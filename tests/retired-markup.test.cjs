const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { restoreText, restoreSaved } = require('../desktop/retired-markup.cjs');
const { createSessionStore } = require('../desktop/session.cjs');
const { createProjectStore } = require('../desktop/projects.cjs');
const { prepareGeneration } = require('../desktop/jobs.cjs');
const M = require('../ui/projects.js');
const source = '开头<#0.5#>[[emotion:happy]]真开心[[/emotion]]结尾[[cue:laugh]]';
const plain = '开头真开心结尾哈哈，';
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-retired-markup-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('withdrawn controls restore prose while ordinary text, punctuation and literals remain intact', () => {
  assert.equal(restoreText(source), plain);
  assert.equal(restoreText('普通文案（开心），保留 [happy] 和 <xml>。'), '普通文案（开心），保留 [happy] 和 <xml>。');
  assert.equal(restoreText(plain), plain);
  for (const text of [source, '字<#0.5', '[[emotion:happy]]字']) assert.throws(() => prepareGeneration({ text }), /已撤回/);
});

test('session cleanup preserves the exact original once and survives restart', t => {
  const dir = directory(t), session = { schema: 'shengyue-project-1', text: source, rows: [{ text: source }], options: { emotion: 'sad' }, voiceKey: 'preset:Vivian' };
  let store = createSessionStore(dir); store.save(session);
  const restored = store.load(); assert.equal(restored.text, plain); assert.equal(restored.rows[0].text, plain); assert.equal(restored.options.emotion, 'sad'); assert.equal(restored.retiredMarkupNotice, true);
  store.close(); store = createSessionStore(dir); t.after(() => store.close());
  assert.equal(store.load().retiredMarkupNotice, undefined);
  const db = new DatabaseSync(path.join(dir, 'studio.sqlite')); t.after(() => db.close());
  const backups = db.prepare('SELECT content FROM retired_inline_backups').all(); assert.equal(backups.length, 1); assert.deepEqual(JSON.parse(backups[0].content), session);
});

test('project cleanup preserves names, roles and timestamps and invalidates only the annotated audio signature', t => {
  const dir = directory(t), project = M.create('保留项目'), line = M.line(source, project.roles[0].id); project.chapters[0].lines = [line];
  const store = createProjectStore(dir); t.after(() => store.close()); store.save(project);
  const originalDate = store.list()[0].updatedAt, restored = store.load(project.id);
  assert.equal(restored.chapters[0].lines[0].text, plain); assert.equal(restored.name, project.name); assert.deepEqual(restored.roles, project.roles); assert.equal(store.list()[0].updatedAt, originalDate);
  const options = { text: source, mode: 'preset', speaker: 'Vivian', emotion: 'natural' };
  assert.notEqual(M.fingerprint(options), M.fingerprint({ ...options, text: plain }));
});

test('a failed cleanup write rolls back without replacing the original record', t => {
  const dir = directory(t), db = new DatabaseSync(path.join(dir, 'test.sqlite')); t.after(() => db.close());
  db.exec('CREATE TABLE sample (content TEXT)'); const original = JSON.stringify({ text: source, rows: [] }); db.prepare('INSERT INTO sample VALUES (?)').run(original);
  assert.throws(() => restoreSaved(db, 'session', 1, original, () => { throw new Error('disk full'); }), /disk full/);
  assert.equal(db.prepare('SELECT content FROM sample').get().content, original);
});

test('the shipped UI has no segment annotation editor or toolbar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8'); assert.doesNotMatch(html, /inline-editor|inline-script/);
  const ui = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8'); assert.doesNotMatch(ui, /InlineEditors|InlineScript/);
  assert.equal(fs.existsSync(path.join(__dirname, '../backend/inline_script.py')), false);
});
