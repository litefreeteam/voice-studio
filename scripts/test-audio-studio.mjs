import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const python = process.env.VOICE_STUDIO_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const asrAssets = process.env.VOICE_STUDIO_TEST_ASR_ASSETS;
if (asrAssets) await writeFile(path.join(fixture.data, 'storage.json'), JSON.stringify({ assetDir: path.resolve(asrAssets) }));
const artifacts = path.join(root, '.test-data/audio-studio'); await mkdir(artifacts, { recursive: true });
await cp(path.join(root, 'backend'), path.join(fixture.appDir, 'backend'), { recursive: true });
await copyFile(path.join(root, 'backend/worker.py'), path.join(fixture.appDir, 'backend/studio_worker.py'));
await copyFile(path.join(root, 'tests/fixtures/audio-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
await copyFile(path.join(root, 'shared/transcription-manifest.json'), path.join(fixture.appDir, 'shared/transcription-manifest.json'));
const musicFile = path.join(fixture.data, '背景音乐.wav'), referenceFile = path.join(fixture.data, '参考录音.wav');
execFileSync(python, ['-c', `import numpy as np,soundfile as sf,sys
for name,seconds,freq in [(sys.argv[1],3,220),(sys.argv[2],8,440)]:
 sf.write(name,np.sin(np.arange(seconds*24000)/24000*2*np.pi*freq)*.1,24000)
`, musicFile, referenceFile]);
if (asrAssets) await copyFile(path.join(root, 'ui/assets/previews/clear-female.mp3'), referenceFile);
let app, page; const errors = [];
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: python } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady).catch(error => { console.error('Renderer errors:', errors); throw error; });
  await page.evaluate(() => refresh());
}
async function complete() {
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'), null, { timeout: 30000 });
  await page.evaluate(() => refresh());
  await page.waitForFunction(() => document.querySelector('.project-line-versions') && !document.querySelector('.project-line-versions').disabled).catch(async error => {
    console.log('Audio readiness:', await page.evaluate(async () => ({ row: document.querySelector('.project-line-row')?.textContent, jobs: await studio.invoke('jobs-list'), hint: document.querySelector('#toast').textContent, history: state.history.length, errors: document.querySelector('#project-role-error').textContent })));
    throw error;
  });
}
async function chooseFile(file) { await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file); }
try {
  await launch();
  await page.locator('[data-view="projects"]').click(); await page.locator('#project-new').click(); await page.locator('#project-new-name').fill('版本、波形与混音'); await page.locator('#project-new-form .primary').click();
  await page.locator('#project-add-line').click(); await page.locator('.project-line-row textarea').fill('同一句台词，可以选回上一遍更好听的。');
  await page.locator('.project-line-actions .text-button').filter({ hasText: '生成这句' }).click(); await complete();
  await page.locator('.project-line-actions .text-button').filter({ hasText: '重做这句' }).click(); await complete();
  await page.locator('.project-line-versions').click(); await page.locator('#audio-editor-dialog').waitFor();
  assert.equal(await page.locator('#audio-editor-version option').count(), 2);
  const first = await page.locator('#audio-editor-version option').first().getAttribute('value');
  await page.locator('#audio-editor-version-trigger').click(); await page.getByRole('option').filter({ hasText: '第 1 版' }).click(); await page.locator('#audio-editor-select').click();
  await page.waitForFunction(() => document.querySelector('#audio-editor-select').textContent === '已选为成品');
  const waveFields = page.locator('#audio-editor-dialog .audio-wave-selection input');
  await waveFields.nth(0).fill('0.5'); await waveFields.nth(0).dispatchEvent('change');
  await waveFields.nth(1).fill('3.5'); await waveFields.nth(1).dispatchEvent('change');
  const canvas = page.locator('#audio-editor-dialog canvas'); await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .125, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .1875, bounds.y + bounds.height / 2); await page.mouse.up();
  assert.ok(Math.abs(Number(await waveFields.nth(0).inputValue()) - .75) < .02, 'dragging the start handle edits the crop');
  await waveFields.nth(0).fill('0.5'); await waveFields.nth(0).dispatchEvent('change');
  await page.locator('#audio-editor-gain').fill('-6'); await page.locator('#audio-editor-fade-in').fill('100');
  await page.locator('#audio-editor-save').click();
  await page.waitForFunction(() => document.querySelector('#audio-editor-dialog .audio-quality').textContent.includes('已保存'));
  await page.locator('#audio-editor-dialog').screenshot({ path: path.join(artifacts, 'versions-waveform.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1080, height: 740 }));
  await page.waitForFunction(() => window.innerWidth <= 1080);
  assert.equal(await page.locator('#audio-editor-dialog').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth), false);
  await page.locator('#audio-editor-dialog').screenshot({ path: path.join(artifacts, 'waveform-narrow.png') });
  await page.locator('#audio-editor-dialog .audio-studio-transport button').first().click();
  await assertSound(page, '#audio-editor-preview');
  await page.locator('#audio-editor-original').click();
  await assertSound(page, '#audio-editor-preview', 'idle');
  await assertSound(page, '#audio-editor-original');
  await page.locator('#audio-editor-dialog .audio-studio-transport button').last().click();
  await assertSound(page, '#audio-editor-original', 'idle');
  await page.locator('#audio-editor-dialog .audio-studio-close').click();
  let project = await page.evaluate(async () => { const list = await studio.invoke('projects-list'); return studio.invoke('project-load', { id: list[0].id }); });
  const selectedTake = project.chapters[0].lines[0].selectedTake;
  assert.equal(selectedTake.id, first);
  let history = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8'));
  const old = history.find(item => item.options.lineTakeId === first); assert.equal(old.editedDuration, 3); assert.equal(history.length, 2);
  const originalBytes = await readFile(path.join(fixture.data, 'outputs', old.id, old.wav));

  // A paused task must not hide freshly imported music behind cached status.
  const preparationJob = await page.evaluate(async () => {
    const project = ScriptProjects.create('暂停任务的资源刷新验收'); await studio.invoke('project-save', project);
    const job = await studio.invoke('jobs-submit', { requestId: crypto.randomUUID(), options: { projectId: project.id, projectBatch: true,
      managed: true, scheduledAt: Date.now() + 3600000, rows: [{ text: '暂停中的台词。', lineId: 'paused-line', lineVersion: 'a'.repeat(32) }] } });
    await studio.invoke('jobs-pause', { id: job.id }); return { jobId: job.id, projectId: project.id };
  });
  const originalProjectId = project.id;
  const loadOriginal = () => page.evaluate(id => studio.invoke('project-load', { id }), originalProjectId);
  await app.evaluate(({ ipcMain }) => {
    const invoke = ipcMain._invokeHandlers.get('studio');
    globalThis.mixerTest = { failSave: false, delayPreview: false, lastPreviewMix: null };
    ipcMain.removeHandler('studio');
    ipcMain.handle('studio', async (event, action, data) => {
      if (action === 'project-save' && mixerTest.failSave) return { ok: false, error: { message: '混音保存失败检查' } };
      if (action === 'project-preview') mixerTest.lastPreviewMix = structuredClone(data.mix);
      const result = await invoke(event, action, data);
      if (action === 'project-preview' && mixerTest.delayPreview) await new Promise(resolve => { mixerTest.releasePreview = resolve; });
      return result;
    });
  });
  await page.locator('#project-mix-open').click();
  assert.equal(await page.locator('#project-mix-preview').isDisabled(), true, 'preview requires music');
  await page.locator('#project-mix-dialog').screenshot({ path: path.join(artifacts, 'mixing-empty.png') });
  await chooseFile(musicFile); await page.locator('#project-mix-import').click();
  await page.waitForFunction(() => document.querySelector('#project-mix-music').value.length === 32);
  assert.doesNotMatch(await page.locator('#project-mix-music option:checked').textContent(), /不可用/);
  assert.equal(await page.evaluate(() => state.backgrounds.length), 1);
  assert.equal((await loadOriginal()).mix, undefined, 'importing music does not save a draft to the project');
  await page.locator('[data-mix-gain="-30"]').click();
  assert.equal(await page.locator('#project-mix-gain').inputValue(), '-30');
  assert.equal(await page.locator('#project-mix-gain-range').inputValue(), '-30');
  await page.locator('#project-mix-gain-range').fill('-18');
  assert.equal(await page.locator('#project-mix-gain').inputValue(), '-18');
  await page.locator('[data-mix-offset="3"]').click();
  assert.equal(await page.locator('#project-mix-offset').inputValue(), '3');
  await page.locator('#project-mix-offset-range').fill('4.5');
  assert.equal(await page.locator('#project-mix-offset').inputValue(), '4.5');
  await page.locator('#project-mix-offset').fill('85.5');
  assert.equal(await page.locator('#project-mix-offset-range').inputValue(), '85.5', 'precise delays beyond the default slider range are retained');
  await page.locator('#project-mix-loop').uncheck(); await page.locator('#project-mix-duck').uncheck();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.locator('#project-mix-import').click();
  await page.waitForFunction(() => document.querySelector('#project-mix-status').textContent.includes('已取消导入'));
  assert.equal(await page.locator('#project-mix-gain').inputValue(), '-18');
  assert.equal(await page.locator('#project-mix-offset').inputValue(), '85.5');
  await page.keyboard.press('Escape');
  await page.locator('#project-mix-dialog').waitFor({ state: 'hidden' });
  assert.equal((await loadOriginal()).mix, undefined, 'Escape discards unsaved mixing settings');
  assert.equal(await page.locator('#project-mix-open').evaluate(el => el === document.activeElement), true, 'closing restores focus to the entry');
  await page.locator('#project-mix-open').click();
  await page.locator('#project-mix-music-trigger').click();
  await page.getByRole('option').filter({ hasText: /^背景音乐 ·/ }).click();
  assert.equal(await page.locator('#project-mix-gain').inputValue(), '-20');
  assert.equal(await page.locator('#project-mix-offset').inputValue(), '0');
  assert.equal(await page.locator('#project-mix-loop').isChecked(), true);
  assert.equal(await page.locator('#project-mix-duck').isChecked(), true);
  await page.locator('#project-mix-remove').click();
  assert.equal(await page.locator('#project-mix-preview').isDisabled(), true);
  assert.equal(await page.evaluate(() => state.backgrounds.length), 1, 'removal leaves the local music library intact');
  await page.locator('#project-mix-music-trigger').click();
  await page.getByRole('option').filter({ hasText: /^背景音乐 ·/ }).click();
  await page.locator('[data-mix-offset="5"]').click();
  await page.locator('#project-mix-loop').uncheck(); await page.locator('#project-mix-duck').uncheck();
  await page.locator('#project-mix-reset').click();
  assert.equal(await page.locator('#project-mix-offset').inputValue(), '0');
  assert.equal(await page.locator('#project-mix-loop').isChecked(), true);
  assert.equal(await page.locator('#project-mix-duck').isChecked(), true);
  await page.locator('#project-mix-gain').fill('-24'); await page.locator('#project-mix-gain').dispatchEvent('change');
  assert.equal(await page.locator('#project-mix-gain-range').inputValue(), '-24');
  await page.locator('#project-mix-preview').click();
  await page.waitForFunction(() => document.querySelector('#project-mix-status').textContent.includes('正在试听'));
  await assertSound(page, '#project-mix-preview');
  await page.locator('#project-mix-preview').click(); await assertSound(page, '#project-mix-preview', 'paused');
  await page.locator('#project-mix-preview').click(); await assertSound(page, '#project-mix-preview');
  assert.equal((await loadOriginal()).mix, undefined, 'a real mixed preview leaves project settings unchanged');
  assert.equal(await app.evaluate(() => mixerTest.lastPreviewMix.gainDb), -24, 'preview sends the current draft to the real mixer');
  await page.locator('#project-mix-dialog').screenshot({ path: path.join(artifacts, 'mixing.png') });
  await page.locator('#project-mix-stop').click();
  await app.evaluate(() => { mixerTest.delayPreview = true; });
  await page.evaluate(() => { window.lateMixPlays = 0; const play = Audio.prototype.play; Audio.prototype.play = function () { window.lateMixPlays++; return play.call(this); }; });
  await page.locator('#project-mix-preview').click();
  await page.locator('#project-mix-close').click();
  await page.waitForFunction(() => !document.querySelector('#project-mix-dialog').open);
  for (let tries = 0; !await app.evaluate(() => !!mixerTest.releasePreview); tries++) {
    assert.ok(tries < 100, 'preview reaches its controlled response gate');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await app.evaluate(() => { mixerTest.delayPreview = false; mixerTest.releasePreview(); });
  await page.waitForFunction(() => document.querySelector('#project-mix-preview').getAttribute('aria-busy') === 'false');
  assert.equal(await page.evaluate(() => window.lateMixPlays), 0, 'closing a pending preview never starts late audio');
  await page.locator('#project-mix-open').click(); await page.locator('#project-mix-music-trigger').click();
  await page.getByRole('option').filter({ hasText: /^背景音乐 ·/ }).click();
  await page.locator('#project-mix-gain').fill('-24');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 960, height: 640 }));
  await page.waitForFunction(() => window.innerWidth <= 960);
  assert.equal(await page.locator('#project-mix-dialog').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth), false);
  assert.equal(await page.locator('#project-mix-apply').evaluate(button => { const r = button.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }), true, 'save remains visible in a small window');
  await page.locator('#project-mix-duck').scrollIntoViewIfNeeded();
  await page.locator('#project-mix-dialog').screenshot({ path: path.join(artifacts, 'mixing-narrow.png') });
  await app.evaluate(() => { mixerTest.failSave = true; });
  await page.locator('#project-mix-apply').click();
  await page.waitForFunction(() => document.querySelector('#project-mix-error').textContent.includes('混音保存失败检查'));
  assert.equal(await page.locator('#project-mix-dialog').isVisible(), true);
  assert.equal(await page.locator('#project-mix-gain').inputValue(), '-24', 'a failed save retains the draft for retry');
  assert.equal((await loadOriginal()).mix, undefined);
  await app.evaluate(() => { mixerTest.failSave = false; });
  await page.evaluate(() => projectWorkspace.save());
  assert.equal((await loadOriginal()).mix, undefined, 'failed save rolls the in-memory project back before autosave');
  await page.locator('#project-mix-apply').click(); await page.locator('#project-mix-dialog').waitFor({ state: 'hidden' });
  project = await loadOriginal();
  assert.equal(project.mix.gainDb, -24); assert.equal(project.mix.backgroundId.length, 32);
  await page.locator('#project-mix-open').click();
  await page.locator('[data-mix-gain="-12"]').click(); await page.locator('#project-mix-remove').click();
  await page.locator('#project-mix-cancel').click();
  assert.deepEqual((await loadOriginal()).mix, project.mix, 'Cancel preserves previously saved mix');
  const exportFile = path.join(fixture.data, '编辑与混音成品.zip');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exportFile);
  await page.locator('#project-delivery').click(); await page.locator('#project-delivery-submit').click();
  await page.waitForFunction(() => !document.querySelector('#project-delivery-success').hidden);
  const report = JSON.parse(execFileSync(python, ['-c', 'import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("report.json").decode())', exportFile], { encoding: 'utf8' }));
  assert.equal(report.segments[0].id, old.id); assert.equal(report.durationSeconds, 3); assert.equal(report.mix.gainDb, -24);
  await page.locator('#project-delivery-close').click();
  await assert.rejects(page.evaluate(id => studio.invoke('project-delete', { id }), preparationJob.projectId), /完成或取消/);
  await page.evaluate(async ({ jobId, projectId }) => {
    await studio.invoke('jobs-cancel', { id: jobId }); await studio.invoke('project-delete', { id: projectId }); await refresh();
  }, preparationJob);

  await chooseFile(referenceFile); await page.locator('[data-view="roles"]').click();
  await page.locator('#reference-consent').check(); await page.locator('#import-reference').click();
  await page.locator('#reference-import-dialog').waitFor();
  if (asrAssets) {
    await page.locator('#reference-import-transcribe').click();
    await page.waitForFunction(() => document.querySelector('#reference-import-text').value.length > 5, null, { timeout: 90000 });
    assert.match(await page.locator('#reference-import-text').inputValue(), /长方形|面积|厘米|卡片/);
    await page.waitForFunction(() => !document.querySelector('#status-text').textContent.includes('正在本机识别'));
    await writeFile(path.join(artifacts, 'transcription.json'), JSON.stringify({ text: await page.locator('#reference-import-text').inputValue(), engine: 'faster-whisper-small', local: true }, null, 2));
  }
  const referenceFields = page.locator('#reference-import-dialog .audio-wave-selection input');
  await referenceFields.nth(0).fill('1'); await referenceFields.nth(0).dispatchEvent('change');
  await referenceFields.nth(1).fill('6'); await referenceFields.nth(1).dispatchEvent('change');
  if (asrAssets) assert.equal(await page.locator('#reference-import-text').inputValue(), '', 'changing the selected audio invalidates the auto-filled transcript');
  await page.locator('#reference-import-name').fill('核对后的参考声音'); await page.locator('#reference-import-text').fill('这是已经核对的录音原话。');
  await page.locator('#reference-import-preview').click(); await assertSound(page, '#reference-import-preview');
  await page.locator('#reference-import-dialog .audio-studio-transport').first().getByRole('button', { name: '停止', exact: true }).click();
  await assertSound(page, '#reference-import-preview', 'idle');
  await page.locator('#reference-import-dialog').screenshot({ path: path.join(artifacts, 'reference-import.png') });
  await page.locator('#reference-import-save').click(); await page.locator('#reference-import-dialog').waitFor({ state: 'detached' });
  const refs = await page.evaluate(async () => (await studio.invoke('status')).references);
  assert.equal(refs[0].text, '这是已经核对的录音原话。'); assert.equal(refs[0].duration, 5);
  await page.locator('[data-view="editor"]').click(); await page.evaluate(() => selectVoice('preset:Vivian'));
  await page.locator('#text').fill('快速配音版本比较。'); await page.locator('#generate').click();
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'));
  const quick = page.locator('#results .clip').filter({ hasText: '快速配音版本比较。' }); await quick.first().waitFor();
  const quickOriginalId = await quick.first().getAttribute('data-clip-id');
  await quick.first().getByRole('button', { name: '重做', exact: true }).click();
  await page.waitForFunction(async () => (await studio.invoke('status')).history.filter(item => item.text === '快速配音版本比较。').length === 2);
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'));
  await page.evaluate(() => refresh());
  await quick.first().getByRole('button', { name: '版本 / 波形', exact: true }).click();
  await page.locator('#audio-editor-version-trigger').click(); await page.getByRole('option').filter({ hasText: '第 1 版' }).click();
  await page.locator('#audio-editor-select').click(); await page.waitForFunction(() => document.querySelector('#audio-editor-select').textContent === '已选为成品').catch(async error => { console.log('Selection debug:', await page.evaluate(() => ({ error: document.querySelector('#audio-editor-dialog .audio-studio-error').textContent, selection: state.audioSelections, quick: state.history.filter(item => item.text === '快速配音版本比较。') }))); throw error; });
  await page.locator('#audio-editor-dialog .audio-studio-close').click();
  assert.equal(await quick.count(), 1, 'selected quick takes are not duplicated across output jobs');
  await page.locator('[data-view="history"]').click();
  const chosenQuick = page.locator('#history .clip').filter({ hasText: '快速配音版本比较。' }); assert.equal(await chosenQuick.count(), 1);
  assert.equal(await chosenQuick.getAttribute('data-clip-id'), quickOriginalId);
  await chosenQuick.locator('.play').click(); await assertSound(page, '#history .clip .play');
  await chosenQuick.screenshot({ path: path.join(artifacts, 'work-playback.png') });
  await chosenQuick.locator('.play').click(); await assertSound(page, '#history .clip .play', 'idle');
  const wavExport = path.join(fixture.data, '所选版本.wav');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, wavExport);
  await chosenQuick.getByRole('button', { name: 'WAV ↓', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('音频已导出'));
  assert.deepEqual(await readFile(wavExport), await readFile(path.join(fixture.data, 'outputs', quickOriginalId, 'voice.wav')));
  await app.close(); await launch();
  project = await page.evaluate(async () => { const list = await studio.invoke('projects-list'); return studio.invoke('project-load', { id: list[0].id }); });
  assert.deepEqual(project.chapters[0].lines[0].selectedTake, selectedTake); assert.equal(project.mix.gainDb, -24);
  assert.equal(await page.evaluate(async id => (await studio.invoke('status')).audioSelections[id], quickOriginalId), quickOriginalId);
  assert.deepEqual(await readFile(path.join(fixture.data, 'outputs', old.id, old.wav)), originalBytes);
  history = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8')); assert.equal(history.find(item => item.id === old.id).editedDuration, 3);

  // The real copy action keeps mix/target settings and starts with independent takes.
  await page.evaluate(id => projectWorkspace.open(id), project.id);
  await page.locator('#project-options-open').click();
  await page.locator('#project-target-seconds').fill('90'); await page.evaluate(() => projectWorkspace.save());
  await page.locator('#project-options-done').click();
  await page.locator('#project-back').click(); await page.getByRole('button', { name: '复制项目', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#project-title').value.endsWith(' · 副本'));
  const copy = await page.evaluate(async () => { const projects = await studio.invoke('projects-list'); return studio.invoke('project-load', { id: projects.find(project => project.name.endsWith(' · 副本')).id }); });
  assert.deepEqual(copy.mix, project.mix); assert.equal(copy.targetSeconds, 90);
  assert.equal(copy.chapters[0].lines[0].selectedTake, undefined); assert.equal(copy.chapters[0].lines[0].generationAttempt, undefined);
  await page.locator('.project-line-actions .text-button').filter({ hasText: '生成这句' }).click(); await complete();
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 1/);

  // The deletion warning, cancellation and cleanup cover all original versions.
  await page.locator('#project-back').click();
  const originalCard = page.locator(`[data-project-id="${project.id}"]`);
  await originalCard.locator('.project-card-delete').click();
  assert.match(await page.locator('#project-confirm-description').textContent(), /全部配音音频和版本.*无法恢复/);
  await page.locator('#project-confirm-dialog [data-close]').click();
  assert.deepEqual(await readFile(path.join(fixture.data, 'outputs', old.id, old.wav)), originalBytes);
  await originalCard.locator('.project-card-delete').click(); await page.locator('#project-confirm-apply').click();
  await originalCard.waitFor({ state: 'detached' });
  for (const item of history.filter(item => item.options?.projectId === project.id)) {
    await assert.rejects(readFile(path.join(fixture.data, 'outputs', item.id, item.wav)), { code: 'ENOENT' });
  }
  await app.close(); await launch();
  const remaining = await page.evaluate(() => studio.invoke('status'));
  assert.equal(remaining.history.some(item => item.options?.projectId === project.id), false);
  assert.equal(remaining.history.filter(item => item.options?.projectId === copy.id).length, 1);
  assert.equal(remaining.history.filter(item => item.text === '快速配音版本比较。').length, 2);
  assert.equal(remaining.jobs.jobs.some(job => job.projectId === project.id), false);
  assert.equal(remaining.references.length, 1); assert.equal(remaining.backgrounds.length, 1);
  assert.deepEqual(await readFile(wavExport), await readFile(path.join(fixture.data, 'outputs', quickOriginalId, 'voice.wav')));
  assert.equal(JSON.parse(execFileSync(python, ['-c', 'import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("report.json").decode())', exportFile], { encoding: 'utf8' })).segments[0].id, old.id);
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ passed: true, realTranscription: !!asrAssets, checks: ['older take selection', 'real PCM crop/gain/fade', 'original retention', 'real mixed draft preview and final ZIP', 'mix sliders, presets, switches and precision', 'mix cancel and Escape discard draft', 'mix save failure rollback and retry', 'late preview cannot play after close', 'small window fixed footer', 'background persistence', 'paused task imports', 'reference crop and transcript', 'independent project copies with mix and target', 'project audio deletion and cancellation', 'restart'], errors }, null, 2));
  console.log('Passed: real Electron version selection, waveform editing, paused-task resource imports, project copies with mix/target settings, project audio cleanup, and restart persistence. TTS alone is deterministic.');
} catch (error) {
  console.log('Audio UI failure:', await page?.evaluate(() => ({ width: innerWidth, height: innerHeight, open: [...document.querySelectorAll('dialog[open]')].map(d => d.id), mix: ['#project-mix-preview', '.mix-dialog-footer', '.mix-cover-tag'].map(selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), css = getComputedStyle(el); return { selector, x: r.x, y: r.y, width: r.width, height: r.height, position: css.position, zIndex: css.zIndex }; }) })).catch(() => null));
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {}); throw error;
} finally { await app?.close().catch(() => {}); await fixture.cleanup(); }
