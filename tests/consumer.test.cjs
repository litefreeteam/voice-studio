const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'shared/catalog.json')));

// Exercise the actual playback/filter functions without an Electron window or model.
// UI rendering and native audio are separately checked in the desktop application.
function client({ invoke, storage } = {}) {
  const elements = [], selectors = new Map(), calls = [], audio = [];
  let progressListener;
  const intervals = new Map();
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.className = ''; this.value = ''; this.attributes = {}; this.listeners = {}; this._text = ''; elements.push(this); }
    get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    get firstElementChild() { return this.children[0]; }
    get lastElementChild() { return this.children.at(-1); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    replaceWith(node) { this.parentNode?.insertBefore(node, this); this.remove(); }
    insertBefore(node, before) { node.remove(); const index = this.children.indexOf(before); node.parentNode = this; if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
    contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
    querySelectorAll(selector) { const direct = selector.startsWith(':scope > '); const cls = selector.replace(':scope > ', '').slice(1); const nodes = direct ? this.children : this.children.flatMap(child => [child, ...child.descendants()]); return nodes.filter(node => node.classList.contains(cls)); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getAttribute(name) { return this.attributes[name]; }
    replaceChildren(...children) { this._text = ''; for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    scrollIntoView() {}
    focus() {}
    addEventListener(name, listener) { this.listeners[name] = listener; }
    get classList() {
      const node = this;
      return {
        contains: name => node.className.split(' ').includes(name),
        toggle(name, on) {
          const names = new Set(node.className.split(' ').filter(Boolean));
          const show = on ?? !names.has(name); if (show) names.add(name); else names.delete(name);
          node.className = [...names].join(' '); return show;
        },
        add(name) { this.toggle(name, true); }, remove(name) { this.toggle(name, false); }
      };
    }
  }
  const document = {
    createElement: tag => new Node(tag), createTextNode: text => { const node = new Node('text'); node.textContent = text; return node; },
    querySelector(selector) {
      if (!selectors.has(selector)) { const node = new Node(); node.id = selector.startsWith('#') ? selector.slice(1) : ''; selectors.set(selector, node); }
      return selectors.get(selector);
    },
    querySelectorAll(selector) {
      if (selector.startsWith('.')) return elements.filter(x => x.classList.contains(selector.slice(1)));
      if (selector === '[data-filter]') return elements.filter(x => x.dataset.filter);
      if (selector === '[data-view]') return elements.filter(x => x.dataset.view);
      return [];
    }
  };
  document.querySelector('#generate').append(document.createElement('span'), document.querySelector('#generate-label'), document.querySelector('#generate-arrow'));
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.duration = 8; this.currentTime = 0; audio.push(this); }
    async play() { this.paused = false; this.onplay?.(); }
    pause() { this.paused = true; this.onpause?.(); }
  }
  class TestURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const source = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
  const bootstrap = source.indexOf('async function initializeWorkspace()');
  assert.ok(bootstrap > 0);
  const context = vm.createContext({ document, Audio, URL: TestURL, Blob, crypto,
    window: { scrollTo() {}, location: { href: 'file://' + path.join(root, 'ui/index.html') }, studio: { async invoke(action, data) { calls.push({ action, data }); return invoke ? invoke(action, data) : new Uint8Array([1, 2]); }, onProgress(callback) { progressListener = callback; } } },
    GenerationProgress: require('../ui/progress.js'), WorkHistory: require('../ui/history.js'), setInterval(callback) { const id = intervals.size + 1; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); },
    setTimeout: () => 1, clearTimeout() {}, localStorage: storage || { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {} }
  });
  new vm.Script(source.slice(0, bootstrap) + '\nglobalThis.client = {state, previewVoice, stopPreview, renderLibrary, renderSceneFilters, generate, moveGenerationToBackground, cancelJob, cancelOperation, renderHistory, renderHistoryFilters, filteredHistory, changeHistoryPage, changeHistoryFilters, resetHistory, exportHistory, playClip, getTask(){return jobTask(backgroundJobs.find(job=>job.id===inlineJobId)) || generationTask}, setCatalog(value){catalog=value}, setScene(value){sceneFilter=value}, currentVoice};').runInContext(context);
  context.client.setCatalog(catalog);
  context.client.state.license = { activated: true };
  return { ...context.client, navigate: view => vm.runInContext(`navigate(${JSON.stringify(view)})`, context),
    evaluate: code => vm.runInContext(code, context),
    renderPackages: () => vm.runInContext('renderPackages()', context),
    renderDownload: download => { context.downloadFixture = download; vm.runInContext('packageDownload = downloadFixture; renderPackageDownload()', context); },
    document, audio, calls, intervals, progress: event => progressListener(event) };
}

test('quick creation shares voice identity between batches and individual rows and requests both packages', () => {
  const c = client();
  const values = { '#language': 'Chinese', '#scene': 'dialogue', '#pace': 'normal', '#intensity': '50', '#engine': 'standard',
    '#prefix': 'voice', '#sample-rate': '24000', '#project-name': '作品', '#voice-description': '温暖自然的成年女性声音' };
  for (const [id, value] of Object.entries(values)) c.document.querySelector(id).value = value;
  c.document.querySelector('#lock-voice').checked = true;
  c.state.voiceKey = 'design:meditation-female'; c.state.emotion = 'gentle';
  const settings = c.evaluate('settings()');
  const row = c.evaluate("rowOptions({voiceKey:'design:meditation-female',text:'第一句',emotion:'happy'})");
  assert.equal(row.voiceScopeId, settings.voiceScopeId); assert.equal(row.voiceId, settings.voiceId);
  assert.equal(row.voiceDescription, settings.voiceDescription, 'switching from text to dialogue retains an edited character description');
  assert.equal(row.voiceRevision, settings.voiceRevision); assert.equal(row.emotion, 'gentle');
  assert.deepEqual([...c.evaluate('requiredPackages()')], ['character', 'reference']);
  c.state.packages = [{ id: 'character', ready: true }];
  assert.deepEqual([...c.evaluate('neededPackages()')], ['reference']);
  c.state.voiceKey = 'preset:Vivian';
  assert.equal(c.evaluate('sessionSnapshot().options.voiceScopeId'), settings.voiceScopeId, 'mixed scripts retain their scope with a preset selected');
  c.document.querySelector('#lock-voice').checked = false;
  const free = c.evaluate("rowOptions({voiceKey:'design:meditation-female',text:'自由设计',emotion:'happy'})");
  assert.equal(free.lockVoice, false); assert.equal(free.emotion, 'happy');
});

test('quick podcast directions reach each stable speaker without affecting fixed or reference-only voices', () => {
  const c = client();
  for (const [id, value] of Object.entries({ '#language': 'Chinese', '#scene': 'dialogue', '#pace': 'normal', '#intensity': '30', '#engine': 'standard', '#sample-rate': '48000', '#instruction': '整体轻松聊天' })) c.document.querySelector(id).value = value;
  c.state.voiceKey = 'preset:Serena';
  const row = c.evaluate("rowOptions({voiceKey:'preset:Serena',text:'真的吗？',emotion:'natural',pace:'fast',instruction:'好奇地追问'})");
  assert.equal(row.speaker, 'Serena'); assert.equal(row.instruction, '好奇地追问'); assert.equal(row.pace, 'fast');
  assert.equal(c.evaluate("rowOptions({voiceKey:'preset:Dylan',text:'当然',emotion:'natural'}).instruction"), '整体轻松聊天');
  c.document.querySelector('#lock-voice').checked = true; c.state.voiceKey = 'design:podcast-female';
  assert.equal(c.evaluate("rowOptions({voiceKey:'design:podcast-female',text:'固定人物',instruction:'单句要求'}).instruction"), '整体轻松聊天');
  c.state.references = [{ id: 'reference', name: '录音', text: '准确原话' }]; c.document.querySelector('#reference-style').value = 'original';
  assert.equal(c.evaluate("rowOptions({voiceKey:'clone:reference',text:'复刻',instruction:'单句要求'}).instruction"), '');
});

test('voice preparation opens the merged settings page and selects its only navigation entry', () => {
  const c = client();
  const account = c.document.querySelector('#view-account'); account.className = 'view hidden';
  const editor = c.document.querySelector('#view-editor'); editor.className = 'view';
  const nav = c.document.createElement('button'); nav.dataset.view = 'account';
  c.document.querySelector('#engine').value = 'standard';
  c.navigate('downloads');
  assert.equal(account.classList.contains('hidden'), false);
  assert.equal(editor.classList.contains('hidden'), true);
  assert.equal(nav.getAttribute('aria-current'), 'page');
  assert.equal(nav.classList.contains('active'), true);
  c.navigate('editor');
  assert.equal(nav.getAttribute('aria-current'), undefined);
  c.navigate('account');
  assert.equal(account.classList.contains('hidden'), false);
});

test('resources expose only install and update actions with all four packages directly available', () => {
  const c = client();
  c.state.packages = [{ id: 'standard', ready: true }];
  c.renderPackages();
  const grid = c.document.querySelector('#package-grid'), cards = grid.children;
  assert.deepEqual(cards.map(card => card.dataset.package), ['standard', 'light', 'character', 'reference']);
  assert.equal(cards[0].querySelector('.package-download').textContent, '检查更新');
  assert.equal(cards[3].querySelector('.package-download').textContent, '安装');
  assert.equal(cards[0].querySelector('.package-menu'), null);
  assert.doesNotMatch(grid.textContent, /挑选声音|AI 批量配音|使用/);
});

test('complete resources include fixed-voice dependencies and distinguish legacy files awaiting verification', () => {
  const c = client();
  c.state.packages = ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true, verified: id !== 'reference' }));
  c.state.resources = { plan: { packages: c.state.packages.map(pack => ({ id: pack.id, downloadBytes: 0 })) } };
  c.renderPackages();
  assert.match(c.document.querySelector('#resources-state').textContent, /3 \/ 4/);
  assert.equal(c.document.querySelector('#resources-prepare').textContent, '补齐剩余资源');
  assert.match(c.document.querySelector('#resources-size').textContent, /待校验/);
  assert.equal(c.evaluate("readyFor({ mode: 'design', lockVoice: true })"), false);
  const reference = c.document.querySelector('#package-grid').children[3];
  assert.equal(reference.querySelector('.package-state').textContent, '待校验');
  assert.equal(reference.querySelector('.package-download').textContent, '校验并准备');
});

test('update feedback stays on its resource card through checking, transfer and completion', () => {
  const c = client(); c.state.packages = [{ id: 'standard', ready: true }]; c.renderPackages();
  const [card, other] = c.document.querySelector('#package-grid').children;
  const download = { id: 'standard', updating: true, status: 'running', stage: 'preparing', current: 0, total: null, message: '正在检查资源…' };
  c.renderDownload(download);
  assert.equal(card.querySelector('.package-download').textContent, '检查中');
  assert.equal(card.querySelector('.package-cancel').hidden, false);
  assert.equal(other.querySelector('.package-progress').hidden, true);
  c.renderDownload({ ...download, stage: 'download', current: 400000000, total: 1600000000 });
  assert.equal(card.querySelector('.package-state').textContent, '25%');
  assert.equal(card.querySelector('.package-description').textContent, '400.0 MB / 1.60 GB');
  c.renderDownload({ ...download, status: 'cancelled' });
  assert.equal(card.querySelector('.package-download').textContent, '继续更新');
  assert.equal(card.querySelector('.package-state').textContent, '已暂停');
  c.renderDownload({ ...download, status: 'failed', message: '下载连接中断' });
  assert.equal(card.querySelector('.package-download').textContent, '重试更新');
  assert.equal(card.querySelector('.package-description').textContent, '下载连接中断');
  c.renderDownload({ ...download, status: 'complete' });
  assert.equal(card.querySelector('.package-state').textContent, '已是最新');
  assert.equal(card.querySelector('.package-download').textContent, '检查更新');
  assert.equal(card.querySelector('.package-cancel').hidden, true);
});

test('all shipped voice definitions have valid scenario tags and preview metadata', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ui/assets/previews/manifest.json')));
  assert.equal(Object.keys(manifest.items).length, catalog.voices.length + catalog.characters.length);
  const scenes = new Set(catalog.scenes.map(s => s.id));
  for (const [mode, entries] of [['preset', catalog.voices], ['design', catalog.characters]]) for (const voice of entries) {
    assert.ok(voice.scenes.length >= 2);
    assert.ok(voice.scenes.every(s => scenes.has(s)), voice.id);
    const entry = manifest.items[`${mode}:${voice.id}`];
    assert.ok(entry, `${mode}:${voice.id}`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(voice.preview.sha256, entry.sha256);
    assert.ok(voice.preview.duration > 1);
    assert.equal(voice.preview.text, entry.text);
    if (voice.reference) {
      assert.match(voice.reference.file, /^voice-[a-z0-9-]+\.mp3$/);
      const sample = fs.readFileSync(path.join(root, 'backend', voice.reference.file));
      assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), voice.reference.sha256);
      assert.equal(voice.reference.sha256, entry.sha256, 'curated audition and synthesis sample must be identical');
      assert.equal(voice.reference.text, voice.preview.text);
      assert.equal(voice.reference.language, voice.language || 'Chinese');
    }
  }
});

test('all shipped voice recordings are present and match their manifest hashes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ui/assets/previews/manifest.json')));
  const problems = [];
  for (const [mode, entries] of [['preset', catalog.voices], ['design', catalog.characters]]) for (const voice of entries) {
    try {
      const bytes = fs.readFileSync(path.join(root, 'ui', voice.preview.file));
      assert.ok(bytes.length > 1000, 'recording is incomplete');
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.items[`${mode}:${voice.id}`].sha256);
    } catch (error) { problems.push(`${voice.preview.file}: ${error.code || error.message}`); }
  }
  assert.deepEqual(problems, [], 'Genuine preview recordings are required; catalog metadata is not an audio fixture.');
});

test('offline preview never invokes inference or changes voice, draft, history or results', async () => {
  const c = client();
  c.state.packages = [];
  c.state.results = [{ id: 'existing-result' }];
  c.state.history = [{ id: 'existing-history' }];
  const original = JSON.stringify(c.state);
  await c.previewVoice('design:girl-clear');
  assert.equal(c.calls.length, 0);
  assert.equal(JSON.stringify(c.state), original);
  assert.match(c.audio[0].src, /assets\/previews\/girl-clear\.mp3$/);
  assert.equal(c.audio[0].paused, false);
  assert.equal(c.document.querySelector('#sample-name').textContent, '小雨 · 声音示例');
  await c.previewVoice('design:girl-clear');
  assert.equal(c.audio[0].paused, true);
  await c.previewVoice('design:girl-clear');
  assert.equal(c.audio.length, 1);
  assert.equal(c.audio[0].paused, false);
  await c.previewVoice('preset:Vivian');
  assert.equal(c.audio[0].paused, true);
  assert.equal(c.audio[1].paused, false);
  c.stopPreview();
  assert.equal(c.audio[1].paused, true);
  assert.ok(c.document.querySelector('#sample-player').classList.contains('hidden'));
});

test('saved voice preview reads original recording; custom descriptions never auto-generate', async () => {
  const c = client();
  c.state.references = [{ id: 'a'.repeat(32), name: '我的声音', duration: 6, text: '原话' }];
  await c.previewVoice('clone:' + 'a'.repeat(32));
  assert.deepEqual(c.calls.map(x => x.action), ['reference-audio']);
  assert.equal(c.audio[0].src, 'blob:test');
  await c.previewVoice('design:custom');
  assert.equal(c.calls.length, 1);
  assert.equal(c.audio[0].paused, true);
});

test('scenario filters and keyword search select voices using the visible scene tags', () => {
  const c = client();
  c.setScene('bedtime'); c.renderLibrary();
  const cards = c.document.querySelector('#voice-grid').children;
  assert.ok(cards.length > 0 && cards.length < catalog.voices.length + catalog.characters.length);
  for (const card of cards) assert.ok(c.currentVoice(card.dataset.voice).scenes.includes('bedtime'));
  c.setScene('all'); c.document.querySelector('#voice-search').value = '课程讲解'; c.renderLibrary();
  for (const card of c.document.querySelector('#voice-grid').children) assert.ok(c.currentVoice(card.dataset.voice).scenes.includes('course'));
  c.document.querySelector('#voice-search').value = '不存在的关键词'; c.renderLibrary();
  assert.match(c.document.querySelector('#voice-grid').textContent, /暂时没找到/);
});

test('generation submits asynchronously, prevents double submission and isolates task outputs', async () => {
  let resolveSubmission;
  const c = client({ invoke(action) {
    if (action === 'jobs-submit') return new Promise(resolve => { resolveSubmission = resolve; });
    return { history: [], packages: [], references: [] };
  } });
  const pending = c.generate({ text: '第一份文案' });
  assert.equal(c.state.busy, false);
  await c.generate({ text: '双击提交' });
  assert.equal(c.calls.filter(call => call.action === 'jobs-submit').length, 1);
  const first = { id: 'job-1', name: '第一份', status: 'running', stage: 'generating', createdAt: 1000, started: 1000, ended: null, total: 2, completed: 0, current: 1, characters: 6, rows: [{ text: '第一段' }, { text: '第二段' }], items: [], stopping: false };
  resolveSubmission({ id: first.id, revision: 1, jobs: [first] }); await pending;
  assert.equal(c.getTask().running, true); assert.equal(c.intervals.size, 1);
  c.moveGenerationToBackground();
  const clip = { id: 'saved', text: '第一段', duration: 5, wav: 'voice.wav', options: {} };
  c.progress({ type: 'jobs', revision: 2, jobs: [{ ...first, completed: 1, items: [clip] }] });
  assert.equal(c.state.results.length, 1);
  assert.equal(c.document.querySelector('#generation-count').textContent, '已完成 1 / 2 段');
  c.progress({ type: 'jobs', revision: 1, jobs: [first] });
  assert.equal(c.state.results.length, 1);
  const next = { ...first, id: 'job-2', name: '第二份', status: 'queued', stage: 'queued', items: [], completed: 0 };
  const submission = c.generate({ text: '新的文案' });
  resolveSubmission({ id: next.id, revision: 3, jobs: [{ ...first, completed: 1, items: [clip] }, next] }); await submission;
  assert.equal(c.state.results.length, 1);
  c.progress({ type: 'jobs', revision: 4, jobs: [{ ...first, completed: 1, items: [clip] }, next] });
  assert.equal(c.state.results.length, 1); assert.equal(c.state.busy, false);
});

test('cancel targets one background task and preserves completed output', async () => {
  const first = { id: 'job-1', name: '第一份', status: 'running', stage: 'generating', createdAt: 1000, started: 1000, total: 2, completed: 1, current: 2, characters: 6, rows: [{ text: '第一段' }, { text: '第二段' }], items: [{ id: 'saved', text: '第一段', wav: 'saved.wav', options: {} }] };
  const c = client({ invoke(action) {
    if (action === 'jobs-submit') return { id: first.id, revision: 1, jobs: [first] };
    if (action === 'jobs-cancel') return { revision: 2, jobs: [{ ...first, status: 'cancelled', stage: 'cancelled', ended: 2000 }] };
    return { history: [], packages: [], references: [] };
  } });
  await c.generate({ text: '第一段\n第二段', batch: true });
  await c.cancelJob(first.id);
  assert.equal(c.calls.filter(call => call.action === 'jobs-cancel').length, 1);
  assert.equal(c.calls.find(call => call.action === 'jobs-cancel').data.id, first.id);
  assert.equal(c.getTask().stage, 'cancelled'); assert.equal(c.state.results.length, 1);
  assert.equal(c.intervals.size, 0); assert.equal(c.state.busy, false);
});

function workFixtures(count = 31) {
  return Array.from({ length: count }, (_, index) => ({ id: `work-${index}`, text: `第 ${index + 1} 段文案`, project: index < 26 ? '旅行旁白' : '晚安故事', voiceName: '知夏', wav: `work-${index}.wav`, duration: 6, createdAt: 100000 + index, options: { scene: 'video' } }));
}

test('work page shows a bounded page, resets on filters and handles no matches without exporting', async () => {
  const c = client(); c.state.history = workFixtures();
  c.document.querySelector('#history-page-size').value = '12';
  c.renderHistoryFilters(); c.renderHistory();
  assert.equal(c.document.querySelector('#history').children.length, 12);
  assert.equal(c.document.querySelector('#history-total').textContent, '31');
  c.changeHistoryPage(3);
  assert.equal(c.document.querySelector('#history').children.length, 7);
  assert.match(c.document.querySelector('#history-summary').textContent, /25–31/);
  c.document.querySelector('#history-project').value = '旅行旁白'; c.changeHistoryFilters();
  assert.match(c.document.querySelector('#history-page-info').textContent, /1 \/ 3/);
  assert.equal(c.document.querySelector('#history').children[0].dataset.clipId, 'work-25');
  assert.match(c.document.querySelector('#history-export-label').textContent, /筛选结果 · 26 条/);
  c.document.querySelector('#history-search').value = '没有这段文案'; c.changeHistoryFilters();
  assert.match(c.document.querySelector('#history').textContent, /暂时没找到/);
  assert.equal(c.document.querySelector('#history-export').disabled, true);
  assert.equal(c.document.querySelector('#history-pagination').classList.contains('hidden'), true);
  await c.exportHistory(); assert.equal(c.calls.length, 0);
  c.resetHistory(); assert.equal(c.filteredHistory().length, 31);
});

test('project audio stays out of work lists, counts, filters, search and exports', async () => {
  const works = workFixtures();
  const projectAudio = [
    { ...works[0], id: 'project-only', project: '配音项目', voiceName: '项目专属声音', options: { projectId: 'project-1', scene: 'game' } },
    { ...works[0], id: 'same-name-project', options: { projectId: 'project-2', scene: 'video' } }
  ];
  const history = [...projectAudio, ...works], before = JSON.stringify(history);
  const c = client({ invoke(action) {
    if (action === 'zip') return { saved: true, count: works.length };
    return { history, packages: [], references: [] };
  } });
  c.state.history = history; c.renderHistoryFilters(); c.renderHistory(); c.evaluate('update()');
  assert.equal(c.document.querySelector('#history-total').textContent, '31');
  assert.equal(c.document.querySelector('#history-count').textContent, '31');
  assert.equal(c.document.querySelector('#history').children.length, 12);
  for (const [key, excluded] of [['project', '配音项目'], ['voice', '项目专属声音'], ['scene', 'game']]) {
    assert.equal(c.document.querySelector('#history-' + key).children.some(option => option.value === excluded), false);
  }
  assert.equal(c.evaluate("selectDetails(document.querySelector('#history-project'), {value: '旅行旁白'}).description"), '26 条作品');
  c.document.querySelector('#history-search').value = '项目专属声音'; c.changeHistoryFilters();
  assert.equal(c.filteredHistory().length, 0);
  c.resetHistory(); await c.exportHistory();
  const zip = c.calls.find(call => call.action === 'zip');
  assert.deepEqual([...zip.data.ids], works.toReversed().map(item => item.id));
  assert.equal(JSON.stringify(c.state.history), before, 'all project audio remains available in shared media');
});

test('project-only audio arriving from background jobs keeps My Works empty', () => {
  const c = client();
  c.evaluate(`applyJobs({ revision: 1, jobs: [{ id: 'project-job', name: '配音项目', projectId: 'project-1',
    status: 'complete', rows: [], total: 1, completed: 1,
    items: [{ id: 'project-clip', text: '项目台词', project: '配音项目', options: { projectId: 'project-1' } }] }] });`);
  assert.equal(c.state.history.length, 1);
  assert.equal(c.filteredHistory().length, 0);
  assert.equal(c.document.querySelector('#history-count').textContent, '0');
  assert.equal(c.document.querySelector('#history-total').textContent, '0');
  assert.match(c.document.querySelector('#history').textContent, /去创作第一段配音/);
  assert.doesNotMatch(c.document.querySelector('#history').textContent, /清空筛选/);
  assert.equal(c.document.querySelector('#history-export').disabled, true);
  c.resetHistory(); assert.equal(c.filteredHistory().length, 0);
});

test('work export includes every matched page in chosen format and blocks repeated requests', async () => {
  let finish;
  const works = workFixtures();
  const c = client({ invoke(action) {
    if (action === 'zip') return new Promise(resolve => { finish = resolve; });
    return { history: works, packages: [], references: [] };
  } });
  c.state.history = works; c.document.querySelector('#history-project').value = '旅行旁白';
  c.document.querySelector('#history-page-size').value = '12'; c.document.querySelector('#history-export-format').value = 'mp3';
  c.changeHistoryPage(2);
  const pending = c.exportHistory(); await c.exportHistory();
  const zip = c.calls.filter(call => call.action === 'zip');
  assert.equal(zip.length, 1); assert.equal(zip[0].data.ids.length, 26); assert.equal(zip[0].data.format, 'mp3');
  assert.equal(zip[0].data.ids[0], 'work-25'); assert.equal(zip[0].data.ids[25], 'work-0');
  assert.equal(c.document.querySelector('#history-export').disabled, true);
  finish({ saved: true, count: 26 }); await pending;
  assert.equal(c.document.querySelector('#history-export').disabled, false);
});

test('bulk work selection persists across pages and versions and prunes hidden works on filtering', () => {
  const c = client(); c.state.history = workFixtures(); c.renderHistory();
  c.evaluate("selectHistory('page')");
  assert.equal(c.evaluate('selectedHistory().length'), 12);
  c.changeHistoryPage(2); c.evaluate("selectHistory('page')");
  assert.equal(c.evaluate('selectedHistory().length'), 24);
  assert.equal(c.document.querySelector('#history-select-page').checked, true);
  c.evaluate("selectHistory('page', false)");
  assert.equal(c.evaluate('selectedHistory().length'), 12);
  c.evaluate("selectHistory('all')");
  assert.equal(c.evaluate('selectedHistory().length'), 31);
  c.document.querySelector('#history-project').value = '晚安故事'; c.changeHistoryFilters();
  assert.equal(c.evaluate('historySelection.size'), 5);
  c.resetHistory(); assert.equal(c.evaluate('selectedHistory().length'), 5);
  c.evaluate("selectHistory('clear')"); assert.equal(c.document.querySelector('#history-bulk-panel').inert, true);

  const original = c.state.history[0];
  c.evaluate('historySelection.add("work-0")');
  c.state.history.unshift({ ...original, id: 'new-take', options: { ...original.options, generationGroupId: original.id } });
  c.state.audioSelections = { 'work-0': 'new-take' }; c.renderHistory();
  assert.deepEqual([...c.evaluate('selectedHistory().map(item => item.id)')], ['new-take']);
});

test('bulk download snapshots only checked current versions and keeps selection on cancel and failure', async () => {
  let finish, fail;
  const works = workFixtures(), c = client({ invoke(action) {
    if (action === 'zip') return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    return { history: works, packages: [], references: [] };
  } });
  c.state.history = works; c.document.querySelector('#history-export-format').value = 'wav'; c.renderHistory();
  c.evaluate('historySelection.add("work-0"); historySelection.add("work-30"); updateHistorySelection()');
  let pending = c.evaluate('downloadSelectedHistory()'); await c.evaluate('downloadSelectedHistory()');
  assert.equal(c.calls.filter(call => call.action === 'zip').length, 1);
  assert.deepEqual([...c.calls.find(call => call.action === 'zip').data.ids], ['work-30', 'work-0']);
  assert.equal(c.calls.find(call => call.action === 'zip').data.format, 'wav');
  assert.equal(c.document.querySelector('#history-bulk-download').disabled, true);
  assert.equal(c.document.querySelector('#history-select-page').disabled, true);
  finish({ saved: false }); await pending;
  assert.equal(c.evaluate('historySelection.size'), 2);
  assert.equal(c.document.querySelector('#history-bulk-download').disabled, false);
  pending = c.evaluate('downloadSelectedHistory()'); fail(new Error('保存失败')); await pending;
  assert.equal(c.evaluate('historySelection.size'), 2);
  assert.equal(c.document.querySelector('#history-bulk-download').disabled, false);
});

test('changing work pages cancels pending playback and stops the previous page audio', async () => {
  let finish;
  const c = client({ invoke: () => new Promise(resolve => { finish = resolve; }) });
  c.state.history = workFixtures(); c.renderHistory();
  const button = c.document.createElement('button');
  const pending = c.playClip(c.state.history[0], button, '#history');
  c.changeHistoryPage(2); finish(new Uint8Array([1, 2])); await pending;
  assert.equal(c.audio.length, 0); assert.equal(button.textContent, '▶');
  const playback = c.playClip(c.state.history[0], button, '#history'); finish(new Uint8Array([1, 2])); await playback;
  assert.equal(c.audio[0].paused, false);
  c.changeHistoryPage(1); assert.equal(c.audio[0].paused, true);
});

test('UI-01: edited reference transcripts follow their reference across scripts, projects, labs and restart', async () => {
  const stored = new Map(), storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  const references = [{ id: 'ref-a', name: '录音甲', text: '' }, { id: 'ref-b', name: '录音乙', text: '乙的原话' }];
  const c = client({ storage }); c.state.references = structuredClone(references); c.state.voiceKey = 'clone:ref-a';
  c.document.querySelector('#reference-text').value = '我刚填写的准确参考原话。';
  c.evaluate('rememberReferenceText()');
  assert.equal(c.evaluate("rowOptions({voiceKey:'clone:ref-a',text:'新台词'}).referenceText"), '我刚填写的准确参考原话。');
  assert.equal(c.evaluate("rowOptions({voiceKey:'clone:ref-b',text:'另一段'}).referenceText"), '乙的原话', 'never reuse the other recording transcript');
  const source = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
  for (const start of ['projectWorkspace = window.createProjectWorkspace({', 'laboratory = window.createLaboratory({']) {
    const section = source.slice(source.indexOf(start)), resolver = section.match(/resolveVoice: (key => \{[\s\S]*?\n    \}),/)[1];
    const resolved = c.evaluate(`(${resolver})('clone:ref-a')`);
    assert.equal(resolved.referenceText, '我刚填写的准确参考原话。');
  }
  const next = client({ storage, invoke: async (action, data) => { assert.equal(action, 'update-reference'); return { ...references.find(reference => reference.id === data.id), text: data.text }; } });
  next.state.references = structuredClone(references); next.state.voiceKey = 'clone:ref-b';
  assert.equal(next.evaluate("rowOptions({voiceKey:'clone:ref-a',text:'重启后的台词'}).referenceText"), '我刚填写的准确参考原话。');
  await next.evaluate('flushReferenceTexts()');
  assert.equal(next.state.references[0].text, '我刚填写的准确参考原话。');
  assert.equal(stored.get('shengyue-reference-texts-1'), '{}');
  const reopened = client({ storage }); reopened.state.references = structuredClone(next.state.references);
  assert.equal(reopened.evaluate("voices().find(voice => voice.id === 'ref-a').text"), '我刚填写的准确参考原话。');
});

test('UI-01: reference saves serialize late edits, retain failures and retry without replacing newer text', async () => {
  const stored = new Map(), storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  const pending = []; let fail = false;
  const c = client({ storage, invoke: (action, data) => {
    assert.equal(action, 'update-reference'); if (fail) return Promise.reject(new Error('busy'));
    return new Promise(resolve => pending.push({ data, resolve }));
  } });
  c.state.references = [{ id: 'ref', name: '参考', text: '旧文字' }]; c.state.voiceKey = 'clone:ref';
  const input = c.document.querySelector('#reference-text'); input.value = '第一次编辑'; c.evaluate('rememberReferenceText()');
  const operation = c.evaluate('flushReferenceTexts()');
  input.value = '等待时继续编辑'; c.evaluate('rememberReferenceText()'); c.evaluate('flushReferenceTexts()');
  assert.equal(pending.length, 1, 'only one in-flight write');
  pending[0].resolve({ id: 'ref', text: pending[0].data.text });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2); assert.equal(pending[1].data.text, '等待时继续编辑');
  assert.equal(c.evaluate("voices().find(voice => voice.id === 'ref').text"), '等待时继续编辑');
  pending[1].resolve({ id: 'ref', text: pending[1].data.text }); await operation;
  assert.equal(c.state.references[0].text, '等待时继续编辑');
  fail = true; input.value = '失败也要保留'; c.evaluate('rememberReferenceText()');
  await assert.rejects(c.evaluate('flushReferenceTexts()'), /busy/);
  assert.equal(c.evaluate("rowOptions({voiceKey:'clone:ref',text:'新台词'}).referenceText"), '失败也要保留');
  assert.equal(JSON.parse(stored.get('shengyue-reference-texts-1')).ref, '失败也要保留');
  fail = false; const retry = c.evaluate('flushReferenceTexts()'); pending[2].resolve({ id: 'ref', text: pending[2].data.text }); await retry;
  assert.equal(c.state.references[0].text, '失败也要保留');
});

test('UI-07: scheduled and paused tasks do not block existing result/history/project ZIP exports', async () => {
  const c = client(), source = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
  const exportHook = source.match(/export: (async \(items, format\) => \{[\s\S]*?\n    \})/)[1];
  c.state.results = [{ id: 'existing' }];
  c.evaluate('outputJobIds.add("done"); globalThis.exportCalls = []; operate = async (action, data) => { exportCalls.push({action, data}); return {saved:true}; };');
  for (const status of ['scheduled', 'paused']) {
    c.evaluate(`backgroundJobs = [{id:'done',status:'complete',items:[{id:'existing',text:'成品',duration:1,options:{}}],rows:[],current:1,total:1,completed:1},{id:'waiting',status:'${status}',items:[],rows:[],current:1,total:1,completed:0}]; update(); updateHistoryExport([{id:'existing'}]);`);
    assert.equal(c.document.querySelector('#export-zip').disabled, false);
    assert.equal(c.document.querySelector('#history-export').disabled, false);
    assert.equal(c.document.querySelector('#history-export-format').disabled, false);
    assert.equal((await c.evaluate(`(${exportHook})([{id:'existing',exportFilename:'新文件名'}],'mp3')`)).saved, true);
  }
  assert.equal(c.evaluate('exportCalls.length'), 2);
  assert.equal(c.evaluate('exportCalls[0].data.items[0].exportFilename'), '新文件名');
  for (const status of ['running', 'queued']) {
    c.evaluate(`backgroundJobs = [{id:'busy',status:'${status}',items:[]}]; updateHistoryExport([{id:'existing'}]);`);
    assert.equal(c.document.querySelector('#history-export').disabled, true);
    assert.equal(await c.evaluate(`(${exportHook})([{id:'existing'}],'mp3')`), null);
  }
});

test('UI-01: whitespace is normalized and explicitly cleared transcripts never revive saved configuration text', async () => {
  const c = client({ invoke: async (action, data) => {
    assert.equal(action, 'update-reference'); return { id: data.id, text: data.text.trim(), textUpdatedAt: 12345 };
  } });
  c.state.references = [{ id: 'ref', name: '参考', text: '以前的原话' }]; c.state.voiceKey = 'clone:ref';
  const input = c.document.querySelector('#reference-text'); input.value = '  准确原话 \n'; c.evaluate('rememberReferenceText()');
  await c.evaluate('flushReferenceTexts()');
  assert.equal(c.state.references[0].text, '准确原话');
  input.value = ' \n\t '; c.evaluate('rememberReferenceText()');
  assert.equal(c.evaluate("rowOptions({voiceKey:'clone:ref',text:'新台词'}).referenceText"), '');
  await c.evaluate('flushReferenceTexts()');
  c.evaluate("roles = [{id:'saved',voiceKey:'clone:ref',options:{mode:'clone',referenceId:'ref',referenceText:'以前的原话'}}];");
  assert.equal(c.evaluate("rowOptions({voiceKey:'role:saved',text:'新台词'}).referenceText"), '');
  assert.throws(() => c.evaluate("validateReferenceTexts({mode:'clone',referenceId:'ref',referenceText:'   '})"), /准确原话/);
  assert.throws(() => c.evaluate("validateReferenceTexts({rows:[rowOptions({voiceKey:'role:saved',text:'新台词'})]})"), /准确原话/);
});

test('queue storage errors notify once until a successful persistence clears the warning', () => {
  const c = client(); c.evaluate('globalThis.queueNotices = []; toast = (message, error) => queueNotices.push({message,error});');
  c.evaluate("applyJobs({revision:1,jobs:[],storageError:'任务保存失败'}); applyJobs({revision:2,jobs:[],storageError:'任务保存失败'});");
  assert.equal(c.evaluate('queueNotices.length'), 1); assert.equal(c.evaluate('queueNotices[0].error'), true);
  c.evaluate("applyJobs({revision:3,jobs:[],storageError:''}); applyJobs({revision:4,jobs:[],storageError:'任务保存失败'});");
  assert.equal(c.evaluate('queueNotices.length'), 2);
  c.evaluate("refresh = async () => {}; globalThis.diskJob = {id:'disk',name:'任务',status:'running',rows:[],items:[],current:1,total:1,completed:0}; applyJobs({revision:5,jobs:[diskJob],storageError:''}); applyJobs({revision:6,jobs:[{...diskJob,status:'failed'}],storageError:'磁盘已满'});");
  assert.equal(c.evaluate('queueNotices.length'), 3);
  assert.equal(c.evaluate('queueNotices.at(-1).message'), '磁盘已满', 'generic task failure notices must not hide the storage error');
});

test('saved original recording roles do not inherit optional expression from another selected voice', () => {
  const c = client(); c.state.voiceKey = 'clone:current';
  c.state.references = [{ id: 'current', name: '当前声音', text: '当前原话' }, { id: 'saved', name: '原有声音', text: '原有原话' }];
  c.document.querySelector('#reference-style').value = 'expressive';
  c.evaluate("roles = [{ id:'legacy', voiceKey:'clone:saved', options:{ mode:'clone', referenceId:'saved', referenceText:'原有原话' } }]");
  const row = c.evaluate("rowOptions({voiceKey:'role:legacy',text:'原有角色的台词',emotion:'happy'})");
  assert.equal(row.referenceStyle, 'original'); assert.equal(row.emotion, 'natural');
  assert.deepEqual([...c.evaluate("requiredPackages(rowOptions({voiceKey:'role:legacy',text:'台词'}))")], ['reference']);
});
