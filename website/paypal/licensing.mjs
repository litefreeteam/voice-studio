import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
// Deploy unchanged copies of the desktop's actual license and report validators.
const core = require(existsSync(path.join(directory, 'license-core.cjs')) ? './license-core.cjs' : '../../desktop/license.cjs');
const reports = require(existsSync(path.join(directory, 'compatibility-report.cjs')) ? './compatibility-report.cjs' : '../../shared/compatibility-report.cjs');
export const validatePurchaseReport = reports.validatePurchaseReport;

export function createLicenseSigner({ privateKeyPath, publicKey } = {}) {
  if (!privateKeyPath) return null;
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  const expected = publicKey || readFileSync(existsSync(path.join(directory, 'license-public.pem'))
    ? path.join(directory, 'license-public.pem') : new URL('../../shared/license-public.pem', import.meta.url));
  if (privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
    .equals(createPublicKey(expected).export({ type: 'spki', format: 'der' }))) throw new Error('License signing key does not match the desktop public key');
  return machine => {
    if (!/^SYD1-[0-9A-F]{32}$/.test(machine)) throw new Error('Invalid license device code');
    const code = `SY2.${sign(null, core.licenseMessage(machine), privateKey).toString('base64url')}`;
    core.verifyCode(code, machine, expected);
    return code;
  };
}
