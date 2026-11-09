import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

// Real renderer, isolated mock data. DPR alone does not reduce the logical viewport:
// each case also uses the content size remaining after Windows scaling/frame/taskbar.
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-data/layout');
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
await mkdir(artifacts, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const server = createServer(async (request, response) => {
  const file = path.resolve(root, 'ui', '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(path.join(root, 'ui') + path.sep)) { response.writeHead(403).end(); return; }
  try { const data = await readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [], errors = [];
const cases = [
  { name: 'windows-1080p-100', width: 1420, height: 850, dpr: 1, platform: 'win32' },
  { name: 'windows-1080p-125', width: 1360, height: 720, dpr: 1.25, platform: 'win32' },
  { name: 'windows-1080p-150', width: 1200, height: 620, dpr: 1.5, platform: 'win32' },
  { name: 'windows-laptop-125', width: 1024, height: 510, dpr: 1.25, platform: 'win32' },
  { name: 'windows-laptop-150', width: 850, height: 430, dpr: 1.5, platform: 'win32' },
  { name: 'windows-small', width: 800, height: 500, dpr: 1, platform: 'win32' },
  { name: 'macbook', width: 1360, height: 850, dpr: 2, platform: 'darwin' },
  { name: 'macbook-small', width: 960, height: 600, dpr: 2, platform: 'darwin' }
];

try {
  for (const scenario of cases) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.dpr });
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(`${scenario.name}: ${error.message}`));
    await page.addInitScript(({ catalog, platform }) => {
      const projects = new Map(), labs = new Map();
      const saveProject = data => { const project = structuredClone(data); project.updatedAt = Date.now(); projects.set(project.id, project); return { saved: true, updatedAt: project.updatedAt }; };
      const saveLab = data => { labs.set(data.id, structuredClone(data)); return { saved: true }; };
      window.studio = {
        platform,
        onProgress() {}, saveProjectSync: saveProject, saveLabSync: saveLab,
        saveSessionSync(data) { localStorage.setItem('layout-session', JSON.stringify(data)); return { saved: true }; },
        async invoke(action, data) {
          if (action === 'license') return { activated: true, machineCode: 'LAYOUT-TEST' };
          if (action === 'catalog') return catalog;
          if (action === 'status') return { license: { activated: true, machineCode: 'LAYOUT-TEST' }, history: [], references: [], packages: ['standard', 'light', 'character', 'reference'].map(id => ({ id, ready: true })), hardware: { platform, arch: 'x64', memoryGB: 16, freeDiskGB: 128 }, jobs: { revision: 0, jobs: [] } };
          if (action === 'session-load') return JSON.parse(localStorage.getItem('layout-session') || 'null');
          if (action === 'session-save') return window.studio.saveSessionSync(data);
          if (action === 'project-save') return saveProject(data);
          if (action === 'project-load') return structuredClone(projects.get(data.id));
          if (action === 'projects-list') return [...projects.values()].map(project => ({ id: project.id, name: project.name, updatedAt: project.updatedAt, chapterCount: project.chapters.length, roleCount: project.roles.length, lineCount: project.chapters.reduce((n, chapter) => n + chapter.lines.length, 0) }));
          if (action === 'lab-list') return [...labs.values()];
          if (action === 'lab-save') return saveLab(data);
          if (action === 'lab-load') return structuredClone(labs.get(data.id));
          if (action === 'cli-config') return { platform: 'Windows x64', status: 'shengyue status --json', generate: 'shengyue generate --text "你好"', guide: '本机配音接入说明' };
          throw new Error('Unexpected layout test action: ' + action);
        }
      };
    }, { catalog, platform: scenario.platform });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady && !document.querySelector('#workspace').hidden);
    assert.equal(await page.locator('.titlebar').isVisible(), scenario.platform === 'darwin');

    const checkLayout = async view => {
      await page.evaluate(() => scrollTo(0, 0));
      const metrics = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const sidebar = document.querySelector('.sidebar'), nav = sidebar.querySelector(':scope>nav');
        return {
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          sidebar: rect(sidebar), nav: rect(nav), navScroll: nav.scrollHeight > nav.clientHeight,
          menu: [...sidebar.querySelectorAll('.nav')].map(rect),
          bottom: rect(sidebar.querySelector('.sidebar-bottom')),
          overflow: [...document.querySelectorAll('main button, main input, main textarea, main .card')].filter(node => node.getClientRects().length && node.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(node => node.id || node.className)
        };
      });
      await page.screenshot({ path: path.join(artifacts, `${scenario.name}-${view}.png`), scale: 'css' });
      assert.ok(metrics.scrollWidth <= scenario.width, `${scenario.name}/${view}: horizontal overflow ${metrics.scrollWidth}`);
      assert.deepEqual(metrics.overflow, [], `${scenario.name}/${view}: overflowing controls`);
      assert.ok(metrics.menu.every(item => item.height >= 42), `${scenario.name}: menu rows compressed`);
      assert.ok(metrics.bottom.bottom <= scenario.height && metrics.bottom.y >= metrics.nav.bottom - 1, `${scenario.name}: sidebar sections overlap`);
      assert.ok(metrics.menu.every(item => item.right <= metrics.sidebar.right), `${scenario.name}: sidebar buttons overflow`);
      // A clipped last item must scroll into view and remain clickable above Settings.
      const last = page.locator('.sidebar>nav .nav').last();
      await last.scrollIntoViewIfNeeded();
      const lastBounds = await last.boundingBox();
      assert.ok(lastBounds.y >= metrics.nav.y - 1 && lastBounds.y + lastBounds.height <= metrics.bottom.y + 1, `${scenario.name}: last menu item unreachable`);
      report.push({ scenario: scenario.name, view, width: scenario.width, height: scenario.height, navScroll: metrics.navScroll });
    };

    for (const view of ['home', 'editor', 'projects', 'voices', 'roles', 'history', 'laboratory', 'account']) {
      await page.locator(`.sidebar [data-view="${view}"]`).click();
      await page.locator(`#view-${view}`).waitFor({ state: 'visible' });
      await checkLayout(view);
    }
    await page.locator('.sidebar [data-view="home"]').click();
    await page.locator('[data-start-scenario="podcast-intro"]').click();
    await page.locator('#project-detail').waitFor({ state: 'visible' });
    await checkLayout('project-workspace');
    await page.locator('#project-import').click();
    const checkImportLayout = async step => {
      const bounds = await page.locator('#project-import-dialog').evaluate(dialog => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        return { dialog: rect(dialog), footer: rect(dialog.querySelector('.import-dialog-footer')), overflow: dialog.scrollWidth > dialog.clientWidth + 1 };
      });
      assert.ok(bounds.dialog.left >= 0 && bounds.dialog.top >= 0 && bounds.dialog.right <= scenario.width && bounds.dialog.bottom <= scenario.height, `${scenario.name}/${step}: import outside viewport`);
      assert.ok(bounds.footer.left >= bounds.dialog.left && bounds.footer.right <= bounds.dialog.right && bounds.footer.bottom <= bounds.dialog.bottom, `${scenario.name}/${step}: import actions outside dialog`);
      assert.equal(bounds.overflow, false, `${scenario.name}/${step}: import horizontal overflow`);
      await page.screenshot({ path: path.join(artifacts, `${scenario.name}-import-${step}.png`), scale: 'css', animations: 'disabled' });
    };
    await checkImportLayout('source');
    await page.locator('[name="project-import-kind"][value="dialogue"]').check();
    await page.locator('#project-import-text').fill('第1章 起程\n旁白：森林里，新的一天开始了。\n小兔子：我们出发吧！');
    await page.locator('#project-import-preview').click();
    assert.equal(await page.locator('#project-import-line-count').textContent(), '2');
    assert.equal(await page.locator('#project-import-role-count').textContent(), '2');
    await checkImportLayout('preview');
    await page.locator('#project-import-edit').click();
    assert.match(await page.locator('#project-import-text').inputValue(), /小兔子：我们出发吧/);
    await page.locator('#project-import-dialog [data-close]').first().click();
    await page.locator('.sidebar [data-view="editor"]').click();
    await page.locator('#browse-voices').click();
    await page.locator('#voice-picker').waitFor({ state: 'visible' });
    const picker = await page.locator('#voice-picker').boundingBox();
    assert.ok(picker.x >= 0 && picker.y >= 0 && picker.x + picker.width <= scenario.width && picker.y + picker.height <= scenario.height, `${scenario.name}: picker outside viewport`);
    await page.screenshot({ path: path.join(artifacts, `${scenario.name}-voice-picker.png`), scale: 'css' });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${report.length} page layouts across Windows 100%/125%/150%, small laptops and Mac; sidebar scroll/click reachability and voice picker bounds.`);
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ report, errors }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
