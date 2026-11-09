import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const artifacts = path.join(root, '.test-data/project-input');
const errors = [];
let app;
try {
  await mkdir(path.join(fixture.appDir, 'backend'));
  await copyFile(path.join(root, 'tests/fixtures/project-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
  await mkdir(artifacts, { recursive: true });
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="projects"]').click();
  await page.locator('#project-new').click(); await page.locator('#project-new-name').fill('手动台词输入检查');
  await page.locator('#project-new-form .primary').click();
  await page.locator('#project-add-line').click();
  const input = await page.locator('.project-line-row textarea').elementHandle();
  const snapshot = () => input.evaluate(node => ({ focused: node === document.activeElement, connected: node.isConnected,
    text: node.value, start: node.selectionStart, end: node.selectionEnd, top: node.getBoundingClientRect().top, scroll: scrollY,
    productionVisible: !document.querySelector('.project-production').hidden }));
  const before = await snapshot();
  assert.equal(before.focused, true);
  assert.equal(before.productionVisible, true, 'adding the blank line reveals production controls before input starts');
  await page.screenshot({ path: path.join(artifacts, 'before-input.png') });
  await page.keyboard.insertText('你好');
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  const after = await snapshot();
  await page.screenshot({ path: path.join(artifacts, 'after-first-word.png') });
  assert.equal(after.connected && after.focused, true, 'the first committed word keeps the original textarea focused');
  assert.equal(after.start, 2); assert.equal(after.end, 2);
  assert.ok(Math.abs(after.top - before.top) < 32, 'entering the first word must not move the editor away');

  // Cross both the summary-refresh and autosave timers between committed words.
  for (const word of ['，世界', '。\n', '继续输入第二句。']) {
    await page.keyboard.insertText(word);
    await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
    const current = await snapshot();
    assert.equal(current.connected && current.focused, true);
    assert.equal(current.start, current.text.length); assert.equal(current.end, current.text.length);
    assert.ok(Math.abs(current.top - before.top) < 32);
  }
  const fullText = '你好，世界。\n继续输入第二句。';
  assert.equal((await snapshot()).text, fullText);
  await input.evaluate(node => node.setSelectionRange(3, 5));
  await page.keyboard.insertText('朋友');
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  assert.equal((await snapshot()).start, 5, 'autosave preserves the caret inside an existing line');

  // IME updates and a background refresh keep the same composing element alive.
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.setSelectionRange(node.value.length, node.value.length);
    node.value += '拼音候选'; node.setSelectionRange(node.value.length, node.value.length);
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '拼音候选', isComposing: true }));
    projectWorkspace.refreshMedia();
  });
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  assert.equal((await snapshot()).focused, true);
  await input.evaluate(node => {
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '拼音候选' }));
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '拼音候选' }));
  });
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');

  // Clearing the only line and starting again must not hide/reinsert the panel.
  await input.fill('');
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  assert.equal((await snapshot()).productionVisible, true);
  assert.equal(await page.locator('#project-generate').isDisabled(), true);
  await page.keyboard.insertText('清空后仍可继续写。');
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  assert.ok(Math.abs((await snapshot()).top - before.top) < 32);
  assert.equal((await snapshot()).focused, true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 960, height: 720 }));
  await page.waitForFunction(() => innerWidth === 960);
  await page.locator('#project-new').evaluate(async () => {
    const project = ScriptProjects.create('窄窗口手动输入检查');
    await studio.invoke('project-save', project); await projectWorkspace.open(project.id);
  });
  await page.locator('#project-add-line').click();
  const narrow = await page.locator('.project-line-row textarea').elementHandle();
  const top = await narrow.evaluate(node => node.getBoundingClientRect().top);
  await page.keyboard.insertText('窄窗口也能连续输入');
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  assert.equal(await narrow.evaluate(node => node.isConnected && node === document.activeElement), true);
  assert.ok(Math.abs(await narrow.evaluate(node => node.getBoundingClientRect().top) - top) < 32);
  const persisted = await page.evaluate(async () => {
    const projects = await studio.invoke('projects-list');
    return Promise.all(projects.map(project => studio.invoke('project-load', { id: project.id })));
  });
  assert.equal(persisted.find(project => project.name === '手动台词输入检查').chapters[0].lines[0].text, '清空后仍可继续写。');
  assert.equal(persisted.find(project => project.name === '窄窗口手动输入检查').chapters[0].lines[0].text, '窄窗口也能连续输入');
  assert.deepEqual(errors, []);
  console.log('Project input desktop checks passed: first word, continued Chinese input, caret, IME events, autosave, clearing and 960px layout.');
} finally { await app?.close(); await fixture.cleanup(); }
