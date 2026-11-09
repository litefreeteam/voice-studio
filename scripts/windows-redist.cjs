const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PE = require('pe-library');
const R = require('resedit');

function verifyRedist(bytes, manifest) {
  if (bytes.length !== manifest.size || crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw new Error('Windows VC++ prerequisite checksum mismatch; run npm run resources:win');
  }
  const exe = PE.NtExecutable.from(bytes, { ignoreCert: true });
  const info = R.Resource.VersionInfo.fromEntries(PE.NtExecutableResource.from(exe).entries)[0]?.fixedInfo;
  const version = info && [info.productVersionMS >>> 16, info.productVersionMS & 65535,
    info.productVersionLS >>> 16, info.productVersionLS & 65535].join('.');
  if (version !== manifest.version) throw new Error('Windows VC++ prerequisite version mismatch');
  return version;
}

function verifyWindowsRedist(root) {
  const folder = path.join(root, 'resources/windows');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'vc-redist.json'), 'utf8'));
  const definitions = fs.readFileSync(path.join(folder, 'vc-redist-version.nsh'), 'utf8');
  if (!definitions.includes(`!define SHENGYUE_VC_VERSION "${manifest.version}"`) ||
      !definitions.includes(`!define SHENGYUE_VC_SHA256 "${manifest.sha256}"`)) {
    throw new Error('Windows VC++ NSIS prerequisite definitions do not match the pinned manifest');
  }
  verifyRedist(fs.readFileSync(path.join(folder, manifest.filename)), manifest);
  return manifest;
}

module.exports = { verifyRedist, verifyWindowsRedist };
