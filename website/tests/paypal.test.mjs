import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWebhookServer, createVerifier, crc32, WEBHOOK_PATH } from '../paypal/server.mjs';

let fixtureDir, privateKey, certificate;
before(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'paypal-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(fixtureDir, 'key.pem'),
    '-out', path.join(fixtureDir, 'cert.pem'), '-days', '1', '-subj', '/CN=webhook-test'], { stdio: 'ignore' });
  privateKey = await readFile(path.join(fixtureDir, 'key.pem'));
  certificate = await readFile(path.join(fixtureDir, 'cert.pem'), 'utf8');
});
after(async () => rm(fixtureDir, { recursive: true, force: true }));

const event = { id: 'WH-TEST-001', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-TEST', status: 'COMPLETED' } };
function signedHeaders(raw, webhookId = 'registered-webhook') {
  const id = 'transmission-001', time = new Date().toISOString();
  const message = `${id}|${time}|${webhookId}|${crc32(Buffer.from(raw))}`;
  return {
    'content-type': 'application/json', 'paypal-transmission-id': id, 'paypal-transmission-time': time,
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-TEST',
    'paypal-transmission-sig': sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64'),
  };
}
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'paypal-events-'));
  const server = createWebhookServer({ dataDir, webhookId: '', environment: 'live', logger: () => {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, url: `http://127.0.0.1:${server.address().port}` };
}

test('receive-only mode persists unverified notifications and deduplicates concurrent deliveries', async t => {
  const { url, dataDir } = await fixture(t);
  const health = await fetch(`${url}/api/paypal/healthz`);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal((await health.json()).mode, 'receive-only');
  const replies = await Promise.all(Array.from({ length: 4 }, async () => {
    const response = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
    assert.equal(response.status, 202);
    return response.json();
  }));
  assert.equal(replies.filter(reply => !reply.duplicate).length, 1);
  assert.ok(replies.every(reply => reply.verification === 'unverified'));
  const directory = path.join(dataDir, 'live/unverified');
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const record = JSON.parse(await readFile(path.join(directory, files[0])));
  assert.deepEqual(record.event, event);
  assert.equal(record.rawBody, JSON.stringify(event));
  assert.equal(record.verification, 'unverified');
  assert.equal((await fetch(`${url}/paypal-data/${files[0]}`)).status, 404);
});

test('verified mode checks original bytes and rejects modified or unsigned payloads', async t => {
  const { url, dataDir } = await fixture(t, {
    webhookId: 'registered-webhook', fetchImpl: async () => new Response(certificate),
  });
  const raw = JSON.stringify({ ...event, summary: '支付成功' }, null, 2);
  const headers = signedHeaders(raw);
  const response = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers, body: raw });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verification, 'verified');
  assert.equal((await readdir(path.join(dataDir, 'live/verified'))).length, 1);
  const modified = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers, body: raw.replace('支付成功', '订单取消') });
  assert.equal(modified.status, 401);
  const unsigned = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
  assert.equal(unsigned.status, 400);
  const reformatted = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers, body: JSON.stringify(JSON.parse(raw)) });
  assert.equal(reformatted.status, 401);
});

test('certificate downloads cannot target arbitrary hosts, redirects, or sandbox in live mode', async () => {
  let calls = 0;
  const verifier = createVerifier({ webhookId: 'registered-webhook', fetchImpl: async () => { calls++; throw new Error('offline'); } });
  const raw = Buffer.from(JSON.stringify(event));
  for (const certUrl of ['http://127.0.0.1/admin', 'https://api.paypal.com.attacker.test/v1/notifications/certs/CERT-X',
    'https://api.paypal.com:444/v1/notifications/certs/CERT-X', 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-X', 'invalid']) {
    await assert.rejects(verifier(raw, { ...signedHeaders(raw), 'paypal-cert-url': certUrl }), { status: 400 });
  }
  assert.equal(calls, 0);
  await assert.rejects(verifier(raw, signedHeaders(raw)), { status: 503 });
});

test('malformed, oversized and unsupported requests are rejected', async t => {
  const { url } = await fixture(t);
  for (const [body, status] of [['{', 400], ['null', 400], ['{}', 400], [JSON.stringify({ ...event, id: '' }), 400], ['x'.repeat(262145), 413]]) {
    const response = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, status);
  }
  assert.equal((await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', body: 'hello' })).status, 415);
  assert.equal((await fetch(`${url}${WEBHOOK_PATH}`, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${url}/api/paypal/healthz`, { method: 'POST' })).status, 405);
});

test('storage failures return an error so PayPal can retry', async t => {
  const { url } = await fixture(t, { dataDir: path.join(fixtureDir, 'cert.pem') });
  const response = await fetch(`${url}${WEBHOOK_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(response.status, 500);
});

test('CRC32 matches the standard vector and simulator ID is rejected in live mode', () => {
  assert.equal(crc32(Buffer.from('123456789')), 3421780262);
  assert.throws(() => createWebhookServer({ webhookId: 'WEBHOOK_ID', environment: 'live' }), /Simulator/);
});

test('CLI entry starts through the current release symlink used by systemd', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paypal-release-'));
  await symlink(fileURLToPath(new URL('../paypal', import.meta.url)), path.join(directory, 'current'));
  const child = spawn(process.execPath, [path.join(directory, 'current/server.mjs')], {
    env: { ...process.env, PAYPAL_PORT: '0', PAYPAL_WEBHOOK_ID: '', PAYPAL_ENV: 'live', PAYPAL_DATA_DIR: path.join(directory, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    }
    await rm(directory, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('CLI did not listen')), 5000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0]).port); }
    });
  });
  assert.ok(port > 0);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/paypal/healthz`)).status, 200);
});
