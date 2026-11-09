import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

// Exercise the actual IPC, ZIP writer and deletion transaction in disposable data.
const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const python = process.env.VOICE_STUDIO_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const artifacts = path.join(root, '.test-data/history-bulk'), errors = [];
const id = number => number.toString(16).padStart(32, '0');
const history = Array.from({ length: 27 }, (_, index) => ({ id: id(index + 1), text: `第 ${index + 1} 段：让每一个平凡的日子，都有好声音陪伴。`,
  project: index < 20 ? '秋日旅行旁白' : '睡前故事', speaker: 'Vivian', voiceName: '知夏', wav: `voice-${index + 1}.wav`, mp3: `voice-${index + 1}.mp3`,
  duration: 4, createdAt: Date.now() - index * 60000, options: { mode: 'preset', speaker: 'Vivian', scene: 'video' } }));
history.push({ ...history[0], id: id(28), createdAt: Date.now() + 1000, options: { ...history[0].options, generationGroupId: id(1) } });
history.push({ ...history[0], id: id(29), project: '项目台词', options: { projectId: 'keep-project' } });
let app, page;
const setSave = async choice => app.evaluate(({ dialog }, choice) => { dialog.showSaveDialog = async () => choice; }, choice);
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: python } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="history"]').click();
}
try {
  await mkdir(artifacts, { recursive: true });
  await cp(path.join(root, 'backend'), path.join(fixture.appDir, 'backend'), { recursive: true, filter: file => path.basename(file) !== '__pycache__' });
  await copyFile(path.join(root, 'backend/worker.py'), path.join(fixture.appDir, 'backend/studio_worker.py'));
  await copyFile(path.join(root, 'tests/fixtures/audio-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
  const wav = Buffer.alloc(44 + 24000 * 4 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let sample = 0; sample < 96000; sample++) wav.writeInt16LE(Math.round(Math.sin(sample / 24000 * 2 * Math.PI * 220) * 3000), 44 + sample * 2);
  for (const item of history) {
    const folder = path.join(fixture.data, 'outputs', item.id); await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, item.wav), wav);
    await copyFile(path.join(root, 'ui/assets/previews/Vivian.mp3'), path.join(folder, item.mp3));
    await writeFile(path.join(folder, 'metadata.json'), JSON.stringify(item));
  }
  await writeFile(path.join(fixture.data, 'history.json'), JSON.stringify(history));
  await writeFile(path.join(fixture.data, 'audio-selections.json'), JSON.stringify({ [id(1)]: id(1) }));
  await launch();
  assert.equal(await page.locator('#history-total').textContent(), '27');
  assert.equal(await page.locator('#history-bulk-panel').evaluate(node => node.inert && node.clientHeight === 0), true);
  await page.locator('#history .history-select').first().check();
  assert.equal(await page.locator('#history-select-page').evaluate(input => input.indeterminate), true);
  assert.equal(await page.locator('#history .clip.is-selected').count(), 1);
  await page.locator('#history-next').click(); await page.locator('#history .history-select').first().check();
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 2 条/);
  const selectedIds = await page.evaluate(() => selectedHistory().map(item => item.id));
  await setSave({ canceled: true }); await page.locator('#history-bulk-download').click();
  await page.waitForFunction(() => !state.busy && historyOperation === null);
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 2 条/);
  await page.evaluate(() => { const format = document.querySelector('#history-export-format'); format.value = 'wav'; format.dispatchEvent(new Event('change')); });
  const zipFile = path.join(fixture.data, '所选作品.zip'); await setSave({ canceled: false, filePath: zipFile });
  await page.locator('#history-bulk-download').click();
  await page.waitForFunction(() => !state.busy && historyOperation === null);
  assert.match(await page.locator('#toast').textContent(), /已下载 2 条/);
  const manifest = JSON.parse(execFileSync(python, ['-c', 'import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', zipFile], { encoding: 'utf8' }));
  assert.deepEqual(manifest.map(item => item.id), selectedIds);
  assert.ok(manifest.every(item => item.exportFile.endsWith('.wav')));
  assert.equal(manifest.find(item => item.id === id(1)).id, id(1), 'exports the chosen older version');
  await page.locator('#history-select-page').check();
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 13 条/);
  await page.locator('#history-select-page').uncheck();
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 1 条/);
  await page.locator('#history-select-all').click();
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 27 条/);
  await page.locator('#history-clear-selection').click();
  assert.equal(await page.locator('#history-bulk-panel').evaluate(node => node.inert), true);

  await page.locator('#history-search').fill('睡前故事');
  await page.locator('#history-select-all').click();
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 7 条/);
  await page.locator('#view-history').screenshot({ path: path.join(artifacts, 'selection-desktop.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 960, height: 720 }));
  await page.waitForFunction(() => window.innerWidth === 960);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.equal(await page.locator('#history-bulk').evaluate(node => node.scrollWidth > node.clientWidth), false);
  await page.locator('#view-history').screenshot({ path: path.join(artifacts, 'selection-narrow.png') });
  await page.locator('#history-bulk-delete').click();
  assert.match(await page.locator('#delete-heading').textContent(), /7 条/);
  assert.match(await page.locator('#delete-description').textContent(), /全部 7 个音频版本/);
  assert.equal(await page.locator('#delete-cancel').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8')).length, 29);
  await page.locator('#history-bulk-delete').click(); await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => !state.busy && historyOperation === null);
  assert.equal(await page.locator('#history-total').textContent(), '20');
  assert.match(await page.locator('#history-summary').textContent(), /没有找到符合条件/);
  await page.locator('#history-reset').click();
  const chosen = page.locator(`#history .clip[data-clip-id="${id(1)}"]`); await chosen.locator('.history-select').check();
  await page.locator('#history-bulk-delete').click();
  assert.match(await page.locator('#delete-description').textContent(), /全部 2 个音频版本/);
  await page.locator('#delete-dialog').screenshot({ path: path.join(artifacts, 'delete-confirmation.png') });
  const historyFile = path.join(fixture.data, 'history.json'), beforeDelete = await readFile(historyFile, 'utf8');
  // A stale choice must fail without deleting another take or losing selection.
  await writeFile(historyFile, JSON.stringify(JSON.parse(beforeDelete).filter(item => item.id !== id(1))));
  await page.locator('#delete-confirm').click(); await page.waitForFunction(() => !state.busy && historyOperation === null);
  assert.match(await page.locator('#delete-error').textContent(), /不存在或已删除/);
  assert.match(await page.locator('#history-selection-summary').textContent(), /已选 1 条/);
  assert.equal(await page.locator('#delete-confirm').isDisabled(), false);
  await writeFile(historyFile, beforeDelete);
  await page.locator('#delete-confirm').click(); await page.waitForFunction(() => !state.busy && historyOperation === null);
  let remaining = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8'));
  assert.equal(remaining.some(item => item.id === id(1) || item.id === id(28)), false);
  assert.equal(remaining.some(item => item.id === id(29)), true);
  assert.equal(await page.locator('#history-total').textContent(), '19');
  await app.close(); await launch();
  assert.equal(await page.locator('#history-total').textContent(), '19');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#history .clip').first().evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.locator('#history-select-all').click(); await page.locator('#history-bulk-delete').click(); await page.locator('#delete-confirm').click();
  await page.waitForFunction(() => !state.busy && historyOperation === null);
  assert.equal(await page.locator('#history-total').textContent(), '0');
  assert.match(await page.locator('#history').textContent(), /去创作第一段配音/);
  remaining = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8'));
  assert.deepEqual(remaining.map(item => item.id), [id(29)]);
  assert.deepEqual(errors, []);
  console.log('History bulk desktop checks passed: cross-page selection, ZIP contents, cancellation, all versions, restart, empty state, reduced motion and 960px layout.');
} finally { await app?.close(); await fixture.cleanup(); }
