const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../ui/projects.js');

function fixture(statuses = ['complete', 'complete']) {
  const project = M.create('导出测试');
  project.chapters[0].lines = statuses.map((_, index) => M.line('第 ' + (index + 1) + ' 句。', project.roles[0].id));
  const entries = M.entries(project).map((entry, index) => {
    const options = { projectId: project.id, chapterId: entry.chapter.id, lineId: entry.line.id, filename: 'line-' + (index + 1), text: entry.line.text, partCount: 1, partIndex: 0 };
    return { ...entry, options, status: statuses[index], clips: statuses[index] === 'new' || statuses[index] === 'unassigned' ? [] : [{ id: 'clip-' + index, options: { ...options } }] };
  });
  return { project, entries };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Eligibility is shared with the dialog, not inferred from the presence of any old clip.
test('delivery defaults preserve original silence and use speech RMS leveling with 350 ms gaps', () => {
  assert.deepEqual(M.DELIVERY_DEFAULTS, { sampleRate: 48000, normalize: true, trimSilence: false, pauseMs: 350, includeSegments: true });
  assert.equal(M.deliverySnapshot(fixture()).partial, false);
});

test('project delivery timing is shared by snapshots and explicit overrides', () => {
  const data = fixture();
  data.project.deliverySettings = { ...M.DELIVERY_DEFAULTS, trimSilence: true, pauseMs: 80 };
  const snapshot = M.deliverySnapshot(data);
  assert.equal(snapshot.settings.trimSilence, true); assert.equal(snapshot.settings.pauseMs, 80);
  assert.equal(M.deliverySnapshot({ ...data, settings: { pauseMs: 150 } }).settings.pauseMs, 150);
  data.project.deliverySettings.pauseMs = 0;
  assert.equal(snapshot.settings.pauseMs, 80, 'an in-flight delivery keeps its frozen settings');
  assert.equal(M.deliverySnapshot(fixture()).settings.pauseMs, 350, 'unrelated projects keep their defaults');
});

test('missing, changed and processing lines block complete delivery even if clips exist', () => {
  const data = fixture(['complete', 'new', 'changed', 'pending', 'unassigned']);
  const readiness = M.deliveryReadiness(data.entries);
  assert.deepEqual([readiness.total, readiness.complete, readiness.missing, readiness.changed, readiness.pending, readiness.canExport], [5, 1, 2, 1, 1, false]);
  assert.throws(() => M.deliverySnapshot(data), /尚未完整/);
  assert.throws(() => M.deliverySnapshot(fixture(['new', 'pending'])), /没有完整可用/);
  assert.throws(() => M.deliverySnapshot(fixture([])), /没有台词/);
});

test('explicit partial consent exports only complete current lines and labels omissions', () => {
  const data = fixture(['complete', 'changed', 'pending', 'new', 'complete']);
  assert.throws(() => M.deliverySnapshot({ ...data, allowPartial: false }), /确认/);
  const snapshot = M.deliverySnapshot({ ...data, allowPartial: true, scopeLabel: '整个项目' });
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.totalLines, 5); assert.equal(snapshot.exportedLines, 2); assert.equal(snapshot.skippedLines, 3);
  assert.deepEqual(snapshot.items.map(item => item.id), ['clip-0', 'clip-4']);
  assert.equal(snapshot.scopeLabel, '整个项目');
});

test('long-line partial parts are never included as a completed sentence', () => {
  const data = fixture(['complete', 'changed']);
  data.entries[1].clips[0].options.partCount = 2;
  assert.deepEqual(M.deliverySnapshot({ ...data, allowPartial: true }).items.map(item => item.id), ['clip-0']);
  data.entries[1].status = 'complete'; // Even a mistaken status must not bypass part completeness.
  assert.equal(M.deliveryReadiness(data.entries).complete, 1);
  data.entries[1].clips.push({ id: 'clip-part-2', options: { ...data.entries[1].clips[0].options, partIndex: 1 } });
  const snapshot = M.deliverySnapshot(data);
  assert.deepEqual(snapshot.items.slice(1).map(item => item.partIndex), [0, 1]);
  assert.equal(snapshot.items[1].lineId, snapshot.items[2].lineId, 'adjacent parts retain line identity for gap-free joins');
});

test('range changes recompute completeness and retain current order without mutating source', () => {
  const data = fixture(['complete', 'new', 'complete']);
  assert.throws(() => M.deliverySnapshot({ ...data, scopeLabel: '整个项目' }), /尚未完整/);
  const selected = [data.entries[2], data.entries[0]];
  const snapshot = M.deliverySnapshot({ project: data.project, entries: selected, scopeLabel: '选中台词' });
  assert.deepEqual(snapshot.items.map(item => item.id), ['clip-2', 'clip-0']);
  assert.equal(snapshot.partial, false); assert.equal(snapshot.totalLines, 2);
  assert.equal(data.entries.length, 3);
});

test('submitted project name, items, original filenames, scope and settings are immutable snapshots', async () => {
  const data = fixture(), settings = { pauseMs: 600, includeSegments: false };
  const snapshot = M.deliverySnapshot({ ...data, settings, scopeLabel: '当前章节' });
  data.project.name = '另一个名字'; data.entries[0].options.filename = 'changed'; data.entries[0].clips[0].id = 'new-take'; settings.pauseMs = 0;
  assert.equal(snapshot.projectName, '导出测试'); assert.equal(snapshot.items[0].id, 'clip-0'); assert.equal(snapshot.items[0].exportFilename, 'line-1'); assert.equal(snapshot.settings.pauseMs, 600);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.items[0]) && Object.isFrozen(snapshot.settings));
  const task = deferred(); let sent;
  const controller = M.createDeliveryController({ api: (action, args) => { sent = args; return task.promise; }, requestId: () => 'snapshot-test' });
  const pending = controller.submit(snapshot);
  sent.projectName = 'transport mutation'; sent.items[0].id = 'transport-clip';
  assert.equal(controller.getState().snapshot.projectName, '导出测试'); assert.equal(controller.getState().snapshot.items[0].id, 'clip-0');
  task.resolve({ saved: true, count: 2, durationSeconds: 3 }); await pending;
  assert.equal(controller.getState().phase, 'complete');
});

test('repeated export clicks share one operation and only its request-scoped progress is accepted', async () => {
  const task = deferred(), calls = [], snapshot = M.deliverySnapshot(fixture());
  const controller = M.createDeliveryController({ api: (action, args) => { calls.push({ action, args }); return task.promise; }, requestId: () => 'delivery-one' });
  const first = controller.submit(snapshot), second = controller.submit(snapshot);
  assert.strictEqual(first, second); assert.equal(calls.length, 1);
  assert.equal(controller.progress({ stage: 'generation', requestId: 'delivery-one' }), false);
  assert.equal(controller.progress({ stage: 'delivery', requestId: 'another-export' }), false);
  assert.equal(controller.progress({ stage: 'delivery', requestId: 'delivery-one', projectId: 'other-project' }), false);
  assert.equal(controller.progress({ stage: 'delivery', requestId: 'delivery-one', projectId: snapshot.projectId, phase: 'render', current: 1, total: 2 }), true);
  assert.equal(controller.getState().progress.current, 1);
  task.resolve({ saved: true }); await first;
  assert.equal(controller.progress({ stage: 'delivery', requestId: 'delivery-one' }), false);
});

test('cancel targets only this export, including an immediate cancel after submit', async () => {
  const task = deferred(), calls = [];
  const controller = M.createDeliveryController({ api: (action, args) => { calls.push({ action, args }); return action === 'project-export' ? task.promise : Promise.resolve(true); }, requestId: () => 'cancel-me' });
  const pending = controller.submit(M.deliverySnapshot(fixture()));
  assert.equal(await controller.cancel(), true); assert.equal(await controller.cancel(), false);
  assert.deepEqual(calls.map(call => call.action), ['project-export', 'project-export-cancel']);
  assert.deepEqual(calls[1].args, { requestId: 'cancel-me' });
  assert.equal(controller.getState().phase, 'cancelling');
  task.resolve({ saved: false, cancelled: true }); await pending;
  assert.equal(controller.getState().phase, 'cancelled');
  assert.equal(controller.getState().snapshot.settings.pauseMs, 350);
});

test('cancel failure keeps the live export available for another request', async () => {
  const task = deferred(); let failures = 1;
  const controller = M.createDeliveryController({ api: action => action === 'project-export' ? task.promise : failures-- ? Promise.reject(new Error('暂不可用')) : Promise.resolve(true) });
  const pending = controller.submit(M.deliverySnapshot(fixture()));
  assert.equal(await controller.cancel(), false); assert.equal(controller.getState().phase, 'running');
  assert.match(controller.getState().error, /未能停止/);
  assert.equal(await controller.cancel(), true);
  task.reject(new Error('已取消')); await pending;
  assert.equal(controller.getState().phase, 'cancelled');
});

test('failed export keeps settings and supports a distinct retry without losing quality warnings', async () => {
  const snapshot = M.deliverySnapshot({ ...fixture(), settings: { pauseMs: 500, trimSilence: true, includeSegments: false } });
  let count = 0;
  const controller = M.createDeliveryController({ api: () => ++count === 1 ? Promise.reject(new Error('磁盘空间不足')) : Promise.resolve({ saved: true, warnings: [{ code: 'ORIGINAL_CLIPPING', id: 'clip-0' }] }), requestId: () => 'attempt-' + (count + 1) });
  await controller.submit(snapshot);
  assert.equal(controller.getState().phase, 'failed'); assert.match(controller.getState().error, /磁盘空间不足/);
  assert.equal(controller.getState().snapshot.settings.pauseMs, 500);
  const firstRequest = controller.getState().requestId;
  await controller.submit(controller.getState().snapshot);
  assert.equal(controller.getState().phase, 'complete'); assert.notEqual(controller.getState().requestId, firstRequest);
  assert.equal(controller.getState().snapshot.settings.trimSilence, true);
  assert.equal(controller.getState().result.warnings[0].code, 'ORIGINAL_CLIPPING');
});

test('switching projects cancels the previous export and ignores its late completion and progress', async () => {
  const old = deferred(), next = deferred(), calls = []; let number = 0;
  const controller = M.createDeliveryController({ api: (action, args) => { calls.push({ action, args }); return action === 'project-export-cancel' ? Promise.resolve(true) : args.projectName === '新项目' ? next.promise : old.promise; }, requestId: () => 'request-' + ++number });
  const prior = controller.submit(M.deliverySnapshot(fixture())); controller.reset();
  const data = fixture(); data.project.name = '新项目'; const current = controller.submit(M.deliverySnapshot(data));
  assert.equal(controller.progress({ stage: 'delivery', requestId: 'request-1', phase: 'render' }), false);
  old.resolve({ saved: true, count: 999 }); await prior;
  assert.equal(controller.getState().phase, 'running'); assert.equal(controller.getState().snapshot.projectName, '新项目');
  assert.deepEqual(calls.find(call => call.action === 'project-export-cancel').args, { requestId: 'request-1' });
  next.resolve({ saved: true, count: 2 }); await current;
  assert.equal(controller.getState().result.count, 2);
});

test('save-dialog cancellation and bounded setting validation remain retryable', async () => {
  const controller = M.createDeliveryController({ api: () => Promise.resolve({ saved: false }) });
  await controller.submit(M.deliverySnapshot(fixture())); assert.equal(controller.getState().phase, 'cancelled');
  for (const settings of [{ pauseMs: -1 }, { pauseMs: 3001 }, { pauseMs: 1.5 }, { sampleRate: 123 }, { normalize: 'yes' }]) assert.throws(() => M.deliverySnapshot({ ...fixture(), settings }), /检查导出设置/);
});

// Exercise the actual dialog functions and handlers with a minimal DOM adapter.
// Native focus trapping, pixel layout and the OS save dialog need desktop QA.
function dialogFixture(data = fixture(['complete', 'new'])) {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../ui/project-workspace.js'), 'utf8'), nodes = new Map(), calls = [], exports = [];
  let context;
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', checked: false, hidden: false, disabled: false, textContent: '', children: [], open: false, isConnected: true, listeners: {},
      get childElementCount() { return this.children.length; },
      append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, removeAttribute(name) { delete this[name]; },
      showModal() { this.open = true; }, close() { this.open = false; }, reportValidity() { return true; },
      focus() { context.document.activeElement = this; }, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return nodes.get(selector);
  };
  const api = (action, args) => {
    calls.push({ action, args });
    if (action === 'project-export') { const task = deferred(); exports.push({ ...task, args }); return task.promise; }
    return Promise.resolve(true);
  };
  context = vm.createContext({ M, project: data.project, chapterId: data.project.chapters[0].id,
    deliveryProjectId: '', deliveryReturnFocus: null, deliveryReviewKey: '', deliveryCloseAfterCancel: false,
    document: { activeElement: get('#project-delivery') }, window: { CustomSelects: { sync() {} } },
    $: get, scoped: scope => scope === 'selected' ? [data.entries[0]] : data.entries,
    node: (tag, cls, text) => ({ tag, className: cls, textContent: text }), cleanError: value => String(value.message || value), hooks: { api } });
  const start = source.indexOf('  function deliveryScopeLabel('), end = source.indexOf('  function renderManagedStatus()', start);
  const eventsStart = source.indexOf("  $('#project-delivery').onclick = openDelivery;"), eventsEnd = source.indexOf("  $('#project-import').onclick = importDialog;", eventsStart);
  assert.ok(start > 0 && end > start && eventsStart > 0 && eventsEnd > eventsStart);
  vm.runInContext(source.slice(start, end) + '\n' + source.slice(eventsStart, eventsEnd), context);
  context.delivery = M.createDeliveryController({ api, onChange: () => context.renderDelivery() });
  get('#project-generation-scope').value = 'all'; get('#project-delivery-normalize').checked = true; get('#project-delivery-segments').checked = true; get('#project-delivery-pause').value = '350';
  return { context, get, data, calls, exports, open: () => context.openDelivery(),
    change: (selector, value) => { get(selector).value = value; get(selector).onchange(); },
    submit: () => context.submitDelivery({ preventDefault() {} }) };
}

test('actual dialog requires explicit partial choice and consent; changing scope clears consent', async () => {
  const f = dialogFixture(); f.open();
  assert.equal(f.get('#project-delivery-submit').disabled, true);
  assert.match(f.get('#project-delivery-ready').textContent, /1 \/ 2/);
  f.change('#project-delivery-completeness', 'available');
  assert.equal(f.get('#project-delivery-partial').hidden, false);
  assert.equal(f.get('#project-delivery-submit').disabled, true);
  f.get('#project-delivery-partial-confirm').checked = true; f.get('#project-delivery-partial-confirm').onchange();
  assert.equal(f.get('#project-delivery-submit').disabled, false);
  f.change('#project-delivery-scope', 'selected');
  assert.equal(f.get('#project-delivery-partial-confirm').checked, false);
  assert.equal(f.get('#project-delivery-submit').disabled, false);
  f.change('#project-delivery-scope', 'all');
  assert.equal(f.get('#project-delivery-submit').disabled, true, 'prior range consent never carries into a broader range');
  await f.submit(); assert.equal(f.calls.length, 0);
  f.get('#project-delivery-partial-confirm').checked = true; f.get('#project-delivery-partial-confirm').onchange();
  const operation = f.submit();
  assert.equal(f.exports[0].args.partial, true); assert.equal(f.exports[0].args.items.length, 1);
  f.exports[0].resolve({ saved: true }); await operation;
  assert.match(f.get('#project-delivery-success-title').textContent, /节选/);
});

test('actual dialog Escape asks before stopping and normal dismissal restores the opener', async () => {
  const f = dialogFixture(fixture()); f.open();
  const operation = f.submit();
  let prevented = false;
  f.get('#project-delivery-dialog').listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.get('#project-delivery-dialog').open, true);
  assert.equal(f.get('#project-delivery-close-confirm').hidden, false);
  assert.equal(f.calls.filter(call => call.action === 'project-export-cancel').length, 0);
  f.get('#project-delivery-keep').onclick(); assert.equal(f.get('#project-delivery-close-confirm').hidden, true);
  await f.get('#project-delivery-cancel').onclick();
  assert.equal(f.calls.at(-1).action, 'project-export-cancel');
  f.exports[0].resolve({ saved: false, cancelled: true }); await operation;
  assert.equal(f.get('#project-delivery-submit').disabled, false);
  f.get('#project-delivery-close').onclick();
  assert.equal(f.get('#project-delivery-dialog').open, false);
  assert.equal(f.context.document.activeElement, f.get('#project-delivery'));
});

test('actual dialog failure preserves settings and retry displays readable quality warnings', async () => {
  const f = dialogFixture(fixture()); f.open(); f.get('#project-delivery-pause').value = '720';
  const operation = f.submit(); f.exports[0].reject(new Error('磁盘空间不足')); await operation;
  assert.equal(f.get('#project-delivery-pause').value, '720'); assert.match(f.get('#project-delivery-error').textContent, /磁盘空间不足/);
  assert.equal(f.get('#project-delivery-submit').textContent, '重试导出');
  const retry = f.submit();
  assert.equal(f.exports[1].args.settings.pauseMs, 720);
  f.exports[1].resolve({ saved: true, count: 2, durationSeconds: 59.9, warnings: [{ code: 'ORIGINAL_CLIPPING', id: 'clip-0' }] }); await retry;
  assert.match(f.get('#project-delivery-success-detail').textContent, /1 分 0 秒/);
  assert.match(f.get('#project-delivery-warnings').children[0].textContent, /削波/);
  assert.equal(f.get('#project-delivery-submit').hidden, true);
});

test('actual dialog preserves the submitted summary during processing and isolates project navigation', async () => {
  const f = dialogFixture(); f.open(); f.change('#project-delivery-completeness', 'available');
  f.get('#project-delivery-partial-confirm').checked = true; f.get('#project-delivery-partial-confirm').onchange();
  const operation = f.submit();
  f.data.entries[1].status = 'complete'; f.data.entries[1].clips = [{ id: 'now-ready', options: { partIndex: 0, partCount: 1 } }];
  f.context.renderDelivery();
  assert.match(f.get('#project-delivery-ready').textContent, /1 \/ 2/, 'live generation cannot rewrite the export summary');
  assert.match(f.get('#project-delivery-partial-note').textContent, /跳过 1 句/);
  f.context.dismissDeliveryForNavigation();
  assert.equal(f.get('#project-delivery-dialog').open, false);
  const next = M.create('新项目'); f.context.project = next;
  f.exports[0].resolve({ saved: true, count: 99 }); await operation;
  assert.equal(f.context.delivery.getState().phase, 'idle');
  assert.equal(f.calls.at(-1).action, 'project-export-cancel');
});

test('closing while export wins the cancellation race tells the user the file was saved', async () => {
  const f = dialogFixture(fixture()), notes = []; f.context.hooks.toast = text => notes.push(text); f.open();
  const operation = f.submit();
  await f.get('#project-delivery-stop-close').onclick();
  f.exports[0].resolve({ saved: true, count: 2 }); await operation;
  assert.equal(f.get('#project-delivery-dialog').open, false);
  assert.match(notes[0], /已保存/);
  assert.equal(f.context.document.activeElement, f.get('#project-delivery'));
  await f.submit(); assert.equal(f.exports.length, 1, 'a completed hidden form cannot resubmit implicitly');
});

test('delivery controls retain silence by default and exported instructions disclose peak and subtitle limits', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  const instructions = fs.readFileSync(path.join(__dirname, '../backend/delivery.py'), 'utf8');
  assert.match(source, /id="project-delivery-normalize"[^>]*checked/);
  const trim = source.match(/<input[^>]*id="project-delivery-trim"[^>]*>/)[0];
  assert.doesNotMatch(trim, /checked/);
  assert.match(source, /SRT 按音频段对齐，不是逐字字幕/);
  assert.match(instructions, /关闭RMS均衡时仍保留样本峰值保护，可能降低音量/);
  assert.match(instructions, /不是逐字ASR对齐/);
});
