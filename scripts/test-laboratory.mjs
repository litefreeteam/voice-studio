import { _electron as electron, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
import Media from '../ui/lab-media.js';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
await mkdir(path.join(fixture.appDir, 'backend'));
await copyFile(path.join(root, 'tests/fixtures/project-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
const artifacts = path.join(root, '.test-data/laboratory'); await mkdir(artifacts, { recursive: true });
let app, page, browser; const errors = [];
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
}
const scope = () => page.locator('#lab-workspace');
async function saved() { await page.waitForFunction(() => /已.*保存/.test(document.querySelector('#lab-save-state').textContent)); }
async function choose(label, value, parent = scope()) {
  await parent.locator('select').evaluateAll((selects, { label, value }) => { const select = selects.find(select => select.closest('.lab-field').querySelector('label').textContent === label); if (!select) throw new Error('Select missing: ' + label); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, { label, value });
}
async function completed(count) {
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'), null, { timeout: 30000 });
  await page.waitForFunction(count => document.querySelector('#lab-summary').textContent.includes(`已完成 ${count} 段`) && !document.querySelector('#lab-summary').textContent.includes('处理中'), count);
}
async function current() {
  return page.evaluate(async () => { const list = await studio.invoke('lab-list'); return studio.invoke('lab-load', { id: list.find(item => item.name === document.querySelector('#lab-name').value).id }); });
}
async function newWork(index, name) {
  if (await page.locator('#lab-back').isVisible()) await page.locator('#lab-back').click();
  await page.locator('#lab-kinds .lab-kind').nth(index).click();
  await page.locator('#lab-name').fill(name); await saved();
}
async function generate(count) { await page.locator('#lab-generate').click(); await completed(count); }
async function exportFile(label, filename) {
  const destination = path.join(artifacts, filename);
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, destination);
  await page.locator('#toast').evaluate(toast => toast.textContent = '');
  await page.locator('#lab-export-actions').getByRole('button', { name: label, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已保存到所选位置') && document.querySelector('#lab-export-progress').hidden);
  await stat(destination); return destination;
}
const calls = async () => (await readFile(path.join(fixture.data, 'test-calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const totalCalls = async () => (await calls()).flat().length;
async function screenshot(name) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true }); }

try {
  await launch(); await page.locator('[data-view="laboratory"]').click();
  assert.equal(await page.locator('#lab-kinds .lab-kind').count(), 4);
  await page.waitForFunction(() => [...document.querySelectorAll('.lab-kind-art')].every(image => image.complete && image.naturalWidth > 0));
  await screenshot('library');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 740 }));
  await page.waitForFunction(() => window.innerWidth <= 1120);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await screenshot('library-narrow');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1420, height: 920 }));
  await newWork(0, '同一句文案的四种表达'); await generate(4);
  let rows = (await calls())[0]; assert.equal(new Set(rows.map(row => row.labKey)).size, 4);
  assert.equal(await page.locator('#lab-results .is-ready').count(), 4);
  await page.locator('#lab-results').getByRole('button', { name: '☆ 收藏', exact: true }).first().click(); await saved();
  assert.equal((await current()).favorites.length, 1);
  const zip = path.join(artifacts, 'favorite.zip');
  await app.evaluate(({ dialog }, zip) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip }); }, zip);
  await page.locator('#lab-export-actions').getByRole('button', { name: '只打包收藏版本' }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已导出 1 段'));
  const manifest = JSON.parse(execFileSync('/usr/bin/python3', ['-c', 'import json,sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', zip], { encoding: 'utf8' }));
  assert.equal(manifest.length, 1); assert.equal(manifest[0].options.labKey, (await current()).favorites[0]);
  await screenshot('variants');
  await scope().getByLabel('配音文案', { exact: true }).fill('同一段新的文字，需要四份新的声音。'); await saved();
  assert.equal(await page.locator('#lab-results .is-ready').count(), 0); await generate(4); assert.equal(await totalCalls(), 8);
  await page.locator('#lab-results').getByRole('button', { name: '重做', exact: true }).first().click(); await completed(4);
  await page.waitForFunction(async () => (await studio.invoke('status')).history.length === 9);
  await page.locator('#lab-results').getByRole('button', { name: '版本 / 波形', exact: true }).first().click();
  assert.equal(await page.locator('#audio-editor-version option').count(), 2);
  const previousVersion = await page.locator('#audio-editor-version option').first().getAttribute('value');
  await page.locator('#audio-editor-version-trigger').click(); await page.getByRole('option').filter({ hasText: '第 1 版' }).click();
  await page.locator('#audio-editor-select').click();
  await page.waitForFunction(() => document.querySelector('#audio-editor-select').textContent === '已选为成品');
  await page.locator('#audio-editor-dialog .audio-studio-close').click(); await saved();
  assert.ok(Object.values((await current()).selectedTakes).includes(previousVersion));

  await newWork(1, '树洞里的欢迎会');
  await scope().locator('.lab-dialogue-import summary').click();
  await scope().getByLabel('导入短剧对白').fill('小鹿：你听见树洞里的声音了吗？\n小熊：是小松鼠在准备欢迎会！\n小鹿：那我们也来帮忙。');
  await scope().getByRole('button', { name: '拆分并替换台词' }).click(); await saved();
  assert.equal(await scope().locator('.lab-line').count(), 3); await generate(3); const comicCount = await totalCalls();
  await page.evaluate(() => { window.labOriginalPlay = Audio.prototype.play; Audio.prototype.play = function () { this.loop = true; return window.labOriginalPlay.call(this); }; });
  await page.locator('#lab-results [data-lab-play]').first().click();
  await assertSound(page, '#lab-results [data-lab-play]');
  await page.locator('#lab-stop-playback').click(); await assertSound(page, '#lab-results [data-lab-play]', 'idle');
  await page.evaluate(() => { Audio.prototype.play = window.labOriginalPlay; });
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 360; c.height = 240; const ctx = c.getContext('2d'); ctx.fillStyle = '#9dcfb5'; ctx.fillRect(0, 0, 360, 240); ctx.fillStyle = '#4e6657'; ctx.font = '40px sans-serif'; ctx.fillText('森林欢迎会', 60, 120); return c.toDataURL('image/png').split(',')[1]; });
  await scope().locator('.lab-line input[type=file]').first().setInputFiles({ name: '森林.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await scope().locator('.lab-line img').first().waitFor(); await saved();
  assert.match((await current()).lines[0].image, /^data:image\/jpeg/); assert.equal(await page.locator('#lab-results .is-ready').count(), 3);
  await scope().getByLabel('台词', { exact: true }).nth(1).fill('原来是朋友们在准备一个惊喜！'); await saved();
  assert.equal(await page.locator('#lab-results .is-ready').count(), 2); await generate(3); assert.equal(await totalCalls(), comicCount + 1);
  await scope().locator('.lab-line').last().getByRole('button', { name: '↑', exact: true }).click(); await saved();
  assert.equal(await page.locator('#lab-results .is-ready').count(), 3, 'reordering keeps valid speech');
  await scope().locator('.lab-appearance summary').click(); await choose('句间停顿', '600'); await saved();
  const wavFile = await exportFile('合并音频 WAV', 'comic.wav'), merged = Media.pcm(await readFile(wavFile)); assert.equal(merged.duration, 1.5);
  const subtitles = await exportFile('按句字幕 SRT', 'comic.srt');
  assert.match(await readFile(subtitles, 'utf8'), /00:00:00,700 --> 00:00:00,800\n那我们也来帮忙。/);
  const videoFile = await exportFile('竖屏视频 WebM', 'comic.webm');
  assert.equal((await readFile(videoFile)).subarray(0, 4).toString('hex'), '1a45dfa3');
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await page.locator('#lab-export-actions').getByRole('button', { name: '合并音频 WAV', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#lab-export-progress').hidden);
  await page.locator('#lab-export-actions').getByRole('button', { name: '竖屏视频 WebM', exact: true }).click();
  await page.locator('#lab-cancel-export').waitFor({ state: 'visible' }); await page.locator('#lab-cancel-export').click();
  await page.waitForFunction(() => document.querySelector('#lab-export-progress').hidden);
  assert.match(await page.locator('#toast').textContent(), /已取消/); assert.equal(await page.locator('#lab-name').isDisabled(), false);
  // Failed filesystem writes restore editing and preserve the experiment.
  await app.evaluate(({ dialog }, folder) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: folder }); }, artifacts);
  await page.locator('#lab-export-actions').getByRole('button', { name: '合并音频 WAV', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('EISDIR'));
  assert.equal(await page.locator('#lab-name').isDisabled(), false); assert.equal(await page.locator('#lab-results .is-ready').count(), 3);
  await screenshot('comic');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 740 }));
  await page.waitForFunction(() => window.innerWidth <= 1120);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  const sidebar = await page.evaluate(() => ({ navigation: document.querySelector('.sidebar > nav').getBoundingClientRect().bottom, help: document.querySelector('[data-view=account]').getBoundingClientRect().bottom, bottom: document.querySelector('.sidebar-bottom').getBoundingClientRect().top, end: document.querySelector('.sidebar-bottom').getBoundingClientRect().bottom, height: innerHeight }));
  assert.ok(sidebar.navigation <= sidebar.bottom && sidebar.bottom < sidebar.help && sidebar.help <= sidebar.end && sidebar.end <= sidebar.height, 'all navigation and bottom settings controls fit the minimum window height'); await screenshot('comic-narrow');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1420, height: 920 }));

  await newWork(2, '安安的星星故事');
  await scope().getByLabel('主角名字', { exact: true }).fill('安安'); await scope().getByLabel('主角喜欢什么', { exact: true }).fill('搭积木');
  await scope().locator('.lab-recording summary').click();
  await scope().getByLabel('导入录音中的准确原话', { exact: true }).fill('安安，今天我们一起讲一个故事。');
  await scope().getByRole('button', { name: '导入录音', exact: true }).click();
  assert.match(await page.locator('#toast').textContent(), /确认.*授权/);
  await page.locator('#lab-reference-consent').check();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, wavFile);
  await scope().getByRole('button', { name: '导入录音', exact: true }).click();
  await page.locator('#reference-import-dialog').waitFor();
  await page.locator('#reference-import-text').fill('安安，今天我们一起讲一个故事。');
  await page.locator('#reference-import-save').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#lab-fields select')].some(select => select.value.startsWith('clone:'))); await saved();
  await generate(4); rows = (await calls()).at(-1); assert.ok(rows.every(row => row.mode === 'clone' && row.emotion === 'natural' && row.referenceText.includes('安安')));
  assert.match(rows[0].text, /安安喜欢搭积木/); assert.ok(rows.every(row => !row.text.includes('{{'))); await screenshot('family');
  const unicodeStory = '甲'.repeat(599) + '😀结束';
  await scope().getByLabel('编辑故事', { exact: true }).fill(unicodeStory); await saved();
  await generate(2); rows = (await calls()).at(-1);
  assert.equal(rows.map(row => row.text).join(''), unicodeStory);
  assert.ok(rows.every(row => row.text.isWellFormed() && row.text.length <= 600));

  await newWork(3, '给你的一份有声祝福'); await generate(3); await screenshot('buttons');
  const htmlFile = await exportFile('离线语音按钮 HTML', 'buttons.html');
  const cardVideo = await exportFile('祝福卡视频 WebM', 'greeting.webm'); assert.ok((await stat(cardVideo)).size > 1000);
  const work = await current(), count = await totalCalls();
  await app.close(); app = null; await launch(); await page.locator('[data-view="laboratory"]').click();
  assert.equal(await page.locator('#lab-recent .lab-recent-card').count(), 4);
  await page.locator('#lab-recent .lab-recent-card').filter({ hasText: work.name }).click();
  assert.equal(await page.locator('#lab-results .is-ready').count(), 3); assert.equal((await current()).id, work.id); assert.equal(await totalCalls(), count);
  // Returning from a queue job opens its experiment instead of the ordinary editor.
  await page.locator('#lab-show-tasks').click(); await page.locator('#jobs-list button').filter({ hasText: '听听作品' }).first().click();
  await page.waitForFunction(() => !document.querySelector('#view-laboratory').classList.contains('hidden'));
  assert.equal(await page.locator('#lab-name').inputValue(), work.name);

  // Inspect and play the actual exported files in a browser with networking blocked.
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); const preview = await browser.newPage();
  preview.on('pageerror', error => errors.push(error.message)); await preview.route('https://**/*', route => route.abort());
  await preview.goto(pathToFileURL(htmlFile).href); assert.equal(await preview.locator('[data-play]').count(), 3);
  await preview.locator('audio').first().evaluate(audio => audio.loop = true);
  await preview.locator('[data-play]').first().click(); await preview.waitForFunction(() => document.querySelector('[data-play]').getAttribute('aria-pressed') === 'true');
  assert.equal(await preview.locator('[data-play] .button-wave i').count(), 12);
  assert.equal(await preview.locator('[data-play] .button-wave').first().evaluate(wave => getComputedStyle(wave).display), 'flex');
  await preview.locator('audio').first().evaluate(audio => audio.loop = false); await preview.waitForFunction(() => document.querySelector('audio').ended);
  await preview.keyboard.press('2'); await preview.waitForFunction(() => document.querySelectorAll('audio')[1].ended);
  await preview.screenshot({ path: path.join(artifacts, 'offline-buttons.png') });
  await preview.goto('about:blank');
  const mediaInfo = await preview.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), letter => letter.charCodeAt(0));
    const video = document.createElement('video'); video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' })); document.body.append(video);
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('exported WebM cannot play')); });
    await video.play(); const stream = video.captureStream();
    const tracks = stream.getTracks().map(track => track.kind);
    await new Promise(resolve => video.onended = resolve); return { width: video.videoWidth, height: video.videoHeight, tracks, time: video.currentTime, duration: video.duration };
  }, (await readFile(videoFile)).toString('base64'));
  assert.equal(mediaInfo.width, 720); assert.equal(mediaInfo.height, 1280); assert.ok(mediaInfo.tracks.includes('audio')); assert.ok(mediaInfo.tracks.includes('video')); assert.ok(mediaInfo.time >= 1.4);
  assert.deepEqual(errors, []); await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ cases: ['variants/favorites/redo', 'dialogue/images/partial-regeneration', 'family/consent/reference/substitution', 'buttons/offline-keyboard', 'wav/srt/video/export', 'SQLite/restart', 'task-navigation'], mediaInfo, generatedSegments: count, errors }, null, 2));
  console.log('Laboratory Electron workflows passed; exported WebM audio/video and offline soundboard played successfully.');
} finally { await browser?.close(); await app?.close(); await fixture.cleanup(); }
