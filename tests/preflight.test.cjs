const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const compatibility = require('../desktop/compatibility.cjs');
const { profileFor, assess, packageSelection, probeNetwork, storageProbe } = compatibility;
const facts = { platform: 'darwin', arch: 'arm64', release: '23.0.0', memoryGB: 16, availableMemoryGB: 6, cpu: 'Apple M1' };

test('each supported architecture selects an isolated interpreter and dependency lock', () => {
  assert.equal(profileFor('darwin', 'arm64').requirements, 'requirements-mac.lock');
  assert.equal(profileFor('darwin', 'x64').requirements, 'requirements-intel.lock');
  assert.equal(profileFor('win32', 'x64').requirements, 'requirements-win.lock');
  for (const [platform, arch] of [['win32', 'arm64'], ['linux', 'x64'], ['darwin', 'ia32'], ['ohos', 'arm64']]) assert.equal(profileFor(platform, arch), null);
  assert.throws(() => packageSelection({ packages: ['light', '../generate'] }));
});
test('old OS, ARM emulation, insufficient RAM, full disk and denied writes cannot qualify', () => {
  const ok = { freeDiskGB: 50, packages: ['light'], writable: true };
  assert.equal(assess(facts, ok).blocked, false);
  for (const f of [{ ...facts, release: '22.6.0' }, { ...facts, memoryGB: 4 }, { ...facts, arch: 'x64', translated: true },
    { ...facts, platform: 'win32', arch: 'x64', nativeArm: true, release: '10.0.26100' }, { ...facts, platform: 'win32', release: '6.3.9600' }]) assert.equal(assess(f, ok).blocked, true);
  for (const extra of [{ freeDiskGB: 1 }, { freeDiskGB: null }, { writable: false }]) assert.equal(assess(facts, { ...ok, ...extra }).blocked, true);
  assert.equal(assess({ ...facts, memoryGB: 8 }, ok).blocked, false);
  assert.equal(assess({ ...facts, memoryGB: 8 }, { ...ok, packages: ['character'] }).blocked, true);
  assert.equal(assess({ ...facts, arch: 'x64', nativeArm: false }, ok).blocked, false);
});

function fixture(t, { hostFacts = facts, runtime = false, disk = 100, writable = true, network } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-preflight-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const filename = require.resolve('../desktop/preflight.cjs');
  const localRequire = createRequire(filename), controllerModule = { exports: {} }, calls = [], events = [];
  const testCompatibility = { ...compatibility,
    machineFacts: () => ({ ...hostFacts }),
    storageProbe: dir => ({ ...storageProbe(dir), freeDiskGB: disk, writable }),
    probeNetwork: async (profile, signal) => {
      calls.push(['network', profile.id]);
      return network ? network(profile, signal) : [{ id: 'network-models', state: 'pass', message: 'fixture connection' }];
    } };
  vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module', 'exports'], { filename })(
    name => name === './compatibility.cjs' ? testCompatibility : localRequire(name),
    controllerModule, controllerModule.exports);
  const controller = controllerModule.exports.createPreflight({ dataDir, assetDir: () => dataDir,
    machine: 'SYD1-' + 'A'.repeat(32), runtimeReady: () => runtime, progress: event => events.push(event),
    setup: () => { calls.push(['setup']); throw new Error('Detection must never install resources'); },
    request: () => { calls.push(['worker']); throw new Error('Detection must never start a speech worker'); },
    close: () => { calls.push(['close']); }, cancel: () => { calls.push(['cancel-worker']); } });
  function model(key, size = 7) {
    const folder = path.join(dataDir, 'models', { character: 'voice-character', reference: 'voice-reference', light: 'voice-light' }[key]);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'weights'), 'fixture');
    fs.writeFileSync(path.join(folder, '.complete.json'), JSON.stringify({ files: { weights: size } }));
  }
  return { controller, dataDir, calls, events, model };
}
test('supported platform configuration qualifies without installed runtime, models or generated audio', async t => {
  for (const hostFacts of [facts, { ...facts, arch: 'x64', cpu: 'Intel' },
    { ...facts, platform: 'win32', arch: 'x64', release: '10.0.26100', cpu: 'Intel' }]) {
    const f = fixture(t, { hostFacts });
    const report = await f.controller.prepare({ packages: ['light', 'standard', 'character', 'reference'] });
    assert.equal(report.profile, profileFor(hostFacts.platform, hostFacts.arch).id);
    assert.equal(report.schema, 'shengyue-compatibility-2');
    assert.equal(report.scope, 'environment');
    assert.equal(report.ready, true);
    assert.equal(report.blocked, false);
    assert.ok(report.results.every(result => result.passed && !result.resourceReady && result.duration === undefined));
    assert.equal(report.checks.find(check => check.id === 'runtime').state, 'warn');
    assert.equal(report.heard, undefined);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(fs.readdirSync(f.dataDir), ['compatibility-report.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'compatibility-report.json'))), report);
  }
});
test('configuration failures stay visible without starting downloads or inference', async t => {
  for (const options of [{ hostFacts: { ...facts, platform: 'linux', arch: 'x64' } },
    { hostFacts: { ...facts, memoryGB: 4 } }, { disk: 1 }, { writable: false }]) {
    const f = fixture(t, options);
    const report = await f.controller.prepare({ packages: ['light'], network: true });
    assert.equal(report.ready, false);
    assert.equal(report.blocked, true);
    assert.ok(report.checks.some(check => check.state === 'fail'));
    assert.deepEqual(f.calls, []);
  }
});
test('resource status is informational, checks both character dependencies and updates without synthesis', async t => {
  const f = fixture(t, { runtime: true });
  f.model('character');
  const initial = await f.controller.inspect({ packages: ['character'] });
  assert.deepEqual(initial.packages, ['character', 'reference']);
  assert.equal(initial.results[0].resourceReady, false);
  assert.equal(initial.requiredDiskGB, 13);
  assert.equal(initial.ready, true);
  f.model('reference');
  const complete = await f.controller.prepare({ packages: ['character'] });
  assert.ok(complete.results.every(result => result.resourceReady));
  assert.equal(complete.checks.find(check => check.id === 'runtime').state, 'pass');
  fs.unlinkSync(path.join(f.dataDir, 'models/voice-reference/weights'));
  const missing = await f.controller.inspect({ packages: ['character'] });
  assert.equal(missing.results[0].resourceReady, false);
  assert.equal(missing.ready, true);
  assert.deepEqual(f.calls, []);
});
test('old trial reports are ignored and actual configuration is always checked afresh', async t => {
  const f = fixture(t, { hostFacts: { ...facts, memoryGB: 4 } });
  fs.writeFileSync(path.join(f.dataDir, 'history.json'), '[{"id":"preserve"}]');
  fs.writeFileSync(path.join(f.dataDir, 'compatibility-report.json'), JSON.stringify({
    schema: 'shengyue-compatibility-1', ready: true, heard: true,
    results: [{ package: 'light', passed: true, duration: 5, elapsed: 2 }]
  }));
  const report = await f.controller.prepare({ packages: ['light'] });
  assert.equal(report.ready, false);
  assert.equal(report.scope, 'environment');
  assert.equal(report.results[0].duration, undefined);
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'history.json'), 'utf8'), '[{"id":"preserve"}]');
  assert.deepEqual(f.calls, []);
});
test('optional microphone checking only affects its own report result', async t => {
  const f = fixture(t);
  assert.equal((await f.controller.inspect()).ready, true);
  assert.equal((await f.controller.inspect({ microphoneRequired: true })).ready, false);
  assert.equal((await f.controller.microphoneResult({ passed: true, microphoneRequired: true })).ready, true);
  assert.equal((await f.controller.microphoneResult({ passed: false, microphoneRequired: true })).ready, false);
  assert.equal((await f.controller.inspect()).ready, true);
  assert.deepEqual(f.calls, []);
});
test('network checks are explicit and cancellation never cancels a speech worker', async t => {
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { network: async (_profile, signal) => {
    started();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return [];
  } });
  await f.controller.inspect();
  assert.deepEqual(f.calls, []);
  const checking = f.controller.prepare({ packages: ['light'], network: true });
  await pending;
  await assert.rejects(f.controller.prepare(), /正在检测/);
  f.controller.cancel();
  await assert.rejects(checking, /取消/);
  assert.deepEqual(f.calls, [['network', 'mac-arm64']]);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'compatibility-report.json')), false);
  assert.equal((await f.controller.prepare()).ready, true);
});
test('progress only describes configuration checks, never resource preparation or audio generation', async t => {
  const f = fixture(t), packages = ['light', 'standard', 'character', 'reference'];
  await f.controller.prepare({ packages });
  const completed = f.events.filter(event => event.preflightPhase === 'complete');
  assert.deepEqual(completed.map(event => [event.package, event.completedPackages, event.packageCount]), packages.map((key, index) => [key, index + 1, 4]));
  assert.ok(f.events.every(event => ['check', 'complete'].includes(event.preflightPhase)));
  assert.deepEqual(f.calls, []);
});
test('network failure stays distinct from inference; probes use only fixed public sources', async t => {
  const previous = global.fetch, urls = [];
  global.fetch = async url => { urls.push(url); throw new Error('offline'); };
  t.after(() => { global.fetch = previous; });
  const checks = await probeNetwork(profileFor('win32', 'x64'));
  assert.equal(checks.length, 3);
  assert.ok(checks.every(c => c.state === 'warn'));
  assert.ok(urls.every(url => url.startsWith('https://')));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-storage-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  assert.equal(storageProbe(folder).writable, true);
  assert.deepEqual(fs.readdirSync(folder), []);
});
