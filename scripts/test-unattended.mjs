import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const artifacts = path.join(root, '.test-data/unattended'); await mkdir(artifacts, { recursive: true });
await mkdir(path.join(fixture.appDir, 'backend'));
// Exercise real IPC, persistence, power assertions and audio writes with a deterministic worker.
const worker = (await readFile(path.join(root, 'tests/fixtures/project-worker.py'), 'utf8'))
  .replace('history = []', 'history = json.loads((root / "history.json").read_text()) if (root / "history.json").exists() else []')
  .replace('time.sleep(0.003)', 'time.sleep(0.25)')
  .replace('rows = data["rows"]', 'rows = data["rows"]\n            if rows[0]["text"] == "模拟引擎卡住。":\n                time.sleep(9999)\n            if rows[0]["text"] == "这段需要补做。" and not (root / "allow-retry").exists():\n                raise ValueError("测试：这段暂时无法生成")');
await writeFile(path.join(fixture.appDir, 'backend/worker.py'), worker);
const queueFile = path.join(fixture.appDir, 'desktop/jobs.cjs');
await writeFile(queueFile, (await readFile(queueFile, 'utf8')).replace('retryDelay = attempt => attempt * 5000', 'retryDelay = attempt => attempt * 5'));
const serviceFile = path.join(fixture.appDir, 'desktop/service.cjs');
await writeFile(serviceFile, (await readFile(serviceFile, 'utf8')).replace('30 * 60 * 1000', '750'));
let app, page; const errors = [];
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
}
const snapshot = () => page.evaluate(() => studio.invoke('jobs-list'));
async function waitJob(index, status) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if ((await snapshot()).jobs[index]?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for job ' + index + ': ' + status);
}
const jobRow = id => page.locator(`[data-job-id="${id}"]`);
const powerBlocked = () => app.evaluate(({ powerSaveBlocker }) => Array.from({ length: 32 }, (_, id) => powerSaveBlocker.isStarted(id)).some(Boolean));
async function openProject(id) {
  await page.locator('[data-view="projects"]').click();
  await page.locator(`[data-project-id="${id}"] .project-card-title`).click();
}
try {
  await launch();
  const projectId = await page.evaluate(async () => {
    const p = ScriptProjects.create('夜读 · 长篇小说');
    p.chapters[0].lines = [ScriptProjects.line('故事从这里开始。', p.roles[0].id), ScriptProjects.line('这段需要补做。', p.roles[0].id)];
    p.chapters.push({ id: crypto.randomUUID(), name: '第2章 归来', lines: [ScriptProjects.line('新的篇章，已经完成。', p.roles[0].id)] });
    await studio.invoke('project-save', p); return p.id;
  });
  await openProject(projectId); await page.locator('#project-options-open').click(); await page.locator('#project-managed').click();
  assert.equal(await page.locator('#managed-scope').inputValue(), 'all');
  assert.match(await page.locator('#managed-preview-summary').textContent(), /2 个章节 · 3 条台词/);
  assert.equal(await page.locator('#managed-submit').isEnabled(), true);
  await page.locator('[name="managed-start"][value="scheduled"]').check();
  assert.equal(await page.locator('#managed-time-field').isVisible(), true);
  await page.screenshot({ path: path.join(artifacts, 'schedule.png') });
  await page.locator('#managed-submit').click();
  await waitJob(0, 'scheduled');
  const scheduled = (await snapshot()).jobs[0];
  assert.equal(scheduled.total, 3); assert.equal(scheduled.managed, true); assert.ok(scheduled.scheduledAt > Date.now());
  assert.equal(await powerBlocked(), true);
  assert.match(await page.locator('#project-managed-title').textContent(), /已预约/);
  await page.reload(); await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  assert.equal((await snapshot()).jobs.length, 1);
  await app.close(); await launch();
  assert.equal((await snapshot()).jobs[0].status, 'scheduled'); assert.equal(await powerBlocked(), true);
  await openProject(projectId); await page.locator('#project-managed-tasks').click();
  await jobRow(scheduled.id).getByRole('button', { name: '暂停托管' }).click();
  await waitJob(0, 'paused');
  assert.equal(await powerBlocked(), false);
  await jobRow(scheduled.id).getByRole('button', { name: '继续生成' }).click();
  await waitJob(0, 'running');
  await jobRow(scheduled.id).getByRole('button', { name: '暂停托管' }).click();
  await waitJob(0, 'paused');
  assert.equal((await snapshot()).jobs[0].completed, 1);
  assert.equal(await powerBlocked(), false);
  await page.screenshot({ path: path.join(artifacts, 'paused.png') });
  await jobRow(scheduled.id).getByRole('button', { name: '继续生成' }).click();
  await waitJob(0, 'partial');
  const partial = (await snapshot()).jobs[0];
  assert.equal(partial.completed, 2); assert.equal(partial.failedRows.length, 1); assert.equal(partial.failedRows[0].index, 1);
  assert.equal(await powerBlocked(), false);
  assert.match(await jobRow(scheduled.id).locator('.job-status').textContent(), /待补做/);
  await jobRow(scheduled.id).locator('.managed-failures summary').click();
  assert.match(await jobRow(scheduled.id).locator('.managed-failures').textContent(), /这段需要补做/);
  await page.screenshot({ path: path.join(artifacts, 'partial.png') });
  await writeFile(path.join(fixture.data, 'allow-retry'), 'yes');
  await jobRow(scheduled.id).getByRole('button', { name: '只补做失败段落' }).click();
  await waitJob(1, 'complete');
  const retry = (await snapshot()).jobs[1]; assert.equal(retry.total, 1); assert.equal(retry.completed, 1);
  assert.equal(retry.rows[0].text, '这段需要补做。');
  const history = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8'));
  assert.equal(history.length, 3); assert.equal(new Set(history.map(item => item.options.lineId)).size, 3);
  await page.locator('#jobs-close').click();
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 2/);
  await page.locator('#project-options-open').click(); await page.locator('#project-managed').click();
  assert.equal(await page.locator('#managed-submit').isDisabled(), true);
  assert.match(await page.locator('#managed-error').textContent(), /已完成/);
  await page.locator('#managed-dialog [data-close="managed-dialog"]').first().click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 820 }));
  await page.waitForFunction(() => window.innerWidth <= 1120);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.project-production').screenshot({ path: path.join(artifacts, 'completed-narrow.png') });
  await page.evaluate(() => studio.invoke('jobs-submit', { options: { managed: true, projectBatch: true, projectId: 'stall-test', project: '卡住恢复测试', rows: [{ text: '模拟引擎卡住。', lineId: 'stall-line', lineVersion: 'a'.repeat(32) }] } }));
  await waitJob(2, 'partial');
  const stalled = (await snapshot()).jobs[2]; assert.equal(stalled.failedRows.length, 1);
  assert.match(stalled.failedRows[0].error, /30 分钟没有进展/);
  assert.equal(await powerBlocked(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: real Electron schedule form, whole-project default, restart persistence, power assertion release, pause at saved boundary, bounded retries, failed-segment recovery, stalled-worker timeout, no duplicate audio and narrow layout. Deterministic worker; model quality unchanged.');
} catch (error) { await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {}); throw error; }
finally { await app?.close(); await fixture.cleanup(); }
