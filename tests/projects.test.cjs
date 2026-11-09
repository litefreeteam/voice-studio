const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../ui/projects.js');
const { parseScript } = require('../ui/csv.js');
const { createProjectStore } = require('../desktop/projects.cjs');
const { createJobQueue, prepareProjectGeneration, generationBatches } = require('../desktop/jobs.cjs');
const catalog = require('../shared/catalog.json');
const emotions = catalog.emotions;
const resolveVoice = key => key ? { mode: 'preset', speaker: 'Vivian', voiceName: '旁白声音', language: 'Chinese', engine: 'standard', intensity: 50, instruction: '', voiceDescription: '' } : null;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('project copies preserve independent mix and duration settings without selecting the original takes', () => {
  const source = M.create('有背景音乐的项目'), role = source.roles[0];
  source.targetSeconds = 90;
  source.mix = { backgroundId: 'a'.repeat(32), gainDb: -24, loop: false, ducking: true, offsetMs: 2300 };
  source.chapters[0].lines.push(M.line('这句已有两个生成版本。', role.id));
  const entry = M.entries(source)[0], options = M.optionsFor(source, entry, resolveVoice), version = M.fingerprint(options);
  entry.line.generationAttempt = { id: 'new-take', version }; entry.line.selectedTake = { id: 'old-take', version };
  const before = structuredClone(source), copy = M.duplicate(source), copied = M.entries(copy)[0];
  assert.deepEqual(copy.mix, source.mix); assert.equal(copy.targetSeconds, 90);
  assert.equal(copy.name, '有背景音乐的项目 · 副本');
  assert.notEqual(copy.id, source.id); assert.notEqual(copy.roles[0].id, role.id);
  assert.notEqual(copied.chapter.id, entry.chapter.id); assert.notEqual(copied.line.id, entry.line.id);
  assert.equal(copied.line.roleId, copy.roles[0].id);
  assert.equal(copied.line.selectedTake, undefined); assert.equal(copied.line.generationAttempt, undefined);
  const copiedOptions = M.optionsFor(copy, copied, resolveVoice), copiedVersion = M.fingerprint(copiedOptions);
  const generated = { id: 'new-audio', options: { ...copiedOptions, lineVersion: copiedVersion, lineTakeId: 'copy-take', partCount: 1 } };
  assert.equal(M.lineState(copied, copiedOptions, M.audioIndex([generated], copy.id)).status, 'complete');
  copy.mix.gainDb = -10; copy.roles[0].options.instruction = '副本的新要求'; copied.line.text = '副本的新台词';
  assert.deepEqual(source, before, 'editing the copy must not change any original project settings');
});

test('every scene template creates a separate project with usable voices and complete performance defaults', () => {
  const original = structuredClone(catalog), identifiers = new Set();
  for (const template of catalog.templates) {
    const project = M.fromTemplate(template, catalog), expectedRows = template.rows?.length ? template.rows : (template.batch ? template.text.split(/\r?\n/).filter(text => text.trim()) : [template.text]).map(text => ({ text, voiceKey: template.voiceKey }));
    assert.equal(project.name, template.name);
    assert.equal(M.validate(project), project);
    assert.equal(project.roles.length, new Set(expectedRows.map(row => row.voiceKey)).size);
    const allIds = [project.id, ...project.roles.map(role => role.id), ...project.chapters.flatMap(chapter => [chapter.id, ...chapter.lines.map(line => line.id)])];
    for (const id of allIds) { assert.equal(identifiers.has(id), false, 'scene instances never reuse project, role, chapter or line identifiers'); identifiers.add(id); }
    const generatedRows = M.entries(project).map((entry, index) => {
      const expected = expectedRows[index], role = project.roles.find(role => role.id === entry.line.roleId);
      const [mode, voiceId] = expected.voiceKey.split(':'), voice = (mode === 'preset' ? catalog.voices : catalog.characters).find(voice => voice.id === voiceId);
      // Resolve deliberately different defaults so the test proves that the scene owns its settings.
      const options = M.optionsFor(project, entry, () => ({ mode, language: 'English', scene: 'ad', emotion: 'sad', pace: 'fast', intensity: 100, instruction: '其他要求', engine: 'light' }));
      assert.equal(role.voiceKey, expected.voiceKey);
      assert.equal(role.emotion, template.emotion); assert.equal(role.pace, template.pace);
      assert.equal(options.mode, mode); assert.equal(options[mode === 'preset' ? 'speaker' : 'character'], voiceId);
      assert.equal(options.voiceName, voice.name); assert.equal(options.voiceDescription, mode === 'design' ? voice.prompt : '');
      assert.equal(options.language, template.language); assert.equal(options.scene, template.scene);
      assert.equal(options.emotion, mode === 'design' ? template.emotion : expected.emotion || template.emotion); assert.equal(options.pace, template.pace);
      assert.equal(options.intensity, template.intensity); assert.equal(options.instruction, mode === 'design' ? template.instruction : expected.instruction || template.instruction);
      assert.equal(options.engine, 'standard'); assert.equal(options.sampleRate, 48000);
      assert.equal(options.text, expected.text);
      if (expected.filename) assert.equal(options.filename, expected.filename);
      return { ...options, lineVersion: M.fingerprint(options) };
    });
    const prepared = prepareProjectGeneration({ projectBatch: true, projectId: project.id, rows: generatedRows });
    assert.equal(prepared.rows.length, expectedRows.length);
    assert.equal(project.chapters[0].lines.length, expectedRows.length);
    project.roles[0].options.instruction = '用户修改表达'; project.chapters[0].lines[0].text = '用户修改文稿';
  }
  assert.deepEqual(catalog, original, 'creating and editing scene projects never changes catalog templates or voices');
});

test('podcast uses stable controllable speakers and persists per-turn direction and delivery timing', t => {
  const template = catalog.templates.find(template => template.id === 'interview-dialogue');
  const project = M.fromTemplate(template, catalog);
  assert.deepEqual(project.roles.map(role => role.name), ['主持人', '嘉宾']);
  assert.ok(project.roles.every(role => role.voiceKey.startsWith('preset:') && role.options.engine === 'standard'));
  assert.equal(project.deliverySettings.trimSilence, true); assert.equal(project.deliverySettings.pauseMs, 80);
  assert.equal(M.DELIVERY_DEFAULTS.trimSilence, false); assert.equal(M.DELIVERY_DEFAULTS.pauseMs, 350);
  const rows = M.entries(project).map(entry => M.optionsFor(project, entry, resolveVoice));
  assert.equal(new Set(rows.map(row => row.speaker)).size, 2);
  assert.ok(rows.every((row, i) => row.instruction === template.rows[i].instruction && row.emotion === 'natural'));
  assert.notEqual(rows[0].instruction, rows[2].instruction);
  const edited = { ...rows[0], instruction: '轻轻反问' };
  assert.notEqual(M.fingerprint(rows[0]), M.fingerprint(edited), 'a changed delivery requires new audio');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-podcast-')), store = createProjectStore(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.save(project);
  const restored = store.load(project.id);
  assert.deepEqual(restored.deliverySettings, project.deliverySettings);
  assert.deepEqual(M.entries(restored).map(entry => entry.line.instruction), template.rows.map(row => row.instruction));
  const other = M.fromTemplate(template, catalog); other.deliverySettings.pauseMs = 0;
  assert.equal(project.deliverySettings.pauseMs, 80, 'settings are private to each project');
  for (const invalid of [{ pauseMs: -1 }, { pauseMs: 1.5 }, { pauseMs: 3001 }, { trimSilence: 'true' }, { surprise: true }]) {
    assert.throws(() => M.validate({ ...project, deliverySettings: { ...project.deliverySettings, ...invalid } }), /导出设置/);
  }
});

test('repeated scene creation preserves existing projects, row overrides and user naming', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-scenes-')), store = createProjectStore(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const template = catalog.templates.find(template => template.id === 'game-dialogue');
  const original = M.create('正在创作的故事'); original.chapters[0].lines.push(M.line('需要保留的文稿', original.roles[0].id)); store.save(original);
  const first = M.fromTemplate(template, catalog, '我的游戏'), second = M.fromTemplate(template, catalog);
  store.save(first); store.save(second);
  assert.equal(store.list().length, 3); assert.deepEqual(store.load(original.id).chapters, original.chapters);
  assert.notEqual(first.id, second.id); assert.equal(first.name, '我的游戏'); assert.equal(second.name, template.name);
  assert.equal(first.roles.length, 2); assert.equal(first.chapters[0].lines[0].roleId, first.chapters[0].lines[2].roleId);
  assert.deepEqual(first.chapters[0].lines.map(line => line.emotion), template.rows.map(row => row.emotion));
  assert.deepEqual(first.chapters[0].lines.map(line => line.filename), template.rows.map(row => row.filename));
  first.roles[0].options.intensity = 0;
  assert.notEqual(second.roles[0].options.intensity, 0);
  assert.throws(() => M.fromTemplate({ ...template, rows: [{ text: '无效场景', voiceKey: 'design:missing' }] }, catalog), /声音不存在/);
  assert.throws(() => M.fromTemplate(template, catalog, ''), /项目名称/);
});

test('optional sentence splitting retains punctuation, character and performance on every sentence', () => {
  const parsed = M.parse('小兔子（开心）：你好！一起出发吧。好吗？', '.txt', emotions, parseScript, { splitSentences: true });
  assert.equal(parsed.count, 3);
  assert.deepEqual(parsed.chapters[0].lines.map(line => line.text), ['你好！', '一起出发吧。', '好吗？']);
  assert.ok(parsed.chapters[0].lines.every(line => line.role === '小兔子' && line.emotion === 'happy'));
});

test('story imports skip Markdown dividers without dropping spoken text or assigning divider roles', () => {
  const story = '# 晚间故事\n故事的名字叫《那条没有等到的消息》。\n---\n - - - \n***\n* * *\n___\n_ _ _\n林禾三十岁，在一家设计公司上班。';
  for (const scriptMode of ['dialogue', 'narration']) {
    const parsed = M.parse(story, '.txt', emotions, parseScript, { scriptMode });
    assert.equal(parsed.count, 2);
    assert.deepEqual(parsed.chapters[0].lines.map(line => line.text), ['故事的名字叫《那条没有等到的消息》。', '林禾三十岁，在一家设计公司上班。']);
    assert.deepEqual(parsed.roleNames, ['旁白']);
    assert.equal(parsed.pending, 0);
  }
  const table = M.parse('文本,角色,语气,文件名\n---,分隔线,,\n你好---世界,旁白,开心,keep', '.csv', emotions, parseScript);
  assert.equal(table.count, 1);
  assert.deepEqual(table.roleNames, ['旁白']);
  assert.equal(table.chapters[0].lines[0].text, '你好---世界');
  assert.equal(table.chapters[0].lines[0].filename, 'keep');
  assert.throws(() => M.parse('---\n***\n___', '.txt', emotions, parseScript), /没有找到可以导入的台词/);
});

test('import detects chapters, aliases, inline emotions and unresolved prose without losing words', () => {
  const parsed = M.parse('第1章 开始\n旁白：太阳升起来了。\n兔兔（开心）：出发啦！\n熊爷爷：[笑着]别忘了地图。\n“这是谁说的？”\n第2章 河边\n小兔子说道：“桥坏了。”\n树叶在风中摇晃。', '.txt', emotions, parseScript);
  assert.equal(parsed.chapters.length, 2); assert.equal(parsed.count, 6); assert.equal(parsed.pending, 2); assert.equal(parsed.customCues, 1);
  assert.deepEqual(parsed.roleNames, ['旁白', '兔兔', '熊爷爷']);
  assert.equal(parsed.chapters[0].lines[1].emotion, 'happy');
  assert.equal(parsed.chapters[0].lines[2].instruction, '笑着');
  assert.equal(parsed.chapters[1].lines[0].text, '小兔子说道：“桥坏了。”');
  const project = M.create('森林探险');
  project.roles.push({ id: crypto.randomUUID(), name: '小兔子', aliases: ['兔兔'], voiceKey: 'design:girl-clear', emotion: 'natural', pace: 'normal', options: {} });
  const imported = M.importInto(project, parsed, { 熊爷爷: { voiceKey: 'preset:Uncle_Fu' } }, 'chapters');
  assert.equal(project.chapters[0].lines.length, 0, 'preview/commit never mutates the original');
  assert.equal(imported.roles.length, 3); assert.equal(imported.chapters.length, 2);
  assert.equal(imported.chapters[0].lines[1].roleId, project.roles[1].id);
  assert.equal(imported.chapters[0].lines[2].instruction, '笑着');
  assert.equal(imported.chapters[0].lines[3].roleId, '');
});

test('CSV quoting, chapter columns and role mappings work across chapter boundaries', () => {
  const parsed = M.parse('章节,角色,语气,台词,文件名\n起程,旁白,自然,"第一句，有逗号。",intro\n起程,兔兔,开心,"你好\n再见",rabbit\n归来,旁白,温柔,回家了。,home', '.csv', emotions, parseScript);
  assert.equal(parsed.chapters.length, 2); assert.equal(parsed.count, 3);
  assert.equal(parsed.chapters[0].lines[1].text, '你好\n再见');
  const project = M.create('CSV 导入'), imported = M.importInto(project, parsed, { 兔兔: { roleId: project.roles[0].id } }, 'append', project.chapters[0].id);
  assert.equal(imported.roles.length, 1); assert.equal(imported.chapters[0].lines.length, 3);
  assert.equal(M.roleFor(imported, '兔兔').id, project.roles[0].id, 'manual import mappings are remembered as aliases');
  const replaced = M.importInto(imported, parsed, {}, 'replace', imported.chapters[0].id);
  assert.equal(replaced.chapters[0].lines.length, 3);
});

test('defaults inherit by role, overrides survive default changes and stale audio needs regeneration', () => {
  const project = M.create(), role = project.roles[0];
  role.emotion = 'gentle'; project.chapters[0].lines = [M.line('第一句', role.id), { ...M.line('第二句', role.id), emotion: 'happy' }];
  const entry = M.entries(project)[0], options = M.optionsFor(project, entry, resolveVoice), signature = M.fingerprint(options);
  assert.equal(options.emotion, 'gentle');
  const history = [{ id: 'audio', createdAt: 1, options: { ...options, lineVersion: signature, partCount: 1 } }];
  const index = M.audioIndex(history, project.id);
  assert.equal(M.lineState(entry, options, index).status, 'complete');
  project.name = '新的故事名'; role.name = '故事旁白';
  assert.equal(M.fingerprint(M.optionsFor(project, entry, resolveVoice)), signature, 'display renames preserve valid audio');
  role.emotion = 'sad';
  assert.equal(M.lineState(entry, M.optionsFor(project, entry, resolveVoice), index).status, 'changed');
  assert.equal(M.optionsFor(project, M.entries(project)[1], resolveVoice).emotion, 'happy');
  assert.equal(M.lineState(entry, options, index, new Set([entry.line.id + '\n' + signature])).status, 'pending');
  assert.equal(M.optionsFor(project, entry, () => null), null);
  const clone = M.optionsFor(project, entry, () => ({ mode: 'clone', referenceId: 'ref', engine: 'standard', instruction: '忽略' }));
  assert.equal(clone.emotion, 'natural'); assert.equal(clone.instruction, '');
});

test('partial audio is complete only when all parts exist; latest versions are indexed in order', () => {
  const project = M.create(), entry = { line: M.line('长句', project.roles[0].id), chapter: project.chapters[0], ci: 0, li: 0 };
  const options = M.optionsFor(project, entry, resolveVoice), version = M.fingerprint(options);
  const item = (id, partIndex, createdAt) => ({ id, createdAt, options: { ...options, lineVersion: version, partIndex, partCount: 2 } });
  let index = M.audioIndex([item('first', 0, 1)], project.id);
  assert.equal(M.lineState(entry, options, index).status, 'changed');
  index = M.audioIndex([item('old', 1, 1), item('new', 1, 2), item('first', 0, 1)], project.id);
  assert.equal(M.lineState(entry, options, index).status, 'complete');
  assert.deepEqual(M.lineState(entry, options, index).clips.map(item => item.id), ['first', 'new']);
});

test('designed project roles default to a fixed voice and invalidate setup only when voice settings change', () => {
  const project = M.create(), role = project.roles[0]; role.voiceKey = 'design:meditation-female';
  role.emotion = 'gentle'; role.pace = 'slow';
  project.chapters[0].lines = [{ ...M.line('首句', role.id), emotion: 'happy', pace: 'fast', instruction: '单句要求' }];
  const resolve = () => ({ mode: 'design', character: 'meditation-female', voiceDescription: '柔和女声', scene: 'bedtime', instruction: '轻声引导', intensity: 25, language: 'Chinese' });
  const entry = M.entries(project)[0], first = M.optionsFor(project, entry, resolve);
  assert.equal(first.lockVoice, true); assert.equal(first.roleId, role.id);
  assert.equal(first.emotion, 'gentle'); assert.equal(first.pace, 'slow'); assert.equal(first.instruction, '轻声引导');
  role.options.voiceAnchorId = 'anchor'; role.options.voiceAnchorSignature = M.voiceSettingsSignature(first);
  project.name = '改名项目'; role.name = '改名角色'; entry.line.text = '后续另一句';
  assert.equal(M.optionsFor(project, entry, resolve).voiceAnchorId, 'anchor', 'names and text preserve the prepared voice');
  const copied = structuredClone(project); copied.id = crypto.randomUUID();
  assert.equal(M.optionsFor(copied, M.entries(copied)[0], resolve).voiceAnchorId, undefined, 'copied projects prepare independent role voices');
  role.emotion = 'sad';
  assert.equal(M.optionsFor(project, entry, resolve).voiceAnchorId, undefined, 'new role expression must be auditioned again');
  role.options.lockVoice = false;
  const free = M.optionsFor(project, entry, resolve);
  assert.equal(free.emotion, 'happy'); assert.equal(free.pace, 'fast'); assert.equal(free.instruction, '单句要求');
  assert.notEqual(M.fingerprint(free), M.fingerprint(first), 'legacy and free-design audio cannot masquerade as fixed voice audio');
});

test('multiple projects and long chapters persist independently; invalid edits preserve saved content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-projects-')); let store = createProjectStore(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const first = M.create('第一个故事'), second = M.create('第二个故事');
  first.chapters[0].lines = Array.from({ length: 1200 }, (_, i) => M.line('第' + i + '句', first.roles[0].id));
  store.save(first); store.save(second); store.close(); store = createProjectStore(root);
  assert.equal(store.list().length, 2); assert.equal(store.load(first.id).chapters[0].lines.length, 1200);
  const invalid = structuredClone(first); invalid.roles[0].aliases.push('旁白'); invalid.roles.push({ ...invalid.roles[0], id: crypto.randomUUID(), name: '另一个角色' });
  assert.throws(() => store.save(invalid), /重复/);
  assert.equal(store.load(first.id).roles.length, 1);
  store.delete(second.id); assert.equal(store.list().length, 1); assert.equal(store.load(first.id).name, first.name);
});

test('one long project spans more than ten backend batches with bounded sizes and accurate progress', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-project-jobs-'));
  let queue; const calls = [];
  const rows = Array.from({ length: 1201 }, (_, index) => ({ text: '长故事台词。'.repeat(20), lineId: 'line-' + index, lineVersion: 'a'.repeat(32), voiceName: '旁白' }));
  const prepared = prepareProjectGeneration({ projectBatch: true, projectId: 'story', rows });
  const batches = generationBatches(prepared.rows); assert.ok(batches.length > 10);
  assert.ok(batches.every(rows => rows.length <= 100 && rows.reduce((n, row) => n + row.text.length, 0) <= 5000));
  queue = createJobQueue({ dataDir: root, cancel() {}, execute: async data => {
    calls.push(data);
    const items = data.rows.map((row, index) => {
      queue.acceptProgress({ stage: 'generating', current: index + 1 });
      const item = { id: row.lineId, options: row }; queue.acceptProgress({ stage: 'clip', item }); return item;
    });
    return { items };
  } });
  t.after(() => { queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = queue.submit({ projectBatch: true, projectId: 'story', rows }); await tick();
  const saved = queue.snapshot().jobs.find(item => item.id === job.id);
  assert.equal(saved.status, 'complete'); assert.equal(saved.completed, 1201); assert.equal(saved.current, 1201);
  assert.equal(calls.length, batches.length); assert.equal(queue.snapshot().jobs.length, 1);
});

test('cancelling a project preserves part metadata and retry skips every saved segment', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-project-cancel-'));
  const calls = []; let queue, reject;
  queue = createJobQueue({ dataDir: root, cancel() { reject(new Error('操作已取消')); }, execute(data) {
    calls.push(data);
    if (calls.length > 1) return Promise.resolve({ items: data.rows.map((row, i) => ({ id: 'resumed-' + i, options: row })) });
    queue.acceptProgress({ stage: 'clip', item: { id: 'saved', options: data.rows[0] } });
    return new Promise((_resolve, fail) => { reject = fail; });
  } });
  t.after(() => { queue.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = queue.submit({ projectBatch: true, projectId: 'story', rows: [{ text: '很长的台词。'.repeat(300), lineId: 'long-line', lineVersion: 'b'.repeat(32), filename: 'story' }] });
  await tick(); queue.cancel(job.id); await tick();
  queue.retry(job.id); await tick();
  assert.equal(calls[1].rows[0].partIndex, 1); assert.equal(calls[1].rows[0].partCount, calls[0].rows.length);
  assert.equal(calls[1].rows[0].filename, calls[0].rows[1].filename);
  assert.equal(calls[1].rows.length, calls[0].rows.length - 1);
});

test('UI-05/06: project audio signatures cover role identity and standard scene but preserve voice setup', () => {
  const project = M.create(), a = project.roles[0]; a.voiceKey = 'design:hero'; a.options = { lockVoice: true };
  const b = { ...structuredClone(a), id: crypto.randomUUID(), name: '另一个角色', aliases: [] }; project.roles.push(b);
  const line = M.line('独立角色声音', a.id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0], design = () => ({ mode: 'design', character: 'hero', voiceDescription: '自然温暖', scene: 'story', engine: 'standard' });
  for (const role of [a, b]) {
    line.roleId = role.id; const options = M.optionsFor(project, entry, design);
    role.options.voiceAnchorSignature = M.voiceSettingsSignature(options); role.options.voiceAnchorId = role.id;
  }
  line.roleId = a.id; const first = M.optionsFor(project, entry, design);
  line.roleId = b.id; const second = M.optionsFor(project, entry, design);
  assert.equal(second.voiceAnchorId, b.id); assert.notEqual(M.fingerprint(first), M.fingerprint(second));
  const history = [{ id: 'a-audio', options: { ...first, lineVersion: M.fingerprint(first) } }];
  assert.equal(M.lineState(entry, second, M.audioIndex(history, project.id)).status, 'changed');
  assert.deepEqual(M.lineState(entry, second, M.audioIndex(history, project.id)).clips, []);
  b.name = '只改显示名称'; assert.equal(M.fingerprint(M.optionsFor(project, entry, design)), M.fingerprint(second));
  const anotherAnchor = { ...second, voiceAnchorId: 'another-anchor' };
  assert.notEqual(M.fingerprint(anotherAnchor), M.fingerprint(second), 'replacing an anchor invalidates audio even with the same role revision');
  assert.equal(M.voiceSettingsSignature(anotherAnchor), M.voiceSettingsSignature(second), 'anchor identity is excluded from its own setup signature');
  const standard = { ...first, mode: 'preset', scene: 'bedtime' };
  assert.notEqual(M.fingerprint(standard), M.fingerprint({ ...standard, scene: 'ad' }));
  assert.equal(M.fingerprint({ ...standard, engine: 'light' }), M.fingerprint({ ...standard, engine: 'light', scene: 'ad' }));
  // The old setup format stays valid; fixing audio fingerprints must not discard saved anchors.
  assert.equal(M.voiceSettingsSignature({ projectId: 'project', roleId: 'role', mode: 'design', character: 'hero', voiceDescription: '自然温暖', scene: 'story', engine: 'standard', lockVoice: true, voiceRevision: 'v1' }), '["project","role","4a16c19064df30f26e28969140e167f3"]', 'matches the pre-fix setup signature');
  const legacyHash = M.fingerprint({ ...first, text: '' }, true);
  assert.equal(M.voiceSettingsSignature(first), JSON.stringify([project.id, a.id, legacyHash]));
  assert.notEqual(M.fingerprint(first), M.fingerprint(first, true), 'unsafe legacy audio signatures intentionally expire');
});

test('UI-02: partial redo never mixes takes and its choice survives project persistence', t => {
  const project = M.create(), line = M.line('甲'.repeat(1201), project.roles[0].id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0], options = M.optionsFor(project, entry, resolveVoice), version = M.fingerprint(options);
  const clip = (take, partIndex, createdAt) => ({ id: `${take}-${partIndex}`, createdAt, options: { ...options, lineVersion: version, lineTakeId: take, partIndex, partCount: 3 } });
  const old = [0, 1, 2].map(i => clip('old', i, 1));
  line.generationAttempt = { id: 'new', version };
  assert.deepEqual(M.lineState(entry, options, M.audioIndex(old, project.id)).clips, [], 'redo is incomplete even before its first output');
  const history = [clip('new', 0, 2), ...old], index = M.audioIndex(history, project.id);
  let result = M.lineState(entry, options, index);
  assert.equal(result.status, 'changed'); assert.deepEqual(result.clips.map(item => item.id), ['new-0']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-take-')); let store = createProjectStore(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.save(project); store.close(); store = createProjectStore(root);
  const reopened = store.load(project.id), reopenedEntry = M.entries(reopened)[0];
  assert.equal(M.lineState(reopenedEntry, options, index).status, 'changed');
  history.unshift(clip('new', 1, 3), clip('new', 2, 4));
  result = M.lineState(reopenedEntry, options, M.audioIndex(history, project.id));
  assert.equal(result.status, 'complete'); assert.deepEqual(result.clips.map(item => item.id), ['new-0', 'new-1', 'new-2']);
  assert.equal(old.length, 3, 'previous complete take remains in history for recovery');
});

test('UI-03: export uses current order and filenames including long-line parts without mutating history', () => {
  const project = M.create(), role = project.roles[0]; project.chapters[0].lines = [M.line('第一句', role.id), M.line('第二句', role.id)];
  const history = M.entries(project).map((entry, i) => { const options = M.optionsFor(project, entry, resolveVoice); return { id: 'clip-' + i, wav: options.filename + '.wav', options: { ...options, lineVersion: M.fingerprint(options), partCount: 1 } }; });
  const original = structuredClone(history); project.chapters[0].lines.reverse(); project.chapters[0].lines[0].filename = '新的文件名';
  const entries = M.entries(project).map(entry => { const options = M.optionsFor(project, entry, resolveVoice); return { ...entry, options, ...M.lineState(entry, options, M.audioIndex(history, project.id)) }; });
  const items = M.exportItems(entries);
  assert.deepEqual(items.map(item => item.id), ['clip-1', 'clip-0']);
  assert.deepEqual(items.map(item => item.exportFilename), ['新的文件名', '001-00002-旁白']);
  assert.deepEqual(items.map(item => item.lineOrder), [0, 1]); assert.deepEqual(history, original);
  entries[0].clips = [{ id: 'part', options: { partIndex: 1, partCount: 3 } }];
  assert.equal(M.exportItems(entries)[0].exportFilename, '新的文件名-002');
});

function productionFixture(project, save) {
  const vm = require('node:vm'), source = fs.readFileSync(path.join(__dirname, '../ui/project-workspace.js'), 'utf8');
  const start = source.indexOf('  async function produce(entries, force = false, managedOptions = {}) {'), end = source.indexOf('  function stopAudio() {', start);
  assert.ok(start > 0 && end > start);
  let submitted;
  const context = vm.createContext({ M, project, structuredClone, crypto, submitting: false, derived: null, needsSetup: () => false, fixRoles() {}, markChanged() {}, renderProduction() {}, refreshMedia() {}, save,
    hooks: { ready: () => true, toast() {}, submit: async value => { submitted = value; return { id: 'job' }; } } });
  vm.runInContext(source.slice(start, end), context);
  return { context, result: () => submitted };
}

test('UI-04: edits and project navigation during save cannot relabel the submitted text or identity', async () => {
  const project = M.create(), line = M.line('旧台词', project.roles[0].id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0]; entry.options = M.optionsFor(project, entry, resolveVoice); entry.status = 'new'; entry.clips = [];
  let release; const saved = new Promise(resolve => { release = resolve; }), f = productionFixture(project, () => saved);
  const operation = f.context.produce([entry]);
  line.text = '编辑后的新台词'; entry.options.scene = 'ad'; f.context.project = M.create('切换到其他项目');
  release(); await operation;
  const submitted = f.result(), row = submitted.rows[0];
  assert.equal(row.text, '旧台词'); assert.equal(submitted.projectId, project.id); assert.equal(row.projectId, project.id);
  const old = M.optionsFor(project, { ...entry, line: { ...line, text: '旧台词' } }, resolveVoice);
  assert.equal(row.lineVersion, M.fingerprint(old));
  const history = [{ id: 'old-audio', options: row }], index = M.audioIndex(history, project.id);
  assert.equal(M.lineState(entry, M.optionsFor(project, entry, resolveVoice), index).status, 'changed');
  line.text = '旧台词'; assert.equal(M.lineState(entry, old, index).status, 'complete');
});

test('UI-02: missing-part submission resumes the persisted take; redo creates a new one', async () => {
  const project = M.create(), line = M.line('甲'.repeat(1201), project.roles[0].id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0]; entry.options = M.optionsFor(project, entry, resolveVoice); entry.status = 'changed';
  line.generationAttempt = { id: crypto.randomUUID(), version: M.fingerprint(entry.options) };
  entry.clips = [{ text: '甲'.repeat(600), options: { partIndex: 0, partCount: 3, lineTakeId: line.generationAttempt.id } }];
  const previous = line.generationAttempt.id, f = productionFixture(project, async () => {});
  await f.context.produce([entry]);
  assert.deepEqual([...f.result().rows.map(row => row.partIndex)], [1, 2]);
  assert.ok(f.result().rows.every(row => row.lineTakeId === previous));
  await f.context.produce([entry], true);
  assert.equal(f.result().rows.length, 3); assert.notEqual(f.result().rows[0].lineTakeId, previous);
  assert.ok(f.result().rows.every(row => row.lineTakeId === line.generationAttempt.id));
});

test('UI-02: save and rejected-submission failures restore the previous take without reverting text edits', async () => {
  for (const duringSave of [true, false]) {
    const project = M.create(), line = M.line('原文字', project.roles[0].id); project.chapters[0].lines.push(line);
    const entry = M.entries(project)[0]; entry.options = M.optionsFor(project, entry, resolveVoice); entry.status = 'complete'; entry.clips = [];
    const previous = { id: crypto.randomUUID(), version: M.fingerprint(entry.options) }; line.generationAttempt = previous;
    const f = productionFixture(project, async () => { if (duringSave) { line.text = '保存期间编辑'; throw new Error('save failed'); } });
    if (!duringSave) f.context.hooks.submit = async () => { line.text = '提交期间编辑'; throw new Error('queue full'); };
    await assert.rejects(f.context.produce([entry], true), duringSave ? /save failed/ : /queue full/);
    assert.deepEqual(line.generationAttempt, previous);
    assert.equal(line.text, duringSave ? '保存期间编辑' : '提交期间编辑');
    assert.equal(f.result(), undefined);
  }
});

test('changed split boundaries restart partial old takes without mixing or deleting their audio', async () => {
  for (const text of ['甲'.repeat(598) + 'hello world，结尾。', '甲'.repeat(599) + '𠮷野家很好。', '甲'.repeat(595) + 'hello world，结尾。']) {
    const project = M.create(), line = M.line(text, project.roles[0].id); project.chapters[0].lines.push(line);
    const entry = M.entries(project)[0]; entry.options = M.optionsFor(project, entry, resolveVoice);
    const version = M.fingerprint(entry.options), previousId = crypto.randomUUID();
    line.generationAttempt = { id: previousId, version };
    const old = [{ id: 'old-part', text: text.slice(0, 600).trim(), options: { ...entry.options, text: undefined,
      lineVersion: version, lineTakeId: previousId, partIndex: 0, partCount: 2 } }];
    // The whitespace case's first part still matches, so saved part 1 exposes
    // the old trim loss rather than discarding a correctly reusable prefix.
    if (text.startsWith('甲'.repeat(595) + 'hello')) {
      old[0].text = text.slice(600).trim(); old[0].options.partIndex = 1;
    }
    const original = structuredClone(old);
    Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(old, project.id)));
    const f = productionFixture(project, async () => {}); await f.context.produce([entry]);
    assert.notEqual(line.generationAttempt.id, previousId);
    assert.equal(f.result().rows.map(row => row.text).join(''), text);
    assert.ok(f.result().rows.every(row => row.lineTakeId === line.generationAttempt.id));
    assert.deepEqual(old, original, 'historical audio records remain untouched');
    const first = f.result().rows[0], history = [...old, { id: 'new-part', text: first.text, options: first }];
    Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(history, project.id)));
    assert.deepEqual(entry.clips.map(clip => clip.id), ['new-part']);
    await f.context.produce([entry]);
    assert.deepEqual([...f.result().rows.map(row => row.partIndex)], [1]);
  }
});

test('existing complete takes remain complete and invalid split plans do not change attempts', async () => {
  const project = M.create(), line = M.line('甲'.repeat(598) + 'hello world', project.roles[0].id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0]; entry.options = M.optionsFor(project, entry, resolveVoice);
  const version = M.fingerprint(entry.options), id = crypto.randomUUID(); line.generationAttempt = { id, version };
  const old = [line.text.slice(0, 600), line.text.slice(600)].map((text, partIndex) => ({ id: 'old-' + partIndex, text,
    options: { ...entry.options, lineVersion: version, lineTakeId: id, partIndex, partCount: 2 } }));
  Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(old, project.id)));
  assert.equal(entry.status, 'complete');
  const f = productionFixture(project, async () => {}); await f.context.produce([entry]);
  assert.equal(f.result(), undefined); assert.equal(line.generationAttempt.id, id);
  line.text = 'a' + '\u0301'.repeat(600); entry.status = 'changed';
  await assert.rejects(f.context.produce([entry]), /组合字符/);
  assert.equal(line.generationAttempt.id, id); assert.equal(f.result(), undefined);
});

test('UI-01: project roles resolve updated and cleared canonical reference text instead of stored copies', () => {
  const project = M.create(), role = project.roles[0]; role.voiceKey = 'clone:reference';
  role.options = { mode: 'clone', referenceId: 'reference', referenceText: '旧原话' };
  const entry = { line: M.line('新台词', role.id), chapter: project.chapters[0], ci: 0, li: 0 };
  for (const referenceText of ['刚填写的新原话', '']) {
    assert.equal(M.optionsFor(project, entry, () => ({ mode: 'clone', referenceId: 'reference', referenceText })).referenceText, referenceText);
  }
});

test('UI-02: upgrades adopt partial legacy or recovered takes and redo still isolates the previous complete take', async () => {
  for (const mode of ['clone', 'light']) for (const recoveredTake of [undefined, 'recovered-take']) {
    const project = M.create(), line = M.line('甲'.repeat(1201), project.roles[0].id); project.chapters[0].lines.push(line);
    const entry = M.entries(project)[0], resolve = () => mode === 'clone' ? { mode: 'clone', referenceId: 'ref', referenceText: '原话' } : { mode: 'preset', engine: 'light', speaker: 'Vivian' };
    entry.options = M.optionsFor(project, entry, resolve); const version = M.fingerprint(entry.options);
    const history = [{ id: 'saved-first', createdAt: 1, options: { ...entry.options, text: '甲'.repeat(600), lineVersion: version, ...(recoveredTake ? { lineTakeId: recoveredTake } : {}), partIndex: 0, partCount: 3 } }];
    Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(history, project.id)));
    assert.equal(line.generationAttempt, undefined);
    const f = productionFixture(project, async () => {}); await f.context.produce([entry]);
    assert.deepEqual([...f.result().rows.map(row => row.partIndex)], [1, 2]);
    const adoptedId = recoveredTake || M.LEGACY_TAKE_ID;
    assert.equal(line.generationAttempt.id, adoptedId); assert.ok(f.result().rows.every(row => row.lineTakeId === adoptedId));
    history.push(...f.result().rows.map((options, index) => ({ id: 'resumed-' + index, createdAt: 2, options })));
    const reopened = structuredClone(project), reopenedEntry = M.entries(reopened)[0];
    assert.equal(M.lineState(reopenedEntry, entry.options, M.audioIndex(history, project.id)).status, 'complete');
    Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(history, project.id)));
    await f.context.produce([entry], true);
    assert.equal(f.result().rows.length, 3); assert.notEqual(line.generationAttempt.id, adoptedId);
    const newPart = { id: 'redo-first', createdAt: 3, options: f.result().rows[0] };
    history.unshift(newPart); Object.assign(entry, M.lineState(entry, entry.options, M.audioIndex(history, project.id)));
    assert.equal(entry.status, 'changed'); assert.deepEqual(entry.clips.map(clip => clip.id), ['redo-first']);
    await f.context.produce([entry]);
    assert.deepEqual([...f.result().rows.map(row => row.partIndex)], [1, 2]);
    assert.ok(f.result().rows.every(row => row.lineTakeId === newPart.options.lineTakeId));
  }
});

test('optional expressive recording controls persist, override per line and invalidate only affected audio', () => {
  const project = M.create(), role = project.roles[0]; role.voiceKey = 'clone:own';
  role.emotion = 'happy'; role.pace = 'fast'; role.options = { referenceStyle: 'expressive', intensity: 80, instruction: '轻松聊天。', scene: 'ad' };
  project.chapters[0].lines = [M.line('第一句。', role.id)];
  const entry = M.entries(project)[0], resolve = () => ({ mode: 'clone', referenceId: 'own', referenceText: '原话', engine: 'standard' });
  const expressive = M.optionsFor(project, entry, resolve);
  assert.equal(expressive.emotion, 'happy'); assert.equal(expressive.pace, 'fast'); assert.equal(expressive.instruction, '轻松聊天。');
  assert.equal(expressive.referenceId, 'own'); assert.equal(expressive.referenceStyle, 'expressive');
  entry.line.emotion = 'sad'; entry.line.pace = 'slow';
  const line = M.optionsFor(project, entry, resolve); assert.equal(line.emotion, 'sad'); assert.equal(line.pace, 'slow');
  const reopened = JSON.parse(JSON.stringify(project)); M.validate(reopened);
  assert.equal(M.optionsFor(reopened, M.entries(reopened)[0], resolve).referenceStyle, 'expressive');
  role.options.referenceStyle = 'original';
  const original = M.optionsFor(project, entry, resolve); assert.equal(original.emotion, 'natural'); assert.equal(original.instruction, '');
  assert.notEqual(M.fingerprint(original), M.fingerprint(expressive));
  assert.notEqual(M.fingerprint(expressive), M.fingerprint({ ...expressive, scene: 'course' }));
  assert.equal(M.fingerprint(original), M.fingerprint({ ...original, referenceStyle: undefined }), 'legacy original recordings keep their existing audio signatures');
});
