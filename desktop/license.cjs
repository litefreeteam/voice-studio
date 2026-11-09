const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PRODUCT = 'shengyue';
const { activationRequired } = require('../shared/edition.json');

function machineCode(root) {
  let value;
  try {
    if (process.platform === 'darwin') value = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 }).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)[1];
    else if (process.platform === 'win32') value = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)[1];
  } catch {
    if (['darwin', 'win32'].includes(process.platform)) throw Object.assign(new Error('无法读取本机设备标识，请检查系统权限后重试'), { code: 'DEVICE_ID_UNAVAILABLE' });
  }
  if (!value) {
    const file = path.join(root, 'installation-id');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomUUID());
    value = fs.readFileSync(file, 'utf8');
  }
  return 'SYD1-' + crypto.createHash('sha256').update(`${PRODUCT}:${value.trim().toLowerCase()}`).digest('hex').slice(0, 32).toUpperCase();
}

// All SY2 licenses are permanent professional licenses. Reconstructing these
// fields removes the JSON payload while retaining the full Ed25519 signature.
function licenseMessage(machine) {
  return Buffer.from(`${PRODUCT}:offline:pro:perpetual:v2:${machine}`, 'utf8');
}

function normalizeCode(code) {
  if (typeof code !== 'string' || code.length > 512) throw new Error('激活码格式不正确');
  return code.replace(/\s/g, '');
}

function verifyCode(code, machine, publicKey) {
  const normalized = normalizeCode(code);
  if (!/^SY2\.[A-Za-z0-9_-]{86}$/.test(normalized)) throw new Error('请粘贴新版 SY2 激活码（90 个字符），旧版激活码不再支持');
  const encoded = normalized.slice(4), signature = Buffer.from(encoded, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== encoded ||
      !crypto.verify(null, licenseMessage(machine), publicKey, signature)) {
    throw new Error('激活码无效或与当前设备不匹配，请核对后重试');
  }
  return { product: PRODUCT, machine, edition: 'pro', expiresAt: null,
    licenseId: crypto.createHash('sha256').update(signature).digest('hex').slice(0, 32) };
}

class LicenseStore {
  constructor(root, publicKey, { required = activationRequired } = {}) {
    this.root = root; this.key = publicKey; this.required = required;
    // Free builds must also work when hardware identifiers are unavailable.
    this.machine = required ? machineCode(root) : '';
  }
  status() {
    if (!this.required) return { activated: true, activationRequired: false, machineCode: '',
      customer: '', licenseId: '', edition: '免费版', expiresAt: null, warning: '' };
    let payload = null, warning = '';
    try { payload = verifyCode(fs.readFileSync(path.join(this.root, 'license.txt'), 'utf8'), this.machine, this.key); }
    catch (error) { if (fs.existsSync(path.join(this.root, 'license.txt'))) warning = error.message; }
    return { activated: !!payload, machineCode: this.machine,
      customer: payload?.customer || '', licenseId: payload?.licenseId || '', edition: payload ? '专业版' : '未激活',
      expiresAt: payload?.expiresAt ?? null, warning };
  }
  activate(code) {
    if (!this.required) return this.status();
    verifyCode(code, this.machine, this.key);
    const temporary = path.join(this.root, `license-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, normalizeCode(code), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, path.join(this.root, 'license.txt'));
    } finally { fs.rmSync(temporary, { force: true }); }
    return this.status();
  }
  allow() {
    const state = this.status();
    if (!state.activated) throw Object.assign(new Error(`请先激活软件后再使用。${state.warning ? ` ${state.warning}` : ''}`), { code: 'LICENSE_REQUIRED' });
  }
}
module.exports = { LicenseStore, verifyCode, machineCode, licenseMessage };
