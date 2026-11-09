import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const PE = require('pe-library'), R = require('resedit');
const run = promisify(execFile), root = path.resolve(import.meta.dirname, '..');
const version = require('../package.json').version;
if (!require('../shared/edition.json').activationRequired) {
  await import('./test-release-free.mjs');
  process.exit(0);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-release-security-'));
const report = { version, date: new Date().toISOString().slice(0, 10), checks: [], limitations: [
  'Runtime attack reproduction runs on macOS ARM64. Windows and Intel Mac have archive, fuse and integrity-metadata checks; Windows native execution requires Windows.',
  'No Developer ID / Authenticode certificate is configured. Mac uses ad-hoc hardened-runtime signing with a library-validation exception; Windows is unsigned.',
  'These checks cover the identified bypasses. A user who controls the machine can still rewrite/re-sign binaries or reimplement the open model engine; this is not a guarantee against all offline cracking.'
] };
const record = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log('PASS:', name); };
const app = path.join(root, 'release/mac-arm64/声悦.app');
const originalResources = path.join(app, 'Contents/Resources');
const archive = path.join(originalResources, 'app.asar');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const data = path.join(scratch, 'data'); fs.mkdirSync(data);
const env = { ...process.env, VOICE_STUDIO_DATA: data };
delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE; delete env.VOICE_STUDIO_PYTHON;
const executable = path.join(app, 'Contents/MacOS/声悦');
let offlineSandbox = false;
async function cli(args, { file = executable, expected = 0, environment = env, offline = false } = {}) {
  const actualArgs = ['--cli', '--data-dir', data, ...args];
  let result;
  try {
    result = offline
      ? await run('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', file, ...actualArgs], { env: environment, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
      : await run(file, actualArgs, { env: environment, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(expected, 0);
  } catch (error) { assert.equal(error.code, expected, error.stderr || error.message); result = error; }
  return JSON.parse(result.stdout);
}
function rawRun(file, args = []) {
  return spawnSync(file, ['--cli', '--data-dir', data, ...args], { env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
}
async function clone(label) {
  const folder = path.join(scratch, label + '.app'); await run('/bin/cp', ['-cR', app, folder]);
  return { folder, resources: path.join(folder, 'Contents/Resources'), executable: path.join(folder, 'Contents/MacOS/声悦') };
}
try {
  const artifacts = [
    { name: 'mac-arm64', app, resources: originalResources },
    { name: 'mac-x64', app: path.join(root, 'release/mac/声悦.app'), resources: path.join(root, 'release/mac/声悦.app/Contents/Resources') },
    { name: 'win-x64', app: path.join(root, 'release/win-unpacked/声悦.exe'), resources: path.join(root, 'release/win-unpacked/resources') }
  ];
  for (const artifact of artifacts) {
    const file = path.join(artifact.resources, 'app.asar'), wire = await getCurrentFuseWire(artifact.app);
    for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) assert.equal(wire[FuseV1Options[name]], 48, name);
    for (const name of ['EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar']) assert.equal(wire[FuseV1Options[name]], 49, name);
    const names = asar.listPackage(file).map(name => name.replace(/^\//, ''));
    assert.ok(!names.some(name => /\.seller|signing-key|(?:^|\/)license\.txt|\.test-data|\.env(?:\.|$)/.test(name)));
    assert.equal(JSON.parse(asar.extractFile(file, 'package.json')).version, version);
    for (const name of ['desktop/license.cjs', 'desktop/service.cjs', 'desktop/preflight.cjs', 'desktop/compatibility.cjs', 'ui/preflight.js', 'desktop/trust-anchor.cjs', 'desktop/integrity.cjs', 'backend/worker.py', 'shared/catalog.json',
      'desktop/audio-operations.cjs', 'backend/audio_tools.py', 'backend/reference_tools.py', 'backend/delivery.py',
      'ui/audio-studio.js', 'ui/audio-studio.css', 'ui/reference-import.js', 'ui/project-workspace.js',
      'ui/projects.js', 'ui/lab-core.js', 'ui/laboratory.js', 'ui/app.js', 'ui/index.html',
      'shared/transcription-manifest.json', 'backend/requirements-mac.lock', 'backend/requirements-intel.lock', 'backend/requirements-win.lock']) {
      assert.ok(asar.extractFile(file, name).equals(fs.readFileSync(path.join(root, name))), name);
    }
    assert.ok(!fs.existsSync(path.join(artifact.resources, 'backend/worker.py')));
    assert.ok(!fs.existsSync(path.join(artifact.resources, 'shared/license-public.pem')));
    for (const name of names) if (asar.statFile(file, name).size) assert.doesNotMatch(asar.extractFile(file, name).toString(), /BEGIN (?:[A-Z]+ )?PRIVATE KEY/, name);
    const headerHash = hash(asar.getRawHeader(file).headerString);
    if (artifact.name.startsWith('mac')) {
      const { stdout } = await run('/usr/bin/plutil', ['-extract', 'ElectronAsarIntegrity', 'json', '-o', '-', path.join(artifact.app, 'Contents/Info.plist')]);
      assert.equal(JSON.parse(stdout)['Resources/app.asar'].hash, headerHash);
      assert.ok(fs.readFileSync(path.join(artifact.app, 'Contents/Frameworks/ShengyueArchiveGuard.dylib')).includes(Buffer.from(hash(fs.readFileSync(file)))));
      const dependencies = await run('/usr/bin/otool', ['-L', path.join(artifact.app, 'Contents/MacOS/声悦')]);
      assert.match(dependencies.stdout, /@rpath\/ShengyueArchiveGuard\.dylib/);
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', artifact.app]);
      const signed = await run('/usr/bin/codesign', ['-dvv', artifact.app]);
      assert.match(signed.stderr, /runtime/);
      require('./after-sign.cjs').verifyMicrophoneEntitlements(artifact.app);
      record(artifact.name + ': signed app and helpers permit microphone input');
    } else {
      const resources = PE.NtExecutableResource.from(PE.NtExecutable.from(fs.readFileSync(artifact.app))).entries;
      const entry = resources.find(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
      assert.ok(entry, 'Windows native ASAR integrity resource');
      assert.equal(JSON.parse(Buffer.from(entry.bin).toString())[0].value, headerHash);
      assert.equal(R.Resource.VersionInfo.fromEntries(resources)[0].getStringValues({ lang: 1033, codepage: 1200 }).ProductName, '声悦');
    }
    record(artifact.name + ': sealed code, pinned key, fuses, integrity metadata, no private keys');
    record(artifact.name + ': audio versions, reference import, quality checks, waveform and mixing match current source');
  }
  const initial = await cli(['license', 'status']); assert.equal(initial.result.activated, false);
  assert.equal((await cli(['generate', '--text', 'blocked'], { expected: 5 })).error.code, 'LICENSE_REQUIRED');
  record('Unactivated packaged CLI blocks generation');

  const substituted = await clone('key-substitution');
  fs.mkdirSync(path.join(substituted.resources, 'shared'));
  const attacker = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(substituted.resources, 'shared/license-public.pem'), attacker.publicKey.export({ type: 'spki', format: 'pem' }));
  const input = path.join(scratch, 'activation.json');
  const message = Buffer.from(`shengyue:offline:pro:perpetual:v2:${initial.result.machineCode}`);
  fs.writeFileSync(input, JSON.stringify({ code: 'SY2.' + crypto.sign(null, message, attacker.privateKey).toString('base64url') }), { mode: 0o600 });
  assert.equal((await cli(['license', 'activate', '--input', input], { file: substituted.executable, expected: 1 })).ok, false);
  assert.equal((await cli(['license', 'status'], { file: substituted.executable })).result.activated, false);
  record('External public-key replacement and self-issued activation rejected');

  const installer = await clone('installer-substitution');
  const installerMarker = path.join(scratch, 'installer-executed');
  fs.writeFileSync(path.join(installer.resources, 'uv/mac-arm64/uv'), `#!/bin/sh\ntouch '${installerMarker}'\nexit 1\n`);
  const configuration = await cli(['preflight', 'prepare', '--package', 'light'], { file: installer.executable });
  assert.equal(configuration.result.scope, 'environment');
  assert.equal(configuration.result.heard, undefined);
  assert.ok(configuration.result.results.every(result => result.duration === undefined));
  assert.equal(fs.existsSync(installerMarker), false);
  assert.equal(fs.existsSync(path.join(data, 'runtime')), false);
  assert.equal(fs.existsSync(path.join(data, 'preflight')), false);
  record('Packaged compatibility check inspects the environment without installers, models or generated audio');

  const payload = await clone('payload-tamper'), payloadArchive = path.join(payload.resources, 'app.asar');
  const bytes = fs.readFileSync(payloadArchive);
  const target = Buffer.from("edition: payload ? '专业版' : '未激活'");
  const offset = bytes.indexOf(target); assert.ok(offset >= 0);
  Buffer.from("edition: payload ? '专业版' : '已篡改'").copy(bytes, offset);
  fs.writeFileSync(payloadArchive, bytes);
  const payloadFailure = rawRun(payload.executable, ['license', 'status']);
  assert.notEqual(payloadFailure.status, 0); assert.doesNotMatch(payloadFailure.stdout || '', /已篡改/);
  record('In-place ASAR payload modification refuses to execute', { exitCode: payloadFailure.status, signal: payloadFailure.signal });

  const repacked = await clone('repacked'), repackArchive = path.join(repacked.resources, 'app.asar');
  const extracted = path.join(scratch, 'source'); asar.extractAll(repackArchive, extracted);
  fs.appendFileSync(path.join(extracted, 'desktop/license.cjs'), '\n// audit modification\n');
  await asar.createPackage(extracted, repackArchive);
  const repackFailure = rawRun(repacked.executable, ['license', 'status']); assert.notEqual(repackFailure.status, 0);
  record('Repacked ASAR with recalculated archive hashes refuses to execute', { exitCode: repackFailure.status, signal: repackFailure.signal });

  const replacementHash = hash(asar.getRawHeader(repackArchive).headerString);
  await run(path.join(root, '.venv/bin/python'), ['-c', 'import plistlib,sys; p=sys.argv[1]; v=plistlib.load(open(p,"rb")); v["ElectronAsarIntegrity"]["Resources/app.asar"]["hash"]=sys.argv[2]; plistlib.dump(v,open(p,"wb"))', path.join(repacked.folder, 'Contents/Info.plist'), replacementHash]);
  const metadataFailure = rawRun(repacked.executable, ['license', 'status']);
  assert.equal(metadataFailure.status, 78); assert.match(metadataFailure.stderr, /完整性校验失败/);
  record('Mac native digest blocks simultaneous ASAR and Info.plist hash replacement');

  const directory = await clone('directory-sideload');
  asar.extractAll(archive, path.join(directory.resources, 'app'));
  fs.renameSync(path.join(directory.resources, 'app.asar'), path.join(directory.resources, 'saved.asar'));
  const directoryFailure = rawRun(directory.executable, ['license', 'status']); assert.notEqual(directoryFailure.status, 0);
  record('Unpacked app-directory fallback cannot bypass ASAR checks');

  for (const flag of ['--inspect=127.0.0.1:9229', '--remote-debugging-port=9222', '--remote-debugging-pipe']) {
    const attempt = rawRun(executable, [flag, 'license', 'status']);
    assert.notEqual(attempt.status, 0); assert.equal(JSON.parse(attempt.stdout).error.code, 'UNSAFE_LAUNCH');
  }
  const nodeMarker = path.join(scratch, 'node-injected');
  const hook = path.join(scratch, 'hook.cjs'); fs.writeFileSync(hook, `require('node:fs').writeFileSync(${JSON.stringify(nodeMarker)},'injected')`);
  const injectedEnv = { ...env, NODE_OPTIONS: '--require=' + hook, ELECTRON_RUN_AS_NODE: '1' };
  assert.equal((await cli(['license', 'status'], { environment: injectedEnv })).result.activated, false);
  assert.equal(fs.existsSync(nodeMarker), false);
  record('Inspector, Chromium remote debugger, NODE_OPTIONS and run-as-node bypasses blocked');

  // Extract the original protected worker only for a direct-protocol attack test.
  const worker = path.join(scratch, 'source/backend/worker.py');
  const python = path.join(root, '.venv/bin/python');
  const requests = ['generate', 'zip', 'reference', 'capture'].map((op, id) => ({ id, op, data: { text: 'blocked', ids: ['a'.repeat(32)], path: '/missing.wav' } }));
  const direct = spawnSync(python, ['-I', worker, '--data-dir', data], { encoding: 'utf8', input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', timeout: 20000 });
  assert.equal(direct.status, 0, direct.stderr);
  const denied = direct.stdout.split('\n').filter(Boolean).map(JSON.parse).filter(x => x.type === 'error');
  assert.equal(denied.length, 4); assert.ok(denied.every(x => x.code === 'LICENSE_REQUIRED'));
  record('Original extracted Python worker independently rejects all four paid operations without a license');

  // Use the existing issuer, never copy its private key into a fixture or report.
  const { stdout: code } = await run(process.execPath, [path.join(root, 'scripts/license-admin.cjs'), 'issue', initial.result.machineCode, '--replacement']);
  fs.writeFileSync(input, JSON.stringify({ code: code.trim() }), { mode: 0o600 });
  assert.equal((await cli(['license', 'activate', '--input', input], { offline: true })).result.activated, true); offlineSandbox = true;
  assert.equal((await cli(['license', 'status'], { offline: true })).result.activated, true);
  record('Existing merchant-issued SY2 activation and restart work with all network access denied');
  const rejectedInstaller = await cli(['setup', '--package', 'light'], { file: installer.executable, expected: 1 });
  assert.equal(rejectedInstaller.error.code, 'INTEGRITY_ERROR');
  assert.equal(fs.existsSync(installerMarker), false);
  record('Replaced bundled installer is rejected before execution after activation');

  assert.equal((await cli(['license', 'status'], { file: path.join(root, 'release/mac/声悦.app/Contents/MacOS/声悦') })).result.activated, true);
  record('Intel Mac CLI runs under Rosetta and recognizes the same offline activation');

  const runtime = path.join(data, 'runtime'); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
  // Chromium cannot initialize its own sandbox inside a parent SBPL sandbox.
  // Activation above is tested with the whole process offline; long inference
  // gets a network-denied Python launcher without changing production code.
  const pythonLauncher = path.join(runtime, 'bin/python');
  fs.writeFileSync(pythonLauncher, `#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' '${python.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
  const networkProbe = spawnSync(pythonLauncher, ['-I', '-c', 'import socket,sys\ntry:\n socket.create_connection(("127.0.0.1",9),1)\nexcept PermissionError:\n print("network denied"); sys.exit(0)\nexcept OSError:\n sys.exit(1)\nsys.exit(1)'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(networkProbe.status, 0, networkProbe.stderr); assert.match(networkProbe.stdout, /network denied/);
  report.offlineEnforcement = { activation: 'Whole application process denied all network access', inference: 'Engine subprocess denied all network access; Chromium parent kept its native sandbox' };
  fs.writeFileSync(path.join(runtime, 'ready.json'), JSON.stringify({ profile: 'mac-arm64', requirementsHash: hash(asar.extractFile(archive, 'backend/requirements-mac.lock')) }));
  const models = process.env.VOICE_STUDIO_TEST_MODELS || path.join(os.homedir(), 'Library/Application Support/Voice Studio/models');
  assert.ok(fs.existsSync(path.join(models, 'voice-light/.complete.json')), 'Real local light model is required for release validation');
  fs.symlinkSync(models, path.join(data, 'models'), 'dir');
  const loose = await clone('loose-worker-substitution');
  const looseMarker = path.join(scratch, 'loose-worker-executed');
  fs.mkdirSync(path.join(loose.resources, 'backend'));
  fs.writeFileSync(path.join(loose.resources, 'backend/worker.py'), `open(${JSON.stringify(looseMarker)}, 'w').write('executed')\n`);
  assert.equal((await cli(['status'], { file: loose.executable })).result.runtimeReady, true);
  assert.equal(fs.existsSync(looseMarker), false);
  record('Injected loose Python worker is ignored; sealed engine is used');
  const pythonMarker = path.join(scratch, 'python-injected');
  const badPython = path.join(scratch, 'malicious-python');
  fs.writeFileSync(badPython, '#!/bin/sh\ntouch ' + pythonMarker + '\nexit 1\n', { mode: 0o700 });
  fs.writeFileSync(path.join(scratch, 'sitecustomize.py'), `open(${JSON.stringify(pythonMarker)},'w').write('injected')`);
  const maliciousEnv = { ...injectedEnv, VOICE_STUDIO_PYTHON: badPython, PYTHONPATH: scratch, PYTHONHOME: scratch };
  const generated = await cli(['generate', '--text', '你好，这是修复后的离线配音验证。', '--engine', 'light', '--timeout', '150'], { environment: maliciousEnv });
  assert.equal(generated.result.items.length, 1);
  const clip = generated.result.items[0];
  assert.ok(Array.isArray(clip.quality?.flags), 'Packaged inference must include the post-generation audio quality report');
  assert.equal(fs.readFileSync(clip.paths.wav).toString('ascii', 0, 4), 'RIFF');
  assert.ok(fs.statSync(clip.paths.mp3).size > 1000);
  assert.equal(fs.existsSync(pythonMarker), false); assert.equal(fs.existsSync(nodeMarker), false);
  const outputZip = path.join(scratch, 'output.zip');
  assert.equal((await cli(['export', '--ids', clip.id, '--output', outputZip])).ok, true);
  record('Real offline model inference saves WAV/MP3, audio quality report and ZIP; Python override and loader injection ignored', { durationSeconds: clip.duration, qualityFlags: clip.quality.flags });

  fs.unlinkSync(path.join(data, 'license.txt'));
  assert.equal((await cli(['generate', '--text', 'blocked again'], { expected: 5, offline: true })).error.code, 'LICENSE_REQUIRED');
  record('Deleting a valid license relocks the packaged application offline');
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; throw error;
} finally {
  report.offlineNetworkDenied = offlineSandbox;
  fs.rmSync(scratch, { recursive: true, force: true });
  report.temporaryAppsKeysAndLicensesRemoved = true;
  fs.writeFileSync(path.join(root, `release/security-validation-${version}.json`), JSON.stringify(report, null, 2) + '\n');
}
