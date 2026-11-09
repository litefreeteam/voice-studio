import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
import { createSessionStore } from '../desktop/session.cjs';
import { createProjectStore } from '../desktop/projects.cjs';
import M from '../ui/projects.js';
const root = path.resolve(import.meta.dirname, '..'), fixture = await createDesktopFixture({ activated: true });
const artifacts = path.join(root, '.test-data/inline-retirement'); await mkdir(artifacts, { recursive: true });
await mkdir(path.join(fixture.appDir, 'backend'));
const fixtureWorker = (await readFile(path.join(root, 'tests/fixtures/project-worker.py'), 'utf8')).replace('json.dumps(rows, ensure_ascii=False)', 'json.dumps([{**data, **row, "rows": None} for row in rows], ensure_ascii=False)');
await writeFile(path.join(fixture.appDir, 'backend/worker.py'), fixtureWorker);
const source = '开头<#0.5#>[[emotion:happy]]真开心[[/emotion]]结尾[[cue:laugh]]', plain = '开头真开心结尾哈哈，';
const session = createSessionStore(fixture.data);
session.save({ schema: 'shengyue-project-1', text: source, rows: [], script: false, voiceKey: 'preset:Vivian', options: { mode: 'preset', speaker: 'Vivian', engine: 'standard', emotion: 'natural', language: 'Chinese', sampleRate: 48000 } }); session.close();
const store = createProjectStore(fixture.data), project = M.create('撤回标记测试');
project.chapters[0].lines = [M.line(source, project.roles[0].id)]; store.save(project); store.close();
let app, page; const errors = [];
async function launch() {
  app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: '/usr/bin/python3' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
}
async function completed(count) { await page.waitForFunction(async count => (await studio.invoke('jobs-list')).jobs.filter(j => j.status === 'complete').length >= count, count); }
try {
  await launch(); await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#text').inputValue(), plain);
  assert.equal(await page.locator('[data-inline-action],.inline-rich,.inline-toolbar').count(), 0);
  await page.locator('[data-emotion="happy"]').click(); await page.locator('#generate').click(); await completed(1);
  let calls = (await readFile(path.join(fixture.data, 'test-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls[0].length, 1); assert.equal(calls[0][0].text, plain); assert.equal(calls[0][0].emotion, 'happy');
  await page.screenshot({ path: path.join(artifacts, 'plain-editor.png') });
  await page.evaluate(id => projectWorkspace.open(id), project.id);
  assert.equal(await page.locator('.project-line-row textarea').inputValue(), plain);
  assert.equal(await page.locator('.inline-toolbar').count(), 0);
  await page.locator('#project-generate').click(); await completed(2);
  calls = (await readFile(path.join(fixture.data, 'test-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.at(-1).length, 1); assert.equal(calls.at(-1)[0].text, plain);
  const db = new DatabaseSync(path.join(fixture.data, 'studio.sqlite'), { readOnly: true });
  const backups = db.prepare('SELECT scope, content FROM retired_inline_backups').all(); db.close();
  assert.equal(backups.length, 2);
  assert.equal(JSON.parse(backups.find(b => b.scope === 'session').content).text, source);
  assert.equal(JSON.parse(backups.find(b => b.scope === 'project').content).chapters[0].lines[0].text, source);
  await app.close(); app = null; await launch(); await page.locator('[data-view="editor"]').click();
  assert.equal(await page.locator('#text').inputValue(), plain); assert.equal(await page.locator('.inline-toolbar').count(), 0);
  await page.evaluate(id => projectWorkspace.open(id), project.id); assert.equal(await page.locator('.project-line-row textarea').inputValue(), plain);
  assert.deepEqual(errors, []);
  console.log('Passed: toolbar removed; old session/project markers restored with exact original backups; whole-line generation and global emotion preserved; clean prose survives restart.');
} catch (error) { await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {}); console.error('Renderer errors:', errors); throw error; }
finally { await app?.close(); await fixture.cleanup(); }
