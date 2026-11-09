const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { verifyRedist, verifyWindowsRedist } = require('../scripts/windows-redist.cjs');
const root = path.resolve(__dirname, '..');
const manifest = require('../resources/windows/vc-redist.json');
const bytes = fs.readFileSync(path.join(root, 'resources/windows', manifest.filename));

test('Windows prerequisite matches the pinned Microsoft binary, native version and installer definitions', () => {
  assert.equal(new URL(manifest.url).hostname, 'download.visualstudio.microsoft.com');
  assert.equal(verifyWindowsRedist(root).version, manifest.version);
});

test('truncated or modified prerequisite installers cannot enter a build', () => {
  assert.throws(() => verifyRedist(bytes.subarray(0, bytes.length - 1), manifest), /checksum mismatch/);
  const corrupt = Buffer.from(bytes);
  corrupt[1024] ^= 1;
  assert.throws(() => verifyRedist(corrupt, manifest), /checksum mismatch/);
});

test('a native version mismatch cannot be hidden by a valid hash', () => {
  assert.throws(() => verifyRedist(bytes, { ...manifest, version: '14.0.0.0' }), /version mismatch/);
});

test('a stale NSIS version or hash fails before producing an installer', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-prerequisite-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const folder = path.join(scratch, 'resources/windows');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'vc-redist.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, 'vc-redist-version.nsh'), '!define SHENGYUE_VC_VERSION "14.0.0.0"\n');
  assert.throws(() => verifyWindowsRedist(scratch), /definitions do not match/);
});

test('installer rejects old Windows and ARM before touching prerequisites or an existing app', () => {
  const source = fs.readFileSync(path.join(root, 'resources/windows/installer.nsh'), 'utf8');
  const early = source.slice(source.indexOf('!macro preInit'), source.indexOf('!macro customHeader'));
  assert.match(early, /RunningX64/);
  assert.match(early, /IsNativeARM64/);
  assert.match(early, /GetRealOSVersion/);
  assert.match(early, /GetRealOSBuildNo/);
  assert.match(early, /19041/);
  assert.match(early, /SetErrorLevel 1633/);
  assert.doesNotMatch(early, /ExecWait|File \/oname|ShengyueEnsureVCRuntime/);
});
