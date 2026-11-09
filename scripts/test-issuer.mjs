import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { verifyCode } from '../desktop/license.cjs';

const root = path.resolve(import.meta.dirname, '..');
const machine = 'SYD1-' + '0'.repeat(32);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'shengyue-issuer-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const network = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(path.join(root, 'seller-tools/声悦激活码签发.html')).href);
  await page.locator('#machine').fill(machine);
  await page.locator('#issue').click();
  await page.waitForFunction(() => !document.querySelector('#issue').disabled);
  assert.match(await page.locator('#status').innerText(), /先选择签发私钥/);
  const wrongKey = path.join(temporary, 'wrong-key.pem');
  await writeFile(wrongKey, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await page.locator('#key').setInputFiles(wrongKey);
  await page.locator('#issue').click();
  await page.waitForFunction(() => !document.querySelector('#issue').disabled);
  assert.match(await page.locator('#status').innerText(), /私钥与当前客户端不匹配/);
  assert.equal(await page.locator('#output').inputValue(), '');
  await page.locator('#key').setInputFiles(path.join(root, '.seller/signing-key.pem'));
  await page.locator('#issue').click();
  await page.waitForFunction(() => document.querySelector('#output').value.startsWith('SY2.'));
  const code = await page.locator('#output').inputValue();
  assert.equal(code.length, 90);
  assert.equal(verifyCode(code, machine, await readFile(path.join(root, 'shared/license-public.pem'))).edition, 'pro');
  const issued = execFileSync(process.execPath, [path.join(root, 'scripts/license-admin.cjs'), 'issue', machine], { encoding: 'utf8' }).trim();
  assert.equal(code, issued);
  assert.equal(await page.locator('#report').count(), 0);
  assert.equal(await page.locator('#replacement').count(), 0);
  for (const flags of [['--replacement'], ['--report', path.join(temporary, 'missing-report.json')]]) {
    const legacy = execFileSync(process.execPath, [path.join(root, 'scripts/license-admin.cjs'), 'issue', machine, ...flags], { encoding: 'utf8' }).trim();
    assert.equal(legacy, code);
  }
  await page.locator('#machine').fill('incorrect');
  await page.locator('#issue').click();
  await page.waitForFunction(() => !document.querySelector('#issue').disabled);
  assert.match(await page.locator('#status').innerText(), /机器码应为/);
  assert.equal(await page.locator('#output').inputValue(), '');
  assert.deepEqual(network, []);
  console.log('PASS: browser and Node issuers produce identical 90-character offline codes; wrong key and malformed device rejected; no network requests');
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
