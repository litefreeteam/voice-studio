import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileFor } from '../desktop/compatibility.cjs';
import { verifyTool } from '../desktop/integrity.cjs';
import { createDevFixture } from '../scripts/dev-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonCommand = process.env.VOICE_STUDIO_PYTHON || (existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
const python = execFileSync(pythonCommand, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();

test('debug client includes a working installer and isolates writable runtime/model files', async t => {
  const installedData = await mkdtemp(path.join(os.tmpdir(), 'shengyue-preview-source-'));
  t.after(() => rm(installedData, { recursive: true, force: true }));
  for (const name of ['runtime', 'models']) {
    await mkdir(path.join(installedData, name));
    await writeFile(path.join(installedData, name, 'probe.txt'), 'original');
  }
  const fixture = await createDevFixture({ installedData });
  t.after(() => fixture.cleanup());
  const profile = profileFor();
  if (profile) {
    const uv = path.join(fixture.appDir, 'resources/uv', profile.uv);
    verifyTool(uv, profile.uv);
    assert.match(execFileSync(uv, ['--version'], { encoding: 'utf8' }), /^uv 0\.11\.2/);
    // Create a real venv with the bundled manager, entirely offline.
    const venv = path.join(fixture.data, 'installer-probe');
    execFileSync(uv, ['venv', '--no-config', '--offline', '--python', python, venv], { stdio: 'pipe' });
    await access(path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
  }
  for (const name of ['runtime', 'models']) {
    await writeFile(path.join(fixture.data, name, 'probe.txt'), 'updated by debug setup');
    assert.equal(await readFile(path.join(installedData, name, 'probe.txt'), 'utf8'), 'original');
  }
});

test('real debug engine independently verifies its temporary activation', async t => {
  const original = await readFile(path.join(root, 'backend/worker.py'), 'utf8');
  const fixture = await createDevFixture({ installedData: path.join(root, '.test-data/missing-preview-source') });
  t.after(() => fixture.cleanup());
  const script = `import importlib.util,sys
spec=importlib.util.spec_from_file_location('worker',sys.argv[1])
worker=importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
worker.require_license(sys.argv[2])
print('verified')
`;
  const args = ['-I', '-c', script, path.join(fixture.appDir, 'backend/worker.py'), fixture.data];
  assert.equal(execFileSync(python, args, { encoding: 'utf8' }).trim(), 'verified');
  await writeFile(path.join(fixture.data, 'license.txt'), 'invalid activation');
  assert.throws(() => execFileSync(python, args, { stdio: 'pipe' }));
  assert.equal(await readFile(path.join(root, 'backend/worker.py'), 'utf8'), original);
});

test('unactivated debug preview keeps the real installer and engine available for purchase trials', async t => {
  const fixture = await createDevFixture({ activated: false, installedData: path.join(root, '.test-data/missing-preview-source') });
  t.after(() => fixture.cleanup());
  assert.equal(existsSync(path.join(fixture.data, 'license.txt')), false);
  const profile = profileFor();
  if (profile) {
    const uv = path.join(fixture.appDir, 'resources/uv', profile.uv);
    verifyTool(uv, profile.uv);
    assert.match(execFileSync(uv, ['--version'], { encoding: 'utf8' }), /^uv 0\.11\.2/);
    await access(path.join(fixture.appDir, 'backend', profile.requirements));
  }
  await access(path.join(fixture.appDir, 'backend/worker.py'));
  await access(path.join(fixture.appDir, 'backend/downloads.py'));
});
