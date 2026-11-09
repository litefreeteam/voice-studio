import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

// Real desktop IPC and SQLite persistence; no inference, downloads or user data.
const root = path.resolve(import.meta.dirname, '..');
const fixture = await createDesktopFixture({ activated: true });
const data = fixture.data;
const artifacts = path.join(root, '.test-data/session');
await mkdir(artifacts, { recursive: true });
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: data, VOICE_STUDIO_PYTHON: '' }, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#open-project, #save-project').count(), 0);
}
async function close() { await app.close(); app = null; }
const snapshot = () => page.evaluate(() => JSON.parse(JSON.stringify(sessionSnapshot())));
try {
  await launch();
  // Migrate a previous browser draft, retaining long rows and all editor settings.
  const legacy = { schema: 'shengyue-project-1', text: '上次的单段文案', rows: [{ text: '长台词'.repeat(250), voiceKey: 'preset:Serena', emotion: 'happy', filename: '第一句' }], script: true, batch: true, voiceKey: 'preset:Aiden', emotion: 'sad', options: { project: '自动恢复作品', language: 'English', scene: 'story', pace: 'slow', engine: 'standard', voiceDescription: '保留的人物描述', instruction: '像和朋友聊天', referenceText: '参考原话', intensity: 80, prefix: 'my-voice', sampleRate: 44100 } };
  await page.evaluate(value => { sessionReady = false; localStorage.setItem('shengyue-draft-1', JSON.stringify(value)); }, legacy);
  await page.reload(); await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady && document.querySelector('#draft-status').textContent === '已自动保存');
  await page.locator('[data-view="editor"]').click();
  const expected = await snapshot();
  assert.equal(expected.rows[0].text, legacy.rows[0].text);
  assert.equal(expected.script, true); assert.equal(expected.voiceKey, legacy.voiceKey); assert.equal(expected.emotion, legacy.emotion);
  for (const [key, value] of Object.entries(legacy.options)) assert.equal(expected.options[key], value, key);
  assert.equal(await page.evaluate(() => localStorage.getItem('shengyue-draft-1')), null);
  assert.deepEqual(await page.evaluate(() => studio.invoke('session-load')), expected);
  await page.screenshot({ path: path.join(artifacts, 'restored-session.png') });
  await close(); await launch(); assert.deepEqual(await snapshot(), expected);

  // Ordinary input is saved without a button, including fields hidden by the light engine.
  await page.evaluate(() => {
    document.querySelector('#mode-text').click();
    for (const [id, value] of [['text', '修改后自动保存'], ['project-name', '最新作品'], ['prefix', 'latest'], ['instruction', '保留隐藏的表达设置'], ['engine', 'light']]) {
      const field = document.querySelector('#' + id); field.value = value; field.dispatchEvent(new Event(id === 'engine' ? 'change' : 'input'));
    }
  });
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === '已自动保存');
  const edited = await snapshot();
  assert.deepEqual(await page.evaluate(() => studio.invoke('session-load')), edited);
  await close(); await launch(); assert.deepEqual(await snapshot(), edited);

  // Close with a pending debounce: only the real beforeunload IPC can save this edit.
  await page.evaluate(() => {
    const field = document.querySelector('#text'); field.value = '关闭前的最后一次输入'; field.dispatchEvent(new Event('input'));
    clearTimeout(draftTimer);
  });
  assert.equal((await page.evaluate(() => studio.invoke('session-load'))).text, edited.text);
  await close(); await launch();
  assert.equal(await page.locator('#text').inputValue(), '关闭前的最后一次输入');

  // An empty dialogue must stay empty instead of rebuilding rows from the hidden text.
  await page.evaluate(() => { state.rows = []; setScript(true, false); document.querySelector('#project-name').value = ''; saveDraft(); });
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === '已自动保存');
  await close(); await launch();
  assert.equal(await page.locator('.script-row').count(), 0); assert.equal(await page.locator('#project-name').inputValue(), '');
  assert.equal(await page.locator('#script-panel').isVisible(), true);
  await page.evaluate(() => { setScript(false); document.querySelector('#text').value = ''; saveDraft(); clearTimeout(draftTimer); });
  await close(); await launch(); assert.equal(await page.locator('#text').inputValue(), '');
  // Designed dialogue retains its chosen voice even with a preset selected globally.
  await page.evaluate(() => {
    selectVoice('design:meditation-female', false);
    document.querySelector('#reset-voice').click();
    state.rows = [{ text: '第一句', voiceKey: 'design:meditation-female', emotion: 'happy', filename: 'first' },
      { text: '第二句', voiceKey: 'design:meditation-female', emotion: 'gentle', filename: 'second' }];
    setScript(true, false); selectVoice('preset:Vivian', false); saveDraft(true);
  });
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === '已自动保存');
  const voices = await page.evaluate(() => state.rows.map(rowOptions).map(({ voiceScopeId, voiceId, voiceRevision }) => ({ voiceScopeId, voiceId, voiceRevision })));
  assert.ok(voices[0].voiceRevision); assert.deepEqual(voices[0], voices[1]);
  await close(); await launch();
  assert.deepEqual(await page.evaluate(() => state.rows.map(rowOptions).map(({ voiceScopeId, voiceId, voiceRevision }) => ({ voiceScopeId, voiceId, voiceRevision }))), voices);
  // Choosing a saved voice must not re-scope other characters in a mixed script.
  await page.evaluate(() => {
    applyRole({ id: 'legacy-saved', voiceKey: 'design:youth-male', options: { mode: 'design', character: 'youth-male', emotion: 'natural' } }, false);
    state.rows.push({ text: '另一位角色', voiceKey: 'design:youth-male', emotion: 'natural', filename: 'third' });
    setScript(true, false); selectVoice('preset:Vivian', false); saveDraft(true);
  });
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === '已自动保存');
  const mixed = await page.evaluate(() => state.rows.map(rowOptions).map(({ voiceScopeId, voiceId, voiceRevision }) => ({ voiceScopeId, voiceId, voiceRevision })));
  assert.deepEqual(mixed.slice(0, 2), voices); assert.equal(mixed[2].voiceScopeId, 'saved-roles');
  await close(); await launch();
  assert.deepEqual(await page.evaluate(() => state.rows.map(rowOptions).map(({ voiceScopeId, voiceId, voiceRevision }) => ({ voiceScopeId, voiceId, voiceRevision }))), mixed);
  assert.deepEqual(errors, []);
  await close();
  assert.equal((await readFile(path.join(data, 'studio.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
  console.log('Passed: native SQLite autosave, legacy migration, all editor parameters, full application restart, immediate close flush, empty text/dialogue and no manual draft buttons.');
} finally { if (app) await app.close(); await fixture.cleanup(); }
