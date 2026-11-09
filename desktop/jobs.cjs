const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { splitText } = require('../ui/text.js');

const MAX_PENDING = 10;
const terminal = status => ['complete', 'partial', 'cancelled', 'failed', 'interrupted'].includes(status);
function prepareGeneration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配音文案格式不正确');
  const data = structuredClone(input);
  let rows;
  if (data.rows !== undefined) {
    if (!Array.isArray(data.rows) || !data.rows.length || data.rows.length > 100 || data.rows.some(row => !row || typeof row.text !== 'string' || !row.text.trim())) throw new Error('每次需要 1–100 条有效台词');
    rows = data.rows;
  } else {
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('请先输入需要配音的文字');
    rows = (data.batch ? data.text.split(/\r?\n/).filter(line => line.trim()) : [data.text]).map(text => ({ text }));
  }
  if (rows.reduce((sum, row) => sum + row.text.length, 0) > 5000) throw new Error('每次最多 5000 字，请分成多个任务提交');
  const segments = rows.flatMap(row => {
    const chunks = splitText(row.text);
    return chunks.map((text, index) => ({ ...row, text,
      ...(row.filename && chunks.length > 1 ? { filename: `${row.filename.slice(0, 75)}-${String(index + 1).padStart(3, '0')}` } : {}) }));
  });
  if (segments.length > 100) throw new Error('拆分后超过 100 段，请分成多个任务提交');
  return { ...data, rows: segments, text: undefined, batch: false };
}

function prepareProjectGeneration(input) {
  if (!input || typeof input.projectId !== 'string' || !input.projectId || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 10000) throw new Error('项目需要 1–10000 条有效台词');
  const data = structuredClone(input);
  if (data.rows.some(row => !row || typeof row.text !== 'string' || !row.text.trim() || typeof row.lineId !== 'string' || !row.lineId || !/^[a-f0-9]{32}$/.test(row.lineVersion || ''))) throw new Error('项目台词或声音版本不正确');
  if (data.rows.reduce((sum, row) => sum + row.text.length, 0) > 500000) throw new Error('每个项目任务最多 50 万字');
  // A resumed job already carries the original part numbers and part count.
  const rows = data.rows.flatMap(row => {
    const chunks = splitText(row.text);
    return chunks.map((text, index) => ({ ...row, text, partIndex: row.partIndex ?? index, partCount: row.partCount ?? chunks.length,
      ...(row.filename && chunks.length > 1 ? { filename: `${row.filename.slice(0, 75)}-${String(index + 1).padStart(3, '0')}` } : {}) }));
  });
  return { ...data, rows, text: undefined, batch: false };
}
function generationBatches(rows) {
  const batches = []; let batch = [], characters = 0;
  for (const row of rows) {
    if (batch.length && (batch.length >= 100 || characters + row.text.length > 5000)) { batches.push(batch); batch = []; characters = 0; }
    batch.push(row); characters += row.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// Compact at startup/shutdown and between jobs when the journal exceeds 8 MiB.
// Each durable transition
// appends a transaction containing scalar state and *new* results/checkpoints.
// Sequence numbers make replay safe if a crash happens between snapshot rename
// and journal truncation. An incomplete final append is discarded on reopening.
function createQueueStore(dataDir) {
  const file = path.join(dataDir, 'generation-jobs.json'), journal = `${file}.journal`;
  let sequence = 0, journalSize = 0, repairTail = false, jobs = [], loadError = '';
  const damaged = () => { loadError = '任务记录损坏或不完整，原始队列文件已保留。请恢复备份后重新打开软件；现有音频仍可查看。'; };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    jobs = saved.jobs.filter(job => job?.id && job.data && typeof job.status === 'string');
    sequence = Number.isSafeInteger(saved.sequence) ? saved.sequence : 0;
  } catch (error) { if (error.code !== 'ENOENT') damaged(); }
  const indexed = new Map(jobs.map(job => [job.id, job]));
  try {
    const content = fs.readFileSync(journal);
    let offset = 0;
    while (offset < content.length) {
      const end = content.indexOf(10, offset);
      if (end < 0) break;
      let record;
      try { record = JSON.parse(content.subarray(offset, end).toString('utf8')); } catch { damaged(); break; }
      if (!Number.isSafeInteger(record.sequence) || !Array.isArray(record.changes) || record.changes.some(change => !change ||
        (change.job ? !change.job.id || !Array.isArray(change.job.data?.rows) : typeof change.id !== 'string') ||
        ['items', 'failedRows', 'completedRows'].some(key => change[key] && !Array.isArray(change[key].values)))) { damaged(); break; }
      if (record.sequence > sequence) {
        if (record.sequence !== sequence + 1) { damaged(); break; }
        for (const change of record.changes) {
          if (change.remove) indexed.delete(change.id);
          else if (change.job) indexed.set(change.job.id, change.job);
          else {
            const job = indexed.get(change.id);
            if (!job) continue;
            Object.assign(job, change.state);
            for (const key of ['items', 'failedRows', 'completedRows']) if (change[key]) {
              if (change[key].replace) job[key] = change[key].values;
              else (job[key] ||= []).push(...change[key].values);
            }
          }
        }
        sequence = record.sequence;
      }
      offset = end + 1;
    }
    journalSize = offset; repairTail = offset !== content.length;
    jobs = [...indexed.values()];
  } catch (error) { if (error.code !== 'ENOENT') damaged(); }
  const remembered = new Map();
  function describe(job) {
    const { data, rows, items, failedRows, completedRows, ...state } = job;
    return { state: JSON.stringify(state), arrays: Object.fromEntries(['items', 'failedRows', 'completedRows'].map(key => [key, { value: job[key] || [], length: job[key]?.length || 0 }])) };
  }
  function remember(all) { remembered.clear(); for (const job of all) remembered.set(job.id, describe(job)); }
  remember(jobs);
  function save(all) {
    // A torn final append is recoverable. Fully framed corrupt/gapped records
    // are not: retain the original files instead of compacting away unknown work.
    if (loadError) throw new Error(loadError);
    const changes = [], next = new Map();
    for (const job of all) {
      const before = remembered.get(job.id), after = describe(job); next.set(job.id, after);
      if (!before) { changes.push({ job }); continue; }
      const change = { id: job.id };
      if (before.state !== after.state) change.state = JSON.parse(after.state);
      for (const key of ['items', 'failedRows', 'completedRows']) {
        const old = before.arrays[key], current = after.arrays[key];
        if (old.value !== current.value || old.length > current.length) change[key] = { replace: true, values: current.value };
        else if (old.length < current.length) change[key] = { values: current.value.slice(old.length) };
      }
      if (Object.keys(change).length > 1) changes.push(change);
    }
    for (const id of remembered.keys()) if (!next.has(id)) changes.push({ id, remove: true });
    fs.mkdirSync(dataDir, { recursive: true });
    if (repairTail) {
      try { fs.truncateSync(journal, journalSize); } catch (error) { if (error.code !== 'ENOENT' || journalSize) throw error; }
      repairTail = false;
    }
    if (!changes.length) return;
    const record = JSON.stringify({ sequence: sequence + 1, changes }) + '\n';
    try {
      // flush=true fsyncs each checkpoint before the next segment starts.
      fs.appendFileSync(journal, record, { encoding: 'utf8', flush: true });
    } catch (error) { repairTail = true; throw error; }
    journalSize += Buffer.byteLength(record); sequence++;
    remembered.clear(); for (const [id, value] of next) remembered.set(id, value);
  }
  function compact(all) {
    save(all);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ sequence, jobs: all }), { encoding: 'utf8', flush: true });
    fs.renameSync(`${file}.tmp`, file);
    // Persist the rename before discarding its journal on filesystems that support
    // directory fsync. Windows does not expose a syncable directory descriptor.
    let directory;
    try { directory = fs.openSync(dataDir, 'r'); fs.fsyncSync(directory); }
    catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
    finally { if (directory !== undefined) fs.closeSync(directory); }
    // A failed truncate is safe: replay ignores records already in the snapshot.
    fs.writeFileSync(journal, '', { flush: true }); journalSize = 0; repairTail = false;
  }
  return { jobs, save, compact, compactIfNeeded(all) { if (journalSize > 8 * 1024 * 1024) compact(all); } };
}

// One model owns the GPU/CPU. Queue orchestration lives in the main process,
// independently of renderer navigation, reloads and window minimization.
function createJobQueue({ dataDir, execute, cancel, allow = () => {}, onChange = () => {}, now = Date.now, retryDelay = attempt => attempt * 5000 }) {
  const store = createQueueStore(dataDir);
  let jobs = store.jobs, active = null, closed = false, revision = 0, wakeTimer, retryTimer, releaseRetry, publishTimer, storageError = '';
  const itemIds = new WeakMap(), savedIndices = new WeakMap();
  for (const job of jobs) {
    // Jobs queued by older versions also need stable identities on their first
    // post-upgrade execution. IDs are deterministic within the original job.
    if (['queued', 'scheduled', 'paused'].includes(job.status)) {
      job.data.rows = job.data.rows.map((row, generationRowIndex) => ({ ...row, generationJobId: job.id, generationRowIndex }));
    }
    job.cursor ??= job.completed; job.failedRows ??= []; job.items ??= []; job.pausing = false; job.stopping = false;
    // Legacy checkpoints were sequential except for explicitly failed rows.
    if (!job.completedRows) {
      const failed = new Set(job.failedRows.map(row => row.index));
      job.completedRows = Array.from({ length: Math.max(job.cursor, job.completed) }, (_, index) => index).filter(index => !failed.has(index)).slice(0, job.completed);
    }
    if (job.status === 'running') {
      job.status = 'interrupted'; job.ended = now(); job.error = '上次退出时任务中断，已完成的段落已保留。';
    }
    if (job.status === 'interrupted') {
      recoverCommitted(job);
      if (job.cursor === job.total) {
        job.status = job.failedRows.length ? 'partial' : 'complete'; job.stage = job.status;
        job.error = job.failedRows.length ? `${job.failedRows.length} 段未完成，可只补做失败段落。` : '';
      }
    }
  }
  const pending = () => jobs.filter(job => !terminal(job.status));
  const snapshot = () => ({ revision, concurrency: 1, maxPending: MAX_PENDING, storageError,
    jobs: jobs.map(({ data, requestId, completedRows, ...job }) => structuredClone(job)) });
  function persist(compact = false) {
    try { (compact ? store.compact : store.save)(jobs); storageError = ''; return true; }
    catch (error) { storageError = `任务进度未能保存，请检查磁盘空间和文件权限后重试。${error.message || error}`; return false; }
  }
  function storageFailure() { return Object.assign(new Error(storageError), { code: 'QUEUE_STORAGE' }); }
  function notify() { clearTimeout(publishTimer); publishTimer = null; onChange(snapshot()); }
  function publish({ durable = true, immediate = false } = {}) {
    revision++;
    const saved = !durable || persist();
    // Coalesce UI snapshots separately from durable per-segment checkpoints.
    if (immediate || !saved) notify();
    else if (!publishTimer) { publishTimer = setTimeout(notify, 250); publishTimer.unref?.(); }
    return saved;
  }
  function scheduleWake() {
    clearTimeout(wakeTimer);
    const scheduled = jobs.filter(job => job.status === 'scheduled');
    if (closed || !scheduled.length) return;
    const delay = Math.max(1, Math.min(2147483647, Math.min(...scheduled.map(job => job.scheduledAt)) - now()));
    wakeTimer = setTimeout(pump, delay); wakeTimer.unref?.();
  }
  function stopWaiting() { clearTimeout(retryTimer); releaseRetry?.(); releaseRetry = null; }
  function indices(job) {
    if (!savedIndices.has(job)) savedIndices.set(job, new Set(job.completedRows));
    return savedIndices.get(job);
  }
  function addItems(job, items, offset = job.batchOffset || 0) {
    if (!itemIds.has(job)) itemIds.set(job, new Set(job.items.map(item => item.id)));
    const known = itemIds.get(job), saved = indices(job);
    for (const [position, item] of (items || []).entries()) {
      if (!item?.id || known.has(item.id)) continue;
      const options = item.options;
      const index = options?.generationJobId === job.id && Number.isInteger(options.generationRowIndex) ? options.generationRowIndex
        : options?.managedJobId === job.id && Number.isInteger(options.managedRowIndex) ? options.managedRowIndex : offset + position;
      if (index < 0 || index >= job.total || saved.has(index)) continue;
      job.items.push(item); known.add(item.id); saved.add(index); job.completedRows.push(index);
    }
    job.completed = job.completedRows.length;
  }
  function validCommit(item) {
    // History alone is not proof of a recoverable audio commit. Reject missing,
    // empty, redirected or mismatched output files rather than skipping work.
    if (!/^[a-f0-9]{32}$/.test(item?.id || '')) return false;
    try {
      const output = path.join(dataDir, 'outputs'), folder = path.join(output, item.id);
      if (!fs.lstatSync(output).isDirectory() || !fs.lstatSync(folder).isDirectory()) return false;
      for (const extension of ['wav', 'mp3']) {
        const name = item[extension];
        if (typeof name !== 'string' || !name || /[/\\]/.test(name) || path.extname(name) !== `.${extension}`) return false;
        const stat = fs.lstatSync(path.join(folder, name));
        if (!stat.isFile() || !stat.size) return false;
      }
      const metadataFile = path.join(folder, 'metadata.json');
      if (!fs.lstatSync(metadataFile).isFile()) return false;
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      return metadata.id === item.id && metadata.text === item.text && metadata.sourceText === item.sourceText && metadata.wav === item.wav && metadata.mp3 === item.mp3
        && JSON.stringify(metadata.options) === JSON.stringify(item.options);
    } catch { return false; }
  }
  function recoverCommitted(job) {
    // All queue submissions carry original segment identities, including quick
    // creation and non-managed project batches. Keep legacy managed recovery.
    let history = [];
    try { history = JSON.parse(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')); } catch {}
    if (Array.isArray(history)) for (const item of history) {
      const options = item?.options;
      const modern = options?.generationJobId === job.id;
      const index = modern ? options.generationRowIndex : options?.managedJobId === job.id ? options.managedRowIndex : undefined;
      const row = job.data.rows[index];
      if (!Number.isInteger(index) || !row || indices(job).has(index) || (item.sourceText || item.text) !== row.text) continue;
      if (['lineId', 'lineVersion', 'partIndex'].some(key => options[key] !== row[key])) continue;
      if (!validCommit(item)) continue;
      addItems(job, [item], index);
    }
    const saved = indices(job);
    const unresolved = job.failedRows.filter(failure => !saved.has(failure.index));
    if (unresolved.length !== job.failedRows.length) job.failedRows = unresolved;
    const failed = new Set(job.failedRows.map(failure => failure.index));
    while (saved.has(job.cursor) || failed.has(job.cursor)) job.cursor++;
  }
  function requestStop() {
    // Safety control must never depend on storage or renderer callbacks.
    try { cancel(); } finally { stopWaiting(); }
  }
  async function runManaged(job) {
    while (job.cursor < job.data.rows.length) {
      if (closed || job.stopping) throw new Error('操作已取消');
      if (job.pausing) return;
      const index = job.cursor, row = job.data.rows[index];
      job.batchOffset = index; job.current = index + 1;
      for (let attempt = 0; attempt <= 2; attempt++) {
        job.retryAttempt = attempt; job.stage = 'preparing'; publish({ durable: false });
        try {
          const result = await execute({ ...job.data, managedJobId: job.id, managedRowIndex: index, rows: [row] }, job);
          if (closed) return;
          if (storageError) throw storageFailure();
          addItems(job, result.items, index);
          if (!indices(job).has(index)) throw new Error('这一段没有保存音频');
          job.cursor = index + 1; job.lastError = '';
          if (!publish()) throw storageFailure();
          break;
        } catch (error) {
          if (closed || job.stopping || error.code === 'QUEUE_STORAGE' || storageError) throw error;
          recoverCommitted(job);
          // A clip can be saved before a worker reports an error. Never generate it twice.
          if (job.cursor > index) { if (!publish()) throw storageFailure(); break; }
          job.lastError = String(error.message || error);
          if (job.pausing) return;
          if (attempt < 2) {
            job.stage = 'retrying'; job.retryAttempt = attempt + 1;
            if (!publish()) throw storageFailure();
            await new Promise(resolve => { releaseRetry = resolve; retryTimer = setTimeout(resolve, retryDelay(attempt + 1)); });
            releaseRetry = null;
            if (closed || job.stopping) throw new Error('操作已取消');
            if (job.pausing) return;
          } else {
            job.failedRows.push({ index, error: job.lastError }); job.cursor = index + 1;
            if (!publish()) throw storageFailure();
          }
        }
      }
    }
  }
  async function pump() {
    if (closed || active) return;
    clearTimeout(wakeTimer);
    const job = jobs.find(job => job.status === 'queued' || job.status === 'scheduled' && job.scheduledAt <= now());
    if (!job) { scheduleWake(); return; }
    try { allow(); } catch { return; }
    // Do not start more computation until previously failed checkpoints are saved.
    if (!persist()) {
      job.status = 'failed'; job.stage = 'failed'; job.ended = now(); job.error = storageError;
      revision++; notify(); return;
    }
    active = job; job.status = 'running'; job.started ||= now(); job.stage = 'preparing'; job.ended = null;
    try {
      if (!publish({ immediate: true })) throw storageFailure();
      const remaining = job.data.rows.filter((_row, index) => !indices(job).has(index));
      const batches = job.managed ? [] : job.data.projectBatch ? generationBatches(remaining) : [remaining];
      if (job.managed) await runManaged(job);
      for (const rows of batches) {
        if (!rows.length) continue;
        if (closed || job.stopping) throw new Error('操作已取消');
        job.batchOffset = rows[0].generationRowIndex ?? job.completed;
        const result = await execute({ ...job.data, rows }, job);
        if (!closed) {
          if (storageError) throw storageFailure();
          addItems(job, result.items); job.cursor = job.completed;
          if (!publish()) throw storageFailure();
        }
      }
      if (!closed) {
        job.status = job.stopping ? 'cancelled' : job.pausing && job.cursor < job.total ? 'paused' : job.failedRows.length ? 'partial' : 'complete';
        job.stage = job.status;
        job.error = job.failedRows.length ? `${job.failedRows.length} 段重试后仍未完成，其他音频已保存，可只补做未完成段落。` : '';
      }
    } catch (error) {
      if (!closed) {
        recoverCommitted(job);
        job.status = job.stopping ? 'cancelled' : 'failed'; job.stage = job.status;
        job.error = storageError || String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
      }
    } finally {
      // shutdown already persisted the interrupted state. A late worker rejection
      // must not recreate files or overwrite a newly opened queue's checkpoints.
      if (!closed) {
        job.ended = now(); job.stopping = false; job.pausing = false; active = null;
        const saved = publish({ immediate: true });
        if (saved) {
          // Long-lived desktops also reclaim old transactions, only between jobs.
          try { store.compactIfNeeded(jobs); } catch { /* Durable journal remains recoverable. */ }
          queueMicrotask(pump);
        }
      }
    }
  }
  function submit(input, requestId) {
    if (closed) throw new Error('软件正在退出，请重新打开后提交');
    allow();
    const existing = requestId && jobs.find(job => job.requestId === requestId);
    if (existing) return { id: existing.id, ...snapshot() };
    if (pending().length >= MAX_PENDING) throw new Error('已有 10 个待处理任务，完成或取消一个后再添加');
    const data = input?.projectBatch === true ? prepareProjectGeneration(input) : prepareGeneration(input);
    const managed = data.managed === true;
    if (managed && !data.projectBatch) throw new Error('请先将长文导入配音项目，再开启托管配音');
    const scheduledAt = data.scheduledAt ?? null;
    if (scheduledAt !== null && (!managed || !Number.isSafeInteger(scheduledAt) || scheduledAt <= now() || scheduledAt > now() + 30 * 86400000)) throw new Error('请选择未来 30 天内的开始时间');
    const id = randomUUID();
    data.rows = data.rows.map((row, generationRowIndex) => ({ ...row, generationJobId: id, generationRowIndex }));
    const job = { id, requestId, data, name: String(data.project || '未命名作品').slice(0, 80),
      voiceName: data.rows.length > 1 && new Set(data.rows.map(row => row.voiceName || data.voiceName)).size > 1 ? '多种声音' : data.rows[0]?.voiceName || data.voiceName || '你选择的声音',
      projectId: data.projectId,
      rows: data.rows.map(row => ({ text: row.text, voiceName: row.voiceName || data.voiceName, chapterName: row.chapterName, lineId: row.lineId, lineVersion: row.lineVersion, partIndex: row.partIndex, partCount: row.partCount, ...(row.labId ? { labId: row.labId, labKey: row.labKey } : {}) })),
      total: data.rows.length, characters: data.rows.reduce((sum, row) => sum + row.text.length, 0),
      managed, scheduledAt, cursor: 0, failedRows: [], completedRows: [], retryAttempt: 0, pausing: false,
      completed: 0, current: 1, items: [], status: scheduledAt ? 'scheduled' : 'queued', stage: scheduledAt ? 'scheduled' : 'queued', createdAt: now(), started: null, ended: null, stopping: false, error: '' };
    const previous = jobs;
    jobs = [...jobs, job];
    const recent = jobs.filter(job => terminal(job.status)).slice(-40);
    jobs = jobs.filter(job => !terminal(job.status) || recent.includes(job));
    if (!persist()) { jobs = previous; throw storageFailure(); }
    publish({ durable: false, immediate: true }); queueMicrotask(pump);
    return { id: job.id, ...snapshot() };
  }
  function acceptProgress(event) {
    if (!active || closed) return false;
    if (event.stage === 'clip' && event.item?.id) {
      const saved = indices(active);
      let offset = active.batchOffset || 0;
      while (saved.has(offset)) offset++;
      addItems(active, [event.item], offset);
      if (!active.managed) active.cursor = active.completed;
      else if (saved.has(active.batchOffset)) active.cursor = active.batchOffset + 1;
    }
    if (!active.stopping) {
      if (['loading', 'generating', 'encoding'].includes(event.stage)) active.stage = event.stage;
      if (event.stage === 'clip') active.stage = active.completed === active.total ? 'finishing' : 'between';
      if (Number.isInteger(event.current)) active.current = (active.batchOffset || 0) + event.current;
    }
    if (!publish({ durable: event.stage === 'clip' })) requestStop();
    return true;
  }
  function cancelJob(id) {
    const job = jobs.find(job => job.id === id); if (!job || terminal(job.status)) return snapshot();
    if (job.status === 'running') {
      job.stopping = true;
      // Repeated cancellation is safe and may retry a previously failed signal.
      try { requestStop(); } finally { publish({ immediate: true }); }
    } else { job.status = 'cancelled'; job.stage = 'cancelled'; job.ended = now(); publish({ immediate: true }); queueMicrotask(pump); }
    return snapshot();
  }
  function pause(id) {
    const job = jobs.find(job => job.id === id);
    if (!job?.managed || !['running', 'queued', 'scheduled'].includes(job.status) || job.stopping) throw new Error('这个任务当前无法暂停');
    if (job.status === 'running') { job.pausing = true; stopWaiting(); publish({ immediate: true }); }
    else { job.status = 'paused'; job.stage = 'paused'; publish({ immediate: true }); queueMicrotask(pump); }
    return snapshot();
  }
  function resume(id) {
    const job = jobs.find(job => job.id === id);
    if (!job?.managed || job.status !== 'paused') throw new Error('这个任务当前无需继续');
    allow(); job.status = 'queued'; job.stage = 'queued'; job.scheduledAt = null;
    if (!publish({ immediate: true })) { job.status = 'paused'; job.stage = 'paused'; throw storageFailure(); }
    queueMicrotask(pump);
    return snapshot();
  }
  function retry(id, requestId) {
    const job = jobs.find(job => job.id === id);
    if (!job || !['failed', 'partial', 'interrupted', 'cancelled'].includes(job.status)) throw new Error('这个任务不需要重试');
    recoverCommitted(job);
    const remaining = job.data.rows.filter((_row, index) => !indices(job).has(index));
    if (!remaining.length) { job.status = 'complete'; job.stage = 'complete'; job.error = ''; publish({ immediate: true }); throw new Error('所有段落都已经生成，可直接查看作品'); }
    return submit({ ...job.data, rows: remaining, scheduledAt: null }, requestId);
  }
  function shutdown() {
    if (closed) return;
    closed = true;
    clearTimeout(wakeTimer); clearTimeout(publishTimer); stopWaiting();
    if (active) { active.status = 'interrupted'; active.ended = now(); active.error = '退出时任务中断，已完成的段落已保留。'; }
    try { requestStop(); } finally { persist(true); }
  }
  function forgetItem(id) {
    return forgetItems([id]);
  }
  function forgetJob(id) {
    const job = jobs.find(job => job.id === id);
    if (!job) return snapshot();
    if (!terminal(job.status)) throw new Error('请先停止这个任务，再删除记录');
    const previous = jobs;
    jobs = jobs.filter(job => job.id !== id);
    if (!persist()) { jobs = previous; throw storageFailure(); }
    publish({ durable: false, immediate: true });
    return snapshot();
  }
  function forgetItems(ids) {
    if (pending().length) throw new Error('请等配音完成后再删除作品');
    const removed = new Set(ids);
    let changed = false;
    for (const job of jobs) {
      const retained = job.items.filter(item => !removed.has(item.id));
      if (retained.length !== job.items.length) { changed = true; job.deletedCount = (job.deletedCount || 0) + job.items.length - retained.length; job.items = retained; itemIds.delete(job); }
    }
    jobs = jobs.filter(job => !(terminal(job.status) && job.deletedCount && !job.items.length));
    if (changed && !publish({ immediate: true })) throw storageFailure();
    return snapshot();
  }
  function forgetProject(projectId) {
    if (pending().length) throw new Error('请先完成或取消配音任务，再删除项目');
    const retained = jobs.filter(job => job.projectId !== projectId);
    if (retained.length !== jobs.length) {
      jobs = retained;
      if (!publish({ immediate: true })) throw storageFailure();
    }
    return snapshot();
  }
  persist(true);
  return { submit, snapshot, acceptProgress, cancel: cancelJob, pause, resume, retry, forgetJob, forgetItem, forgetItems, forgetProject, start: pump, shutdown,
    hasPending: () => pending().length > 0, hasRunnable: () => jobs.some(job => ['running', 'queued'].includes(job.status)) };
}
module.exports = { createJobQueue, prepareGeneration, prepareProjectGeneration, generationBatches, splitText, MAX_PENDING };
