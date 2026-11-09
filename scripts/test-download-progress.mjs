import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

// Real Electron/IPC, disposable data, controlled downloads and no model transfer.
const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, '.test-data/download-progress');
await mkdir(artifacts, { recursive: true });
const fixture = await createDesktopFixture({ activated: true });
await mkdir(path.join(fixture.appDir, 'backend'));
await writeFile(path.join(fixture.appDir, 'backend/worker.py'), `import json,sys,pathlib,time
root=pathlib.Path(sys.argv[2]); ready=root/'ready-packages.json'
def status():
 ids=json.loads(ready.read_text()) if ready.exists() else []
 return {'packages':[{'id':key,'ready':key in ids,'verified':True} for key in ['standard','light','character','reference']]}
def emit(**event): print(json.dumps({'type':'progress',**event}),flush=True)
def control(): return json.loads((root/'download-control.json').read_text())
def wait(key,step):
 while control()['steps'].get(key,0)<step: time.sleep(.02)
for line in sys.stdin:
 q=json.loads(line); op=q['op']
 if op=='status': result=status()
 elif op=='download':
  key=q['data']['package']
  with (root/'download-calls.jsonl').open('a') as log: log.write(json.dumps({'package':key})+'\\n')
  if not (root/'test-components').exists():
   emit(stage='runtime',message='准备运行环境'); wait(key,1)
   emit(stage='dependencies',message='安装共用组件'); wait(key,2)
   (root/'test-components').write_text('ready')
  emit(stage='download',downloadPhase='transferring',aggregateCurrent=400000000,aggregateTotal=1600000000,fileIndex=3,fileCount=10,message='下载声音文件'); wait(key,3)
  emit(stage='download',downloadPhase='verifying',aggregateCurrent=1600000000,aggregateTotal=1600000000,fileIndex=10,fileCount=10,message='校验声音文件'); wait(key,4)
  if control().get('fail')==key:
   print(json.dumps({'type':'error','id':q['id'],'message':'测试下载连接中断，请重试'}),flush=True); continue
  ids=[p['id'] for p in status()['packages'] if p['ready']]; ready.write_text(json.dumps(list(set(ids+[key]))))
  result=status()
 else: raise ValueError(op)
 print(json.dumps({'type':'result','id':q['id'],'result':result}),flush=True)
`);
let controls = { steps: { light: 0, character: 2, reference: 4 } };
const control = async values => {
  controls = { ...controls, ...values, steps: { ...controls.steps, ...values.steps } };
  const file = path.join(fixture.data, 'download-control.json');
  await writeFile(file + '.tmp', JSON.stringify(controls)); await rename(file + '.tmp', file);
};
await control({});
await writeFile(path.join(fixture.data, 'ready-packages.json'), JSON.stringify(['standard']));
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: path.join(root, '.venv/bin/python') } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ dialog }) => { globalThis.downloadMainErrors = []; dialog.showErrorBox = (title, message) => globalThis.downloadMainErrors.push({ title, message }); });
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
};
const stage = async (id, phase) => page.waitForFunction(({ id, phase }) => packageDownload?.id === id && (packageDownload.phase === phase || packageDownload.stage === phase), { id, phase });
const status = async value => page.waitForFunction(value => packageDownload?.status === value && !state.busy, value);
try {
  await launch();
  await page.evaluate(async () => {
    const project = ScriptProjects.create('下载后继续这个项目');
    project.roles[0].voiceKey = 'design:' + catalog.characters[0].id;
    project.chapters[0].lines = Array.from({ length: 65 }, (_, index) => ScriptProjects.line('保留我的台词，第' + (index + 1) + '句。', project.roles[0].id));
    await api('project-save', project); await projectWorkspace.open(project.id);
  });
  await page.locator('#project-line-search').fill('保留');
  await page.locator('#project-quick-next').click();
  await page.locator('.project-line-row input[type="checkbox"]').first().check();
  assert.match(await page.locator('#project-page-info').innerText(), /2 \/ 3 页/);
  const location = await page.evaluate(() => projectWorkspace.resourceLocation());
  await page.locator('#project-prepare-voices').click();
  assert.match(await page.locator('#package-task-detail').innerText(), /人物与童声、我的专属声音/);
  assert.equal(await page.locator('.package-card:visible').count(), 0, 'individual resources start collapsed');
  assert.equal(await page.locator('#resources-prepare').innerText(), '补齐剩余资源');
  await page.screenshot({ path: path.join(artifacts, 'complete-resource-entry.png'), fullPage: true });
  await page.locator('#resources-prepare').click();
  await stage('light', 'runtime');
  assert.equal(await page.locator('#resources-progress-bar').getAttribute('value'), null);
  assert.equal(await page.locator('#resources-pause').isVisible(), true);
  await control({ steps: { light: 1 } }); await stage('light', 'dependencies');
  await control({ steps: { light: 2 } }); await stage('light', 'transferring');
  const initial = await page.locator('#resources-progress-bar').evaluate(node => node.value);
  assert.ok(initial > 0 && initial < 1);
  await page.locator('[data-view="voices"]').click(); await page.locator('[data-view="account"]').click();
  assert.equal(await page.locator('#resources-progress-bar').evaluate(node => node.value), initial);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 740 }));
  await page.waitForFunction(() => innerWidth <= 1120);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(artifacts, 'downloading-narrow.png'), fullPage: true });
  await control({ steps: { light: 3 } }); await stage('light', 'verifying');
  assert.doesNotMatch(await page.locator('#resources-state').innerText(), /已就绪/);
  assert.ok(await page.locator('#resources-progress-bar').evaluate(node => node.value) < 1);
  await control({ steps: { light: 4 } }); await stage('character', 'transferring');
  assert.ok(await page.locator('#resources-progress-bar').evaluate(node => node.value) >= initial, 'total progress does not reset between packages');
  app.process().stderr.destroy(); app.process().stdout.destroy();
  await page.locator('#resources-pause').click(); await status('cancelled');
  assert.equal(await page.locator('#resources-prepare').innerText(), '继续下载');
  assert.deepEqual(await app.evaluate(() => globalThis.downloadMainErrors), [], 'pause with closed launcher pipes must not raise an exception');
  await page.screenshot({ path: path.join(artifacts, 'paused.png'), fullPage: true });
  await app.close(); app = null;

  await launch(); await page.locator('[data-view="account"]').click();
  assert.equal(await page.locator('#resources-prepare').innerText(), '继续下载', 'pause persists after restart');
  assert.equal(await page.locator('#package-task').isVisible(), true, 'creation destination persists after restart');
  await page.locator('#resources-prepare').click(); await stage('character', 'transferring');
  await control({ fail: 'character', steps: { character: 4 } }); await status('failed');
  assert.equal(await page.locator('#resources-prepare').innerText(), '重试准备');
  assert.doesNotMatch(await page.locator('#resources-state').innerText(), /已就绪/);
  await control({ fail: null });
  await page.locator('#resources-prepare').click();
  await page.waitForFunction(() => !state.busy && !document.querySelector('#view-projects').classList.contains('hidden'));
  assert.equal(await page.locator('#project-line-search').inputValue(), '保留');
  assert.match(await page.locator('#project-page-info').innerText(), /2 \/ 3 页/);
  const restored = await page.evaluate(() => projectWorkspace.resourceLocation());
  assert.equal(restored.id, location.id); assert.deepEqual(restored.selected, location.selected);
  assert.equal(await page.evaluate(() => localStorage.getItem('shengyue-resource-return-1')), null);
  const calls = (await readFile(path.join(fixture.data, 'download-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(call => call.package), ['light', 'character', 'character', 'character', 'reference'], 'installed and completed packages are skipped on every continuation');
  await page.locator('[data-view="account"]').click();
  assert.equal(await page.locator('#resources-state').innerText(), '完整配音功能已就绪');
  assert.equal(await page.locator('#resources-prepare').innerText(), '检查资源更新');
  await page.screenshot({ path: path.join(artifacts, 'ready.png'), fullPage: true });

  // Also preserve the unsaved role form and quick-editor text when returning early.
  await page.evaluate(async id => { state.packages = [{ id: 'standard', ready: true, verified: true }]; await projectWorkspace.open(id); }, location.id);
  await page.locator('#project-fix-roles').click();
  await page.locator('#project-role-name').fill('下载后保留的角色名称');
  await page.locator('#project-role-prepare-voice').click();
  await app.close(); app = null; await launch();
  await page.locator('[data-view="account"]').click();
  await page.locator('#package-task-return').click();
  await page.locator('#project-role-dialog').waitFor();
  assert.equal(await page.locator('#project-role-name').inputValue(), '下载后保留的角色名称');
  await page.locator('[data-close="project-role-dialog"]').click();
  await page.evaluate(() => { state.packages = [{ id: 'standard', ready: true, verified: true }]; navigate('editor'); document.querySelector('#text').value = '返回时保留这段快速配音文稿。'; selectVoice('design:' + catalog.characters[0].id); update(); });
  await page.locator('#generate').click(); await page.locator('#package-task-return').click();
  assert.equal(await page.locator('#text').inputValue(), '返回时保留这段快速配音文稿。');
  // The laboratory uses the same preparation/return flow and preserves its fields.
  await writeFile(path.join(fixture.data, 'ready-packages.json'), JSON.stringify(['standard', 'light', 'character']));
  await page.evaluate(async () => {
    await refresh();
    const doc = VoiceLab.create('family'); doc.voiceKey = 'design:' + catalog.characters[0].id;
    await api('lab-save', doc); await laboratory.open(doc.id); navigate('laboratory', true);
  });
  await page.locator('#lab-workspace .lab-field input').first().fill('下载后保留的主角');
  const labLocation = await page.evaluate(() => laboratory.resourceLocation());
  await page.locator('#lab-generate').click();
  assert.equal(await page.locator('#package-task').isVisible(), true);
  await page.locator('#resources-prepare').click();
  await page.waitForFunction(() => !state.busy && !document.querySelector('#view-laboratory').classList.contains('hidden'));
  assert.equal((await page.evaluate(() => laboratory.resourceLocation())).id, labLocation.id);
  assert.equal(await page.locator('#lab-workspace .lab-field input').first().inputValue(), '下载后保留的主角');
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ passed: true, cases: ['one-click missing packages', 'shared components', 'aggregate progress', 'navigate during download', 'pause/resume and restart', 'closed launcher pipes', 'failure retry', 'project filters/page/selection restore after restart', 'unsaved role form', 'quick draft', 'laboratory return', 'narrow layout'], calls, errors }, null, 2));
  console.log('PASS: complete resources, missing-package selection, pause/resume/restart, retry, creation return and narrow layout');
} finally { await app?.close(); await fixture.cleanup(); }
