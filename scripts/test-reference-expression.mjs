// Real Electron and persisted SQLite state; deterministic worker, no model downloads.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
const root = path.resolve(import.meta.dirname, '..');
const fixture = await createDesktopFixture({ activated: true });
const artifacts = path.join(root, '.test-data/reference-expression/ui'); await mkdir(artifacts, { recursive: true });
await mkdir(path.join(fixture.appDir, 'backend'));
let worker = await readFile(path.join(root, 'tests/fixtures/project-worker.py'), 'utf8');
const packages = `[{"id":key,"ready":True,"verified":True} for key in ["standard","light","character","reference"]] + [{"id":"expressive","ready":(root/'expressive-ready').exists(),"verified":True}]`;
worker = worker.replace('[{"id": key, "ready": True} for key in ["standard", "light", "character", "reference"]]', packages);
worker = worker.replace('json.dumps(rows, ensure_ascii=False)', 'json.dumps([{**data, **row, "rows": None} for row in rows], ensure_ascii=False)');
worker = worker.replace('        elif request["op"] == "prepare-voice":', `        elif request["op"] == "download":
            with (root/'test-downloads.jsonl').open('a') as file: file.write(json.dumps(data)+'\\n')
            if data.get('package') == 'expressive': (root/'expressive-ready').write_text('ready')
            result = {'history':history,'references':json.loads((root/'references.json').read_text()),'packages':${packages}}
        elif request["op"] == "prepare-voice":`);
await writeFile(path.join(fixture.appDir, 'backend/worker.py'), worker);
const referenceId = 'a'.repeat(32), reference = { id: referenceId, name: '我的录音', text: '这段录音的原话。', duration: 5, language: 'Chinese' };
await writeFile(path.join(fixture.data, 'references.json'), JSON.stringify([reference]));
let app, page; const errors = [];
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
}
const choose = (selector, value) => page.locator(selector).evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }, value);
async function downloads() { try { return (await readFile(path.join(fixture.data, 'test-downloads.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function calls() { try { return (await readFile(path.join(fixture.data, 'test-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).flat(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
try {
  await launch();
  await page.locator('[data-view="account"]').click();
  assert.match(await page.locator('#resources-state').innerText(), /已就绪/);
  assert.equal(await page.locator('#optional-resources').getAttribute('open'), null);
  await page.locator('#resources-prepare').click(); await page.waitForFunction(() => !state.busy);
  assert.ok((await downloads()).every(request => request.package !== 'expressive'), 'one-click update never downloads the optional model');
  await page.locator('#optional-resources summary').click();
  await page.locator('[data-package="expressive"] .package-download').click();
  await page.locator('#expressive-download-dialog').waitFor();
  assert.match(await page.locator('#expressive-download-size').innerText(), /2.30 GB/);
  await page.locator('#expressive-download-cancel').click();
  assert.equal((await downloads()).filter(request => request.package === 'expressive').length, 0);

  await page.locator('[data-view="editor"]').click();
  await page.evaluate(id => selectVoice('clone:' + id, false), referenceId);
  assert.equal(await page.locator('#reference-style').inputValue(), 'original');
  assert.equal(await page.locator('#performance-fields').isVisible(), false);
  await choose('#reference-style', 'expressive');
  assert.equal(await page.locator('#performance-fields').isVisible(), true);
  await page.locator('#text').fill('今天我们一起分享一个好消息。');
  await page.locator('[data-emotion="happy"]').click();
  await page.locator('.more-expression summary').click();
  await choose('#intensity', '80'); await choose('#pace', 'fast'); await page.locator('#instruction').fill('像和朋友聊天。');
  assert.equal((await downloads()).filter(request => request.package === 'expressive').length, 0, 'choosing emotional delivery only saves a preference');
  await page.locator('#generate').click();
  await page.locator('#package-task-optional').waitFor();
  assert.match(await page.locator('#package-task-detail').innerText(), /独立可选/);
  await page.locator('#package-task-optional').click();
  await page.screenshot({ path: path.join(artifacts, 'optional-download-confirmation.png') });
  assert.equal((await downloads()).filter(request => request.package === 'expressive').length, 0);
  await page.locator('#expressive-download-confirm').click();
  await page.waitForFunction(() => !state.busy && state.packages.some(pack => pack.id === 'expressive' && pack.ready));
  assert.equal((await downloads()).filter(request => request.package === 'expressive').length, 1);
  assert.equal((await calls()).length, 0, 'installing does not start speech generation');
  await page.locator('[data-view="editor"]').click();
  await page.locator('#generate').click();
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.some(job => job.status === 'complete'));
  const [quick] = await calls();
  assert.equal(quick.referenceStyle, 'expressive'); assert.equal(quick.referenceId, referenceId);
  assert.equal(quick.emotion, 'happy'); assert.equal(quick.intensity, 80); assert.equal(quick.pace, 'fast'); assert.equal(quick.instruction, '像和朋友聊天。');
  await page.screenshot({ path: path.join(artifacts, 'own-voice-emotion-controls.png') });
  await app.close(); app = null; await launch(); await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#reference-style').inputValue(), 'expressive');
  assert.equal(await page.locator('#reference-text').inputValue(), reference.text);
  assert.equal((await downloads()).filter(request => request.package === 'expressive').length, 1, 'restart never downloads resources');

  const projectId = await page.evaluate(async id => {
    const project = ScriptProjects.create('自己的声音与逐句情绪'); project.roles[0].voiceKey = 'clone:' + id;
    project.chapters[0].lines = [ScriptProjects.line('欢迎回来。', project.roles[0].id)];
    await api('project-save', project); await projectWorkspace.open(project.id); return project.id;
  }, referenceId);
  await page.locator('#project-add-role').click(); await page.locator('#project-role-dialog [data-close]').click();
  const project = await page.evaluate(id => studio.invoke('project-load', { id }), projectId);
  await page.evaluate(roleId => document.querySelector(`[data-role-id="${roleId}"] .project-cast-name`).click(), project.roles[0].id);
  await page.locator('#project-role-dialog').waitFor();
  await choose('#project-role-reference-style', 'expressive'); await choose('#project-role-emotion', 'happy');
  await page.locator('#project-role-form .primary').click();
  await page.waitForFunction(() => document.querySelector('#project-save-state').textContent === '已自动保存');
  const lineEmotion = '.project-line-row select[aria-label$="条台词的语气"]';
  assert.equal(await page.locator(lineEmotion).isDisabled(), false); await choose(lineEmotion, 'sad');
  await page.locator('#project-generate').click();
  await page.waitForFunction(async () => (await studio.invoke('jobs-list')).jobs.filter(job => job.status === 'complete').length >= 2);
  const projectRequest = (await calls()).at(-1);
  assert.equal(projectRequest.referenceId, referenceId); assert.equal(projectRequest.referenceStyle, 'expressive'); assert.equal(projectRequest.emotion, 'sad');
  await page.screenshot({ path: path.join(artifacts, 'project-recording-emotions.png') });
  assert.deepEqual(errors, []);
  console.log('Passed: default resources exclude VoxCPM2; selection/cancel/restart do not download; explicit consent installs once; quick and project generation retain the recording and emotion settings.');
} finally { await app?.close(); await fixture.cleanup(); }
