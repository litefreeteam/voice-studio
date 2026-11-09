import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const fixture = await createDesktopFixture({ activated: true });
const env = { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '' };
let app, secondary;
try {
  app = await electron.launch({ args: [fixture.appDir], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  const job = await page.evaluate(() => studio.invoke('jobs-submit', { requestId: 'instance-regression', options: {
    project: '重复启动保留任务', projectId: 'instance-project', projectBatch: true, managed: true,
    scheduledAt: Date.now() + 3600000, rows: [{ text: '这段任务必须保留。', lineId: 'line-1', lineVersion: 'a'.repeat(32) }]
  } }));
  const snapshotFile = path.join(fixture.data, 'generation-jobs.json');
  const journalFile = snapshotFile + '.journal';
  const before = await Promise.all([readFile(snapshotFile), readFile(journalFile)]);
  await app.evaluate(({ app }) => { globalThis.secondLaunchReceived = false; app.once('second-instance', () => { globalThis.secondLaunchReceived = true; }); });
  secondary = spawn(createRequire(import.meta.url)('electron'), [fixture.appDir], { env, stdio: 'pipe' });
  let stderr = ''; secondary.stderr.on('data', buffer => { stderr += buffer; });
  const timer = setTimeout(() => secondary.kill('SIGKILL'), 15000);
  const [code, signal] = await once(secondary, 'exit'); clearTimeout(timer);
  assert.equal(code, 0, stderr); assert.equal(signal, null);
  assert.equal(await app.evaluate(() => globalThis.secondLaunchReceived), true);
  const queue = await page.evaluate(() => studio.invoke('jobs-list'));
  assert.equal(queue.jobs.find(item => item.id === job.id)?.status, 'scheduled');
  const after = await Promise.all([readFile(snapshotFile), readFile(journalFile)]);
  assert.deepEqual(after, before, 'secondary must not rewrite queue checkpoints');
  await app.close(); app = null;
  app = await electron.launch({ args: [fixture.appDir], env, timeout: 30000 });
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  const restored = await reopened.evaluate(() => studio.invoke('jobs-list'));
  assert.equal(restored.jobs.find(item => item.id === job.id)?.status, 'scheduled');
  console.log('PASS: second Electron process exits, focuses the primary, leaves queue files intact, and scheduled work survives restart');
} finally {
  if (secondary && secondary.exitCode === null && secondary.signalCode === null) secondary.kill('SIGKILL');
  await app?.close();
  await fixture.cleanup();
}
