import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
const { verifyRedist, verifyWindowsRedist } = require('./windows-redist.cjs');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const asar = require('@electron/asar'), PE = require('pe-library');
const root = path.resolve(import.meta.dirname, '..');
const version = require('../package.json').version;
const installer = path.join(root, 'release', `Shengyue-${version}-windows-setup.exe`);
const manifest = verifyWindowsRedist(root);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-windows-installer-'));
try {
  const sevenZip = await getPath7za();
  execFileSync(sevenZip, ['x', installer, `-o${scratch}`, '$PLUGINSDIR/Shengyue-vc_redist.x64.exe', '$PLUGINSDIR/app-64.7z', '-y'], { stdio: 'pipe' });
  const embedded = fs.readFileSync(path.join(scratch, '$PLUGINSDIR/Shengyue-vc_redist.x64.exe'));
  assert.equal(verifyRedist(embedded, manifest), manifest.version);
  assert.ok(embedded.equals(fs.readFileSync(path.join(root, 'resources/windows', manifest.filename))));
  const app = path.join(scratch, 'app');
  execFileSync(sevenZip, ['x', path.join(scratch, '$PLUGINSDIR/app-64.7z'), `-o${app}`,
    'resources/app.asar', 'resources/README.md', 'resources/THIRD_PARTY_NOTICES.md', '声悦.exe', '-y'], { stdio: 'pipe' });
  const archive = path.join(app, 'resources/app.asar'), executable = path.join(app, '声悦.exe');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
  const audioFeatureFiles = ['desktop/audio-operations.cjs', 'backend/audio_tools.py', 'backend/reference_tools.py',
    'ui/audio-studio.js', 'ui/audio-studio.css', 'ui/reference-import.js', 'shared/transcription-manifest.json'];
  const recordingFeatureFiles = ['desktop/recording.cjs', 'desktop/app.cjs', 'desktop/preload.cjs', 'ui/recorder.js', 'ui/preflight.js'];
  for (const name of audioFeatureFiles) assert.ok(asar.extractFile(archive, name).equals(fs.readFileSync(path.join(root, name))), name);
  for (const name of recordingFeatureFiles) assert.ok(asar.extractFile(archive, name).equals(fs.readFileSync(path.join(root, name))), name);
  let matched = 0;
  for (const name of asar.listPackage(archive).map(x => x.replace(/^\//, ''))) {
    if (!asar.statFile(archive, name).size) continue;
    assert.doesNotMatch(name, /(?:^|\/)(?:\.seller|\.test-data|\.env)(?:\/|$)|signing-key|(?:^|\/)license\.txt$/);
    const contents = asar.extractFile(archive, name);
    assert.doesNotMatch(contents.toString(), /BEGIN (?:[A-Z]+ )?PRIVATE KEY/);
    if (/^(?:desktop|ui|cli|backend|shared)\//.test(name)) {
      assert.ok(contents.equals(fs.readFileSync(path.join(root, name))), name);
      matched++;
    }
  }
  for (const name of ['README.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(fs.readFileSync(path.join(app, 'resources', name)).equals(fs.readFileSync(path.join(root, name))), name);
  }
  const wire = await getCurrentFuseWire(executable);
  for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) assert.equal(wire[FuseV1Options[name]], 48, name);
  for (const name of ['EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar']) assert.equal(wire[FuseV1Options[name]], 49, name);
  const entries = PE.NtExecutableResource.from(PE.NtExecutable.from(fs.readFileSync(executable))).entries;
  const integrity = entries.find(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  assert.ok(integrity);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(JSON.parse(Buffer.from(integrity.bin).toString())[0].value, hash(asar.getRawHeader(archive).headerString));
  const report = { passed: true, version, platform: 'win-x64', sourceFilesMatched: matched,
    embeddedVCRedist: { version: manifest.version, size: embedded.length, sha256: manifest.sha256, matchesOriginal: true },
    audioFeatureFiles, recordingFeatureFiles, fuses: true, asarIntegrity: true, documentation: true, privateKeyExclusion: true,
    installer: { filename: path.basename(installer), size: fs.statSync(installer).size, sha256: hash(fs.readFileSync(installer)) },
    limitations: ['Verified the actual compiled NSIS payload on macOS. Native Windows microphone input, privacy switches, registry detection, UAC, runtime installation and reboot branches still require Windows acceptance testing.'] };
  fs.writeFileSync(path.join(root, 'release', `windows-validation-${version}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
