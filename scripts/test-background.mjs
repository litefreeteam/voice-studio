import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createJobQueue } from '../desktop/jobs.cjs';
import { testProjectGeneration } from '../tests/project-generation-ui.mjs';

const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-data/background');
await mkdir(artifacts, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'shengyue-background-'));
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const server = createServer(async (request, response) => {
  const file = path.join(root, 'ui', decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(path.join(root, 'ui') + path.sep)) { response.writeHead(403).end(); return; }
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
const executions = [], saves = [], projects = new Map(), history = new Map();
let deletionError = '';
const audioData = [...await readFile(path.join(root, 'ui/assets/previews/Vivian.mp3'))];
const output = id => page.locator(`[data-output-job-id="${id}"]`);
const queue = createJobQueue({ dataDir,
  execute(data) { return new Promise((resolve, reject) => executions.push({ data, resolve, reject })); },
  cancel() { executions.at(-1)?.reject(new Error('操作已取消')); },
  onChange(snapshot) {
    for (const job of snapshot.jobs) for (const item of job.items) history.set(item.id, item);
    page.evaluate(snapshot => window.progress?.({ type: 'jobs', ...snapshot }), snapshot).catch(() => {});
  }
});
await page.exposeFunction('invokeDesktop', (action, data) => {
  if (action === 'license') return { activated: true, machineCode: 'TEST' };
  if (action === 'catalog') return catalog;
  if (action === 'status') return { license: { activated: true, machineCode: 'TEST' }, jobs: queue.snapshot(), history: [...history.values()], references: [], packages: ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true })) };
  if (action === 'audio') return audioData;
  if (action === 'projects-list') return [...projects.values()].map(project => ({ id: project.id, name: project.name, updatedAt: project.updatedAt, chapterCount: project.chapters.length, roleCount: project.roles.length, lineCount: project.chapters.reduce((count, chapter) => count + chapter.lines.length, 0) }));
  if (action === 'project-save') { const project = structuredClone(data); project.updatedAt = Date.now(); projects.set(project.id, project); return { saved: true, updatedAt: project.updatedAt }; }
  if (action === 'project-load') return structuredClone(projects.get(data.id));
  if (action === 'save') { saves.push(data); return { saved: true }; }
  if (action === 'jobs-submit') return queue.submit(data.options, data.requestId);
  if (action === 'jobs-cancel') return queue.cancel(data.id);
  if (action === 'jobs-retry') return queue.retry(data.id, data.requestId);
  if (action === 'jobs-delete') { if (deletionError) throw new Error(deletionError); return queue.forgetJob(data.id); }
  throw new Error(`Unexpected action: ${action}`);
});
try {
  await page.addInitScript(() => { window.studio = { saveSessionSync(data) { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; }, async invoke(action, data) { if (action === 'session-load') return JSON.parse(localStorage.getItem('test-session') || 'null'); if (action === 'session-save') { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; } const result = await window.invokeDesktop(action, data); return action === 'audio' ? new Uint8Array(result) : result; }, onProgress(callback) { window.progress = callback; } }; });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('声音已就绪'));
  await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#project-name').inputValue(), '');
  for (const title of ['', '我自己填写的作品名']) {
    await page.locator('#project-name').fill(title);
    await page.locator('#mode-text').click();
    for (const selector of ['[data-example="warm-male"]', '[data-example="warm-female"]', '[data-example="course"]', '#example']) {
      await page.locator(selector).click();
      assert.equal(await page.locator('#project-name').inputValue(), title);
    }
  }
  await page.locator('#project-name').fill('');
  await page.locator('#mode-text').click();
  const clip = { id: 'saved-short', text: '你好，这是一次短句配音。', voiceName: '知夏', project: '短句', wav: 'first.wav', mp3: 'first.mp3', duration: 6, createdAt: Date.now(), options: {} };
  // A normal click waits inline, prevents duplicate submissions and shows no footer effect.
  await page.locator('#text').fill(clip.text);
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'preparing');
  assert.equal(executions[0].data.project, '');
  assert.equal(await page.locator('#generate').isDisabled(), true);
  assert.equal(await page.locator('#generate .voice-orb').count(), 1);
  assert.equal(await page.locator('#generate').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#generation-dock').isVisible(), false);
  assert.equal(await page.locator('#background-generation').isVisible(), false);
  assert.equal(await page.locator('#stop-generation').isVisible(), true);
  assert.equal(await page.locator('#toast').textContent(), '');
  assert.equal(await page.locator('#results .output-job').count(), 1);
  assert.match(await page.locator('#results .output-job-text').textContent(), /短句配音/);
  assert.match(await page.locator('#results .output-job-status').textContent(), /准备/);
  await page.screenshot({ path: path.join(artifacts, 'inline-short.png') });
  executions[0].resolve({ items: [clip] });
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  assert.equal(await page.locator('#results .clip').count(), 1);
  assert.equal(await page.locator('#results .output-job-status').textContent(), '已完成');
  assert.equal(await page.locator('#results .output-job-summary').isVisible(), false);
  assert.equal(await page.locator('#results .output-job-name').count(), 0);
  assert.equal(await page.locator('#results canvas').count(), 0);
  const assertSingleLine = async () => {
    for (const row of await page.locator('#results .clip').all()) {
      const boxes = await Promise.all(['.play', '.clip-title', '.clip-meta', '.clip-actions'].map(selector => row.locator(selector).boundingBox()));
      const centers = boxes.map(box => box.y + box.height / 2);
      assert.ok(Math.max(...centers) - Math.min(...centers) < 2, 'Audio text, metadata and actions stay on the same line');
      const bounds = await row.boundingBox();
      assert.ok(bounds.height <= 62, 'Each audio uses one compact row');
      assert.ok(boxes[1].width > 30, 'Transcript remains visible');
      assert.ok(boxes.at(-1).x + boxes.at(-1).width <= bounds.x + bounds.width, 'Actions stay inside the row');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  };
  const screenshotOutput = async filename => {
    await page.locator('#toast').waitFor({ state: 'hidden', timeout: 15000 });
    await page.locator('.output-card').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.locator('.output-card').screenshot({ path: path.join(artifacts, filename) });
  };
  await assertSingleLine();
  await screenshotOutput('output-single-line.png');
  await page.setViewportSize({ width: 1080, height: 900 });
  await assertSingleLine();
  await screenshotOutput('output-single-line-narrow.png');
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.locator('#results .play').click();
  await page.waitForFunction(() => document.querySelector('#results .play').textContent === 'Ⅱ');
  await assertSingleLine();
  await page.locator('#results .play').click();
  assert.equal(await page.locator('#results .play').textContent(), '▶');
  assert.equal(await page.locator('#generate .voice-orb').count(), 0);
  assert.equal(await page.locator('#generate').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#stop-generation').isVisible(), false);
  assert.equal(await page.locator('#generation-dock').isVisible(), false);

  const text = '这是一份会自动分段的长文案。'.repeat(100);
  await page.locator('#project-name').fill('睡前故事 · 长文'); await page.locator('#text').fill(text);
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'preparing');
  assert.equal(await page.locator('#background-generation').isVisible(), true);
  assert.equal(await page.locator('#generation-dock').isVisible(), false);
  assert.equal(await page.locator('footer .voice-orb').count(), 0);
  assert.ok((await page.locator('#workspace>footer').boundingBox()).height <= 64);
  assert.ok(executions[1].data.rows.length > 1);
  const first = queue.snapshot().jobs[1];
  assert.equal(executions[1].data.rows.map(row => row.text).join(''), text);
  queue.acceptProgress({ stage: 'generating', current: 1 });
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'generating');
  await page.screenshot({ path: path.join(artifacts, 'inline-long.png') });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'generating');
  await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#generation-dock').isVisible(), false);
  assert.equal(executions.length, 2); // Reload keeps foreground waiting without resubmission.
  await page.locator('#background-generation').click();
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  assert.equal(await page.locator('#generate').textContent(), '生成配音');
  assert.equal(await page.locator('#generate .voice-orb').count(), 0);
  assert.equal(await page.locator('#generation-dock').isVisible(), true);
  assert.equal(executions.length, 2); // Moving to background continues the same task.
  assert.equal(await output(first.id).isVisible(), true);
  assert.equal(await output(first.id).locator('.output-job-text').textContent(), first.rows.map(row => row.text).join(' '));
  assert.match(await output(first.id).locator('.output-job-count').textContent(), /已完成 0/);
  assert.equal(await output(first.id).getByRole('button', { name: '停止生成' }).count(), 1);
  await page.locator('#text').fill('下一份文案正在编辑，第一份继续生成。');
  await page.locator('#project-name').fill('旅行旁白'); await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'queued');
  assert.equal(await page.locator('#generate').isDisabled(), true);
  assert.equal(executions.length, 2);
  const second = queue.snapshot().jobs[2];
  assert.equal(await output(first.id).count(), 1);
  assert.equal(await output(second.id).locator('.output-job-status').textContent(), '排队中');
  assert.equal(await page.locator('#results .output-job').count(), 3);
  await page.locator('#results').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'output-processing.png') });
  await page.locator('#background-generation').click();
  await page.waitForFunction(() => document.querySelector('#generation-queue-count').textContent.includes('1 项排队'));
  await page.screenshot({ path: path.join(artifacts, 'background-entry.png') });
  await page.locator('[data-view="voices"]').click();
  assert.equal(await page.locator('#generation-dock').isVisible(), true);
  await page.locator('#voice-grid [data-voice="preset:Serena"] .sample-preview').click();
  await page.waitForFunction(() => document.querySelector('#voice-grid [data-voice="preset:Serena"] .sample-preview').classList.contains('playing'));
  await page.locator('#show-generation').click();
  assert.equal(await page.locator('#jobs-list .job-row').count(), 3);
  await page.screenshot({ path: path.join(artifacts, 'task-list.png') });
  await page.locator(`[data-job-id="${second.id}"]`).getByRole('button', { name: '取消排队' }).click();
  await page.waitForFunction(() => document.querySelector('#generation-queue-count').textContent === '1 项生成中');
  assert.equal(queue.snapshot().jobs[1].status, 'running');
  queue.acceptProgress({ stage: 'clip', item: { ...clip, id: 'saved-1', text: '已完成的第一段', project: first.name } });
  await page.waitForFunction(id => document.querySelector(`[data-output-job-id="${id}"] .clip`) !== null, first.id);
  assert.equal(await output(first.id).locator('.clip').count(), 1);
  await page.locator(`[data-job-id="${first.id}"]`).getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#generation-dock').dataset.stage === 'cancelled');
  assert.equal(queue.snapshot().jobs[1].completed, 1);
  await page.locator(`[data-job-id="${first.id}"]`).getByRole('button', { name: '听听作品' }).click();
  assert.equal(await output(first.id).locator('.clip').count(), 1);
  assert.equal(await output(first.id).locator('.output-job-status').textContent(), '已停止');
  await output(first.id).getByRole('button', { name: 'MP3 ↓', exact: true }).click();
  assert.deepEqual(saves.at(-1), { id: 'saved-1', format: 'mp3' });
  assert.equal(await page.locator('#text').inputValue(), '下一份文案正在编辑，第一份继续生成。');
  await page.locator('#show-generation').click();
  await page.locator(`[data-job-id="${first.id}"]`).getByRole('button', { name: '继续未完成段落' }).click();
  await page.waitForFunction(() => document.querySelector('#generation-queue-count').textContent === '1 项生成中');
  assert.equal(executions.length, 3);
  assert.equal(executions[2].data.rows.length, first.total - 1);
  await page.locator('#jobs-close').click(); await page.reload();
  await page.waitForFunction(() => document.querySelector('#generation-queue-count').textContent === '1 项生成中');
  await page.locator('[data-view="editor"]').click();
  assert.equal(executions.length, 3);
  assert.equal(await output(first.id).count(), 1);
  const resumed = queue.snapshot().jobs.at(-1);
  assert.equal(await output(resumed.id).count(), 1);
  const remaining = executions[2].data.rows.map((row, index) => ({ ...clip, id: `remaining-${index}`, text: row.text }));
  executions[2].resolve({ items: remaining });
  await page.waitForFunction(() => document.querySelector('#generation-dock').dataset.stage === 'complete');
  await page.locator('#generation-results').click();
  assert.equal(await output(resumed.id).locator('.clip').count(), remaining.length);
  assert.equal(await output(resumed.id).locator('.output-job-status').textContent(), '已完成');
  assert.equal(await output(resumed.id).locator('.output-job-summary').isVisible(), false);
  assert.equal(await output(first.id).locator('.clip').count(), 1);
  await assertSingleLine();
  await screenshotOutput('output-multiple-single-line.png');
  await output(resumed.id).getByRole('button', { name: 'WAV ↓', exact: true }).first().click();
  assert.deepEqual(saves.at(-1), { id: 'remaining-0', format: 'wav' });
  await page.locator('#show-generation').click();
  await page.locator(`[data-job-id="${second.id}"]`).getByRole('button', { name: /删除任务记录/ }).click();
  await page.locator('#delete-confirm').click();
  await page.locator(`[data-job-id="${second.id}"]`).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !state.busy);
  assert.equal(await page.locator(`[data-job-id="${first.id}"]`).getByRole('button', { name: /删除任务记录/ }).isEnabled(), true);
  await page.locator('#jobs-close').click();
  await page.locator('#generation-dismiss').click(); assert.equal(await page.locator('#generation-dock').isVisible(), false);

  // Foreground cancellation and failure always restore the button and keep the draft.
  await page.locator('#text').fill('这段配音需要停止。'); await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'preparing');
  const cancelling = queue.snapshot().jobs.at(-1);
  await output(cancelling.id).getByRole('button', { name: '停止生成', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  assert.equal(queue.snapshot().jobs.at(-1).status, 'cancelled');
  assert.equal(await page.locator('#text').inputValue(), '这段配音需要停止。');
  await output(cancelling.id).getByRole('button', { name: /删除任务记录/ }).click();
  assert.match(await page.locator('#delete-heading').textContent(), /删除这条任务记录/);
  await page.locator('#delete-cancel').click();
  assert.equal(await output(cancelling.id).count(), 1, 'dismissing deletion keeps the stopped record');
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'preparing');
  const running = queue.snapshot().jobs.at(-1);
  assert.equal(await output(running.id).getByRole('button', { name: /删除任务记录/ }).count(), 0);
  deletionError = '测试删除失败，请重试';
  await output(cancelling.id).getByRole('button', { name: /删除任务记录/ }).click();
  await page.locator('#delete-confirm').click();
  await page.locator('#delete-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#delete-error').textContent(), /测试删除失败/);
  assert.equal(await output(cancelling.id).count(), 1);
  assert.equal(queue.snapshot().jobs.at(-1).status, 'running');
  deletionError = '';
  await page.locator('#delete-confirm').click();
  await output(cancelling.id).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !state.busy);
  const executionCount = executions.length;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#generate').dataset.stage === 'preparing');
  await page.locator('[data-view="editor"]').click();
  assert.equal(await output(cancelling.id).count(), 0, 'deleted stopped record stays removed after reload');
  assert.equal(queue.snapshot().jobs.at(-1).id, running.id);
  assert.equal(executions.length, executionCount, 'deleting a stopped record does not resubmit or stop the new task');
  executions.at(-1).reject(new Error('测试生成失败'));
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  assert.equal(await page.locator('#generate .voice-orb').count(), 0);
  assert.equal(await page.locator('#toast').textContent(), '测试生成失败');
  const failed = queue.snapshot().jobs.at(-1);
  assert.equal(await output(failed.id).locator('.output-job-status').textContent(), '生成失败');
  assert.equal(await output(failed.id).locator('.output-job-note').textContent(), '测试生成失败');
  assert.equal(await output(failed.id).getByRole('button', { name: '继续未完成段落' }).count(), 1);
  await output(first.id).getByRole('button', { name: /删除任务记录/ }).click();
  assert.match(await page.locator('#delete-description').textContent(), /已生成的音频会保留在“我的作品”中/);
  await page.locator('#delete-confirm').click();
  await output(first.id).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !state.busy);
  assert.equal(await output(resumed.id).count(), 1, 'deleting the old record preserves the continued task');
  await page.locator('[data-view="history"]').click();
  assert.equal(await page.locator('#history [data-clip-id="saved-1"]').count(), 1, 'completed audio stays available in My Works');
  await page.locator('#history [data-clip-id="saved-1"]').getByRole('button', { name: 'MP3 ↓', exact: true }).click();
  assert.deepEqual(saves.at(-1), { id: 'saved-1', format: 'mp3' });
  await page.locator('[data-view="editor"]').click();
  await output(failed.id).getByRole('button', { name: /删除任务记录/ }).click();
  await page.locator('#delete-confirm').click();
  await output(failed.id).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !state.busy);
  await screenshotOutput('output-deleted-stopped.png');
  await testProjectGeneration({ page, queue, executions, clip, artifacts });
  assert.deepEqual(errors, []);
  console.log('Passed: optional user-entered titles, compact single-line audio at 1360/1080px, persistent output records, real audio playback and WAV/MP3 saving, inline button animation, long-text background opt-in, duplicate prevention, targeted cancellation, failure recovery, partial retry, stopped/failed record deletion, deletion cancel/error/retry, audio preservation, deleting old records during a new task, navigation/audition, renderer reload, project progress and queue labels, continuous button animation and 960/850px layouts.');
} catch (error) { await page.screenshot({ path: path.join(artifacts, 'failure.png') }); throw error; }
finally { queue.shutdown(); await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
