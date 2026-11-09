import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
const root = path.resolve(import.meta.dirname, '..');
const fixture = await createDesktopFixture();
const output = path.join(root, '.test-data/free-edition'); await mkdir(output, { recursive: true });
const env = { ...process.env, VOICE_STUDIO_DATA: fixture.data }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [fixture.appDir], env, timeout: 30000 });
const errors = [];
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#first-run-dialog')?.open && !document.querySelector('#first-run-download').disabled);
  assert.equal(await page.locator('#workspace').isVisible(), true);
  assert.equal(await page.locator('#activation-gate').isVisible(), false);
  assert.equal(await page.locator('#gate-code').count(), 0);
  assert.match(await page.locator('#first-run-checks').innerText(), /内存|系统|处理器/);
  assert.equal((await page.evaluate(() => studio.invoke('license'))).activationRequired, false);
  assert.equal((await page.evaluate(() => studio.invoke('catalog'))).voices.length, 9);
  assert.ok(!(await readdir(fixture.data)).some(name => ['license.txt', 'installation-id', 'runtime', 'models'].includes(name)));
  await page.screenshot({ path: path.join(output, 'first-launch.png') });
  await page.locator('#first-run-later').click();
  await page.locator('[data-view="account"]').click();
  assert.match(await page.locator('#account-plan').innerText(), /免费版/);
  assert.equal(await page.locator('#account-activation-form').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /购买授权|更新激活码|永久授权|专业版/);
  await page.evaluate(() => firstRunGuide.open({ memoryGB: 8 }));
  assert.equal(await page.locator('#first-run-package').inputValue(), 'light');
  await page.locator('#first-run-later').click();
  // Upgrade from an invalid old activation file must still open the free workspace.
  await writeFile(path.join(fixture.data, 'license.txt'), 'corrupt old activation');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#first-run-dialog')?.open);
  assert.equal(await page.locator('#activation-gate').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: fresh native free desktop, automatic checks, no implicit downloads, light recommendation, settings, corrupt-license upgrade');
} finally { await app.close(); await fixture.cleanup(); }
