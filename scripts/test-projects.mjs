import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
await mkdir(path.join(fixture.appDir, 'backend'));
await copyFile(path.join(root, 'tests/fixtures/project-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
const artifacts = path.join(root, '.test-data/projects'); await mkdir(artifacts, { recursive: true });
let app, page; const errors = [], workflowTitles = new Map();
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady).catch(error => { console.error('Renderer errors:', errors); throw error; });
}
async function choose(selector, value) {
  await page.locator(selector).evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function currentProject() { return page.evaluate(async () => { const list = await studio.invoke('projects-list'); return studio.invoke('project-load', { id: list.find(item => item.name === document.querySelector('#project-title').value).id }); }); }
async function saved() { await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存'); }
async function captureLibraryContent(filename) {
  const chrome = await page.evaluate(() => ['.titlebar', '.sidebar', '#workspace>footer'].map(selector => {
    const element = document.querySelector(selector), hidden = element.hidden; element.hidden = true; return { selector, hidden };
  }));
  try { await page.locator('#project-library').screenshot({ path: path.join(artifacts, filename) }); }
  finally { await page.evaluate(chrome => { chrome.forEach(({ selector, hidden }) => { document.querySelector(selector).hidden = hidden; }); window.scrollTo(0, 0); }, chrome); }
}
async function workflowStep(step) {
  await page.waitForFunction(step => document.querySelector('.project-steps [aria-current="step"]')?.dataset.projectStep === step, step);
  assert.equal(await page.locator('.project-steps [aria-current="step"]').count(), 1);
  const title = (await page.locator('#project-next-title').textContent()).trim();
  assert.ok(title, 'the current workflow step explains what to do next');
  workflowTitles.set(step, title);
  assert.equal(await page.locator('.project-next').isVisible(), step === 'import', 'guidance gives way to the script after adding lines');
}
async function completed() {
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.every(job => job.status === 'complete'), null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#project-generate').textContent.includes('正在提交') && !document.querySelector('#project-production-summary').textContent.includes('处理中'));
}
const calls = async () => (await readFile(path.join(fixture.data, 'test-calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

try {
  await launch(); await page.locator('[data-view="projects"]').click();
  await page.locator('.project-library-empty').waitFor();
  assert.equal(await page.locator('#project-library-pagination').isVisible(), false, 'an empty library has no pagination');
  await page.locator('#project-new').click(); await page.locator('#project-new-name').fill('森林里的约定'); await page.locator('#project-new-form .primary').click();
  await page.waitForFunction(() => !document.querySelector('#project-detail').hidden);
  assert.deepEqual(await page.locator('.project-steps button[data-project-step]').evaluateAll(buttons => buttons.map(button => button.dataset.projectStep)), ['import', 'roles', 'generate', 'export']);
  await workflowStep('import');
  await page.screenshot({ path: path.join(artifacts, 'project-workflow-start.png') });
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered');
  await page.locator('.project-steps [data-project-step="import"]').click();
  assert.equal(await page.locator('#project-import-dialog').isVisible(), true);
  assert.equal(await page.locator('#project-import-source').isVisible(), true);
  await page.locator('#project-import-dialog [data-close]').first().click();
  await page.locator('#project-add-role').click(); await page.locator('#project-role-name').fill('小兔子'); await page.locator('#project-role-aliases').fill('兔兔、小兔');
  await page.locator('#project-role-voice-trigger').click(); await page.locator('.select-search').fill('小雨'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#project-role-voice').inputValue(), 'design:girl-clear');
  assert.equal(await page.locator('#project-role-lock-voice').isChecked(), true);
  assert.equal(await page.locator('#project-role-voice-name').textContent(), '小雨');
  assert.equal(await page.locator('#project-role-portrait img').count(), 1);
  assert.equal(await page.locator('#project-role-prepare-voice .icon-audio-lines').count(), 1);
  await page.locator('#project-role-preview').click();
  await page.waitForFunction(() => document.querySelector('#project-role-preview').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#project-role-preview-label').textContent(), '暂停声音示例');
  await assertSound(page, '#project-role-preview');
  await page.locator('#project-role-preview').click();
  assert.equal(await page.locator('#project-role-preview').getAttribute('aria-pressed'), 'false');
  await page.locator('#project-role-form .primary').click();
  assert.match(await page.locator('#project-role-error').textContent(), /确定并试听/);
  await page.evaluate(() => { window.preparedOriginalPlay = Audio.prototype.play; Audio.prototype.play = function () { this.loop = true; return window.preparedOriginalPlay.call(this); }; });
  await page.locator('#project-role-prepare-voice').click();
  await page.waitForFunction(() => !document.querySelector('#project-role-prepare-voice').disabled);
  await assertSound(page, '#project-role-prepare-voice');
  await page.locator('#project-role-prepare-voice').click();
  await assertSound(page, '#project-role-prepare-voice', 'idle');
  await page.evaluate(() => { Audio.prototype.play = window.preparedOriginalPlay; });
  assert.equal(await page.locator('#project-role-anchor-state').getAttribute('data-state'), 'ready');
  await choose('#project-role-emotion', 'happy');
  assert.equal(await page.locator('#project-role-anchor-state').getAttribute('data-state'), 'pending');
  assert.match(await page.locator('#project-role-anchor-state').textContent(), /需重新定声/);
  await choose('#project-role-emotion', 'natural');
  assert.equal(await page.locator('#project-role-anchor-state').getAttribute('data-state'), 'ready');
  for (const [width, height] of [[1420, 920], [960, 640]]) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height });
    await page.waitForFunction(width => innerWidth === width, width);
    const fit = await page.locator('#project-role-dialog').evaluate(dialog => {
      const footer = dialog.querySelector('.role-dialog-footer').getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
      return dialog.scrollWidth <= dialog.clientWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && footer.bottom <= innerHeight && footer.top >= bounds.top;
    });
    assert.equal(fit, true, 'the role dialog and fixed save actions fit inside the window');
    await page.locator('#project-role-dialog').screenshot({ path: path.join(artifacts, `role-dialog-design-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1420, height: 920 }));
  await page.locator('#project-role-form .primary').click(); await saved();
  assert.ok((await currentProject()).roles.find(role => role.name === '小兔子').options.voiceAnchorId, 'the role fixes its voice before script generation');
  await page.locator('#project-next-action').click();
  await page.locator('#project-import-text').fill('第1章 起程\n旁白：森林里，新的一天开始了。\n兔兔（开心）：我们出发吧！\n熊爷爷（温柔）：带上地图，慢慢走。\n“我们到哪里了？”\n第2章 河边\n旁白：他们走到了小河边。\n小兔：桥好像坏了。');
  await page.locator('#project-import-preview').click();
  assert.equal(await page.locator('#project-import-source').evaluate(element => element.hidden), true);
  assert.equal(await page.locator('#project-import-preview-panel').isVisible(), true);
  const importText = await page.locator('#project-import-text').inputValue();
  await page.locator('#project-import-edit').click();
  assert.equal(await page.locator('#project-import-source').isVisible(), true);
  assert.equal(await page.locator('#project-import-preview-panel').evaluate(element => element.hidden), true);
  assert.equal(await page.locator('#project-import-text').inputValue(), importText, 'returning from preview preserves the source script');
  await page.locator('#project-import-preview').click();
  assert.match(await page.locator('#project-import-summary').textContent(), /2 个章节、6 条台词/);
  const rabbit = await currentProject(); const rabbitId = rabbit.roles.find(role => role.name === '小兔子').id;
  assert.equal(await page.locator('[data-role-name="兔兔"] select').first().inputValue(), rabbitId);
  assert.equal(await page.locator('[data-role-name="小兔"] select').first().inputValue(), rabbitId);
  await choose('[data-role-name="熊爷爷"] select[data-select-kind="voice"]', 'preset:Uncle_Fu');
  await page.screenshot({ path: path.join(artifacts, 'import-role-mapping.png') });
  await page.locator('#project-import-apply').click(); await saved();
  await workflowStep('roles');
  await page.screenshot({ path: path.join(artifacts, 'project-workflow-roles.png') });
  assert.equal(await page.locator('#project-fix-roles').isDisabled(), false);
  let project = await currentProject();
  assert.equal(project.roles.length, 3); assert.equal(project.chapters.length, 2);
  assert.equal(project.chapters[0].lines[1].roleId, rabbitId);
  assert.equal(await page.locator('.project-line-row').count(), 4);
  assert.equal(await page.locator('#project-cast article.project-cast-item').count(), 3);
  await page.waitForFunction(() => [...document.querySelectorAll('#project-cast .project-cast-avatar img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('#project-cast .project-cast-avatar img').count(), 3, 'role cards reuse the selected voice portraits');
  assert.match(await page.locator('#project-cast [data-role-id="' + rabbitId + '"] .project-cast-state').textContent(), /已定声/);
  for (const width of [1420, 1120, 960]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 920 }), width);
    await page.waitForFunction(width => innerWidth === width, width);
    await page.locator('.project-cast').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.project-cast-item').evaluateAll(cards => cards.some(card => card.scrollWidth > card.clientWidth)), false);
    await page.locator('.project-cast').screenshot({ path: path.join(artifacts, `project-role-cards-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1420, height: 920 }));
  // A rejected role edit must not detach existing textarea handlers from saved project data.
  await page.locator('#project-cast [data-role-id="' + rabbitId + '"] .project-cast-settings').click();
  await page.locator('#project-role-name').fill('旁白'); await page.locator('#project-role-form .primary').click();
  assert.match(await page.locator('#project-role-error').textContent(), /重复/);
  await page.locator('#project-role-dialog [data-close]').click();
  await page.locator('.project-line-row textarea').first().fill('验证角色编辑失败后，台词仍可以保存。'); await saved();
  assert.equal((await currentProject()).chapters[0].lines[0].text, '验证角色编辑失败后，台词仍可以保存。');
  await page.locator('#project-undo').click(); await saved();
  await choose('#project-generation-scope', 'all'); await page.locator('#project-generate').click();
  assert.match(await page.locator('#toast').textContent(), /请先配好角色/);
  assert.equal((await page.evaluate(() => studio.invoke('jobs-list'))).jobs.length, 0);
  await choose('#project-filter-status', 'new');
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered', 'changing a filter targets the visible result');
  await page.locator('#project-fix-roles').click();
  assert.equal(await page.locator('#project-filter-status').inputValue(), 'unassigned');
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'filtered');
  assert.equal(await page.locator('.project-line-row').count(), 1, 'fix roles locates unresolved dialogue across the project');
  await page.locator('#project-select-filtered').click();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'selected');
  const bearId = project.roles.find(role => role.name === '熊爷爷').id;
  await choose('#project-bulk-role', bearId); await choose('#project-bulk-emotion', 'gentle'); await page.locator('#project-bulk-apply').click();
  await page.locator('#project-clear-selection').click(); await page.locator('#project-filter-reset').click();
  await workflowStep('generate');
  // A role without a voice needs its own settings, even when every sentence has a role.
  await page.locator('#project-cast [data-role-id="' + bearId + '"] .project-cast-settings').click();
  await choose('#project-role-voice', ''); await page.locator('#project-role-form .primary').click(); await saved();
  assert.equal(await page.locator('#project-cast [data-role-id="' + bearId + '"] .project-cast-avatar').textContent(), '熊');
  assert.equal(await page.locator('#project-cast [data-role-id="' + bearId + '"] .project-cast-avatar img').count(), 0, 'unassigned voices show the role initial');
  await workflowStep('roles'); await page.locator('#project-fix-roles').click();
  assert.equal(await page.locator('#project-role-dialog').isVisible(), true);
  assert.equal(await page.locator('#project-role-name').inputValue(), '熊爷爷');
  assert.equal(await page.locator('#project-role-voice').inputValue(), '');
  await choose('#project-role-voice', 'design:custom'); await page.locator('#project-role-form .primary').click(); await saved();
  await page.locator('#project-fix-roles').click();
  assert.equal(await page.locator('.project-role-advanced').evaluate(details => details.open), true);
  assert.equal(await page.locator('#project-role-description').evaluate(input => input === document.activeElement), true, 'a missing custom voice description is directly editable');
  await page.locator('#project-role-description').fill('低沉温柔、说话从容的长者声音');
  await choose('#project-role-voice', 'preset:Uncle_Fu');
  assert.equal(await page.locator('#project-role-error').textContent(), '', 'switching voice clears errors from the previous voice type');
  assert.equal(await page.locator('#project-role-description-field').isVisible(), false);
  assert.equal(await page.locator('#project-role-lock-fields').isVisible(), false);
  await page.locator('#project-role-dialog').screenshot({ path: path.join(artifacts, 'role-dialog-preset.png') });
  await page.locator('#project-role-form .primary').click(); await saved();
  await workflowStep('generate');
  // Global guidance recovers when the current filter has no remaining work.
  await choose('#project-filter-status', 'complete');
  assert.equal(await page.locator('#project-generate').isDisabled(), true);
  await page.locator('#project-reveal-work').click();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'all');
  assert.equal(await page.locator('#project-filter-status').inputValue(), '');
  assert.equal(await page.locator('.project-line-row').count(), 6);
  await choose('#project-generation-scope', 'all'); await page.locator('#project-generate').click(); await completed();
  assert.equal((await calls()).flat().length, 6);
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 6/);
  await page.locator('[data-view="history"]').click();
  assert.equal(await page.locator('#history .clip').count(), 0, 'generated project lines stay inside their project');
  assert.equal(await page.locator('#history-count').textContent(), '0');
  assert.equal(await page.locator('#history-total').textContent(), '0');
  assert.equal(await page.locator('#history-export').isDisabled(), true);
  assert.equal(await page.locator('#history-project option').count(), 1);
  await page.locator('[data-view="projects"]').click(); await page.getByRole('button', { name: '继续创作', exact: true }).click();
  await page.locator('#project-chapters').getByRole('button', { name: '全部章节', exact: true }).click();
  await choose('#project-generation-scope', 'all');
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 6/);
  await workflowStep('export');
  assert.equal(await page.locator('#project-generate').isDisabled(), true);
  await choose('#project-filter-status', 'complete');
  await page.locator('.project-line-row textarea').first().fill('森林里，一个不一样的早晨开始了。'); await saved();
  assert.equal(await page.locator('.project-line-status').first().textContent(), '需要更新');
  await page.locator('.project-production-heading').click();
  await page.waitForFunction(() => document.querySelectorAll('.project-line-row').length === 5);
  assert.ok((await page.locator('.project-line-status').allTextContents()).every(status => status === '已完成'), 'status filters update without replacing the textarea during typing');
  await page.locator('#project-reveal-work').click();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'all');
  await page.locator('#project-generate').click(); await completed();
  assert.equal((await calls()).flat().length, 7, 'only the edited sentence is regenerated');
  await page.locator('#project-listen').click(); await page.waitForFunction(() => document.querySelector('#project-listen').getAttribute('aria-pressed') === 'false');
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, 'project-editor.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 820 }));
  await page.waitForFunction(() => window.innerWidth <= 1120);
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: path.join(artifacts, 'project-editor-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1420, height: 920 }));

  // Cross-page selection, bulk inheritance, undo and bounded rendering for a long chapter.
  await page.locator('#project-import').click();
  const longText = '第3章 长故事\n' + Array.from({ length: 221 }, (_, index) => '旁白：第' + (index + 1) + '段。' + '沿着森林的小路，他们看到了许多不同的风景。'.repeat(5)).join('\n');
  await page.locator('#project-import-text').fill(longText); await page.locator('#project-import-preview').click(); await page.locator('#project-import-apply').click(); await saved();
  assert.equal(await page.locator('.project-line-row').count(), 30);
  assert.match(await page.locator('#project-page-info').textContent(), /1 \/ 8 页/);
  await page.locator('#project-select-filtered').click(); assert.match(await page.locator('#project-selected-count').textContent(), /221/);
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'selected');
  await choose('#project-generation-scope', 'all');
  await page.locator('#project-quick-next').click(); assert.equal(await page.locator('.project-line-top input:checked').count(), 30);
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'all', 'pagination preserves a manually chosen generation scope');
  await choose('#project-page-jump', '8'); assert.equal(await page.locator('.project-line-row').count(), 11);
  await choose('#project-page-jump', '2'); assert.equal(await page.locator('.project-line-row').count(), 30);
  await choose('#project-bulk-pace', 'fast'); await page.locator('#project-bulk-apply').click(); await saved();
  assert.equal(await page.locator('#project-generation-scope').inputValue(), 'all', 'rerendering selected sentences preserves the manually chosen scope');
  project = await currentProject(); assert.ok(project.chapters.at(-1).lines.every(line => line.pace === 'fast'));
  await page.locator('#project-undo').click(); await saved();
  project = await currentProject(); assert.ok(project.chapters.at(-1).lines.every(line => line.pace === ''));
  await page.screenshot({ path: path.join(artifacts, 'long-story-pagination.png') });
  const before = (await calls()).length;
  await choose('#project-generation-scope', 'all'); await page.locator('#project-generate').click(); await completed();
  const batches = (await calls()).slice(before);
  assert.ok(batches.length > 1); assert.equal(batches.flat().length, 221);
  assert.ok(batches.every(rows => rows.length <= 100 && rows.reduce((sum, row) => sum + row.text.length, 0) <= 5000));
  assert.equal((await page.evaluate(() => studio.invoke('jobs-list'))).jobs.length, 3, 'a long story occupies one queue slot');
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 227/);
  const zip = path.join(artifacts, 'project-audio.zip');
  await app.evaluate(({ dialog }, zip) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip }); }, zip);
  await page.locator('#project-options-open').click();
  await page.locator('#project-export').click(); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('打包 227'));
  await page.locator('#project-options-done').click();
  const manifest = JSON.parse(execFileSync('/usr/bin/python3', ['-c', 'import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("manifest.json").decode())', zip], { encoding: 'utf8' }));
  assert.equal(manifest.length, 227); assert.equal(manifest[0].text, '森林里，一个不一样的早晨开始了。');
  assert.equal(manifest.at(-1).text, project.chapters.at(-1).lines.at(-1).text);

  // Close immediately after typing; synchronous desktop IPC preserves the final edit.
  await page.locator('.project-line-row textarea').first().fill('关闭前的最后一句台词');
  await app.close(); app = null; await launch();
  await page.locator('[data-view="history"]').click();
  assert.equal(await page.locator('#history .clip').count(), 0, 'saved project audio stays separate after restart');
  assert.equal(await page.locator('#history-count').textContent(), '0');
  await page.locator('[data-view="projects"]').click(); await page.getByRole('button', { name: '继续创作', exact: true }).click();
  assert.equal((await currentProject()).chapters.at(-1).lines[30].text, '关闭前的最后一句台词');
  assert.equal(await page.locator('.project-line-row').count(), 4, 'reopening starts at the first chapter');
  await page.locator('#project-back').click(); await page.getByRole('button', { name: '复制项目', exact: true }).click(); await saved();
  const projects = await page.evaluate(() => studio.invoke('projects-list'));
  assert.equal(projects.length, 2);
  const copy = await currentProject(), original = await page.evaluate(id => studio.invoke('project-load', { id }), projects.find(item => item.name === '森林里的约定').id);
  assert.notEqual(copy.roles[0].id, original.roles[0].id); assert.notEqual(copy.chapters[0].lines[0].id, original.chapters[0].lines[0].id);
  assert.match(await page.locator('#project-production-summary').textContent(), /已完成 0/, 'copies have independent generation state');
  await page.locator('[data-view="editor"]').click();
  await page.evaluate(() => {
    state.rows = [{ text: '转入项目的原台词', voiceKey: 'preset:Serena', emotion: 'happy', filename: 'keep-name' }];
    document.querySelector('#project-name').value = '逐句配音转入';
    document.querySelector('#pace').value = 'fast'; document.querySelector('#instruction').value = '像在和朋友聊天';
    setScript(true);
  });
  await page.locator('#convert-project').click(); await page.waitForFunction(() => document.querySelector('#project-title').value === '逐句配音转入');
  const converted = await currentProject();
  assert.equal(converted.roles[0].options.instruction, '像在和朋友聊天'); assert.equal(converted.roles[0].pace, 'fast');
  assert.equal(converted.chapters[0].lines[0].filename, 'keep-name'); assert.equal(converted.chapters[0].lines[0].emotion, 'happy');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);

  // Browse the actual SQLite-backed library independently of the chapter's page state.
  await page.evaluate(async () => {
    const existing = await studio.invoke('projects-list');
    for (let i = 1; i <= 25 - existing.length; i++) {
      const project = ScriptProjects.create(`分页验收 ${String(i).padStart(2, '0')}`);
      if (i % 3) project.chapters[0].lines.push(ScriptProjects.line('这是一段用于分页验收的台词。', project.roles[0].id));
      if (i === 22) project.name = '这是一份用于验证长项目名称在卡片和列表中都能正常显示且不会挤压操作按钮的配音项目';
      await studio.invoke('project-save', project);
    }
  });
  await page.locator('#project-back').click();
  assert.equal(await page.locator('.project-card').count(), 12);
  assert.equal(await page.locator('#project-library-count').textContent(), '25 个配音项目');
  assert.match(await page.locator('#project-library-range').textContent(), /显示 1–12 个/);
  assert.equal(await page.locator('#project-library-pages [aria-label="上一页"]').isDisabled(), true);
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(artifacts, 'project-library-grid.png') });
  const firstPage = await page.locator('.project-card').evaluateAll(cards => cards.map(card => card.dataset.projectId));
  await page.locator('#project-library-pages [aria-label="下一页"]').click();
  const secondPage = await page.locator('.project-card').evaluateAll(cards => cards.map(card => card.dataset.projectId));
  assert.equal(secondPage.length, 12); assert.equal(secondPage.some(id => firstPage.includes(id)), false);
  await page.locator('[data-project-layout="list"]').click();
  assert.equal(await page.locator('[data-project-layout="list"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('.project-card').evaluateAll(cards => cards.map(card => card.dataset.projectId)), secondPage, 'layout changes preserve the current page');
  await page.locator('.project-card-title').first().click(); await page.locator('#project-back').click();
  assert.equal(await page.locator('#project-library-pages [aria-current="page"]').textContent(), '2', 'returning from a project preserves the browsing page');
  await page.locator('#project-library-pages [aria-label="第 3 页"]').click();
  assert.equal(await page.locator('.project-card').count(), 1);
  assert.equal(await page.locator('#project-library-pages [aria-label="下一页"]').isDisabled(), true);
  await page.locator('#project-search').fill('分页验收 0');
  assert.equal(await page.locator('.project-card').count(), 9);
  assert.equal(await page.locator('#project-library-pages [aria-current="page"]').textContent(), '1', 'search starts at the first page');
  await page.locator('#project-search').fill('找不到的配音项目');
  assert.equal(await page.locator('.project-card').count(), 0);
  assert.equal(await page.locator('#project-library-pagination').isVisible(), false);
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  assert.equal(await page.locator('.project-card').count(), 12);
  await choose('#project-library-sort', 'name');
  const expectedNames = await page.evaluate(async () => (await studio.invoke('projects-list')).sort((a, b) => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare(a.name, b.name) || a.id.localeCompare(b.id)).slice(0, 12).map(item => item.name));
  assert.deepEqual(await page.locator('.project-card-title').allTextContents(), expectedNames);
  await choose('#project-library-sort', 'oldest');
  const times = await page.evaluate(async () => {
    const projects = await studio.invoke('projects-list'); return [...document.querySelectorAll('.project-card')].map(card => projects.find(item => item.id === card.dataset.projectId).updatedAt);
  });
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  for (const size of [24, 48, 12]) {
    await choose('#project-library-page-size', String(size));
    assert.equal(await page.locator('.project-card').count(), Math.min(size, 25));
    assert.equal(await page.locator('#project-library-pages [aria-current="page"]').textContent(), '1');
  }
  await choose('#project-library-sort', 'newest');
  await page.locator('[data-project-layout="grid"]').click();
  for (const width of [1420, 1120]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 960 }), width);
    await page.waitForFunction(width => window.innerWidth === width, width);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.equal(await page.locator('.project-card-actions').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), true, 'card actions fit inside the card');
    await page.screenshot({ path: path.join(artifacts, `project-library-grid-${width}.png`) });
    await captureLibraryContent(`project-library-grid-content-${width}.png`);
    await page.locator('[data-project-layout="list"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.equal(await page.locator('.project-card-actions').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), true, 'list actions fit inside the row');
    await page.screenshot({ path: path.join(artifacts, `project-library-list-${width}.png`) });
    await captureLibraryContent(`project-library-list-content-${width}.png`);
    await page.locator('[data-project-layout="grid"]').click();
  }
  await page.locator('#project-library-pages [aria-label="第 3 页"]').click();
  await page.locator('.project-card-delete').click();
  await page.locator('#project-confirm-dialog [data-close]').click();
  assert.equal((await page.evaluate(() => studio.invoke('projects-list'))).length, 25, 'cancelling deletion keeps the project');
  await page.locator('.project-card-delete').click(); await page.locator('#project-confirm-apply').click();
  await page.waitForFunction(() => document.querySelector('#project-library-count').textContent === '24 个配音项目');
  assert.equal(await page.locator('#project-library-pages [aria-current="page"]').textContent(), '2', 'deleting the only item on the final page returns to the last available page');
  assert.equal(await page.locator('.project-card').count(), 12);
  assert.deepEqual(errors, []);
  console.log('Passed: real Electron IPC/SQLite, role aliases and import preview, unresolved dialogue, bulk edits across pages, undo, regeneration of changed lines, long-story batching, sequential playback, ordered ZIP export, restart, independent project copies, library pagination/search/sorting/layouts and final-page deletion. Synthesis uses a deterministic test worker.');
} finally { if (app) await app.close(); await fixture.cleanup(); }
