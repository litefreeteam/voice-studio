import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await readFile(new URL('../ui/onboarding.js', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.calls = []; window.blocked = false; window.checkFails = false;
    window.guide = createFirstRunGuide({
      api: async (action, data) => {
        calls.push({ action, data });
        if (checkFails) throw Error('configuration temporarily unavailable');
        return { assetDir: action === 'preflight-location' ? '/new/models' : '/models', requiredDiskGB: 13, blocked,
          checks: [{ state: blocked ? 'fail' : 'pass', message: blocked ? '磁盘空间不足' : '配置通过' }] };
      },
      prepare: data => { calls.push({ action: 'setup', data }); return new Promise(resolve => { window.finish = resolve; }); },
      cancel: async () => { calls.push({ action: 'cancel' }); finish(null); },
      refresh: async () => { calls.push({ action: 'refresh' }); },
      useInstalled: engine => { calls.push({ action: 'useInstalled', engine }); }
    });
    return guide.open({ memoryGB: 8 });
  });
  assert.equal(await page.locator('#first-run-package').inputValue(), 'light');
  assert.deepEqual(await page.evaluate(() => calls.map(c => c.action)), ['preflight']);
  await page.locator('#first-run-change').click();
  await page.waitForFunction(() => document.querySelector('#first-run-location').textContent === '/new/models');
  await page.evaluate(() => { blocked = true; });
  await page.selectOption('#first-run-package', 'all');
  await page.waitForFunction(() => document.querySelector('#first-run-download').disabled);
  assert.equal((await page.evaluate(() => calls.at(-1))).data.packages.length, 4);
  await page.evaluate(() => { blocked = false; checkFails = true; });
  await page.selectOption('#first-run-package', 'standard');
  await page.getByRole('button', { name: '重新检查配置' }).waitFor();
  await page.evaluate(() => { checkFails = false; });
  await page.getByRole('button', { name: '重新检查配置' }).click();
  await page.getByRole('button', { name: '下载模型并开始使用' }).waitFor();
  await page.locator('#first-run-download').click();
  await page.waitForFunction(() => typeof finish === 'function');
  assert.deepEqual(await page.evaluate(() => calls.slice(-2).map(c => c.action)), ['preflight', 'setup']);
  await page.evaluate(() => guide.progress({ message: '正在下载', resourcesTotal: 100, resourcesCurrent: 25 }));
  assert.equal(await page.locator('#first-run-progress').getAttribute('value'), '25');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#first-run-dialog').isVisible(), true);
  await page.locator('#first-run-pause').click();
  await page.getByRole('button', { name: '下载模型并开始使用' }).waitFor();
  assert.match(await page.locator('#first-run-status').innerText(), /已下载内容会保留/);
  await page.selectOption('#first-run-package', 'light');
  await page.locator('#first-run-download').click();
  await page.waitForFunction(() => calls.filter(c => c.action === 'setup').length === 2);
  await page.evaluate(() => finish({ ready: true }));
  await page.waitForFunction(() => !document.querySelector('#first-run-dialog').open);
  assert.ok(await page.evaluate(() => calls.some(c => c.action === 'useInstalled' && c.engine === 'light')));
  await page.evaluate(() => guide.open({ memoryGB: 32 }));
  await page.locator('#first-run-download').click();
  await page.waitForFunction(() => calls.filter(c => c.action === 'setup').length === 3);
  await page.evaluate(() => finish({ ready: true }));
  await page.waitForFunction(() => !document.querySelector('#first-run-dialog').open);
  assert.ok(await page.evaluate(() => calls.some(c => c.action === 'useInstalled' && c.engine === 'standard')));
  assert.deepEqual(errors, []);
  console.log('PASS: first-run configuration, resource selection, location, blocked checks, retry, download progress, pause/resume and light completion');
} finally { await browser.close(); }
