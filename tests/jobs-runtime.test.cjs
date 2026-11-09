const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createJobQueue } = require('../desktop/jobs.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
const row = index => ({ text: '隔离回归文稿。'.repeat(5), lineId: `line-${index}`, lineVersion: 'b'.repeat(32), filename: `line-${index}`, voiceName: '旁白' });
const project = count => ({ projectBatch: true, projectId: 'project', managed: true, rows: Array.from({ length: count }, (_, index) => row(index)) });
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-queue-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t, options = {}) {
  const dataDir = directory(t), calls = [], waits = [], changes = [];
  let stops = 0;
  const queue = createJobQueue({ dataDir,
    execute(data) { calls.push(data); return new Promise((resolve, reject) => waits.push({ resolve, reject })); },
    cancel() { stops++; waits.at(-1)?.reject(new Error('cancelled')); },
    onChange(state) { changes.push(state); }, retryDelay: () => 0, ...options });
  t.after(() => queue.shutdown());
  return { dataDir, calls, waits, changes, queue, get stops() { return stops; } };
}
function committed(dataDir, data, index = 0, id = 'a'.repeat(32)) {
  const input = data.rows[index];
  const item = { id, text: input.text, wav: 'voice.wav', mp3: 'voice.mp3', options: { ...data, ...input } };
  delete item.options.rows; delete item.options.text;
  const folder = path.join(dataDir, 'outputs', id); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, item.wav), 'audio fixture'); fs.writeFileSync(path.join(folder, item.mp3), 'audio fixture');
  fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify(item));
  const file = path.join(dataDir, 'history.json');
  const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  fs.writeFileSync(file, JSON.stringify([item, ...history]));
  return item;
}
function failJournal(t, dir, { partial = false } = {}) {
  const original = fs.appendFileSync;
  fs.appendFileSync = (file, data, ...args) => {
    if (file === path.join(dir, 'generation-jobs.json.journal')) {
      if (partial) original(file, Buffer.from(data).subarray(0, 31));
      throw Object.assign(new Error('injected disk full'), { code: 'ENOSPC' });
    }
    return original(file, data, ...args);
  };
  const restore = () => { fs.appendFileSync = original; };
  t.after(restore); return restore;
}

test('cancellation still signals the worker during ENOSPC and repeated clicks can signal again', async t => {
  const f = fixture(t), submitted = f.queue.submit({ text: '正在运行' }); await tick();
  const restore = failJournal(t, f.dataDir);
  assert.doesNotThrow(() => f.queue.cancel(submitted.id));
  assert.doesNotThrow(() => f.queue.cancel(submitted.id));
  assert.equal(f.stops, 2);
  await tick();
  assert.equal(f.queue.snapshot().jobs[0].status, 'cancelled');
  assert.match(f.queue.snapshot().storageError, /disk full/);
  restore();
  f.queue.retry(submitted.id); await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.queue.snapshot().storageError, '');
});

test('shutdown always signals cancellation even when snapshot creation fails, and is idempotent', async t => {
  const f = fixture(t); f.queue.submit({ text: '退出前的文稿' }); await tick();
  const original = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if (file === path.join(f.dataDir, 'generation-jobs.json.tmp')) throw new Error('snapshot ENOSPC');
    return original(file, ...args);
  };
  try { assert.doesNotThrow(() => f.queue.shutdown()); } finally { fs.writeFileSync = original; }
  await tick(); f.queue.shutdown();
  assert.equal(f.stops, 1);
  assert.equal(f.queue.snapshot().jobs[0].status, 'interrupted');
});

test('a failed submission is rolled back and a torn append is repaired before storage is reused', async t => {
  const f = fixture(t), restore = failJournal(t, f.dataDir, { partial: true });
  assert.throws(() => f.queue.submit({ text: '未能提交' }), /disk full/);
  assert.equal(f.queue.snapshot().jobs.length, 0);
  restore(); f.queue.submit({ text: '重新提交' }); await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved' } });
  f.waits[0].resolve({ items: [{ id: 'saved' }] }); await tick();
  f.queue.shutdown();
  const restored = createJobQueue({ dataDir: f.dataDir, execute() {}, cancel() {} }); t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs.length, 1);
  assert.equal(restored.snapshot().jobs[0].rows[0].text, '重新提交');
  assert.equal(restored.snapshot().jobs[0].completed, 1);
});

test('failed record deletion retains the task and can be retried after storage repair', async t => {
  const f = fixture(t), submitted = f.queue.submit({ text: '可以删除的记录' }); await tick();
  f.queue.cancel(submitted.id); await tick();
  const restore = failJournal(t, f.dataDir, { partial: true });
  assert.throws(() => f.queue.forgetJob(submitted.id), /disk full/);
  assert.equal(f.queue.snapshot().jobs[0].id, submitted.id);
  restore();
  assert.equal(f.queue.forgetJob(submitted.id).jobs.length, 0);
  f.queue.shutdown();
  const restored = createJobQueue({ dataDir: f.dataDir, execute() {}, cancel() {} });
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs.length, 0);
});

test('clip checkpoint failure stops computation, retains its in-memory result and resumes queued work after repair', async t => {
  const f = fixture(t); f.queue.submit(project(2)); f.queue.submit({ text: '下一份' }); await tick();
  const restore = failJournal(t, f.dataDir, { partial: true });
  assert.doesNotThrow(() => f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved' } }));
  await tick();
  assert.equal(f.stops, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.queue.snapshot().jobs[0].status, 'failed');
  assert.equal(f.queue.snapshot().jobs[0].completed, 1);
  assert.equal(f.queue.snapshot().jobs[1].status, 'queued');
  restore(); f.queue.start(); await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].rows[0].text, '下一份');
});

test('ordinary batches recover disk commits lost before IPC and retain original row identities across retries', async t => {
  const f = fixture(t), submission = f.queue.submit({ text: '已经完成\n仍未完成', batch: true }); await tick();
  assert.equal(f.calls[0].rows[0].generationJobId, submission.id);
  assert.deepEqual(f.calls[0].rows.map(row => row.generationRowIndex), [0, 1]);
  committed(f.dataDir, f.calls[0]);
  f.waits[0].reject(new Error('worker exited before clip')); await tick();
  assert.equal(f.queue.snapshot().jobs[0].completed, 1);
  const retry = f.queue.retry(submission.id); await tick();
  assert.deepEqual(f.calls[1].rows.map(row => row.text), ['仍未完成']);
  assert.equal(f.calls[1].rows[0].generationJobId, retry.id);
  committed(f.dataDir, f.calls[1], 0, 'b'.repeat(32));
  f.waits[1].reject(new Error('worker exited again')); await tick();
  assert.throws(() => f.queue.retry(retry.id), /所有段落/);
  assert.equal(f.calls.length, 2);
});

test('ordinary restart recovers final committed audio and duplicate history entries only once', async t => {
  const f = fixture(t); f.queue.submit({ text: '最后一句' }); await tick();
  const item = committed(f.dataDir, f.calls[0]);
  fs.writeFileSync(path.join(f.dataDir, 'history.json'), JSON.stringify([item, item]));
  f.queue.shutdown(); await tick();
  const restored = createJobQueue({ dataDir: f.dataDir, execute() { throw new Error('must not regenerate'); }, cancel() {} });
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs[0].status, 'complete');
  assert.equal(restored.snapshot().jobs[0].items.length, 1);
});

test('legacy annotated audio committed before withdrawal is recovered without regenerating fragments', async t => {
  const source = '开头<#0.5#>[[emotion:happy]]开心[[/emotion]]', f = fixture(t);
  f.queue.submit({ text: '开头开心' }); await tick();
  const item = committed(f.dataDir, f.calls[0]); item.sourceText = source; item.text = '开头开心';
  fs.writeFileSync(path.join(f.dataDir, 'outputs', item.id, 'metadata.json'), JSON.stringify(item));
  fs.writeFileSync(path.join(f.dataDir, 'history.json'), JSON.stringify([item]));
  f.queue.shutdown(); await tick();
  const snapshotFile = path.join(f.dataDir, 'generation-jobs.json'), saved = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  saved.jobs[0].data.rows[0].text = source;
  fs.writeFileSync(snapshotFile, JSON.stringify(saved));
  const restored = createJobQueue({ dataDir: f.dataDir, execute() { throw new Error('must not regenerate annotated audio'); }, cancel() {} });
  t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs[0].status, 'complete');
  assert.equal(restored.snapshot().jobs[0].items[0].sourceText, source);
});

test('ordinary project recovery identifies rows beyond a batch boundary and skips only valid saved rows', async t => {
  const f = fixture(t), input = project(102); input.managed = false;
  const submitted = f.queue.submit(input); await tick();
  assert.equal(f.calls[0].rows.length, 100);
  f.waits[0].resolve({ items: f.calls[0].rows.map((row, index) => ({ id: `saved-${index}`, options: row })) }); await tick();
  assert.deepEqual(f.calls[1].rows.map(row => row.generationRowIndex), [100, 101]);
  committed(f.dataDir, f.calls[1]); f.waits[1].reject(new Error('worker died')); await tick();
  f.queue.retry(submitted.id); await tick();
  assert.deepEqual(f.calls[2].rows.map(row => row.lineId), ['line-101']);
});

for (const corruption of ['missing', 'empty', 'mismatched', 'wrong-row', 'symlink']) test(`recovery rejects ${corruption} audio commits`, async t => {
  const f = fixture(t), submitted = f.queue.submit({ text: '需要验证' }); await tick();
  const item = committed(f.dataDir, f.calls[0]), folder = path.join(f.dataDir, 'outputs', item.id);
  if (corruption === 'missing') fs.unlinkSync(path.join(folder, item.wav));
  if (corruption === 'empty') fs.writeFileSync(path.join(folder, item.mp3), '');
  if (corruption === 'mismatched') fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ ...item, id: 'b'.repeat(32) }));
  if (corruption === 'wrong-row') {
    item.options.generationRowIndex = 3;
    fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify(item));
    fs.writeFileSync(path.join(f.dataDir, 'history.json'), JSON.stringify([item]));
  }
  if (corruption === 'symlink') {
    const saved = path.join(f.dataDir, 'saved.wav'); fs.renameSync(path.join(folder, item.wav), saved);
    try { fs.symlinkSync(saved, path.join(folder, item.wav)); } catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation is not permitted on this host'); return; } throw error; }
  }
  f.waits[0].reject(new Error('worker died')); await tick();
  assert.equal(f.queue.snapshot().jobs[0].completed, 0);
  f.queue.retry(submitted.id); await tick();
  assert.equal(f.calls[1].rows[0].text, '需要验证');
});

function crashWithCheckpoint(dataDir) {
  const source = `const {createJobQueue}=require(${JSON.stringify(require.resolve('../desktop/jobs.cjs'))});
    const queue=createJobQueue({dataDir:${JSON.stringify(dataDir)},execute:()=>new Promise(()=>{}),cancel(){}});
    queue.submit({text:'已保存\\n尚未开始',batch:true});
    setImmediate(()=>{queue.acceptProgress({stage:'clip',item:{id:'checkpoint'}});process.exit(0)});`;
  const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
}
for (const tail of ['partial-utf8', 'duplicate-record']) test(`journal replay preserves per-segment checkpoints after abrupt exit and ${tail}`, async t => {
  const dataDir = directory(t); crashWithCheckpoint(dataDir);
  const journal = path.join(dataDir, 'generation-jobs.json.journal');
  const raw = fs.readFileSync(journal);
  if (tail === 'partial-utf8') fs.appendFileSync(journal, Buffer.concat([Buffer.from('{"sequence":4,"text":"'), Buffer.from('中').subarray(0, 2)]));
  if (tail === 'duplicate-record') fs.appendFileSync(journal, raw.toString('utf8').trimEnd().split('\n').at(-1) + '\n');
  const calls = [];
  const restored = createJobQueue({ dataDir, execute: async data => { calls.push(data); return { items: [{ id: 'new' }] }; }, cancel() {} });
  t.after(() => restored.shutdown());
  const job = restored.snapshot().jobs[0];
  assert.equal(job.status, 'interrupted'); assert.equal(job.completed, 1); assert.equal(job.items.length, 1);
  restored.retry(job.id); await tick();
  assert.deepEqual(calls[0].rows.map(row => row.text), ['尚未开始']);
  assert.equal(restored.snapshot().jobs[1].status, 'complete');
});

for (const corruption of ['invalid-json', 'sequence-gap', 'legacy-snapshot']) test(`fully framed ${corruption} corruption is reported without erasing original queue files`, t => {
  const dataDir = directory(t); crashWithCheckpoint(dataDir);
  const journal = path.join(dataDir, 'generation-jobs.json.journal'), snapshot = path.join(dataDir, 'generation-jobs.json');
  if (corruption === 'invalid-json') fs.appendFileSync(journal, '{broken}\n');
  if (corruption === 'sequence-gap') fs.appendFileSync(journal, JSON.stringify({ sequence: 999, changes: [] }) + '\n');
  if (corruption === 'legacy-snapshot') fs.writeFileSync(snapshot, '{"jobs":invalid}');
  const beforeJournal = fs.readFileSync(journal), beforeSnapshot = fs.readFileSync(snapshot);
  const queue = createJobQueue({ dataDir, execute() { throw new Error('corrupt queues must not run'); }, cancel() {} });
  assert.match(queue.snapshot().storageError, /原始队列文件已保留/);
  assert.throws(() => queue.submit({ text: 'must not replace damaged history' }), /原始队列文件已保留/);
  queue.shutdown();
  assert.deepEqual(fs.readFileSync(journal), beforeJournal); assert.deepEqual(fs.readFileSync(snapshot), beforeSnapshot);
});

test('a completed snapshot with an untrimmed journal replays idempotently', async t => {
  const f = fixture(t); f.queue.submit({ text: '一\n二', batch: true }); await tick();
  f.queue.acceptProgress({ stage: 'clip', item: { id: 'saved' } });
  const original = fs.writeFileSync, journal = path.join(f.dataDir, 'generation-jobs.json.journal');
  fs.writeFileSync = (file, data, ...args) => { if (file === journal && data === '') throw new Error('crash before journal truncate'); return original(file, data, ...args); };
  try { f.queue.shutdown(); } finally { fs.writeFileSync = original; }
  await tick(); assert.ok(fs.statSync(journal).size > 0);
  const calls = [], restored = createJobQueue({ dataDir: f.dataDir, execute: async data => { calls.push(data); return { items: [{ id: 'next' }] }; }, cancel() {} });
  t.after(() => restored.shutdown());
  const job = restored.snapshot().jobs[0]; assert.equal(job.items.length, 1); assert.equal(job.completed, 1);
  restored.retry(job.id); await tick(); assert.deepEqual(calls[0].rows.map(row => row.text), ['二']);
});

test('legacy JSON queues migrate without losing schedule, failures, saved results or retry work', async t => {
  const dataDir = directory(t);
  fs.writeFileSync(path.join(dataDir, 'generation-jobs.json'), JSON.stringify({ jobs: [{
    id: 'legacy', data: { ...project(3) }, rows: project(3).rows, managed: true,
    status: 'running', total: 3, cursor: 2, completed: 1, items: [{ id: 'saved' }], failedRows: [{ index: 0, error: 'legacy failure' }]
  }] }));
  const calls = [], queue = createJobQueue({ dataDir, execute: async data => { calls.push(data); return { items: [{ id: data.rows[0].lineId }] }; }, cancel() {} });
  t.after(() => queue.shutdown());
  assert.equal(queue.snapshot().jobs[0].status, 'interrupted');
  queue.retry('legacy'); await tick();
  assert.deepEqual(calls.map(data => data.rows[0].lineId), ['line-0', 'line-2']);
});

test('legacy ordinary queued work receives stable identities before its first post-upgrade execution', async t => {
  const dataDir = directory(t), rows = [{ text: '旧队列第一句' }, { text: '旧队列第二句' }];
  fs.writeFileSync(path.join(dataDir, 'generation-jobs.json'), JSON.stringify({ jobs: [{
    id: 'legacy-queued', data: { rows }, rows, status: 'queued', total: 2, completed: 0, cursor: 0, items: []
  }] }));
  const calls = [];
  const queue = createJobQueue({ dataDir, cancel() {}, execute: async data => {
    calls.push(data);
    if (calls.length === 1) { committed(dataDir, data); throw new Error('exit before IPC'); }
    return { items: [{ id: 'finished' }] };
  } });
  t.after(() => queue.shutdown());
  queue.start(); await tick();
  assert.deepEqual(calls[0].rows.map(row => [row.generationJobId, row.generationRowIndex]), [['legacy-queued', 0], ['legacy-queued', 1]]);
  assert.equal(queue.snapshot().jobs[0].completed, 1);
  queue.retry('legacy-queued'); await tick();
  assert.deepEqual(calls[1].rows.map(row => row.text), ['旧队列第二句']);
});

test('long-lived queues compact bounded journals between jobs while retaining all recent results', async t => {
  const dataDir = directory(t), original = fs.writeFileSync;
  let queue, compactions = 0;
  fs.writeFileSync = (file, data, ...args) => {
    if (file === path.join(dataDir, 'generation-jobs.json.tmp') && queue) {
      const state = JSON.parse(data);
      assert.ok(state.jobs.every(job => job.status === 'complete'), 'compaction ran inside a segment');
      compactions++;
    }
    return original(file, data, ...args);
  };
  try {
    queue = createJobQueue({ dataDir, cancel() {}, execute: async data => ({ items: [{
      id: `${data.rows[0].generationJobId}-${data.managedRowIndex}`, text: data.rows[0].text, options: data.rows[0]
    }] }) });
    for (let index = 0; index < 14; index++) {
      queue.submit(project(800)); await tick();
      assert.equal(queue.snapshot().jobs.at(-1).status, 'complete');
      assert.ok(fs.statSync(path.join(dataDir, 'generation-jobs.json.journal')).size <= 8 * 1024 * 1024);
    }
    assert.ok(compactions >= 1);
    const copy = directory(t);
    for (const file of ['generation-jobs.json', 'generation-jobs.json.journal']) fs.copyFileSync(path.join(dataDir, file), path.join(copy, file));
    const restored = createJobQueue({ dataDir: copy, execute() {}, cancel() {} });
    assert.equal(restored.snapshot().jobs.length, 14);
    assert.ok(restored.snapshot().jobs.every(job => job.completed === 800 && job.items.length === 800));
    restored.shutdown();
  } finally { fs.writeFileSync = original; queue?.shutdown(); }
});

test('transient loading and encoding updates are coalesced without disk checkpoints', async t => {
  const f = fixture(t); f.queue.submit({ text: '文稿' }); await tick();
  const journal = path.join(f.dataDir, 'generation-jobs.json.journal'), before = fs.statSync(journal).size;
  const callbacks = f.changes.length;
  for (let index = 0; index < 100; index++) {
    f.queue.acceptProgress({ stage: 'loading' }); f.queue.acceptProgress({ stage: 'encoding' });
  }
  assert.equal(fs.statSync(journal).size, before);
  assert.equal(f.changes.length, callbacks);
  await new Promise(resolve => setTimeout(resolve, 270));
  assert.equal(f.changes.length, callbacks + 1);
  assert.equal(f.changes.at(-1).jobs[0].stage, 'encoding');
});

test('successful and all-failed managed workloads write linear bounded deltas and coalesce UI callbacks', async t => {
  async function measure(count, fail = false) {
    const dataDir = directory(t), append = fs.appendFileSync, write = fs.writeFileSync;
    let bytes = 0, writes = 0, notifications = 0, maxDelta = 0, queue;
    const journal = path.join(dataDir, 'generation-jobs.json.journal'), snapshot = path.join(dataDir, 'generation-jobs.json.tmp');
    fs.writeFileSync = (file, data, ...args) => { if (file === snapshot) { bytes += Buffer.byteLength(data); writes++; } return write(file, data, ...args); };
    fs.appendFileSync = (file, data, ...args) => {
      if (file === journal) {
        assert.equal(args[0].flush, true, 'each segment must be flushed before continuation');
        bytes += Buffer.byteLength(data); writes++;
        const record = JSON.parse(data);
        for (const change of record.changes) if (!change.job) {
          maxDelta = Math.max(maxDelta, Buffer.byteLength(JSON.stringify(change)));
          assert.ok(!change.state?.rows && !change.state?.data && !change.state?.items);
          for (const key of ['items', 'failedRows', 'completedRows']) if (change[key]) assert.ok(change[key].values.length <= 1, `${key} delta grew with the job`);
        }
      }
      return append(file, data, ...args);
    };
    const started = performance.now();
    try {
      queue = createJobQueue({ dataDir, cancel() {}, retryDelay: () => 0, onChange() { notifications++; }, execute: async data => {
        if (fail) throw new Error('fixture failed');
        const item = { id: `clip-${data.managedRowIndex}`, text: data.rows[0].text, wav: 'voice.wav', mp3: 'voice.mp3', options: { ...data.rows[0] } };
        queue.acceptProgress({ stage: 'generating', current: 1 }); queue.acceptProgress({ stage: 'encoding', current: 1 });
        queue.acceptProgress({ stage: 'clip', item }); return { items: [item] };
      } });
      queue.submit(project(count));
      while (!['complete', 'partial'].includes(queue.snapshot().jobs[0].status)) await new Promise(resolve => setTimeout(resolve, 20));
      queue.shutdown();
      const result = { rows: count, fail, serializedBytes: bytes, writes, maxDelta, callbacks: notifications, elapsedMs: Math.round(performance.now() - started) };
      t.diagnostic(JSON.stringify(result)); return result;
    } finally { fs.appendFileSync = append; fs.writeFileSync = write; queue?.shutdown(); }
  }
  const sizes = [];
  for (const count of [100, 200, 400, 800]) sizes.push(await measure(count));
  for (let index = 1; index < sizes.length; index++) assert.ok(sizes[index].serializedBytes / sizes[index - 1].serializedBytes < 2.2);
  assert.ok(sizes.at(-1).serializedBytes < 5_000_000);
  assert.ok(sizes.at(-1).callbacks < 20);
  const failures = await measure(30, true);
  assert.ok(failures.maxDelta < 2000);
});
