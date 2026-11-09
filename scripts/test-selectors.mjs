import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';

// Exercise the real renderer and audio assets without downloading or running a model.
const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const artifacts = path.join(root, '.test-data/selectors');
await mkdir(artifacts, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const server = createServer(async (request, response) => {
  const file = path.join(root, 'ui', decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(path.join(root, 'ui') + path.sep)) { response.writeHead(403).end(); return; }
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
try {
  await page.addInitScript(({ catalog }) => {
    const history = JSON.parse(localStorage.getItem('test-history') || 'null') || Array.from({ length: 20 }, (_, index) => ({
      id: `clip-${index}`, text: `作品文案 ${index}`, project: index % 2 ? '故事集' : '旅行旁白',
      voiceName: index % 2 ? '温宁' : '知夏', speaker: index % 2 ? 'Serena' : 'Vivian',
      duration: 5 + index, wav: `${index}.wav`, mp3: `${index}.mp3`, createdAt: Date.now() - index * 60000,
      options: { scene: index % 2 ? 'story' : 'video' }
    })).concat([{
      id: 'project-clip', text: '配音项目专属台词', project: '项目专属名称', voiceName: '项目专属声音',
      duration: 5, wav: 'project.wav', createdAt: Date.now(), options: { projectId: 'project-1', scene: 'game' }
    }, {
      id: 'same-name-project-clip', text: '同名配音项目台词', project: '故事集', voiceName: '温宁',
      duration: 5, wav: 'same-name-project.wav', createdAt: Date.now(), options: { projectId: 'project-2', scene: 'story' }
    }]);
    window.calls = []; window.testReferences = []; window.failDelete = false;
    window.studio = {
      onProgress() {},
      saveSessionSync(data) { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; },
      async invoke(action, data) {
        window.calls.push({ action, data });
        if (action === 'license') return { activated: true, machineCode: 'TEST' };
        if (action === 'session-load') return JSON.parse(localStorage.getItem('test-session') || 'null');
        if (action === 'session-save') { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; }
        if (action === 'catalog') return catalog;
        if (action === 'status') return { license: { activated: true, machineCode: 'TEST' }, history, references: window.testReferences, packages: ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true })) };
        if (action === 'delete-work') {
          if (window.failDelete) throw new Error('删除失败，请重试');
          history.splice(history.findIndex(item => item.id === data.id), 1); localStorage.setItem('test-history', JSON.stringify(history)); return { deleted: true, id: data.id };
        }
        if (action === 'delete-reference') { window.testReferences = window.testReferences.filter(item => item.id !== data.id); return { deleted: true, id: data.id }; }
        throw new Error(`Unexpected call: ${action}`);
      }
    };
  }, { catalog });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('声音已就绪'));
  await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('select:visible').count(), 0);
  assert.equal(await page.locator('.select-trigger').count(), await page.locator('select').count());

  await page.locator('#text').fill('这段文案和作品名在选声后应完整保留。');
  await page.locator('#project-name').fill('测试作品');
  await page.locator('#browse-voices').click();
  assert.equal(await page.locator('#voice-picker-grid .voice-card').count(), catalog.voices.length + catalog.characters.length);
  assert.equal(await page.locator('#voice-picker-grid img').count(), catalog.voices.length + catalog.characters.length);
  await page.waitForFunction(() => [...document.querySelectorAll('#voice-picker-grid .voice-card:nth-child(-n+6) img')].every(image => image.complete && image.naturalWidth));
  await page.screenshot({ path: path.join(artifacts, 'voice-picker.png') });
  await page.locator('[data-picker-filter="child"]').click();
  assert.equal(await page.locator('#voice-picker-grid .voice-card').count(), 4);
  await page.locator('#voice-picker-search').fill('完全不存在');
  assert.equal(await page.locator('#voice-picker-grid .voice-card').count(), 0);
  await page.locator('#voice-picker-grid .text-button').click();
  await page.locator('#voice-picker-scene-trigger').click();
  await page.getByRole('option', { name: '睡前故事', exact: false }).click();
  const filteredCount = await page.locator('#voice-picker-grid .voice-card').count();
  assert.ok(filteredCount > 0 && filteredCount < catalog.voices.length + catalog.characters.length);
  await page.locator('#voice-picker-scene-trigger').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#voice-picker').isVisible(), true);
  assert.equal(await page.locator('.select-popover').count(), 0);
  await page.locator('#voice-picker-scene-trigger').click();
  await page.getByRole('option', { name: '不限用途', exact: true }).click();
  await page.locator('#voice-picker-search').fill('温宁');
  const card = page.locator('#voice-picker-grid [data-voice="preset:Serena"]');
  await card.locator('.sample-preview').click();
  await page.waitForFunction(() => document.querySelector('#sample-name').textContent.includes('温宁') && !document.querySelector('#sample-player').classList.contains('hidden'));
  assert.equal(await page.locator('#voice-picker #sample-player').isVisible(), true);
  await page.waitForFunction(() => document.querySelector('#voice-picker-grid .sample-preview').getAttribute('aria-label') === '暂停试听 温宁');
  assert.equal(await card.locator('.sample-preview').getAttribute('aria-label'), '暂停试听 温宁');
  await page.screenshot({ path: path.join(artifacts, 'voice-picker-preview.png') });
  await card.locator('.use-voice').click();
  assert.equal(await page.locator('#voice-picker').isVisible(), false);
  assert.equal(await page.locator('#view-editor').isVisible(), true);
  assert.equal(await page.locator('#selected-voice strong').textContent(), '温宁');
  assert.equal(await page.locator('#text').inputValue(), '这段文案和作品名在选声后应完整保留。');
  assert.equal(await page.locator('#project-name').inputValue(), '测试作品');
  assert.equal(await page.locator('#browse-voices').evaluate(node => node === document.activeElement), true);

  // The selected portrait owns its audition button; it plays without opening a separate player.
  assert.equal(await page.locator('.selected-voice #preview-voice').count(), 1);
  assert.equal(await page.locator('#preview-voice').textContent(), '');
  await page.locator('#preview-voice').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => samplePlaying?.audio.currentTime > .05 && !samplePlaying.audio.paused);
  assert.equal(await page.locator('#preview-voice').getAttribute('aria-pressed'), 'true');
  await assertSound(page, '#preview-voice');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#preview-voice .sound-wave i').first().evaluate(bar => getComputedStyle(bar).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('#sample-player').isVisible(), false);
  await page.locator('#preview-voice').click();
  assert.equal(await page.evaluate(() => samplePlaying.audio.paused), true);
  assert.equal(await page.locator('#preview-voice').getAttribute('aria-pressed'), 'false');
  await assertSound(page, '#preview-voice', 'paused');
  await page.locator('#preview-voice').click();
  await page.waitForFunction(() => samplePlaying.audio.ended && document.querySelector('#preview-voice').getAttribute('aria-pressed') === 'false', null, { timeout: 25000 });
  await assertSound(page, '#preview-voice', 'idle');

  // Reset restores voice defaults and persists them without changing the draft or export settings.
  await page.evaluate(() => {
    state.emotion = 'happy';
    for (const [id, value] of Object.entries({ language: 'Japanese', scene: 'ad', engine: 'light', intensity: '90', pace: 'fast', instruction: '有精神一点', prefix: 'my-voice', 'sample-rate': '44100' })) document.getElementById(id).value = value;
    renderSelection(); renderEmotions();
  });
  await page.locator('#reset-parameters').click();
  const defaults = await page.evaluate(() => sessionSnapshot());
  assert.equal(defaults.voiceKey, 'preset:Serena');
  assert.equal(defaults.text, '这段文案和作品名在选声后应完整保留。');
  assert.equal(defaults.options.project, '测试作品');
  assert.deepEqual(Object.fromEntries(['language', 'scene', 'engine', 'emotion', 'intensity', 'pace', 'instruction', 'prefix', 'sampleRate'].map(key => [key, defaults.options[key]])), {
    language: 'Chinese', scene: catalog.voices.find(voice => voice.id === 'Serena').scenes[0], engine: 'standard', emotion: 'natural', intensity: 50, pace: 'normal', instruction: '', prefix: 'my-voice', sampleRate: 44100
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('test-session')).options.intensity === 50);
  await page.reload();
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="editor"]').click();
  assert.deepEqual(await page.evaluate(() => sessionSnapshot()), defaults);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(artifacts, 'selected-voice-card.png') });

  await page.evaluate(() => { selectVoice('design:teacher-female', false); document.querySelector('#voice-description').value = '临时修改的声线'; document.querySelector('#lock-voice').checked = false; });
  await page.locator('#reset-parameters').click();
  assert.equal(await page.locator('#voice-description').inputValue(), catalog.characters.find(voice => voice.id === 'teacher-female').prompt);
  assert.equal(await page.locator('#lock-voice').isChecked(), true);
  await page.evaluate(() => selectVoice('design:custom', false));
  assert.equal(await page.locator('#preview-voice').isDisabled(), true);
  assert.match(await page.locator('#preview-voice').getAttribute('aria-label'), /生成后可试听/);
  await page.evaluate(defaults => restoreSession(defaults), defaults);

  // Keyboard commit, cancellation and settings dependent on the chosen value.
  await page.locator('.advanced-settings summary').click();
  await page.locator('#engine-trigger').focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#engine').inputValue(), 'light');
  assert.equal(await page.locator('#performance-fields').isVisible(), false);
  await page.locator('#engine-trigger').click();
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#engine').inputValue(), 'standard');
  await page.locator('#language-trigger').click();
  await page.locator('.select-search').fill('日语');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#language').inputValue(), 'Japanese');
  await page.locator('#language-trigger').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.select-popover').count(), 0);
  await page.locator('#language-trigger').click(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#engine-trigger').evaluate(node => node === document.activeElement), true);

  await page.locator('#mode-script').click();
  await page.locator('#script-voice-0-trigger').click();
  await page.locator('.select-search').fill('小雨');
  assert.equal(await page.locator('.select-option img').count(), 1);
  assert.ok(await page.locator('.select-option .select-tags').count() > 0);
  await page.screenshot({ path: path.join(artifacts, 'script-voice-selector.png') });
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#script-voice-0').inputValue(), 'design:girl-clear');
  assert.equal(await page.locator('#script-voice-0-trigger').evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator('#script-emotion-0-trigger').isDisabled(), true, 'fixed design follows its chosen sample');
  await page.evaluate(() => { document.querySelector('#lock-voice').checked = false; document.querySelector('#lock-voice').dispatchEvent(new Event('change')); });
  await page.locator('#script-emotion-0-trigger').click();
  await page.locator('.select-search').fill('开心'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#script-emotion-0').inputValue(), 'happy');

  await page.locator('#save-role').click(); await page.locator('#role-name').fill('温柔旁白');
  await page.locator('#name-dialog button[value="save"]').click();
  await page.locator('#saved-role-select-trigger').click();
  assert.equal(await page.locator('.select-option img').count(), 1);
  await page.getByRole('option', { name: '温柔旁白', exact: false }).click();
  await page.locator('#browse-voices').click(); await page.locator('[data-picker-filter="mine"]').click();
  assert.equal(await page.locator('#voice-picker-grid .voice-card').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#voice-picker').isVisible(), false);

  await page.locator('[data-view="history"]').click();
  assert.equal(await page.locator('#history-count').textContent(), '20');
  assert.equal(await page.locator('#history-total').textContent(), '20');
  assert.equal(await page.locator('#history-project option').filter({ hasText: '项目专属名称' }).count(), 0);
  assert.equal(await page.locator('#history-voice option').filter({ hasText: '项目专属声音' }).count(), 0);
  assert.equal(await page.locator('#history-scene option[value="game"]').count(), 0);
  await page.locator('#history-search').fill('配音项目专属台词');
  assert.equal(await page.locator('#history .clip').count(), 0);
  assert.equal(await page.locator('#history-export').isDisabled(), true);
  await page.locator('#history-reset').click();
  await page.locator('#history-project-trigger').click();
  assert.equal(await page.locator('.select-heading').textContent(), '作品名称');
  assert.equal(await page.getByRole('option', { name: /故事集/ }).locator('.select-description').textContent(), '10 条作品');
  await page.getByRole('option', { name: '故事集', exact: false }).click();
  assert.equal(await page.locator('#history .clip').count(), 10);
  await page.locator('#history-reset').click();
  assert.equal(await page.locator('#history-project-trigger .select-title').textContent(), '全部作品');
  assert.equal(await page.locator('#history .clip').count(), 12);
  await page.locator('#history-page-size-trigger').click();
  await page.getByRole('option', { name: '24 条', exact: true }).click();
  assert.equal(await page.locator('#history .clip').count(), 20);

  // Every dropdown is enhanced, including rebuilt rows and hidden views.
  assert.equal(await page.locator('select:visible').count(), 0);
  assert.equal(await page.locator('.select-trigger').count(), await page.locator('select').count());
  assert.deepEqual(await page.evaluate(() => window.calls.filter(call => !['license', 'catalog', 'status', 'session-load', 'session-save', 'projects-list', 'lab-list'].includes(call.action))), []);
  // Delete controls use a consistent accessible icon, with cancel/error paths preserving data.
  assert.equal(await page.locator('#history .delete-item').count(), 20);
  assert.equal(await page.locator('#history .delete-item .icon-trash-2').count(), 20);
  await page.screenshot({ path: path.join(artifacts, 'history-delete.png') });
  const workId = await page.locator('#history .clip').first().getAttribute('data-clip-id');
  await page.locator('#history .delete-item').first().click();
  assert.equal(await page.locator('#delete-dialog').isVisible(), true);
  await page.locator('#delete-cancel').click();
  assert.equal(await page.locator('#history .clip').count(), 20);
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.action === 'delete-work').length), 0);
  await page.locator('#history .delete-item').first().click();
  await page.evaluate(() => { window.failDelete = true; });
  await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => document.querySelector('#delete-error').textContent === '删除失败，请重试');
  assert.equal(await page.locator('#history .clip').count(), 20);
  await page.evaluate(() => { window.failDelete = false; });
  await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => document.querySelectorAll('#history .clip').length === 19);
  assert.equal(await page.locator(`#history [data-clip-id="${workId}"]`).count(), 0);
  await page.locator('[data-view="roles"]').click();
  assert.equal(await page.locator('#role-grid .delete-item').count(), 1);
  await page.locator('#role-grid .delete-item').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#role-grid .voice-card').count(), 1);
  await page.locator('#role-grid .delete-item').click(); await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => document.querySelectorAll('#role-grid .voice-card').length === 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('shengyue-roles-1'))), []);
  await page.evaluate(async () => { window.testReferences.push({ id: 'a'.repeat(32), name: '我的参考人声', duration: 5, text: '这是我的录音。' }); await refresh(); });
  await page.locator('#reference-grid .use-voice').click();
  await page.locator('#save-role').click(); await page.locator('#role-name').fill('录音角色'); await page.locator('#name-dialog button[value="save"]').click();
  await page.locator('[data-view="roles"]').click();
  assert.equal(await page.locator('#reference-grid .delete-item').count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'my-voices-delete.png') });
  await page.locator('#reference-grid .delete-item').click();
  await page.screenshot({ path: path.join(artifacts, 'delete-confirmation.png') });
  await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => document.querySelectorAll('#reference-grid .voice-card').length === 0);
  assert.equal(await page.locator('#role-grid .voice-card').count(), 0);
  assert.equal(await page.locator('#reference-select option').count(), 0);
  assert.equal(await page.evaluate(() => state.voiceKey), 'design:warm-female');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('shengyue-roles-1'))), []);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('声音已就绪'));
  await page.locator('[data-view="history"]').click(); assert.equal(await page.locator('#history .clip').count(), 12); assert.equal(await page.locator('#history-total').textContent(), '19');

  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1024, height: 650 });
  await page.locator('[data-view="editor"]').click(); await page.locator('#browse-voices').click();
  await page.screenshot({ path: path.join(artifacts, 'voice-picker-small.png') });
  assert.equal(await page.locator('#voice-picker-close').isVisible(), true);
  console.log('Passed: custom dropdowns, keyboard/search, voice modal, real preview, draft preservation, saved roles, history filters and work/role/reference deletion with cancellation and failure recovery.');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
