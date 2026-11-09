import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { prepareGeneration } from '../desktop/jobs.cjs';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const artifacts = path.join(root, '.test-data/templates');
await mkdir(artifacts, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const file = path.join(root, 'ui', new URL(request.url, 'http://localhost').pathname);
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
page.setDefaultTimeout(10000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(({ catalog }) => {
    window.calls = [];
    window.studio = {
      onProgress() {}, saveSessionSync(data) { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; },
      async invoke(action, data) {
        window.calls.push({ action, data });
        if (action === 'license') return { activated: true, machineCode: 'TEST' };
        if (action === 'catalog') return catalog;
        if (action === 'status') return { license: { activated: true, machineCode: 'TEST' }, history: [], references: [], packages: ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true })), jobs: { revision: 0, jobs: [] } };
        if (action === 'session-load') return JSON.parse(localStorage.getItem('test-session') || 'null');
        if (action === 'session-save') { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; }
        if (action === 'jobs-submit') return { id: 'template-' + window.calls.length, revision: window.calls.length, jobs: [] };
        throw new Error('Unexpected call: ' + action);
      }
    };
  }, { catalog });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('声音已就绪'));
  await page.locator('[data-view="editor"]').click();
  await page.locator('#text').fill('我的原始文稿，需要在撤销后完整保留。');
  await page.locator('#project-name').fill('用户命名的作品');
  const original = await page.evaluate(() => ({ text: document.querySelector('#text').value, voice: document.querySelector('#selected-voice strong').textContent, scene: document.querySelector('#scene').value }));
  await page.locator('#open-templates').click();
  assert.equal(await page.locator('.template-card').count(), 20);
  await page.locator('#template-categories button').filter({ hasText: '课程与培训' }).click();
  assert.equal(await page.locator('.template-card').count(), 6);
  await page.locator('#template-search').fill('课程 沐言');
  assert.equal(await page.locator('.template-card').count(), 1);
  await page.locator('#template-search').fill('不存在的模板');
  assert.equal(await page.locator('.template-card').count(), 0);
  await page.locator('#template-grid').getByRole('button', { name: '查看全部模板' }).click();
  await page.locator('[data-template="course-batch"] .sample-preview').click();
  await page.waitForFunction(() => !document.querySelector('#sample-player').classList.contains('hidden'));
  assert.equal(await page.locator('#template-dialog #sample-player').count(), 1);
  assert.equal(await page.locator('#sample-player').isVisible(), true);
  assert.equal(await page.evaluate(() => window.calls.some(call => ['generate', 'jobs-submit'].includes(call.action))), false);
  await page.screenshot({ path: path.join(artifacts, 'template-library-1360.png') });
  await page.locator('[data-template="course-batch"] .button').click();
  assert.equal(await page.locator('#batch').isChecked(), true);
  assert.equal(await page.locator('#selected-voice strong').textContent(), '沐言');
  assert.equal(await page.locator('#project-name').inputValue(), '用户命名的作品');
  await page.locator('#undo-template').click();
  assert.deepEqual(await page.evaluate(() => ({ text: document.querySelector('#text').value, voice: document.querySelector('#selected-voice strong').textContent, scene: document.querySelector('#scene').value })), original);
  for (const template of catalog.templates) {
    await page.locator('#open-templates').click();
    await page.locator(`[data-template="${template.id}"] .button`).click();
    assert.equal(await page.locator('#language').inputValue(), template.language);
    assert.equal(await page.locator('#scene').inputValue(), template.scene);
    assert.equal(await page.locator('#pace').inputValue(), template.pace);
    assert.equal(await page.locator('#engine').inputValue(), 'standard');
    assert.equal(await page.locator('#project-name').inputValue(), '用户命名的作品');
    const before = await page.evaluate(() => window.calls.filter(call => call.action === 'jobs-submit').length);
    await page.locator('#generate').click();
    await page.waitForFunction(before => window.calls.filter(call => call.action === 'jobs-submit').length > before, before);
    const data = await page.evaluate(() => window.calls.filter(call => call.action === 'jobs-submit').at(-1).data.options);
    const prepared = prepareGeneration(data);
    const effective = prepared.rows.map(row => ({ ...prepared, ...row }));
    for (const row of effective.filter(row => row.mode === 'design')) {
      assert.equal(row.lockVoice, true); assert.ok(row.voiceScopeId); assert.ok(row.voiceId);
      const same = effective.filter(other => other.mode === 'design' && other.character === row.character);
      assert.ok(same.every(other => other.voiceScopeId === row.voiceScopeId && other.voiceId === row.voiceId && other.voiceRevision === row.voiceRevision));
    }
    assert.equal(prepared.rows.length, template.rows?.length || (template.batch ? template.text.split('\n').length : 1));
    if (template.rows) for (let index = 0; index < template.rows.length; index++) {
      const [mode, id] = template.rows[index].voiceKey.split(':');
      assert.equal(prepared.rows[index].mode, mode);
      assert.equal(prepared.rows[index][mode === 'design' ? 'character' : 'speaker'], id);
      assert.equal(prepared.rows[index].filename, template.rows[index].filename);
      if (template.rows[index].instruction) assert.equal(prepared.rows[index].instruction, template.rows[index].instruction);
    }
  }
  const podcast = catalog.templates.find(template => template.id === 'interview-dialogue');
  await page.locator('#draft-status').filter({ hasText: '已自动保存' }).waitFor();
  const identity = await page.evaluate(() => ({ scope: sessionSnapshot().options.voiceScopeId, rows: state.rows.map(rowOptions).map(row => [row.voiceScopeId, row.voiceId, row.voiceRevision]) }));
  await page.reload();
  await page.waitForFunction(count => document.querySelectorAll('.script-row').length === count, podcast.rows.length);
  await page.locator('[data-view="editor"]').click();
  assert.deepEqual(await page.evaluate(() => state.rows.map(row => row.instruction)), podcast.rows.map(row => row.instruction), 'podcast directions survive saving and restoring the quick editor');
  const direction = page.locator('.script-row input[aria-label$="条表演要求"]').first();
  assert.equal(await direction.inputValue(), podcast.rows[0].instruction);
  assert.equal(await direction.isDisabled(), false);
  await direction.fill('像和朋友聊天，好奇地提问。');
  assert.equal(await page.evaluate(() => rowOptions(state.rows[0]).instruction), '像和朋友聊天，好奇地提问。');
  await direction.fill(podcast.rows[0].instruction);
  await page.screenshot({ path: path.join(artifacts, 'podcast-quick.png') });
  assert.equal(await page.locator('#project-name').inputValue(), '用户命名的作品');
  assert.deepEqual(await page.evaluate(() => ({ scope: sessionSnapshot().options.voiceScopeId, rows: state.rows.map(rowOptions).map(row => [row.voiceScopeId, row.voiceId, row.voiceRevision]) })), identity);
  await page.locator('#open-templates').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#template-dialog').isVisible(), false);
  assert.equal(await page.locator('#open-templates').evaluate(node => node === document.activeElement), true);
  await page.locator('[data-view="voices"]').click();
  assert.equal(await page.locator('#voice-grid .voice-card').count(), catalog.voices.length + catalog.characters.length);
  await page.locator('#voice-language-trigger').click(); await page.getByRole('option', { name: '中文', exact: true }).click();
  assert.equal(await page.locator('#voice-grid .voice-card').count(), [...catalog.voices, ...catalog.characters].filter(voice => !voice.language || voice.language === 'Chinese').length);
  const newVoiceIds = ['clear-male', 'warm-male', 'steady-male', 'clear-female', 'warm-female', 'elegant-female'];
  const retunedVoiceIds = ['boy-clear', 'girl-clear', 'boy-soft', 'girl-soft', 'youth-male'];
  for (const id of [...newVoiceIds, ...retunedVoiceIds]) {
    const voice = catalog.characters.find(voice => voice.id === id);
    await page.locator('#voice-search').fill(voice.name);
    const card = page.locator(`#voice-grid [data-voice="design:${id}"]`);
    assert.equal(await card.count(), 1);
    await page.waitForFunction(id => { const img = document.querySelector(`[data-voice="design:${id}"] img`); return img?.complete && img.naturalWidth === 384; }, id);
    await card.locator('.sample-preview').click();
    await page.waitForFunction(id => samplePlaying?.audio?.readyState >= 2 && !samplePlaying.audio.paused && samplePlaying.audio.currentSrc.endsWith(`/${id}.mp3`) && Number.isFinite(samplePlaying.audio.duration) && samplePlaying.audio.duration > 3 && samplePlaying.audio.currentTime > .05, id);
    await card.locator('.sample-preview').click();
    assert.equal(await page.evaluate(() => samplePlaying.audio.paused), true);
    await card.locator('.use-voice').click();
    assert.equal(await page.locator('#selected-voice strong').textContent(), voice.name);
    assert.equal(await page.locator('#voice-description').inputValue(), voice.prompt);
    assert.equal(await page.locator('#lock-voice').isChecked(), true);
    if (voice.reference) assert.match(await page.locator('.preview-note').textContent(), /精选声音/);
    await page.locator('[data-view="voices"]').click();
  }
  await page.locator('#voice-search').fill('男声');
  assert.equal(await page.locator('#voice-grid .voice-card').count(), [...catalog.voices, ...catalog.characters].filter(voice => voice.gender === 'male' && (!voice.language || voice.language === 'Chinese')).length);
  await page.locator('#voice-search').fill('女声');
  assert.equal(await page.locator('#voice-grid .voice-card').count(), [...catalog.voices, ...catalog.characters].filter(voice => voice.gender === 'female' && (!voice.language || voice.language === 'Chinese')).length);
  assert.equal(await page.locator('#builtin-voice-count').textContent(), String(catalog.voices.length + catalog.characters.length));
  await page.locator('#voice-search').fill('课程 女声');
  assert.ok(await page.locator('#voice-grid .voice-card').count() > 0);
  await page.screenshot({ path: path.join(artifacts, 'voice-course-search.png') });
  await page.locator('#voice-search').fill('新声');
  assert.equal(await page.locator('#voice-grid .voice-card').count(), newVoiceIds.length);
  await page.screenshot({ path: path.join(artifacts, 'new-adult-voices.png'), fullPage: true });
  for (const width of [1360, 1080]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator('[data-view="editor"]').click(); await page.locator('#open-templates').click();
    await page.screenshot({ path: path.join(artifacts, `template-library-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#template-close').click();
  }
  assert.deepEqual(errors, []);
  console.log('Passed: all catalog voices, native-language and combined search; 20 templates, categories, search, real offline audition, complete generation options, multi-role filenames, undo, draft restore and keyboard focus.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
