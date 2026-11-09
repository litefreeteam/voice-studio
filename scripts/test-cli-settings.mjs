import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = await createDesktopFixture({ activated: true });
let app;
try {
  await cp(path.join(root, 'cli'), path.join(fixture.appDir, 'cli'), { recursive: true });
  await cp(path.join(root, 'docs'), path.join(fixture.appDir, 'docs'), { recursive: true, filter: file => !file.includes('artwork-source') });
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '' }, timeout: 30000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="account"]').click();
  await page.locator('#cli-content').waitFor({ state: 'visible' });
  const config = await page.evaluate(() => studio.invoke('cli-config'));
  assert.equal(await page.locator('#cli-generate-command').textContent(), config.generate);
  for (const kind of ['status', 'generate', 'guide']) {
    await page.locator(`[data-cli-copy="${kind}"]`).click();
    await page.waitForFunction(kind => !document.querySelector(`[data-cli-copy="${kind}"]`).disabled, kind);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), config[kind]);
  }
  await assert.rejects(page.evaluate(() => studio.invoke('cli-copy', { kind: '__proto__' })), /复制内容无效/);
  // Execute the copied command, with the desktop still open, against its isolated profile.
  const { stdout } = await promisify(execFile)('/bin/sh', ['-c', config.status], { timeout: 30000, env: { ...process.env, VOICE_STUDIO_PYTHON: '' } });
  assert.equal(JSON.parse(stdout).ok, true);
  const saved = path.join(fixture.data, 'script.json');
  await app.evaluate(({ dialog }, saved) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved }); }, saved);
  await page.locator('#cli-save-script').click();
  await page.waitForFunction(() => !document.querySelector('#cli-save-script').disabled);
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), JSON.parse(await readFile(path.join(root, 'website/public/docs/example-script.json'), 'utf8')));
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  assert.deepEqual(await page.evaluate(() => studio.invoke('cli-save-script')), { saved: false });
  await app.evaluate(({ shell }) => { shell.openPath = async file => { globalThis.cliOpenedDoc = file; return ''; }; });
  await page.locator('#cli-docs').click();
  await page.waitForFunction(() => !document.querySelector('#cli-docs').disabled);
  assert.equal(await app.evaluate(() => globalThis.cliOpenedDoc), path.join(fixture.appDir, 'docs/Agent-CLI.md'));
  await app.evaluate(({ shell }) => { shell.openPath = async () => '没有可用的打开程序'; });
  await page.locator('#cli-docs').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('无法打开 CLI 文档'));
  // Replace IPC only at the end of this isolated test to exercise loading recovery.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('studio');
    ipcMain.handle('studio', () => ({ ok: false, error: { code: 'TEST', message: '连接中断' } }));
  });
  await page.locator('[data-view="account"]').click();
  await page.locator('#cli-retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cli-content').isVisible(), false);
  await app.evaluate(({ ipcMain }, config) => {
    ipcMain.removeHandler('studio');
    ipcMain.handle('studio', () => ({ ok: true, result: config }));
  }, config);
  await page.locator('#cli-retry').click();
  await page.locator('#cli-content').waitFor({ state: 'visible' });
  await mkdir(path.join(root, '.test-data/cli-settings'), { recursive: true });
  for (const width of [1420, 1120]) {
    await page.setViewportSize({ width, height: 920 });
    await page.locator('.settings-cli').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `.test-data/cli-settings/settings-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: settings commands, real CLI invocation, clipboard, script save/cancel, local docs, recovery and layout');
} finally { await app?.close(); await fixture.cleanup(); }
