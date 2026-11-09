import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const artifacts = path.join(root, '.test-data/project-editor'), errors = [];
let app;
try {
  await mkdir(path.join(fixture.appDir, 'backend')); await mkdir(artifacts, { recursive: true });
  await copyFile(path.join(root, 'tests/fixtures/project-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  const saved = () => page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  const seed = await page.evaluate(async () => {
    const p = ScriptProjects.create('听见故事 · 编辑交互验收');
    const role = { ...structuredClone(p.roles[0]), id: crypto.randomUUID(), name: '小林', aliases: [], voiceKey: 'preset:Dylan' }; p.roles.push(role);
    p.chapters[0].name = '第一幕 · 雨后的森林';
    p.chapters[0].lines = [ScriptProjects.line('雨停了，森林的清晨正慢慢醒来。', p.roles[0].id), ScriptProjects.line('听见了吗？我们从这里出发。', role.id)];
    p.chapters.push({ id: crypto.randomUUID(), name: '第二幕 · 沿途的风景', lines: Array.from({ length: 30 }, (_, i) => ScriptProjects.line(`第 ${i + 1} 句，沿着小路继续往前。`, role.id)) });
    await studio.invoke('project-save', p); await projectWorkspace.open(p.id); return p;
  });
  const load = () => page.evaluate(id => studio.invoke('project-load', { id }), seed.id);
  const choose = (selector, value) => page.locator(selector).evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  assert.equal(await page.locator('.project-next').isVisible(), false);
  assert.equal(await page.locator('#project-extra-filters').isVisible(), false);
  assert.equal(await page.locator('.project-line-top .avatar img').count(), 2);
  for (const selector of ['.project-line-more .ui-icon', '#project-chapters .icon-list']) assert.notEqual(await page.locator(selector).first().evaluate(icon => getComputedStyle(icon).maskImage), 'none');
  await page.locator('#project-generate').click();
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'));
  await page.waitForFunction(() => document.querySelectorAll('.project-line-status.complete').length === 2);
  assert.equal(await page.locator('#project-progress-label').textContent(), '2 / 2 句');
  await page.locator('[data-line-status="todo"]').click();
  assert.equal(await page.locator('.project-line-row').count(), 0);
  assert.equal(await page.locator('#project-reveal-work').isVisible(), true, 'remaining work outside the current chapter is reachable');
  await page.locator('#project-reveal-work').click();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'all');
  await page.locator(`[data-chapter-id="${seed.chapters[0].id}"]`).click();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered');
  await page.locator('[data-line-status="complete"]').click(); assert.equal(await page.locator('.project-line-row').count(), 2);
  await page.locator('[data-line-status=""]').click();

  // Loop these short fixture WAVs so UI assertions exercise actual playback switching.
  await page.evaluate(() => { window.editorOriginalPlay = Audio.prototype.play; Audio.prototype.play = function () { this.loop = true; return window.editorOriginalPlay.call(this); }; });
  await page.locator('.project-line-listen').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.project-line-row')?.classList.contains('is-playing'));
  await assertSound(page, '.project-line-row:first-child .project-line-listen');
  await assertSound(page, '#project-listen');
  await page.locator('.project-line-listen').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.project-line-row')[1]?.classList.contains('is-playing'));
  assert.equal(await page.locator('.project-line-row.is-playing').count(), 1, 'choosing another row immediately switches playback');
  await assertSound(page, '.project-line-row:first-child .project-line-listen', 'idle');
  await assertSound(page, '.project-line-row:nth-child(2) .project-line-listen');
  await page.locator('.project-line-listen').nth(1).click();
  assert.equal(await page.locator('.project-line-row.is-playing').count(), 0);
  assert.equal(await page.locator('#project-listen').getAttribute('aria-pressed'), 'false');
  await assertSound(page, '#project-listen', 'idle');
  await page.evaluate(() => { Audio.prototype.play = window.editorOriginalPlay; });

  const original = (await load()).chapters[0].lines[0];
  await page.locator('.project-line-more>summary').first().click();
  await page.locator('.project-line-menu').first().getByRole('button', { name: '复制台词', exact: true }).click(); await saved();
  let project = await load(), copy = project.chapters[0].lines[1];
  assert.equal(copy.text, original.text); assert.equal(copy.roleId, original.roleId); assert.notEqual(copy.id, original.id);
  assert.equal(copy.generationAttempt, undefined); assert.equal(copy.selectedTake, undefined, 'copies do not reuse generated audio');
  const currentInput = page.locator(`[data-line-id="${copy.id}"]>textarea`);
  assert.equal(await currentInput.evaluate(input => document.activeElement === input), true);
  await page.locator(`[data-line-id="${copy.id}"] .project-line-continue`).click(); await saved();
  project = await load(); const added = project.chapters[0].lines[2];
  assert.equal(added.roleId, original.roleId); assert.equal(added.text, '');
  const focused = await page.locator(`[data-line-id="${added.id}"]>textarea`).elementHandle();
  const before = await focused.evaluate(input => input.getBoundingClientRect().top);
  await page.keyboard.insertText('下一句继续说。'); await saved();
  assert.equal(await focused.evaluate(input => input.isConnected && input === document.activeElement), true);
  assert.ok(Math.abs(before - await focused.evaluate(input => input.getBoundingClientRect().top)) < 2, 'continued input keeps the same row and position');
  await page.locator(`[data-line-id="${copy.id}"] .project-line-more>summary`).click();
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.project-line-more[open]').count(), 0);
  await page.locator(`[data-line-id="${copy.id}"] .project-line-more>summary`).click();
  await page.locator(`[data-line-id="${copy.id}"] .project-line-delete`).click(); await saved();
  assert.equal((await load()).chapters[0].lines.some(line => line.id === copy.id), false);
  await page.locator('#project-undo').click(); await saved();
  assert.equal((await load()).chapters[0].lines.some(line => line.id === copy.id), true);

  await page.locator('#project-filter-toggle').click();
  assert.equal(await page.locator('#project-filter-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('#project-filter-role-trigger').click();
  await page.getByRole('option').filter({ hasText: '小林' }).click();
  assert.equal(await page.locator('.project-line-row').count(), 1);
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered');
  await page.locator('#project-filter-reset').click();
  await page.locator('#project-options-open').click();
  await page.locator('[data-project-target="30"]').click(); await saved(); assert.equal((await load()).targetSeconds, 30);
  await page.locator('[data-project-target=""]').click(); await saved(); assert.equal((await load()).targetSeconds, 0);
  await page.locator('#project-target-seconds').fill('15.5'); await saved(); await page.keyboard.press('Escape');
  assert.equal((await load()).targetSeconds, 15.5);
  assert.equal(await page.locator('#project-options-open').evaluate(button => button === document.activeElement), true);

  // Layout at the desktop minimum: the script is visible before any page scroll.
  await page.locator('#project-filter-toggle').click();
  for (const [width, height] of [[1420, 920], [1120, 820], [960, 640]]) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height });
    await page.waitForFunction(width => innerWidth === width, width); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const visible = await page.locator('.project-line-row>textarea').first().evaluate(input => { const r = input.getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight - 34; });
    await page.screenshot({ path: path.join(artifacts, `editor-${width}.png`) });
    assert.equal(visible, true, `the first complete textarea is visible at ${width} × ${height}`);
  }
  await page.locator('#project-options-open').click();
  assert.equal(await page.locator('#project-options-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true);
  await page.locator('#project-options-dialog').screenshot({ path: path.join(artifacts, 'production-options.png') });
  await page.locator('#project-options-done').click();
  await page.locator(`[data-chapter-id="${seed.chapters[1].id}"]`).click();
  await page.locator('.project-line-row>textarea').last().focus(); await page.keyboard.press('Control+Enter'); await saved();
  assert.equal(await page.locator('.project-line-row').count(), 1, 'adding after the final row on page 1 opens page 2');
  const final = (await load()).chapters[1].lines.at(-1);
  assert.equal(final.roleId, seed.roles[1].id);
  assert.equal(await page.locator('.project-line-row>textarea').evaluate(input => input === document.activeElement), true);
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered');
  await page.keyboard.insertText('下一页也可以接着写。'); await saved();
  assert.equal((await load()).chapters[1].lines.at(-1).text, '下一页也可以接着写。');
  await page.locator('#project-lines').evaluate(list => scrollTo(0, list.getBoundingClientRect().top + scrollY));
  assert.equal(await page.locator('.project-production').evaluate(bar => { const r = bar.getBoundingClientRect(); return r.top >= 0 && r.top < 70; }), true, 'production controls remain accessible while scrolling');
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ passed: true, checks: ['first-screen script at 1420, 1120 and 960', 'portrait role selectors', 'quick status filters and scope recovery', 'actual WAV playback switching and active row', 'copy without inherited audio', 'continue with same role and stable typing', 'delete and undo', 'role filter', 'duration presets and precision', 'keyboard focus return', 'continue across page boundary', 'sticky production controls'], errors }, null, 2));
  console.log('Project editor checks passed: visible script, quick filters, playback switching, copy/continue/undo, duration options, pagination and sticky controls.');
} finally { await app?.close().catch(() => {}); await fixture.cleanup(); }
