const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyTool, TOOL_HASHES } = require('../desktop/integrity.cjs');

function verifyMicrophoneEntitlements(app) {
  const frameworks = path.join(app, 'Contents', 'Frameworks');
  const bundles = [app, ...fs.readdirSync(frameworks).filter(name => name.endsWith('.app')).map(name => path.join(frameworks, name))];
  for (const bundle of bundles) {
    const xml = execFileSync('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', bundle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const entitlements = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' }));
    if (entitlements['com.apple.security.device.audio-input'] !== true) throw new Error(`Missing signed microphone entitlement: ${bundle}`);
  }
}

function verifyBundledInstallers(resources) {
  for (const target of Object.keys(TOOL_HASHES)) verifyTool(path.join(resources, 'uv', target), target);
}

// Signing must not rewrite the upstream installers whose complete bytes are pinned.
// Check the final app, rather than only checking the input resources before packing.
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  verifyMicrophoneEntitlements(app);
  const resources = path.join(app, 'Contents', 'Resources');
  verifyBundledInstallers(resources);
};
module.exports.verifyMicrophoneEntitlements = verifyMicrophoneEntitlements;
module.exports.verifyBundledInstallers = verifyBundledInstallers;
