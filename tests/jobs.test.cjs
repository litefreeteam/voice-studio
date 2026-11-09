const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJobQueue, prepareGeneration } = require('../desktop/jobs.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-jobs-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const calls = [], waits = [], updates = [];
  let queue;
  queue = createJobQueue({ dataDir, execute(data) { calls.push(data); return new Promise((resolve, reject) => waits.push({ resolve, reject })); },
    cancel() { waits.at(-1)?.reject(new Error('操作已取消')); }, onChange: state => updates.push(state), ...extra });
  t.after(() => queue.shutdown());
  return { queue, calls, waits, dataDir, updates };
}

test('long text is split within model limits, with options and script filenames retained', () => {
  const text = '这是一个完整的句子。'.repeat(210);
  const prepared = prepareGeneration({ text, voiceName: '知夏', emotion: 'gentle' });
  assert.ok(prepared.rows.length > 1);
  assert.equal(prepared.rows.map(row => row.text).join(''), text);
  assert.ok(prepared.rows.every(row => row.text.length <= 600));
  assert.equal(prepared.emotion, 'gentle');
  const script = prepareGeneration({ rows: [{ text, filename: '角色台词', speaker: 'Serena', emotion: 'sad' }] });
  assert.equal(script.rows[0].filename, '角色台词-001');
  assert.ok(script.rows.every(row => row.emotion === 'sad' && row.speaker === 'Serena'));
  assert.throws(() => prepareGeneration({ text: '字'.repeat(5001) }), /5000/);
  assert.throws(() => prepareGeneration({ rows: [{ text: ' ' }] }), /有效台词/);
});

test('accepts 10 independent tasks, snapshots submitted text, executes exactly one at a time', async t => {
  const f = fixture(t);
  const draft = { text: '第一份文案', project: '第一份' };
  const first = f.queue.submit(draft, 'first-click'); draft.text = '已修改文案';
  assert.equal(f.queue.submit({ text: '重复点击' }, 'first-click').id, first.id);
  for (let index = 1; index < 10; index++) f.queue.submit({ text: `文案 ${index}` });
  assert.throws(() => f.queue.submit({ text: '第十一份' }), /10 个待处理/);
  await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].rows[0].text, '第一份文案');
  assert.equal(f.queue.snapshot().jobs.filter(job => job.status === 'running').length, 1);
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved-1' } });
  f.waits[0].resolve({ items: [{ id: 'saved-1' }] }); await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.queue.snapshot().jobs[0].status, 'complete');
  assert.equal(f.queue.snapshot().concurrency, 1);
  assert.equal(f.queue.snapshot().maxPending, 10);
  assert.equal(f.queue.snapshot().jobs.filter(job => job.status === 'running').length, 1);
});

test('queued cancellation does not stop active work; running cancellation keeps clips and advances queue', async t => {
  const f = fixture(t);
  const first = f.queue.submit({ text: '第一句\n第二句', batch: true });
  const waiting = f.queue.submit({ text: '取消这份' });
  const next = f.queue.submit({ text: '下一份' });
  await tick();
  f.queue.cancel(waiting.id); assert.equal(f.calls.length, 1);
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'first-clip' } });
  f.queue.cancel(first.id); f.queue.cancel(first.id); await tick();
  const state = f.queue.snapshot();
  assert.equal(state.jobs.find(job => job.id === first.id).status, 'cancelled');
  assert.equal(state.jobs.find(job => job.id === first.id).completed, 1);
  assert.equal(state.jobs.find(job => job.id === next.id).status, 'running');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].rows[0].text, '下一份');
  f.queue.retry(first.id, 'retry');
  f.waits[1].resolve({ items: [{ id: 'second-job' }] }); await tick();
  assert.deepEqual(f.calls[2].rows.map(row => row.text), ['第二句']);
});

test('stopped task records can be deleted while a retry runs, preserving audio and the new task across restart', async t => {
  const f = fixture(t);
  const first = f.queue.submit({ text: '已完成\n待继续', batch: true }); await tick();
  const clip = { id: 'saved-clip', text: '已完成' };
  f.queue.acceptProgress({ stage: 'clip', item: clip });
  f.queue.cancel(first.id); await tick();
  const retry = f.queue.retry(first.id); await tick();
  const historyFile = path.join(f.dataDir, 'history.json');
  fs.writeFileSync(historyFile, JSON.stringify([clip]));
  const history = fs.readFileSync(historyFile, 'utf8');
  const result = f.queue.forgetJob(first.id);
  assert.deepEqual(result.jobs.map(job => job.id), [retry.id]);
  assert.equal(result.jobs[0].status, 'running');
  assert.deepEqual(f.calls[1].rows.map(row => row.text), ['待继续']);
  assert.equal(fs.readFileSync(historyFile, 'utf8'), history);
  assert.throws(() => f.queue.retry(first.id), /不需要重试/);
  assert.equal(f.queue.forgetJob(first.id).jobs.length, 1, 'repeated deletion is safe');
  f.queue.shutdown(); await tick();
  const restored = createJobQueue({ dataDir: f.dataDir, execute() {}, cancel() {} });
  t.after(() => restored.shutdown());
  assert.deepEqual(restored.snapshot().jobs.map(job => job.id), [retry.id]);
});

test('empty stopped and failed records can be deleted but running and queued records cannot', async t => {
  const f = fixture(t), first = f.queue.submit({ text: '运行中' }), second = f.queue.submit({ text: '排队中' });
  assert.throws(() => f.queue.forgetJob(second.id), /先停止/); await tick();
  assert.throws(() => f.queue.forgetJob(first.id), /先停止/);
  f.queue.cancel(second.id);
  assert.equal(f.queue.forgetJob(second.id).jobs.length, 1);
  f.waits[0].reject(new Error('生成失败')); await tick();
  assert.equal(f.queue.forgetJob(first.id).jobs.length, 0);
});

test('deleting the last audio also removes its empty stopped record', async t => {
  const f = fixture(t), first = f.queue.submit({ text: '已完成\n未完成', batch: true }); await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved' } });
  f.queue.cancel(first.id); await tick();
  assert.equal(f.queue.forgetItem('saved').jobs.length, 0);
});

test('activation is checked at submission and execution; saved queues wait for reactivation', async t => {
  let activated = false;
  const f = fixture(t, { allow() { if (!activated) throw new Error('请先激活'); } });
  assert.throws(() => f.queue.submit({ text: '未激活' }), /请先激活/);
  assert.equal(f.queue.snapshot().jobs.length, 0);
  activated = true;
  f.queue.submit({ text: '等待执行' });
  activated = false;
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.queue.snapshot().jobs[0].status, 'queued');
  assert.throws(() => f.queue.submit({ text: '新任务' }), /请先激活/);
  activated = true;
  f.queue.start(); await tick();
  assert.equal(f.calls.length, 1);
  f.waits[0].resolve({ items: [] }); await tick();
  assert.equal(f.queue.snapshot().jobs[0].status, 'complete');
});

test('restart retains queued jobs and partial output; interrupted task resumes only unsaved segments', async t => {
  const f = fixture(t);
  const first = f.queue.submit({ text: '已完成\n未完成', batch: true });
  f.queue.submit({ text: '等待的文案' }); await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved' } }); f.queue.shutdown(); await tick();
  const calls = [];
  const restored = createJobQueue({ dataDir: f.dataDir, execute(data) { calls.push(data); return Promise.resolve({ items: data.rows.map((row, index) => ({ id: `new-${index}` })) }); }, cancel() {} });
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs[0].status, 'interrupted');
  assert.equal(restored.snapshot().jobs[0].items[0].id, 'saved');
  restored.retry(first.id); restored.start(); await tick(); await tick();
  assert.deepEqual(calls.map(data => data.rows.map(row => row.text)), [['等待的文案'], ['未完成']]);
});

test('split design scripts and failed-job retries retain the original voice scope, role and revision', async t => {
  const f = fixture(t);
  const voice = { mode: 'design', character: 'meditation-female', voiceScopeId: 'quick-work', voiceId: 'narrator', voiceRevision: 'chosen', lockVoice: true };
  const first = f.queue.submit({ ...voice, text: '一句很长的文稿。'.repeat(120) });
  await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'first', voiceAnchorId: 'a'.repeat(64) } });
  f.waits[0].reject(new Error('模拟生成失败')); await tick();
  f.queue.retry(first.id); await tick();
  assert.equal(f.calls[1].voiceScopeId, voice.voiceScopeId);
  assert.equal(f.calls[1].voiceId, voice.voiceId);
  assert.equal(f.calls[1].voiceRevision, voice.voiceRevision);
  assert.equal(f.calls[1].rows.length, f.calls[0].rows.length - 1);
  f.waits[1].resolve({ items: [{ id: 'remaining' }] }); await tick();
});
