import { cp, mkdir, mkdtemp, rm, symlink, copyFile, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, sign } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { LicenseStore, licenseMessage } from '../desktop/license.cjs';

// A real Electron app with a disposable signing key; never reads seller keys or user data.
export async function createDesktopFixture({ activated = false } = {}) {
  const root = path.resolve(import.meta.dirname, '..');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'shengyue desktop 中文-'));
  const appDir = path.join(folder, 'app'), data = path.join(folder, 'data');
  await mkdir(path.join(appDir, 'shared'), { recursive: true });
  await mkdir(data);
  await cp(path.join(root, 'desktop'), path.join(appDir, 'desktop'), { recursive: true });
  await symlink(path.join(root, 'ui'), path.join(appDir, 'ui'), 'dir');
  await copyFile(path.join(root, 'shared/catalog.json'), path.join(appDir, 'shared/catalog.json'));
  for (const name of ['edition.json', 'download-sources.json', 'model-manifest.json', 'transcription-manifest.json']) await copyFile(path.join(root, 'shared', name), path.join(appDir, 'shared', name));
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'shengyue-test', version: '0.4.1', main: 'desktop/main.cjs' }));
  const keys = generateKeyPairSync('ed25519');
  await writeFile(path.join(appDir, 'shared/license-public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  await writeFile(path.join(appDir, 'desktop/trust-anchor.cjs'), 'module.exports = ' + JSON.stringify(keys.publicKey.export({ type: 'spki', format: 'pem' })) + ';\n');
  const store = new LicenseStore(data, keys.publicKey);
  function code(overrides = {}) {
    return `SY2.${sign(null, licenseMessage(overrides.machine ?? store.machine), keys.privateKey).toString('base64url')}`;
  }
  if (activated) store.activate(code());
  return { appDir, data, code, cleanup: () => rm(folder, { recursive: true, force: true }) };
}
