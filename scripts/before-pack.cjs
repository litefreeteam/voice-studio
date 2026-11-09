const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const preparedMacDmgRoots = new Set();

module.exports = async ({ packager, electronPlatformName }) => {
  const root = packager.projectDir;
  if (electronPlatformName === 'darwin' && !preparedMacDmgRoots.has(root)) {
    require('./prepare-mac-dmg-guide.cjs').prepareMacDmgGuide(root);
    require('node:child_process').execFileSync('/usr/bin/swift', [
      path.join(root, 'scripts/prepare-mac-dmg.swift'), path.join(root, 'resources/macos')
    ], { cwd: root, stdio: 'inherit' });
    preparedMacDmgRoots.add(root);
  }
  if (electronPlatformName === 'win32') require('./windows-redist.cjs').verifyWindowsRedist(root);
  const anchor = require(path.join(root, 'desktop/trust-anchor.cjs'));
  if (anchor !== fs.readFileSync(path.join(root, 'shared/license-public.pem'), 'utf8') ||
      !fs.readFileSync(path.join(root, 'backend/worker.py'), 'utf8').includes(anchor.trim())) {
    throw new Error('Desktop, Python and merchant public keys differ; refusing to package');
  }
  for (const part of ['backend', 'shared']) for (const name of fs.readdirSync(path.join(root, part), { recursive: true })) {
    const file = path.join(root, part, name);
    if (fs.statSync(file).isFile() && /BEGIN (?:[A-Z]+ )?PRIVATE KEY/.test(fs.readFileSync(file, 'utf8'))) throw new Error(`Private key in distribution resources: ${part}/${name}`);
  }
  const { TOOL_HASHES } = require(path.join(root, 'desktop/integrity.cjs'));
  for (const [name, expected] of Object.entries(TOOL_HASHES)) {
    const bytes = fs.readFileSync(path.join(root, 'resources/uv', name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Bundled installer hash mismatch: ${name}`);
  }
};
