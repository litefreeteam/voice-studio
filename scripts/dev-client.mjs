import { _electron as electron } from 'playwright';
import { watch } from 'node:fs';
import path from 'node:path';
import { createDevFixture } from './dev-fixture.mjs';

// Keep preview edits and recordings separate from the everyday client.
const root = path.resolve(import.meta.dirname, '..');
const activationPreview = process.argv.includes('--activation');
const fixture = await createDevFixture({ activated: !activationPreview });
let app, watcher, timer;
let changed = new Set(), updating = Promise.resolve();
const waitForReady = page => page.waitForFunction(() =>
  document.querySelector('#activation-gate').getAttribute('aria-busy') === 'false' &&
  (!document.querySelector('#activation-gate').hidden || (typeof sessionReady !== 'undefined' && sessionReady)));
try {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: process.env.VOICE_STUDIO_PYTHON || '' }, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => console.error('Renderer:', error.message));
  await waitForReady(page);
  await app.evaluate(({ app, BrowserWindow }) => {
    app.setName('声悦 · 测试版');
    const window = BrowserWindow.getAllWindows()[0];
    window.setTitle('声悦 · 测试版'); window.show(); window.focus(); app.focus({ steal: true });
  });
  const label = () => page.evaluate(() => {
    document.title = '声悦 · 测试版';
    document.querySelector('.titlebar span').textContent = '声悦 · 测试版 · 实时预览';
  });
  await label();
  if (!activationPreview) await page.locator('[data-view="home"]').click();
  watcher = watch(path.join(root, 'ui'), { recursive: true }, (_event, file) => {
    if (!file || !/\.(css|js|html|svg|webp|png)$/.test(file)) return;
    changed.add(file); clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...changed]; changed.clear();
      updating = updating.then(async () => {
        if (page.isClosed()) return;
        if (files.every(file => file.endsWith('.css'))) {
          await page.evaluate(() => Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link => new Promise(resolve => {
            link.onload = link.onerror = resolve;
            const url = new URL(link.href); url.searchParams.set('preview', Date.now()); link.href = url.href;
          }))));
        } else {
          const view = await page.evaluate(() => ({ id: document.querySelector('#workspace').hidden ? null : document.querySelector('.view:not(.hidden)')?.id.replace('view-', ''), scroll: scrollY }));
          await page.reload();
          await waitForReady(page);
          await label();
          await page.evaluate(view => { if (view.id) navigate(view.id); window.scrollTo(0, view.scroll); }, view);
        }
        console.log('Updated:', files.join(', '));
      }).catch(error => console.error('Preview update:', error.message));
    }, 200);
  });
  console.log(`Live preview ready: pid=${app.process().pid}, view=${activationPreview ? 'activation' : 'workspace'}, recordings=${await page.locator('#reference-grid .voice-card').count()}`);
  console.log('CSS updates immediately; other UI changes reload the current page. Close the test window to stop.');
  const stop = () => app.close().catch(() => {});
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  page.once('close', stop);
  await new Promise(resolve => app.once('close', resolve));
} finally {
  clearTimeout(timer); watcher?.close();
  if (app) await app.close().catch(() => {});
  await fixture.cleanup();
}
