const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyCode, LicenseStore, licenseMessage } = require('../desktop/license.cjs');
const { parseScript } = require('../ui/csv.js');
const keys = crypto.generateKeyPairSync('ed25519');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-license-'));
try {
  const store = new LicenseStore(root, keys.publicKey, { required: true }), machine = store.machine;
  const sign = message => 'SY2.' + crypto.sign(null, message, keys.privateKey).toString('base64url');
  const code = sign(licenseMessage(machine));
  assert.equal(code.length, 90);
  assert.equal(store.status().activated, false);
  assert.equal(store.status().edition, '未激活');
  assert.throws(() => store.allow(), { code: 'LICENSE_REQUIRED' });
  fs.writeFileSync(path.join(root, 'usage.json'), JSON.stringify({ used: 0 }));
  assert.throws(() => store.allow(), { code: 'LICENSE_REQUIRED' });
  assert.equal('remaining' in store.status(), false);
  assert.equal('limit' in store.status(), false);
  const verified = verifyCode(code, machine, keys.publicKey);
  assert.equal(verified.edition, 'pro');
  assert.equal(verified.expiresAt, null);
  assert.equal(verified.machine, machine);
  assert.match(verified.licenseId, /^[a-f0-9]{32}$/);
  assert.deepEqual(verifyCode(` \n${code.slice(0, 45)}\n${code.slice(45)}\t`, machine, keys.publicKey), verified);
  assert.throws(() => verifyCode(code, machine + '0', keys.publicKey), /设备不匹配/);
  assert.throws(() => verifyCode(code, machine, crypto.generateKeyPairSync('ed25519').publicKey));
  const signature = Buffer.from(code.slice(4), 'base64url');
  signature[0] ^= 1;
  assert.throws(() => verifyCode('SY2.' + signature.toString('base64url'), machine, keys.publicKey));
  for (const message of [`other:offline:pro:perpetual:v2:${machine}`, `shengyue:offline:basic:perpetual:v2:${machine}`, `shengyue:offline:pro:perpetual:v1:${machine}`]) {
    assert.throws(() => verifyCode(sign(Buffer.from(message)), machine, keys.publicKey));
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const noncanonical = code.slice(0, -1) + alphabet[alphabet.indexOf(code.at(-1)) + 1];
  assert.deepEqual(Buffer.from(noncanonical.slice(4), 'base64url'), Buffer.from(code.slice(4), 'base64url'));
  assert.throws(() => verifyCode(noncanonical, machine, keys.publicKey));
  const oldPayload = Buffer.from(JSON.stringify({ product: 'shengyue', machine, edition: 'pro', expiresAt: null }));
  const oldCode = `SY1.${oldPayload.toString('base64url')}.${crypto.sign(null, oldPayload, keys.privateKey).toString('base64url')}`;
  for (const invalid of [oldCode, code.slice(0, -1), code + '=', 'SY2.' + 'A'.repeat(86), 'SY2.' + 'A'.repeat(1000), null]) {
    assert.throws(() => verifyCode(invalid, machine, keys.publicKey));
  }
  store.activate(`\n${code}\n`);
  assert.equal(fs.readFileSync(path.join(root, 'license.txt'), 'utf8'), code);
  assert.equal(new LicenseStore(root, keys.publicKey, { required: true }).status().activated, true);
  store.allow();
  assert.throws(() => store.activate('invalid'));
  assert.equal(store.status().activated, true);
  fs.writeFileSync(path.join(root, 'license.txt'), oldCode);
  assert.throws(() => store.allow(), { code: 'LICENSE_REQUIRED' });
  fs.unlinkSync(path.join(root, 'license.txt'));
  assert.throws(() => store.allow(), { code: 'LICENSE_REQUIRED' });
  assert.deepEqual(parseScript('\uFEFF文本,角色,情绪,文件名\r\n"你好，世界！",远山,紧张,test-1\r\n"他说""你好""",小雨,开心,test-2', 'test.csv'), [{ text: '你好，世界！', role: '远山', emotion: '紧张', filename: 'test-1' }, { text: '他说"你好"', role: '小雨', emotion: '开心', filename: 'test-2' }]);
  assert.equal(parseScript('文本\t角色\n你好\t温宁', 'test.tsv')[0].role, '温宁');
  assert.throws(() => parseScript('文本\n"未闭合', 'a.csv'));
  console.log('PASS: 90-character SY2, full signature, device / key / domain binding, canonical encoding, legacy rejection, persistence, mandatory activation and CSV / TSV');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
