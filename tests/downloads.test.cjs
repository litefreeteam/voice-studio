const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sources, pythonArchive, modelURL, withDownloadSources } = require('../desktop/downloads.cjs');
const { profileFor, probeNetwork } = require('../desktop/compatibility.cjs');
const manifest = require('../shared/model-manifest.json').repositories;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createStudio } = require('../desktop/service.cjs');
const { licenseMessage } = require('../desktop/license.cjs');

test('Python probes use the exact managed archive for all three platforms', () => {
  for (const [platform, arch, target] of [['darwin', 'arm64', 'aarch64-apple-darwin'], ['darwin', 'x64', 'x86_64-apple-darwin'], ['win32', 'x64', 'x86_64-pc-windows-msvc']]) {
    assert.equal(pythonArchive(profileFor(platform, arch)), `20260325/cpython-3.12.13%2B20260325-${target}-install_only_stripped.tar.gz`);
  }
});

test('dependency indexes switch as whole attempts and preserve the requested order', async () => {
  const attempts = [], events = [];
  const source = await withDownloadSources('packages', async source => {
    attempts.push(source.id);
    if (source.id !== 'pypi') throw new Error('missing wheel or connection failure');
  }, { progress: event => events.push(event) });
  assert.equal(source, 'pypi');
  assert.deepEqual(attempts, ['tsinghua', 'aliyun', 'pypi']);
  assert.match(events[1].message, /正在重新连接声悦定制资源/);
});

test('Python source fallback, exhausted sources and cancellation are distinct', async () => {
  const attempts = [];
  assert.equal(await withDownloadSources('python', async source => {
    attempts.push(source.id); if (source.id === 'npmmirror') throw new Error('offline');
  }), 'astral');
  assert.deepEqual(attempts, ['npmmirror', 'astral']);
  await assert.rejects(withDownloadSources('python', async () => { throw new Error('offline'); }), /声悦定制资源准备失败/);
  let cancelled = false, count = 0;
  await assert.rejects(withDownloadSources('packages', async () => { count++; cancelled = true; throw new Error('stopped'); }, { cancelled: () => cancelled }), /stopped/);
  assert.equal(count, 1);
});

test('permission and full disk errors stop immediately without switching sources', async () => {
  for (const error of [Object.assign(new Error('full'), { code: 'ENOSPC' }), Object.assign(new Error('install failure'), { detail: 'Permission denied' }),
    Object.assign(new Error('安装所需的资源文件无法读取'), { code: 'INSTALL_RESOURCE_MISSING' })]) {
    let attempts = 0;
    await assert.rejects(withDownloadSources('packages', async () => { attempts++; throw error; }), error);
    assert.equal(attempts, 1);
  }
});

test('preflight probes the same pinned domestic endpoints and stops after success', async t => {
  const previous = global.fetch, urls = [];
  global.fetch = async (url, options) => {
    urls.push(url); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Range, 'bytes=0-1023');
    return { ok: true, body: { cancel: async () => {} } };
  };
  t.after(() => { global.fetch = previous; });
  const checks = await probeNetwork(profileFor('darwin', 'arm64'));
  assert.equal(urls.length, 3);
  assert.deepEqual(checks.map(c => c.source), ['npmmirror', 'tsinghua', 'modelscope']);
  assert.ok(urls.some(url => url.includes('Revision=') && !url.includes('Revision=master')));
});

test('preflight reports a working backup when the domestic endpoint is unavailable', async t => {
  const previous = global.fetch;
  global.fetch = async url => ({ ok: url.startsWith(sources.python[1].url) || url.startsWith(sources.packages[1].url) || url.startsWith(sources.models[1].url), body: { cancel: async () => {} } });
  t.after(() => { global.fetch = previous; });
  const checks = await probeNetwork(profileFor('win32', 'x64'));
  assert.ok(checks.every(c => c.state === 'pass' && c.message.includes('重新连接成功')));
  assert.deepEqual(checks.map(c => c.source), ['astral', 'aliyun', 'hf-mirror']);
});

test('Node network probes and Python downloader use pinned model revisions', () => {
  for (const [repo, pinned] of Object.entries(manifest)) {
    for (const source of sources.models) {
      const url = modelURL(source, repo, pinned, 'config.json');
      assert.ok(url.startsWith('https://'));
      assert.ok(url.includes(source.id === 'modelscope' ? pinned.files['config.json'].modelscopeRevision : pinned.revision));
    }
  }
});

test('real service switches uv sources and reuses an interpreter after dependency failure', { skip: process.platform === 'win32' || !profileFor() }, async t => {
  const project = path.join(__dirname, '..');
  const localPython = path.join(project, '.venv/bin/python');
  const pythonCommand = process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : 'python3');
  const probe = spawnSync(pythonCommand, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
  const python = probe.stdout.trim();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-install-'));
  const dataDir = path.join(base, 'data'), profile = profileFor();
  fs.mkdirSync(path.join(base, 'backend'), { recursive: true });
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(base, 'backend', profile.requirements), 'fixture==1.0\n');
  fs.writeFileSync(path.join(dataDir, 'fail-packages'), '1');
  const uv = path.join(base, 'uv', profile.uv);
  fs.mkdirSync(path.dirname(uv), { recursive: true });
  fs.writeFileSync(uv, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),env=process.env,root=path.dirname(env.UV_PYTHON_INSTALL_DIR);
fs.appendFileSync(path.join(root,'attempts.jsonl'),JSON.stringify({args,mirror:env.UV_PYTHON_INSTALL_MIRROR,cache:env.UV_CACHE_DIR,pythonCache:env.UV_PYTHON_CACHE_DIR})+'\\n');
if(args[0]==='venv'){
  if(env.UV_PYTHON_INSTALL_MIRROR.includes('npmmirror'))process.exit(7);
  const target=args.at(-1);fs.mkdirSync(path.join(target,'bin'),{recursive:true});
  fs.symlinkSync(${JSON.stringify(python)},path.join(target,'bin/python'));
}else{
  const index=args[args.indexOf('--default-index')+1];
  if(index.includes('tsinghua')||fs.existsSync(path.join(root,'fail-packages')))process.exit(7);
}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(base, 'backend/worker.py'), `import json,sys,pathlib
for line in sys.stdin:
 q=json.loads(line)
 with (pathlib.Path(sys.argv[2])/'worker-calls.jsonl').open('a') as log: log.write(json.dumps(q)+'\\n')
 print(json.dumps({'type':'result','id':q['id'],'result':{'packages':[]}}),flush=True)
`);
  const previous = process.env.VOICE_STUDIO_PYTHON;
  delete process.env.VOICE_STUDIO_PYTHON;
  const keys = crypto.generateKeyPairSync('ed25519');
  const studio = createStudio({ dataDir, resourceDir: base, trustedPublicKey: keys.publicKey });
  t.after(async () => {
    await studio.close(); fs.rmSync(base, { recursive: true, force: true });
    if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous;
  });
  const code = 'SY2.' + crypto.sign(null, licenseMessage(studio.licensing.machine), keys.privateKey).toString('base64url');
  await studio.invoke('activate', { code });
  await assert.rejects(studio.invoke('setup', { package: 'light' }), /声悦定制资源准备失败/);
  assert.ok(fs.existsSync(path.join(dataDir, 'runtime/interpreter.json')));
  assert.equal(fs.existsSync(path.join(dataDir, 'runtime/ready.json')), false);
  fs.unlinkSync(path.join(dataDir, 'fail-packages'));
  await studio.invoke('setup', { package: 'light' });
  const downloads = fs.readFileSync(path.join(dataDir, 'worker-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.op === 'download');
  assert.deepEqual(downloads.map(call => call.data.package), ['light'], 'setup only downloads the selected package');
  const attempts = fs.readFileSync(path.join(dataDir, 'attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(attempts.filter(attempt => attempt.args[0] === 'venv').length, 2);
  assert.equal(attempts.length, 7);
  assert.ok(attempts[0].args.includes('cpython-3.12.13-macos-' + (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-none'));
  assert.ok(attempts.every(attempt => attempt.pythonCache === path.join(dataDir, 'cache/python-archives')));
  const ready = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime/ready.json'), 'utf8'));
  assert.deepEqual(ready.sources, { python: 'astral', packages: 'aliyun' });
});
