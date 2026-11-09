const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { licenseMessage } = require('../desktop/license.cjs');
const compatibility = require('../desktop/compatibility.cjs');
const project = path.join(__dirname, '..');
const localPython = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonCommand = process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
const python = cp.spawnSync(pythonCommand, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout?.trim();
assert.ok(python, 'Service protocol integration tests require Python 3');

function loadModule(relative, replacements = {}) {
  const filename = path.join(project, relative), localRequire = createRequire(filename);
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), process, Buffer, console, setTimeout, clearTimeout, AbortController,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return sandbox.module.exports;
}

const worker = `import sys, json, os, time
for line in sys.stdin:
    request = json.loads(line)
    data = request.get('data', {})
    if data.get('delay'):
        time.sleep(data['delay'])
    if data.get('wait'):
        print(json.dumps({'type':'progress','stage':'waiting','message':'中文等待 🎙️'}, ensure_ascii=False), flush=True)
        time.sleep(60)
    result = {'pid':os.getpid(), 'op':request['op'], 'data':data, 'stdin':sys.stdin.encoding, 'stdout':sys.stdout.encoding,
              'utf8':sys.flags.utf8_mode, 'isolated':sys.flags.isolated, 'unbuffered':getattr(sys.stdout, 'write_through', False), 'argv':sys.argv}
    message = json.dumps({'type':'result','id':request['id'],'result':result}, ensure_ascii=False) + '\\n'
    # Write one byte at a time to exercise UTF-8 sequences split across pipe chunks.
    for byte in message.encode('utf-8'):
        os.write(sys.stdout.fileno(), bytes([byte]))
`;

function serviceFixture(t, { onProgress = () => {}, workerIdleMs = 60000 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue 服务 🎙️-'));
  const dataDir = path.join(base, '数据目录'), children = [], spawns = [], studios = [];
  fs.mkdirSync(path.join(base, 'backend')); fs.mkdirSync(path.join(base, 'shared'));
  fs.writeFileSync(path.join(base, 'backend/worker.py'), worker);
  fs.writeFileSync(path.join(base, 'shared/catalog.json'), JSON.stringify({ fixture: true }));
  const keys = crypto.generateKeyPairSync('ed25519');
  const { createStudio } = loadModule('desktop/service.cjs', {
    'node:child_process': { ...cp, spawn(...args) { const child = cp.spawn(...args); spawns.push(args); children.push(child); return child; } }
  });
  function create() {
    const previous = process.env.VOICE_STUDIO_PYTHON;
    process.env.VOICE_STUDIO_PYTHON = python;
    let studio;
    try { studio = createStudio({ dataDir, resourceDir: base, trustedPublicKey: keys.publicKey, onProgress, workerIdleMs }); }
    finally { if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous; }
    studio.licensing.activate('SY2.' + crypto.sign(null, licenseMessage(studio.licensing.machine), keys.privateKey).toString('base64url'));
    studios.push(studio);
    return studio;
  }
  const studio = create();
  t.after(async () => { await Promise.all(studios.map(s => s.close())); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, dataDir, studio, create, children, spawns, lock: path.join(dataDir, '.operation.lock') };
}

test('idle workers release their models despite status polling and restart on demand', async t => {
  const f = serviceFixture(t, { workerIdleMs: 80 });
  const first = await f.studio.invoke('generate', { text: 'first' });
  const child = f.children[0], deadline = Date.now() + 3000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
    await f.studio.invoke('status');
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'status polling must not retain the loaded model');
  const next = await f.studio.invoke('generate', { text: 'after idle' });
  assert.notEqual(next.pid, first.pid);
});

test('an idle deadline cannot interrupt an active request and adjacent requests reuse the model', async t => {
  const f = serviceFixture(t, { workerIdleMs: 80 });
  const first = await f.studio.invoke('generate', { text: 'first' });
  const slow = await f.studio.invoke('generate', { text: 'in flight', delay: .25 });
  assert.equal(slow.pid, first.pid);
  assert.equal((await f.studio.invoke('generate', { text: 'next' })).pid, first.pid);
});

test('a worker exiting before its idle deadline can restart without a stale timer crash', async t => {
  const f = serviceFixture(t, { workerIdleMs: 40 });
  const first = await f.studio.invoke('generate', { text: 'first' });
  f.children[0].kill('SIGTERM');
  await f.children[0].closed;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.notEqual((await f.studio.invoke('generate', { text: 'restart' })).pid, first.pid);
});

for (const partial of [false, true]) test(`lock owner creation failure rolls back ${partial ? 'partially created owner' : 'empty directory'} and permits retry`, async t => {
  const f = serviceFixture(t), write = fs.writeFileSync;
  try {
    fs.writeFileSync = (file, ...args) => {
      if (path.dirname(String(file)) === f.lock) {
        if (partial) write(file, ...args);
        throw Object.assign(new Error('Injected full disk during owner creation'), { code: 'ENOSPC' });
      }
      return write(file, ...args);
    };
    await assert.rejects(f.studio.invoke('catalog'), { code: 'ENOSPC' });
  } finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal((await f.studio.invoke('catalog')).fixture, true);
  assert.equal((await f.create().invoke('catalog')).fixture, true, 'a later caller also recovers without manual deletion');
});

test('failed lock rollback never recursively deletes an independently established owner', async t => {
  const f = serviceFixture(t), write = fs.writeFileSync, other = `${process.pid}-other-owner`;
  try {
    fs.writeFileSync = (file, ...args) => {
      if (path.dirname(String(file)) === f.lock) {
        write(path.join(f.lock, other), '');
        throw Object.assign(new Error('Injected lock write failure'), { code: 'ENOSPC' });
      }
      return write(file, ...args);
    };
    await assert.rejects(f.studio.invoke('catalog'), { code: 'ENOSPC' });
  } finally { fs.writeFileSync = write; }
  assert.deepEqual(fs.readdirSync(f.lock), [other]);
  await assert.rejects(f.studio.invoke('catalog'), { code: 'BUSY' });
});

test('unknown empty locks and live owners are never reclaimed as stale', async t => {
  const f = serviceFixture(t);
  fs.mkdirSync(f.lock);
  fs.utimesSync(f.lock, new Date(0), new Date(0));
  await assert.rejects(f.studio.invoke('catalog'), { code: 'BUSY' });
  assert.equal(fs.existsSync(f.lock), true);
  fs.writeFileSync(path.join(f.lock, `${process.pid}-live`), '');
  await assert.rejects(f.studio.invoke('catalog'), { code: 'BUSY' });
  assert.deepEqual(fs.readdirSync(f.lock), [`${process.pid}-live`]);
});

test('stale owner recovery tolerates a new owner winning the directory race', async t => {
  const f = serviceFixture(t), unlink = fs.unlinkSync;
  fs.mkdirSync(f.lock);
  const stale = path.join(f.lock, '2147483647-stale'), contender = path.join(f.lock, `${process.pid}-contender`);
  fs.writeFileSync(stale, '');
  try {
    fs.unlinkSync = file => {
      unlink(file);
      if (file === stale) fs.writeFileSync(contender, '');
    };
    await assert.rejects(f.studio.invoke('catalog'), { code: 'BUSY' });
  } finally { fs.unlinkSync = unlink; }
  assert.deepEqual(fs.readdirSync(f.lock), [path.basename(contender)]);
  fs.unlinkSync(contender); fs.rmdirSync(f.lock);
  assert.equal((await f.studio.invoke('catalog')).fixture, true);
});

test('failed worker owner registration terminates the child before releasing its lock', async t => {
  const f = serviceFixture(t), write = fs.writeFileSync;
  let failed = false;
  try {
    fs.writeFileSync = (file, ...args) => {
      if (path.dirname(String(file)) === f.lock && !path.basename(String(file)).startsWith(`${process.pid}-`)) {
        write(file, ...args); failed = true;
        throw Object.assign(new Error('Injected disk full registering child'), { code: 'ENOSPC' });
      }
      return write(file, ...args);
    };
    await assert.rejects(f.studio.invoke('generate', { text: '注册失败' }), { code: 'ENOSPC' });
  } finally { fs.writeFileSync = write; }
  assert.equal(failed, true);
  assert.ok(f.children[0].exitCode !== null || f.children[0].signalCode !== null, 'child has closed before invocation rejects');
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal((await f.studio.invoke('generate', { text: '恢复 🎉' })).data.text, '恢复 🎉');
});

test('failed re-registration of an idle worker rolls back all new owners and remains retryable', async t => {
  const f = serviceFixture(t), write = fs.writeFileSync;
  const first = await f.studio.invoke('generate', { text: 'initial' });
  try {
    fs.writeFileSync = (file, ...args) => {
      if (path.dirname(String(file)) === f.lock && path.basename(String(file)).startsWith(`${first.pid}-`)) {
        write(file, ...args);
        throw Object.assign(new Error('Injected owner re-registration failure'), { code: 'ENOSPC' });
      }
      return write(file, ...args);
    };
    await assert.rejects(f.studio.invoke('generate', { text: 'blocked' }), { code: 'ENOSPC' });
  } finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal((await f.studio.invoke('generate', { text: 'recovered' })).data.text, 'recovered');
});

test('isolated Python IPC explicitly uses UTF-8 and preserves multilingual text, emoji and paths', async t => {
  const f = serviceFixture(t), previous = Object.fromEntries(['PYTHONUTF8', 'PYTHONIOENCODING', 'PYTHONUNBUFFERED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { PYTHONUTF8: '0', PYTHONIOENCODING: 'cp1252', PYTHONUNBUFFERED: '0' });
  try {
    const text = '中文路径与对白 🎙️ 日本語 한국어 café 🧑🏽‍🚀';
    const result = await f.studio.invoke('generate', { text });
    assert.equal(result.data.text, text);
    assert.equal(result.stdin.toLowerCase(), 'utf-8'); assert.equal(result.stdout.toLowerCase(), 'utf-8');
    assert.equal(result.utf8, 1); assert.equal(result.isolated, 1); assert.equal(result.unbuffered, true);
    assert.ok(result.argv.includes(f.dataDir));
    assert.deepEqual(Array.from(f.spawns[0][1].slice(0, 4)), ['-I', '-X', 'utf8', '-u']);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('competing service cannot operate while another child runs and cancellation permits retry', { timeout: 10000 }, async t => {
  let signal;
  const started = new Promise(resolve => { signal = resolve; });
  const f = serviceFixture(t, { onProgress: event => { if (event.stage === 'waiting') signal(); } });
  const second = f.create();
  const running = f.studio.invoke('generate', { text: 'first', wait: true });
  const stopped = assert.rejects(running, { code: 'CANCELLED' });
  await started;
  await assert.rejects(second.invoke('generate', { text: 'contender' }), { code: 'BUSY' });
  f.studio.cancel(); await stopped;
  assert.equal((await second.invoke('generate', { text: 'after cancel' })).data.text, 'after cancel');
  assert.equal(fs.existsSync(f.lock), false);
});

function preflightFixture(t, { disk = 100 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-workflow-'));
  const calls = [], facts = { platform: 'darwin', arch: 'arm64', release: '23.0.0', memoryGB: 16, availableMemoryGB: 8, cpu: 'synthetic fixture' };
  const { createPreflight } = loadModule('desktop/preflight.cjs', { './compatibility.cjs': { ...compatibility,
    machineFacts: () => facts, storageProbe: () => ({ freeDiskGB: disk, writable: true }) } });
  const controller = createPreflight({ dataDir, assetDir: () => dataDir, machine: 'FIXTURE', runtimeReady: () => false,
    setup: async () => { calls.push('setup'); throw new Error('Unexpected setup'); },
    request: async () => { calls.push('worker'); throw new Error('Unexpected worker'); } });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { controller, dataDir, calls };
}

test('character configuration includes the reference disk budget without installing or running models', async t => {
  const f = preflightFixture(t);
  const inspected = await f.controller.prepare({ packages: ['character'] });
  assert.deepEqual(Array.from(inspected.packages), ['character', 'reference']);
  assert.equal(inspected.requiredDiskGB, 17);
  assert.equal(inspected.ready, true);
  assert.equal(inspected.scope, 'environment');
  assert.deepEqual(f.calls, []);
});

test('character disk failure is reported without any download or inference', async t => {
  const f = preflightFixture(t, { disk: 15 });
  const report = await f.controller.prepare({ packages: ['character'] });
  assert.equal(report.blocked, true);
  assert.equal(report.ready, false);
  assert.ok(report.checks.some(check => check.id === 'disk' && /预留 17 GB/.test(check.message)));
  assert.deepEqual(f.calls, []);
});

test('free service preflight never starts the worker or installs resources', async t => {
  const f = serviceFixture(t);
  fs.rmSync(path.join(f.dataDir, 'license.txt'), { force: true });
  for (const action of ['preflight', 'preflight-prepare']) {
    const report = await f.studio.invoke(action, { packages: ['light'] });
    assert.equal(report.scope, 'environment');
    assert.equal(report.results[0].duration, undefined);
    assert.equal(f.spawns.length, 0);
  }
  await f.studio.invoke('preflight-cancel');
  assert.equal((await f.studio.invoke('license')).activationRequired, false);
  assert.equal(f.spawns.length, 0);
});

test('Windows reports the supported CPU installer explicitly without claiming CUDA support', () => {
  assert.match(compatibility.profileFor('win32', 'x64').label, /CPU/);
  const result = compatibility.assess({ platform: 'win32', arch: 'x64', release: '10.0.26100', memoryGB: 16, availableMemoryGB: 8, cpu: 'fixture' }, { freeDiskGB: 100 });
  assert.equal(result.blocked, false);
  assert.ok(result.checks.some(check => check.id === 'cpu' && check.state === 'warn' && /不包含 CUDA/.test(check.message)));
});
