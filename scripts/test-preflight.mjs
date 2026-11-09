import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

// Real Electron, service and IPC. A trap worker makes accidental inference fail.
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-data/preflight-ui');
await mkdir(artifacts, { recursive: true });
const f = await createDesktopFixture();
await mkdir(path.join(f.appDir, 'backend'));
await writeFile(path.join(f.appDir, 'backend/worker.py'), [
  'import pathlib,sys',
  "(pathlib.Path(sys.argv[2])/'worker-started').write_text('unexpected worker')",
  "raise RuntimeError('Environment checks must never start the speech engine')",
].join('\n'));
let app;
const errors = [];
try {
  app = await electron.launch({ args: [f.appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env: {
    ...process.env, VOICE_STUDIO_DATA: f.data, VOICE_STUDIO_PYTHON: path.join(root, '.venv/bin/python')
  } });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  // Test connection checks without relying on external servers or downloading bytes.
  await app.evaluate(() => {
    globalThis.__preflightNetwork = [];
    globalThis.__delayPreflightNetwork = true;
    globalThis.fetch = async (url, options) => {
      globalThis.__preflightNetwork.push({ url, method: options.method, range: options.headers.Range });
      if (globalThis.__delayPreflightNetwork) await new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(new Error('aborted'));
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { ok: true, body: { cancel: async () => {} } };
    };
  });
  await page.waitForFunction(() => !document.querySelector('#gate-activate').disabled);
  await page.locator('#gate-preflight').click();
  await page.waitForFunction(() => !document.querySelector('#preflight-prepare').disabled);
  assert.equal(await page.locator('#preflight-options li').count(), 4);
  assert.equal(await page.locator('#preflight-heard').count(), 0);
  assert.equal(await page.locator('#preflight-results audio, #preflight-results button').count(), 0);
  assert.equal(await page.locator('#preflight-copy').isDisabled(), false);
  assert.match(await page.locator('#preflight-summary').innerText(), /配置与环境检查完成/);
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal((await page.evaluate(() => studio.invoke('license'))).activated, false);
  assert.deepEqual(await app.evaluate(() => globalThis.__preflightNetwork), []);
  await page.screenshot({ path: path.join(artifacts, 'configuration.png') });
  await page.locator('#preflight-prepare').click();
  await page.waitForFunction(() => document.querySelector('#preflight-prepare').getAttribute('aria-busy') === 'true');
  assert.match(await page.locator('#preflight-prepare-label').innerText(), /配置与环境/);
  assert.equal(await page.locator('.preflight-button-spinner').isVisible(), true);
  await page.locator('#preflight-stop').click();
  await page.waitForFunction(() => document.querySelector('#preflight-prepare').dataset.progress === 'stopped');
  assert.equal(await page.locator('#preflight-prepare').getAttribute('aria-busy'), 'false');
  assert.equal(existsSync(path.join(f.data, 'worker-started')), false);
  await app.evaluate(() => { globalThis.__delayPreflightNetwork = false; });
  await page.locator('#preflight-prepare').click();
  await page.waitForFunction(() => document.querySelector('#preflight-prepare').dataset.progress === 'complete');
  assert.equal(await page.locator('#preflight-button-count').innerText(), '4 / 4');
  assert.equal(await page.locator('#preflight-results audio, #preflight-results button').count(), 0);
  assert.match(await page.locator('#preflight-results').innerText(), /资源使用时另行准备/);
  assert.equal(await page.locator('#preflight-copy').isDisabled(), false);
  await page.locator('#preflight-copy').click();
  const copied = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText()));
  assert.equal(copied.ready, true);
  assert.equal(copied.schema, 'shengyue-compatibility-2');
  assert.equal(copied.scope, 'environment');
  assert.equal(copied.heard, undefined);
  assert.deepEqual(copied.packages, ['light', 'standard', 'character', 'reference']);
  assert.ok(copied.results.every(result => result.passed && !result.resourceReady && result.duration === undefined));
  assert.equal(copied.checks.filter(check => check.id.startsWith('network-')).length, 3);
  const connections = await app.evaluate(() => globalThis.__preflightNetwork);
  assert.ok(connections.length >= 3);
  assert.ok(connections.every(check => check.url.startsWith('https://') && check.method === 'GET' && check.range === 'bytes=0-1023'));
  await page.screenshot({ path: path.join(artifacts, 'environment-complete.png') });
  await page.locator('.preflight-optional>summary').click();
  await page.locator('#preflight-needs-microphone').check();
  await page.waitForFunction(() => !document.querySelector('#preflight-prepare').disabled);
  // Incomplete checks can still be copied for troubleshooting.
  assert.equal(await page.locator('#preflight-copy').isDisabled(), false);
  await page.locator('#preflight-microphone').click();
  await page.waitForFunction(() => !document.querySelector('#preflight-microphone').disabled);
  assert.match(await page.locator('#preflight-microphone-state').innerText(), /检测到声音信号/);
  await page.locator('#preflight-copy').click();
  const withMicrophone = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText()));
  assert.equal(withMicrophone.microphoneRequired, true);
  assert.equal(withMicrophone.microphone.passed, true);
  await page.locator('#preflight-close').click();
  for (const action of ['generate', 'setup', 'preflight-audio', 'preflight-confirm']) {
    const denied = await page.evaluate(async action => {
      try { await studio.invoke(action, { text: 'cannot bypass licensing' }); }
      catch (error) { return error.message; }
    }, action);
    assert.match(denied, /请先激活/);
  }
  assert.equal(existsSync(path.join(f.data, 'worker-started')), false);
  assert.equal(existsSync(path.join(f.data, 'models')), false);
  assert.equal(existsSync(path.join(f.data, 'runtime')), false);
  assert.equal(existsSync(path.join(f.data, 'preflight')), false);
  const saved = JSON.parse(await readFile(path.join(f.data, 'compatibility-report.json'), 'utf8'));
  assert.equal(saved.scope, 'environment');
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ passed: true,
    scope: 'Real Electron UI, service and IPC; mocked connection responses and microphone device; no speech worker, downloads or synthesis', errors }, null, 2));
  console.log('PASS: environment-only inspection, explicit connection checks and cancellation, report copy, optional microphone, no worker/downloads/audio and activation isolation');
} finally { await app?.close(); await f.cleanup(); }
