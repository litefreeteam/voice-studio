import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const root = path.resolve(import.meta.dirname, '..'), version = require('../package.json').version;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-release-free-'));
const artifacts = [
  { label: 'mac-arm64', archive: 'release/mac-arm64/声悦.app/Contents/Resources/app.asar', exe: 'release/mac-arm64/声悦.app/Contents/MacOS/声悦' },
  { label: 'mac-x64', archive: 'release/mac/声悦.app/Contents/Resources/app.asar', exe: 'release/mac/声悦.app/Contents/MacOS/声悦' },
  { label: 'win-x64', archive: 'release/win-unpacked/resources/app.asar', exe: 'release/win-unpacked/声悦.exe' }
];
const report = { version, edition: 'free', checks: [], nativeWindows: false };
try {
  for (const artifact of artifacts) {
    const archive = path.join(root, artifact.archive), executable = path.join(root, artifact.exe);
    assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
    assert.equal(JSON.parse(asar.extractFile(archive, 'shared/edition.json')).activationRequired, false);
    for (const name of asar.listPackage(archive).map(name => name.replace(/^\//, ''))) {
      if (asar.statFile(archive, name).size === undefined) continue;
      assert.doesNotMatch(name, /(?:^|\/)(?:\.seller|\.test-data|\.env)(?:\/|$)|signing-key|(?:^|\/)license\.txt$/);
      const bytes = asar.extractFile(archive, name);
      assert.doesNotMatch(bytes.toString(), /BEGIN (?:[A-Z]+ )?PRIVATE KEY/);
      if (/^(?:desktop|backend|shared|ui|cli)\//.test(name) && fs.statSync(path.join(root, name)).isFile()) {
        assert.ok(bytes.equals(fs.readFileSync(path.join(root, name))), artifact.label + ': ' + name);
      }
    }
    const fuses = await getCurrentFuseWire(executable);
    for (const fuse of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) assert.equal(fuses[FuseV1Options[fuse]], 48, artifact.label + ': ' + fuse);
    if (artifact.label.startsWith('mac')) {
      const data = path.join(scratch, artifact.label); fs.mkdirSync(data);
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
      function cli(args) {
        return JSON.parse(execFileSync(executable, ['--cli', '--data-dir', data, ...args], { env, encoding: 'utf8', timeout: 30000 }));
      }
      assert.equal(cli(['describe']).licensing.required, false);
      assert.equal(cli(['license', 'status']).result.edition, '免费版');
      assert.equal(cli(['catalog']).result.voices.length, 9);
      assert.equal(cli(['preflight', '--package', 'light']).result.scope, 'environment');
      assert.ok(!fs.existsSync(path.join(data, 'license.txt')));
      assert.ok(!fs.existsSync(path.join(data, 'installation-id')));
      fs.writeFileSync(path.join(data, 'license.txt'), 'corrupt legacy license');
      assert.equal(cli(['catalog']).result.voices.length, 9);
      const source = path.join(scratch, artifact.label + '-source'); asar.extractAll(archive, source);
      const input = ['generate', 'zip', 'reference', 'capture'].map((op, id) => JSON.stringify({ id, op, data: { text: 'free boundary', ids: ['a'.repeat(32)], id: 'a'.repeat(32), path: '/missing.wav' } })).join('\n') + '\n';
      const result = execFileSync(path.join(root, '.venv/bin/python'), ['-I', path.join(source, 'backend/worker.py'), '--data-dir', data], { input, env, encoding: 'utf8', timeout: 30000 });
      const errors = result.trim().split('\n').map(JSON.parse).filter(event => event.type === 'error');
      assert.equal(errors.length, 4); assert.ok(errors.every(error => error.code !== 'LICENSE_REQUIRED'));
    }
    report.checks.push(artifact.label + ': exact source, free edition, archive integrity, no secrets' + (artifact.label.startsWith('mac') ? ', native CLI and extracted Python boundary' : ' (static checks)'));
  }
  const filenames = ['mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip', 'windows-setup.exe', 'win-x64.zip'].map(suffix => `Shengyue-${version}-${suffix}`);
  const sha256 = {};
  for (const name of filenames) {
    const file = path.join(root, 'release', name); assert.ok(fs.statSync(file).size > 1000000);
    sha256[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  fs.writeFileSync(path.join(root, 'website/src/release.json'), JSON.stringify({ version, edition: 'free', sha256 }, null, 2) + '\n');
  report.sha256 = sha256; report.passed = true;
  fs.writeFileSync(path.join(root, `release/free-validation-${version}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
