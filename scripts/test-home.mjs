import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { prepareProjectGeneration } from '../desktop/jobs.cjs';
import { testUsability } from '../tests/usability-ui.mjs';

// Exercise the real homepage, project workspace and static artwork without a model or user data.
const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const artifacts = path.join(root, '.test-data/home');
await mkdir(artifacts, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const file = path.join(root, 'ui', decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(path.join(root, 'ui') + path.sep)) { response.writeHead(403).end(); return; }
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
page.setDefaultTimeout(12000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const home = page.locator('#view-home');
const cards = home.locator('[data-scenario]');
const goHome = async () => { await page.locator('[data-view="home"]').click(); await home.waitFor({ state: 'visible' }); };
const resetHome = async () => { await page.locator('#home-search').fill(''); await page.locator('[data-home-category="all"]').click(); };
const quickSnapshot = () => page.evaluate(() => JSON.parse(JSON.stringify(sessionSnapshot())));
const projectCount = () => page.evaluate(() => window.testProjects.size);
const projectOptions = project => page.evaluate(project => ScriptProjects.entries(project).map(entry => {
  const settings = ScriptProjects.optionsFor(project, entry, key => {
    const voice = currentVoice(key);
    return { mode: voice.mode, speaker: voice.mode === 'preset' ? voice.id : 'Vivian', character: voice.mode === 'design' ? voice.id : undefined,
      voiceName: voice.name, voiceDescription: voice.prompt || '', language: voice.language || 'Chinese', engine: 'standard', scene: 'story', intensity: 50, instruction: '' };
  });
  return { ...settings, lineVersion: ScriptProjects.fingerprint(settings) };
}), project);
try {
  await page.addInitScript(({ catalog }) => {
    window.calls = []; window.testProjects = new Map(); window.testProjectSaveDelay = 0; window.testFailNextProjectSave = false;
    const saveProject = data => {
      const project = structuredClone(data); project.updatedAt = Date.now(); window.testProjects.set(project.id, project);
      return { saved: true, updatedAt: project.updatedAt };
    };
    window.studio = {
      onProgress() {},
      saveSessionSync(data) { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; },
      saveProjectSync: saveProject,
      async invoke(action, data) {
        window.calls.push({ action, data: structuredClone(data) });
        if (action === 'license') return { activated: true, machineCode: 'TEST' };
        if (action === 'catalog') return catalog;
        if (action === 'status') return { license: { activated: true, machineCode: 'TEST' }, history: [], references: [], packages: ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true })), jobs: { revision: 0, jobs: [] } };
        if (action === 'prepare-voice') {
          const bytes = new Uint8Array(44 + 4800), view = new DataView(bytes.buffer);
          const word = (offset, text) => [...text].forEach((char, i) => { bytes[offset + i] = char.charCodeAt(0); });
          word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true);
          view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, 4800, true);
          return { voiceAnchorId: 'test-anchor-' + data.roleId + data.voiceRevision, audio: btoa(String.fromCharCode(...bytes)) };
        }
        if (action === 'session-load') return JSON.parse(localStorage.getItem('test-session') || 'null');
        if (action === 'session-save') { localStorage.setItem('test-session', JSON.stringify(data)); return { saved: true }; }
        if (action === 'project-save') {
          if (window.testProjectSaveDelay) await new Promise(resolve => setTimeout(resolve, window.testProjectSaveDelay));
          if (window.testFailNextProjectSave) { window.testFailNextProjectSave = false; return { saved: false }; }
          return saveProject(data);
        }
        if (action === 'project-load') {
          const project = window.testProjects.get(data.id); if (!project) throw new Error('这个配音项目不存在');
          return structuredClone(project);
        }
        if (action === 'projects-list') return [...window.testProjects.values()].map(project => ({ id: project.id, name: project.name, updatedAt: project.updatedAt,
          chapterCount: project.chapters.length, roleCount: project.roles.length, lineCount: project.chapters.reduce((count, chapter) => count + chapter.lines.length, 0) }));
        throw new Error('Unexpected call: ' + action);
      }
    };
  }, { catalog });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady && !document.querySelector('#workspace').hidden);
  assert.equal(await home.isVisible(), true);
  assert.equal(await page.locator('[data-view="home"]').evaluate(node => node.classList.contains('active')), true);
  assert.equal(await home.locator('.home-featured-card[data-scenario]').count(), 6);
  assert.equal(await home.locator('.home-compact-card[data-scenario]').count(), 14);
  assert.equal(await cards.count(), 20);
  assert.deepEqual((await cards.evaluateAll(nodes => nodes.map(node => node.dataset.scenario))).sort(), catalog.templates.map(template => template.id).sort());
  await home.locator('img').evaluateAll(async images => Promise.all(images.map(async img => {
    img.loading = 'eager'; try { await img.decode(); } catch {}
  })));
  for (const width of [1360, 1080]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: path.join(artifacts, `home-new-${width}.png`) });
  }
  await page.setViewportSize({ width: 1360, height: 960 });
  for (const [category, count] of [['content', 5], ['dialogue', 2], ['story', 4], ['course', 6], ['business', 4], ['all', 20]]) {
    await page.locator(`[data-home-category="${category}"]`).click();
    assert.equal(await cards.count(), count, category);
    assert.equal(await page.locator(`[data-home-category="${category}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`[data-home-category="${category}"]`).evaluate(node => node === document.activeElement), true);
  }
  await page.locator('[data-home-category="content"]').click();
  assert.equal(await home.locator('[data-scenario="interview-dialogue"]').count(), 1, 'two-person podcasts appear under video and podcasts');
  await resetHome();
  await page.locator('#home-search').fill('播客'); assert.ok(await cards.count() >= 1);
  await page.locator('#home-search').fill('不存在的场景'); assert.equal(await cards.count(), 0);
  assert.equal(await page.locator('#home-empty').isVisible(), true);
  await page.locator('#home-reset-search').click(); assert.equal(await cards.count(), 20);
  assert.equal(await page.locator('#home-search').inputValue(), '');

  for (const id of ['knowledge-video', 'interview-dialogue', 'game-dialogue', 'children-reading', 'course-batch', 'audiobook']) {
    const template = catalog.templates.find(template => template.id === id);
    const [mode, voiceId] = template.voiceKey.split(':');
    const voice = catalog[mode === 'preset' ? 'voices' : 'characters'].find(voice => voice.id === voiceId);
    const preview = home.locator(`[data-scenario="${id}"] .sample-preview`);
    assert.equal(await preview.getAttribute('data-preview-key'), template.voiceKey);
    await preview.click();
    await page.waitForFunction(() => !document.querySelector('#sample-player').classList.contains('hidden') && samplePlaying?.audio?.currentTime > .1);
    assert.equal(await page.locator('#sample-text').textContent(), voice.preview.text);
    const duration = await page.evaluate(async bytes => {
      const context = new AudioContext();
      try { return (await context.decodeAudioData(Uint8Array.from(bytes).buffer)).duration; }
      finally { await context.close(); }
    }, [...await readFile(path.join(root, 'ui', voice.preview.file))]);
    assert.ok(duration > 3 && duration < 30, `${id}: ${duration}s`);
    await page.locator('#sample-close').click();
  }
  assert.equal(await page.evaluate(() => window.calls.some(call => ['generate', 'jobs-submit'].includes(call.action))), false);
  await page.locator('#home-all-templates').click();
  assert.equal(await page.locator('#template-dialog').isVisible(), true); assert.equal(await page.locator('.template-card').count(), 20);
  await page.locator('#template-close').click(); assert.equal(await home.isVisible(), true);

  // Keep a populated quick editor draft while every scene creates its own project.
  await page.locator('#home-quick-editor').click(); assert.equal(await page.locator('#view-editor').isVisible(), true);
  await page.locator('#text').fill('我的原始文稿，创建任何场景都不能覆盖。');
  await page.locator('#project-name').fill('用户正在写的作品');
  await page.evaluate(() => {
    for (const [id, value] of [['language', 'English'], ['pace', 'slow'], ['instruction', '保留我的表达要求'], ['prefix', 'user-draft']]) {
      const field = document.querySelector('#' + id); field.value = value; field.dispatchEvent(new Event('input'));
    }
  });
  await page.locator('#draft-status').filter({ hasText: '已自动保存' }).waitFor();
  const originalDraft = await quickSnapshot();
  const ids = new Set();
  for (const template of catalog.templates) {
    await goHome(); await resetHome();
    const configured = await page.evaluate(id => HomeScenarios.template(catalog, id), template.id);
    const before = await projectCount();
    const entry = template.id === 'ecommerce' ? 'data-scenario-art' : 'data-start-scenario';
    await page.locator(`[${entry}="${template.id}"]`).click();
    await page.waitForFunction(before => window.testProjects.size === before + 1 && !document.querySelector('#view-projects').classList.contains('hidden'), before);
    const created = await page.evaluate(() => structuredClone([...window.testProjects.values()].at(-1)));
    assert.equal(ids.has(created.id), false); ids.add(created.id);
    const expected = configured.rows?.length ? configured.rows : (configured.batch ? configured.text.split(/\r?\n/).filter(text => text.trim()) : [configured.text]).map(text => ({ text, voiceKey: configured.voiceKey }));
    const options = await projectOptions(created);
    const prepared = prepareProjectGeneration({ projectBatch: true, projectId: created.id, rows: options });
    assert.equal(prepared.rows.length, expected.length);
    assert.equal(created.roles.length, new Set(expected.map(row => row.voiceKey)).size);
    for (const [index, row] of prepared.rows.entries()) {
      const [mode, id] = expected[index].voiceKey.split(':');
      assert.equal(row.mode, mode); assert.equal(row[mode === 'design' ? 'character' : 'speaker'], id);
      assert.equal(row.text, expected[index].text); assert.equal(row.emotion, mode === 'design' ? configured.emotion : expected[index].emotion || configured.emotion);
      assert.equal(row.language, configured.language); assert.equal(row.scene, configured.scene); assert.equal(row.pace, configured.pace);
      assert.equal(row.intensity, configured.intensity); assert.equal(row.instruction, mode === 'design' ? configured.instruction : expected[index].instruction || configured.instruction); assert.equal(row.engine, 'standard');
      if (expected[index].filename) assert.equal(row.filename, expected[index].filename);
    }
    // Saving a role name or performance edit must not discard the scene defaults.
    await page.locator('.project-cast-settings').first().click();
    await page.locator('#project-role-name').fill(template.id === 'course-batch' ? '我的讲师' : created.roles[0].name + ' · 我的');
    if (template.id === 'course-batch') await page.locator('#project-role-emotion').evaluate(select => { select.value = 'firm'; select.dispatchEvent(new Event('change')); });
    if (created.roles[0].voiceKey.startsWith('design:')) {
      await page.locator('#project-role-prepare-voice').click();
      await page.waitForFunction(() => !document.querySelector('#project-role-prepare-voice').disabled);
    }
    await page.locator('#project-role-form .primary').click();
    await page.locator('#project-save-state').filter({ hasText: '已自动保存' }).waitFor();
    const edited = await page.evaluate(id => structuredClone(window.testProjects.get(id)), created.id);
    const editedOptions = await projectOptions(edited);
    assert.equal(edited.roles[0].name, template.id === 'course-batch' ? '我的讲师' : created.roles[0].name + ' · 我的');
    for (const [index, row] of editedOptions.entries()) {
      assert.equal(row.scene, configured.scene, 'editing a role retains the scene');
      assert.equal(row.language, configured.language); assert.equal(row.engine, 'standard');
      assert.equal(row.intensity, configured.intensity); assert.equal(row.instruction, row.mode === 'design' ? configured.instruction : expected[index].instruction || configured.instruction);
    }
    assert.equal(await page.locator('#project-delivery-pause').inputValue(), String(configured.deliverySettings?.pauseMs ?? 350));
    assert.equal(await page.locator('#project-delivery-trim').isChecked(), configured.deliverySettings?.trimSilence ?? false);
    if (template.id === 'interview-dialogue') {
      await page.screenshot({ path: path.join(artifacts, 'podcast-project.png'), fullPage: true });
      await page.locator('#project-delivery').click();
      await page.locator('#project-delivery-pause').fill('140');
      await page.locator('#project-delivery-cancel').click();
      await page.evaluate(() => projectWorkspace.save());
      assert.equal(await page.evaluate(id => window.testProjects.get(id).deliverySettings.pauseMs, created.id), 140);
      const other = [...ids].find(id => id !== created.id);
      await page.evaluate(id => projectWorkspace.open(id), other);
      assert.equal(await page.locator('#project-delivery-pause').inputValue(), '350');
      assert.equal(await page.locator('#project-delivery-trim').isChecked(), false);
      await page.evaluate(id => projectWorkspace.open(id), created.id);
      assert.equal(await page.locator('#project-delivery-pause').inputValue(), '140');
      assert.equal(await page.locator('#project-delivery-trim').isChecked(), true);
    }
    if (template.id === 'course-batch') {
      assert.equal(editedOptions[0].emotion, 'firm');
      for (const [voiceKey, language] of [['preset:Aiden', 'English'], ['preset:Vivian', 'Chinese'], ['design:teacher-male', 'Chinese']]) {
        await page.locator('.project-cast-settings').first().click();
        await page.locator('#project-role-voice').evaluate((select, key) => { select.value = key; select.dispatchEvent(new Event('change')); }, voiceKey);
        if (voiceKey.startsWith('design:')) {
          await page.locator('#project-role-prepare-voice').click();
          await page.waitForFunction(() => !document.querySelector('#project-role-prepare-voice').disabled);
        }
        await page.locator('#project-role-form .primary').click();
        await page.locator('#project-save-state').filter({ hasText: '已自动保存' }).waitFor();
        const changed = await page.evaluate(id => structuredClone(window.testProjects.get(id)), created.id), changedOptions = await projectOptions(changed);
        const [mode, id] = voiceKey.split(':');
        assert.equal(changed.roles[0].voiceKey, voiceKey);
        assert.ok(['mode', 'speaker', 'character', 'voiceName'].every(key => !Object.hasOwn(changed.roles[0].options, key)), 'voice identity is resolved from the newly selected voice');
        for (const row of changedOptions) {
          assert.equal(row.mode, mode); assert.equal(row[mode === 'preset' ? 'speaker' : 'character'], id);
          assert.equal(row.character, mode === 'preset' ? undefined : id);
          assert.equal(row.language, language, 'switching voice also switches to its supported language');
          assert.equal(row.scene, 'course'); assert.equal(row.intensity, configured.intensity); assert.equal(row.engine, 'standard');
        }
        assert.equal(prepareProjectGeneration({ projectBatch: true, projectId: created.id, rows: changedOptions }).rows.length, expected.length);
      }
    }
    assert.deepEqual(await quickSnapshot(), originalDraft);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('test-session'))), originalDraft);
    assert.equal(await page.evaluate(() => window.calls.some(call => ['generate', 'jobs-submit'].includes(call.action))), false);
  }

  // Starting a second scene must save a dirty project before it opens the new one.
  const previousId = await page.evaluate(() => [...window.testProjects.keys()].at(-1));
  await page.locator('.project-line-row textarea').first().fill('修改后必须先保存的项目台词。');
  await page.evaluate(() => { document.querySelector('[data-view="home"]').click(); document.querySelector('[data-start-scenario="course-batch"]').click(); });
  await page.waitForFunction(() => window.testProjects.size === 21 && !document.querySelector('#view-projects').classList.contains('hidden'));
  const savedPrevious = await page.evaluate(id => structuredClone(window.testProjects.get(id)), previousId);
  assert.equal(savedPrevious.chapters[0].lines[0].text, '修改后必须先保存的项目台词。');
  const relevantSaves = await page.evaluate(id => window.calls.filter(call => call.action === 'project-save').slice(-2).map(call => call.data.id), previousId);
  assert.equal(relevantSaves[0], previousId); assert.notEqual(relevantSaves[1], previousId);
  assert.deepEqual(await quickSnapshot(), originalDraft);

  // A failed save stays on the homepage and shows a useful message.
  await goHome(); await resetHome(); const beforeFailure = await projectCount();
  await page.evaluate(() => { window.testFailNextProjectSave = true; document.querySelector('#toast').classList.add('hidden'); });
  await page.locator('[data-start-scenario="game-dialogue"]').click();
  await page.locator('#toast:not(.hidden)').waitFor(); assert.match(await page.locator('#toast').textContent(), /失败|无法/);
  assert.equal(await home.isVisible(), true); assert.equal(await projectCount(), beforeFailure);
  assert.deepEqual(await quickSnapshot(), originalDraft);

  // Two rapid clicks are one creation even when saving is deliberately slow.
  const beforeDouble = await projectCount(), savesBeforeDouble = await page.evaluate(() => window.calls.filter(call => call.action === 'project-save').length);
  await page.evaluate(() => { window.testProjectSaveDelay = 180; const button = document.querySelector('[data-start-scenario="children-reading"]'); button.click(); button.click(); });
  await page.waitForFunction(before => window.testProjects.size === before + 1 && !document.querySelector('#view-projects').classList.contains('hidden'), beforeDouble);
  await page.evaluate(() => { window.testProjectSaveDelay = 0; });
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.action === 'project-save').length), savesBeforeDouble + 1);
  assert.deepEqual(await quickSnapshot(), originalDraft);
  assert.equal(await page.evaluate(() => window.calls.some(call => ['generate', 'jobs-submit'].includes(call.action))), false);

  await goHome(); await resetHome();
  await page.locator('#toast').waitFor({ state: 'hidden' });
  const artwork = await home.locator('img').evaluateAll(async images => Promise.all(images.map(async img => {
    img.loading = 'eager';
    try { await img.decode(); } catch {}
    return { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 };
  })));
  assert.equal(artwork.length, 21, 'the hero and all 20 scenes include artwork');
  assert.equal(await cards.locator('img').evaluateAll(images => new Set(images.map(img => img.getAttribute('src'))).size), 20, 'every scene has its own illustration');
  assert.ok(artwork.every(img => img.loaded), JSON.stringify(artwork.filter(img => !img.loaded)));
  for (const width of [1360, 1080]) {
    await page.setViewportSize({ width, height: 960 }); await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, `home-${width}.png`), fullPage: true });
    await page.screenshot({ path: path.join(artifacts, `home-${width}-viewport.png`) });
    // The CSP disallows injected screenshot styles; use the app's existing [hidden] rule.
    const fixedChrome = page.locator('.titlebar, footer');
    await fixedChrome.evaluateAll(nodes => nodes.forEach(node => { node.hidden = true; }));
    try {
      await page.locator('#home-more-section').screenshot({ path: path.join(artifacts, `more-scenes-${width}.png`) });
    } finally { await fixedChrome.evaluateAll(nodes => nodes.forEach(node => { node.hidden = false; })); }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `homepage fits ${width}px`);
  }
  await page.locator('#home-quick-editor').click(); assert.deepEqual(await quickSnapshot(), originalDraft);
  await testUsability(page);
  assert.deepEqual(errors, []);
  console.log('Passed: homepage defaults, 20 scenes, categories/search/reset, offline audition, template library, independent projects and performance settings, role editing retains scene defaults, voice changes update identity/language, quick draft preservation, dirty-project saving, failed-save recovery, click guard, artwork and 1080/1360 layouts.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
