// Optional integration test: actual Electron, CLI and local models in a disposable installation.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { cp, mkdir, symlink, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
import Lab from '../ui/lab-core.js';
import Media from '../ui/lab-media.js';

const root = path.resolve(import.meta.dirname, '..');
const installed = process.env.VOICE_CONSISTENCY_REAL_DATA || path.join(os.homedir(), 'Library/Application Support/Voice Studio');
const artifacts = path.join(root, '.test-data/voice-consistency-real', String(Date.now()));
await mkdir(artifacts, { recursive: true });
const fixture = await createDesktopFixture({ activated: true });
const interpreter = process.env.VOICE_STUDIO_PYTHON || path.join(root, '.venv/bin/python');
let app, page;
const errors = [], checks = [];
const failText = '这句话用于模拟一次中断。';
try {
  await cp(path.join(root, 'backend'), path.join(fixture.appDir, 'backend'), { recursive: true, filter: file => !file.includes('__pycache__') });
  await symlink(path.join(installed, 'models'), path.join(fixture.data, 'models'), 'dir');
  const worker = path.join(fixture.appDir, 'backend/worker.py');
  const publicKey = await readFile(path.join(fixture.appDir, 'shared/license-public.pem'), 'utf8');
  let source = (await readFile(worker, 'utf8')).replace(/PUBLIC_KEY_PEM = b"""[\s\S]*?"""/, `PUBLIC_KEY_PEM = b"""${publicKey}"""`);
  const boundary = '    def _synthesize_with_fallback(self, text, speaker, instruction, options=None):\n';
  assert.ok(source.includes(boundary));
  // Only the disposable copy injects one pre-inference failure. Every successful
  // synthesis still runs the real model; no failpoint ships in the product.
  source = source.replace(boundary, boundary + `        trace = {"text": text, "mode": (options or {}).get("mode"), "reference": (options or {}).get("refPath")}
        with (self.root / "voice-trace.jsonl").open("a") as log:
            log.write(json.dumps(trace, ensure_ascii=False) + "\\n")
        marker = self.root / "fail-next-line"
        if text == ${JSON.stringify(failText)} and marker.exists():
            marker.unlink()
            raise RuntimeError("isolated test: interrupted line")
`);
  await writeFile(worker, source);
  async function launch() {
    app = await electron.launch({ args: [fixture.appDir], env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: interpreter } });
    page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  }
  async function jobs() { return page.evaluate(() => studio.invoke('jobs-list')); }
  async function task(run, expected = 'complete') {
    const before = (await jobs()).jobs.length; await run();
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      const snapshot = (await jobs()).jobs;
      if (snapshot.length > before) {
        const job = snapshot.at(-1);
        if (job.status === expected) return job;
        if (['failed', 'partial', 'cancelled', 'interrupted', 'complete'].includes(job.status)) throw new Error(JSON.stringify(job));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Real model task timed out');
  }
  function sameVoice(items, expected) {
    assert.ok(items.length); const anchor = expected || items[0].voiceAnchorId;
    assert.match(anchor, /^[a-f0-9]{64}$/);
    assert.ok(items.every(item => item.voiceAnchorId === anchor && item.options.voiceAnchorId === anchor && item.synthesisMode === 'clone'));
    return anchor;
  }
  async function merged(name, items) {
    const clips = await Promise.all(items.map(async item => ({ text: item.text, bytes: await readFile(path.join(fixture.data, 'outputs', item.id, item.wav)) })));
    await writeFile(path.join(artifacts, name + '.wav'), Media.merge(clips, 400).bytes);
  }
  await launch();
  await page.locator('[data-view="editor"]').click();
  await page.locator('#open-templates').click(); await page.locator('[data-template="relaxation"] .button').click();
  await page.locator('#text').fill('今天，我们一起慢慢说话。\n' + failText + '\n让这个声音陪你继续向前。');
  await writeFile(path.join(fixture.data, 'fail-next-line'), 'once');
  const partial = await task(() => page.locator('#generate').click(), 'failed');
  await writeFile(path.join(artifacts, 'quick-partial.json'), JSON.stringify(partial, null, 2));
  assert.equal(partial.completed, 1, JSON.stringify(partial)); const quickAnchor = sameVoice(partial.items);
  const resumed = await task(() => page.getByRole('button', { name: '继续未完成段落', exact: true }).click());
  assert.equal(resumed.total, 2); sameVoice(resumed.items, quickAnchor);
  const redo = await task(() => page.locator(`[data-clip-id="${partial.items[0].id}"]`).getByRole('button', { name: '重做', exact: true }).click());
  sameVoice(redo.items, quickAnchor);
  const quickScope = await page.evaluate(() => settings().voiceScopeId);
  await app.close(); app = null; await launch(); await page.locator('[data-view="editor"]').click();
  assert.equal(await page.evaluate(() => settings().voiceScopeId), quickScope);
  await page.locator('#text').fill('重新打开以后，还是同一个人物声音。'); await page.locator('#batch').uncheck();
  const reopened = await task(() => page.locator('#generate').click()); sameVoice(reopened.items, quickAnchor);
  checks.push({ feature: 'quick', anchor: quickAnchor, clips: [...partial.items, ...resumed.items, ...redo.items, ...reopened.items].map(item => item.id), failureResume: true, restart: true });
  await merged('quick-continued', [...partial.items, ...resumed.items]);
  await page.screenshot({ path: path.join(artifacts, 'quick.png') });

  for (const type of ['comic', 'buttons', 'family', 'variants']) {
    const doc = Lab.create(type); doc.name = '真实定声验证 ' + type;
    if (type === 'variants') { doc.voiceKeys = ['design:meditation-female']; doc.emotions = ['natural', 'gentle']; doc.text = '今天，让我们分享一个温暖的小故事。'; }
    else if (type === 'family') { doc.voiceKey = 'design:meditation-female'; doc.story = '{{name}}喜欢{{interest}}。\n今天，星星带来了一个好消息。'; }
    else {
      doc.roles.forEach(role => role.voiceKey = 'design:meditation-female');
      doc.lines = [
        { ...doc.lines[0], roleId: doc.roles[0].id, text: '你听见了吗？故事就要开始了。' },
        { ...doc.lines[1], roleId: doc.roles[0].id, text: '别着急，我们一起慢慢说。' }
      ];
    }
    await page.evaluate(doc => studio.invoke('lab-save', doc), doc);
    await page.locator('[data-view="laboratory"]').click();
    await page.locator('#lab-recent .lab-recent-card').filter({ hasText: doc.name }).click();
    const result = await task(() => page.locator('#lab-generate').click());
    const anchors = type === 'variants' ? result.items.map(item => sameVoice([item])) : [sameVoice(result.items)];
    if (type === 'variants') assert.notEqual(anchors[0], anchors[1]);
    const again = await task(() => page.locator('#lab-results').getByRole('button', { name: '重做', exact: true }).first().click());
    sameVoice(again.items, anchors[0]);
    checks.push({ feature: 'lab:' + type, anchors, clips: [...result.items, ...again.items].map(item => item.id) });
    await merged('lab-' + type, result.items);
    if (type === 'comic') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1120, height: 740 }));
      await page.waitForFunction(() => innerWidth <= 1120);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(artifacts, 'lab-designed-role.png'), fullPage: true });
    }
    await page.locator('#lab-back').click();
    console.log('Passed real Electron models: ' + type);
  }
  await app.close(); app = null;
  const launcher = `require(${JSON.stringify(path.join(root, 'cli/studio.cjs'))}).run(JSON.parse(process.argv[1]), {resourceDir:process.argv[2],trustedPublicKey:require('node:fs').readFileSync(require('node:path').join(process.argv[2],'shared/license-public.pem'),'utf8')}).then(code=>process.exitCode=code)`;
  async function cli(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', launcher, JSON.stringify(['--data-dir', fixture.data, '--quiet', ...args]), fixture.appDir], { env: { ...process.env, VOICE_STUDIO_PYTHON: interpreter } });
      let stdout = '', stderr = ''; child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
      child.on('error', reject); child.on('close', code => { try { resolve({ code, result: JSON.parse(stdout), stderr }); } catch { reject(new Error(stdout + stderr)); } }); child.stdin.end();
    });
  }
  const identity = ['--mode', 'design', '--character', 'meditation-female', '--voice-scope-id', 'real-cli', '--voice-id', 'narrator'];
  await writeFile(path.join(fixture.data, 'fail-next-line'), 'once');
  const failed = await cli(['generate', ...identity, '--batch', '--text', '命令行的第一句配音。\n' + failText]);
  assert.equal(failed.code, 1, JSON.stringify(failed));
  const saved = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8')).find(item => item.options.voiceScopeId === 'real-cli');
  const continued = await cli(['generate', ...identity, '--text', failText]);
  assert.equal(continued.code, 0, JSON.stringify(continued)); sameVoice(continued.result.result.items, saved.voiceAnchorId);
  const redone = await cli(['generate', ...identity, '--voice-anchor-id', saved.voiceAnchorId, '--text', '命令行重做仍然使用原来的声音。']);
  assert.equal(redone.code, 0, JSON.stringify(redone)); sameVoice(redone.result.result.items, saved.voiceAnchorId);
  checks.push({ feature: 'cli', anchor: saved.voiceAnchorId, failureResume: true, processRestart: true, clips: [saved.id, ...continued.result.result.items.map(item => item.id), ...redone.result.result.items.map(item => item.id)] });
  await merged('cli-continued', [saved, ...continued.result.result.items]);
  const all = JSON.parse(await readFile(path.join(fixture.data, 'history.json'), 'utf8'));
  for (const item of all) {
    const pcm = Media.pcm(await readFile(path.join(fixture.data, 'outputs', item.id, item.wav)));
    assert.ok(pcm.duration > .3); assert.ok(pcm.samples.some(value => value));
    assert.ok((await readFile(path.join(fixture.data, 'outputs', item.id, item.mp3))).length > 1000);
  }
  assert.deepEqual(errors, []);
  const trace = (await readFile(path.join(fixture.data, 'voice-trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const anchors = (await readdir(path.join(fixture.data, 'voice-anchors'))).filter(file => file.endsWith('.json'));
  assert.equal(trace.filter(call => call.mode === 'design').length, anchors.length, 'failures and redo never redesign any chosen voice');
  await cp(path.join(fixture.data, 'outputs'), path.join(artifacts, 'outputs'), { recursive: true });
  await cp(path.join(fixture.data, 'voice-anchors'), path.join(artifacts, 'voice-anchors'), { recursive: true });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ checks, clips: all.length, samples: anchors.length, trace, errors, scope: 'Real local models on this Mac; inference failure is injected only in a disposable worker copy.' }, null, 2));
  console.log(`Passed: ${all.length} real clips, ${anchors.length} persistent voice samples; quick creation, all four labs, CLI, redo, failure continuation and restart. Artifacts: ${artifacts}`);
} finally {
  if (app) await app.close();
  try { await cp(path.join(fixture.data, 'studio.log'), path.join(artifacts, 'studio.log')); } catch {}
  await fixture.cleanup();
}
