const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJobQueue } = require('../desktop/jobs.cjs');
const { createSleepGuard } = require('../desktop/unattended.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (text, index) => ({ text, lineId: 'line-' + index, lineVersion: 'b'.repeat(32), filename: 'chapter-' + index, chapterName: '第一章', voiceName: '旁白' });
const input = (extra = {}) => ({ projectBatch: true, projectId: 'novel', project: '长篇小说', managed: true, rows: ['开头', '中间', '结尾'].map(row), ...extra });
function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-managed-'));
  const calls = [], waits = [];
  const queue = createJobQueue({ dataDir, retryDelay: () => 0,
    execute(data) { calls.push(data); return new Promise((resolve, reject) => waits.push({ resolve, reject })); },
    cancel() { waits.at(-1)?.reject(new Error('操作已取消')); }, ...options });
  t.after(() => { queue.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { dataDir, calls, waits, queue };
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('Timed out waiting for queue');
}
function finish(f, call) { f.waits[call].resolve({ items: [{ id: 'clip-' + call, options: f.calls[call].rows[0] }] }); }

function committedClip(f, id) {
  const call = f.calls[0], item = { id, text: call.rows[0].text, wav: 'voice.wav', mp3: 'voice.mp3', options: { ...call, ...call.rows[0] } };
  const folder = path.join(f.dataDir, 'outputs', id); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, item.wav), 'audio'); fs.writeFileSync(path.join(folder, item.mp3), 'audio');
  fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify(item));
  fs.writeFileSync(path.join(f.dataDir, 'history.json'), JSON.stringify([item]));
  return item;
}

test('scheduled novels do not block immediate work; start when due and retain schedule after restart', async t => {
  let time = 100000;
  const f = fixture(t, { now: () => time });
  const novel = f.queue.submit(input({ scheduledAt: time + 60000 }));
  f.queue.submit({ text: '白天的短句' }); await tick();
  assert.equal(f.calls[0].rows[0].text, '白天的短句');
  finish(f, 0); await tick();
  assert.equal(f.queue.snapshot().jobs[0].status, 'scheduled');
  assert.equal(f.calls.length, 1);
  f.queue.shutdown(); await tick();
  const calls = [];
  const restored = createJobQueue({ dataDir: f.dataDir, now: () => time, cancel() {}, execute: async data => { calls.push(data); return { items: [{ id: data.rows[0].lineId }] }; } });
  t.after(() => restored.shutdown());
  restored.start(); await tick(); assert.equal(calls.length, 0);
  time += 60000; restored.start(); await tick();
  assert.deepEqual(calls.map(call => call.rows[0].text), ['开头', '中间', '结尾']);
  assert.equal(restored.snapshot().jobs.find(job => job.id === novel.id).status, 'complete');
});

test('managed failures retry twice, skip only the failing segment, and retry preserves part metadata', async t => {
  const f = fixture(t), submitted = f.queue.submit(input()); await tick();
  finish(f, 0); await tick();
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(f.calls[attempt].rows[0].text, '中间');
    f.waits[attempt].reject(new Error('声音引擎暂时失败'));
    await until(() => f.calls.length === attempt + 2);
  }
  assert.equal(f.calls[4].rows[0].text, '结尾'); finish(f, 4); await tick();
  const job = f.queue.snapshot().jobs[0];
  assert.equal(job.status, 'partial'); assert.equal(job.completed, 2); assert.equal(job.cursor, 3);
  assert.deepEqual(job.failedRows, [{ index: 1, error: '声音引擎暂时失败' }]);
  f.queue.retry(submitted.id); await tick();
  assert.equal(f.calls[5].rows.length, 1); assert.equal(f.calls[5].rows[0].text, '中间');
  assert.equal(f.calls[5].rows[0].filename, 'chapter-1'); assert.equal(f.calls[5].rows[0].lineVersion, 'b'.repeat(32));
  finish(f, 5); await tick(); assert.equal(f.queue.snapshot().jobs[1].status, 'complete');
});

test('pause finishes and saves the current segment, releases the queue, then resumes without duplicates', async t => {
  const f = fixture(t), submitted = f.queue.submit(input());
  f.queue.submit({ text: '其他文案' }); await tick();
  f.queue.pause(submitted.id);
  assert.equal(f.queue.snapshot().jobs[0].pausing, true);
  finish(f, 0); await tick();
  assert.equal(f.queue.snapshot().jobs[0].status, 'paused');
  assert.equal(f.calls[1].rows[0].text, '其他文案');
  f.queue.resume(submitted.id); finish(f, 1); await tick();
  assert.equal(f.calls[2].rows[0].text, '中间'); finish(f, 2); await tick();
  assert.equal(f.calls[3].rows[0].text, '结尾'); finish(f, 3); await tick();
  assert.equal(f.queue.snapshot().jobs[0].completed, 3);
  assert.equal(f.queue.snapshot().jobs[0].status, 'complete');
});

test('a saved clip followed by a worker error is not generated twice', async t => {
  const f = fixture(t); f.queue.submit(input()); await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved', options: f.calls[0].rows[0] } });
  f.waits[0].reject(new Error('worker exited after save')); await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].rows[0].text, '中间');
  assert.equal(f.queue.snapshot().jobs[0].failedRows.length, 0);
});

test('a disk commit lost before its progress event is recovered during retry', async t => {
  const f = fixture(t); f.queue.submit(input()); await tick();
  const committed = committedClip(f, 'a'.repeat(32));
  f.waits[0].reject(new Error('worker died before emitting progress')); await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].rows[0].text, '中间');
  assert.equal(f.queue.snapshot().jobs[0].completed, 1);
  assert.equal(f.queue.snapshot().jobs[0].items[0].id, committed.id);
});

test('restart recovers the final disk commit even if no completion event was received', async t => {
  const f = fixture(t); f.queue.submit(input({ rows: [row('最后一段', 0)] })); await tick();
  committedClip(f, 'b'.repeat(32));
  f.queue.shutdown(); await tick();
  let executions = 0;
  const restored = createJobQueue({ dataDir: f.dataDir, cancel() {}, execute: async () => { executions++; return { items: [] }; } });
  t.after(() => restored.shutdown());
  restored.start(); await tick();
  assert.equal(executions, 0); assert.equal(restored.snapshot().jobs[0].status, 'complete');
  assert.equal(restored.snapshot().jobs[0].completed, 1);
});

test('restart recovery retains both successful and failed checkpoints and retries only outstanding work', async t => {
  const f = fixture(t), submitted = f.queue.submit(input()); await tick();
  for (let attempt = 0; attempt < 3; attempt++) {
    f.waits[attempt].reject(new Error('首段失败'));
    await until(() => f.calls.length === attempt + 2);
  }
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved-middle', options: f.calls[3].rows[0] } });
  f.queue.shutdown(); await tick();
  const calls = [];
  const restored = createJobQueue({ dataDir: f.dataDir, cancel() {}, execute: async data => { calls.push(data); return { items: [{ id: data.rows[0].lineId }] }; } });
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs[0].status, 'interrupted');
  restored.retry(submitted.id); await tick();
  assert.deepEqual(calls.map(call => call.rows[0].text), ['开头', '结尾']);
});

test('cancelling a retry wait stops immediately, keeps checkpoints and advances the queue', async t => {
  const f = fixture(t, { retryDelay: () => 60000 }), submitted = f.queue.submit(input());
  f.queue.submit({ text: '下一项' }); await tick();
  f.waits[0].reject(new Error('暂时失败')); await tick();
  assert.equal(f.queue.snapshot().jobs[0].stage, 'retrying');
  f.queue.cancel(submitted.id); await tick();
  assert.equal(f.queue.snapshot().jobs[0].status, 'cancelled');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].rows[0].text, '下一项');
});

test('schedule validation rejects invalid dates and supports cancelling or pausing reservations', async t => {
  const time = Date.now(), f = fixture(t, { now: () => time });
  for (const scheduledAt of [time - 1, time + 31 * 86400000, 'tomorrow', NaN]) assert.throws(() => f.queue.submit(input({ scheduledAt })), /30 天/);
  assert.throws(() => f.queue.submit({ text: '短句', managed: true }), /配音项目/);
  const scheduled = f.queue.submit(input({ scheduledAt: time + 60000 }));
  f.queue.pause(scheduled.id); await tick(); assert.equal(f.calls.length, 0);
  f.queue.resume(scheduled.id); await tick(); assert.equal(f.calls.length, 1);
  const other = f.queue.submit(input({ scheduledAt: time + 60000 }));
  f.queue.cancel(other.id); assert.equal(f.queue.snapshot().jobs[1].status, 'cancelled');
});

test('the scheduler starts a due reservation automatically without renderer polling', async t => {
  const f = fixture(t);
  f.queue.submit(input({ scheduledAt: Date.now() + 30 })); await tick();
  assert.equal(f.calls.length, 0);
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].rows[0].text, '开头');
});

test('sleep guard keeps scheduled or running managed work awake, allows screen sleep, and releases on pause or completion', () => {
  const calls = [], guard = createSleepGuard({ start(type) { calls.push(type); return 0; }, stop(id) { calls.push(id); } });
  const snapshot = status => ({ jobs: [{ managed: true, status }] });
  guard.update(snapshot('scheduled')); guard.update(snapshot('running'));
  assert.deepEqual(calls, ['prevent-app-suspension']);
  guard.update(snapshot('paused')); assert.deepEqual(calls, ['prevent-app-suspension', 0]);
  guard.update(snapshot('queued')); guard.update(snapshot('partial'));
  guard.update({ jobs: [{ managed: false, status: 'running' }] });
  guard.stop(); assert.deepEqual(calls, ['prevent-app-suspension', 0, 'prevent-app-suspension', 0]);
});
