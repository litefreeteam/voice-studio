const { generateKeyPairSync, sign } = require('node:crypto');
const { licenseMessage } = require('../desktop/license.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const operation = process.argv[2];
if (operation === 'init') {
  const folder = path.join(root, '.seller'); fs.mkdirSync(folder, { recursive: true });
  const privateFile = path.join(folder, 'signing-key.pem');
  if (fs.existsSync(privateFile) || fs.existsSync(path.join(root, 'shared/license-public.pem'))) throw new Error('已有签发密钥，禁止覆盖。请先备份并核对现有授权。');
  const keys = generateKeyPairSync('ed25519');
  fs.writeFileSync(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'shared/license-public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('签发密钥已保存到 .seller/signing-key.pem。请离线备份，不要发给客户。');
} else if (operation === 'issue') {
  const machine = process.argv[3];
  if (!/^SYD1-[0-9A-F]{32}$/.test(machine || '')) throw new Error('请提供客户的完整机器码');
  const flags = process.argv.slice(4);
  // Older seller commands may still pass --report; reports no longer gate issuance.
  if (flags.length && !(flags.length === 1 && flags[0] === '--replacement') && !(flags.length === 2 && flags[0] === '--report')) throw new Error('签发仅需客户机器码；已购补发可使用 --replacement');
  const signature = sign(null, licenseMessage(machine), fs.readFileSync(path.join(root, '.seller/signing-key.pem')));
  console.log(`SY2.${signature.toString('base64url')}`);
} else console.log('初始化：node scripts/license-admin.cjs init\n签发授权：node scripts/license-admin.cjs issue 客户机器码\n已购补发：node scripts/license-admin.cjs issue 客户机器码 --replacement');
