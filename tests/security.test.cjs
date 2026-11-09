const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createStudio } = require('../desktop/service.cjs');
const { machineCode, licenseMessage } = require('../desktop/license.cjs');
const { childEnvironment, verifyTool } = require('../desktop/integrity.cjs');
const trustedKey = require('../desktop/trust-anchor.cjs');
const project = path.join(__dirname, '..');

test('free edition does not read or write activation or device identity', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-free-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const studio = createStudio({ dataDir: folder }); t.after(() => studio.close());
  assert.equal(studio.licensing.status().activationRequired, false);
  assert.equal(studio.licensing.machine, '');
  assert.equal((await studio.invoke('activate', { code: 'legacy' })).edition, '免费版');
  assert.equal(fs.existsSync(path.join(folder, 'license.txt')), false);
  assert.equal(fs.existsSync(path.join(folder, 'installation-id')), false);
});

test('Node and independent isolated Python verify the same device and SY2 signature', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-interop-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const keys = crypto.generateKeyPairSync('ed25519'), machine = machineCode(folder);
  const code = 'SY2.' + crypto.sign(null, licenseMessage(machine), keys.privateKey).toString('base64url');
  fs.writeFileSync(path.join(folder, 'license.txt'), code);
  const localPython = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
  const script = `import importlib.util,json,sys\nv=json.load(sys.stdin)\ns=importlib.util.spec_from_file_location('worker',v['worker']); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nassert m.machine_code(v['root']) == v['machine']\nm.ACTIVATION_REQUIRED=True; m.PUBLIC_KEY_PEM=v['publicKey'].encode(); m.require_license(v['root']); print('verified')`;
  const result = spawnSync(python, ['-I', '-c', script], { encoding: 'utf8', input: JSON.stringify({ worker: path.join(project, 'backend/worker.py'), root: folder, machine, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }) });
  assert.equal(result.status, 0, result.error?.message || result.stderr); assert.equal(result.stdout.trim(), 'verified');
  assert.equal(trustedKey, fs.readFileSync(path.join(project, 'shared/license-public.pem'), 'utf8'));
  assert.ok(fs.readFileSync(path.join(project, 'backend/worker.py'), 'utf8').includes(trustedKey.trim()));
});

test('release subprocess environment strips loader and interpreter injection', () => {
  const names = ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'NODE_OPTIONS', 'UV_INDEX_URL', 'PIP_CONFIG_FILE', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'VOICE_STUDIO_PYTHON'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = '/malicious';
    const release = childEnvironment({ PYTHONUNBUFFERED: '1' }, true);
    for (const name of names) assert.equal(release[name], undefined, name);
    assert.equal(release.PYTHONUNBUFFERED, '1');
    assert.equal(childEnvironment({}, false).VOICE_STUDIO_PYTHON, '/malicious');
  } finally {
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
});

test('a replaced environment installer is rejected before execution', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-tool-attack-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'uv'); fs.writeFileSync(file, 'replaced executable');
  assert.throws(() => verifyTool(file, 'mac-arm64/uv'), { code: 'INTEGRITY_ERROR' });
});

test('all bundled platform installers match their pinned release hashes', () => {
  const problems = [];
  for (const target of ['mac-arm64/uv', 'mac-x64/uv', 'win-x64/uv.exe']) {
    const file = path.join(project, 'resources/uv', target);
    try { assert.equal(verifyTool(file, target), file); }
    catch (error) { problems.push(`${target}: ${error.code || error.message}`); }
  }
  assert.deepEqual(problems, [], 'Bundled installer verification failed. Prepare the genuine resources with npm run resources.');
});

test('post-sign installer validation accepts original installers and rejects changed app resources', t => {
  const { verifyBundledInstallers } = require('../scripts/after-sign.cjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-signed-tools-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const resources = path.join(folder, '声悦.app/Contents/Resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.symlinkSync(path.join(project, 'resources/uv'), path.join(resources, 'uv'), 'dir');
  verifyBundledInstallers(resources);
  fs.unlinkSync(path.join(resources, 'uv'));
  fs.mkdirSync(path.join(resources, 'uv/mac-arm64'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'uv/mac-arm64/uv'), 'changed during signing');
  assert.throws(() => verifyBundledInstallers(resources), { code: 'INTEGRITY_ERROR' });
});

test('post-sign microphone gate rejects missing entitlements in either app or helper', { skip: process.platform !== 'darwin' }, t => {
  const { execFileSync } = require('node:child_process');
  const { verifyMicrophoneEntitlements } = require('../scripts/after-sign.cjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-signed-microphone-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const app = path.join(folder, 'Voice.app'), helper = path.join(app, 'Contents/Frameworks/Voice Helper.app');
  for (const [bundle, name, id] of [[app, 'Voice', 'test.voice'], [helper, 'Voice Helper', 'test.voice.helper']]) {
    fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
    fs.copyFileSync('/usr/bin/true', path.join(bundle, 'Contents/MacOS', name));
    fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  }
  const missing = path.join(folder, 'missing.plist'), allowed = path.join(project, 'resources/entitlements.mac.plist');
  fs.writeFileSync(missing, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  const sign = (bundle, entitlements) => execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, bundle], { stdio: 'pipe' });
  sign(helper, allowed); sign(app, missing);
  assert.throws(() => verifyMicrophoneEntitlements(app), /Missing signed microphone entitlement: .*Voice\.app$/);
  sign(helper, missing); sign(app, allowed);
  assert.throws(() => verifyMicrophoneEntitlements(app), /Missing signed microphone entitlement: .*Voice Helper\.app$/);
  sign(helper, allowed); sign(app, allowed);
  verifyMicrophoneEntitlements(app);
});
