import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createOrderStore } from '../paypal/orders.mjs';
import { createFulfillment } from '../paypal/fulfillment.mjs';
import { createLicenseSigner } from '../paypal/licensing.mjs';
import { createActivationMailer, activationEmail } from '../paypal/mailer.mjs';
import { verifyIpn, webhookPayment } from '../paypal/payments.mjs';
import { createWebhookServer } from '../paypal/server.mjs';

const require = createRequire(import.meta.url);
const { verifyCode } = require('../../desktop/license.cjs');
const receiverEmail = 'merchant@example.com';
const machine = 'SYD1-' + 'A'.repeat(32);
function report(machineCode = machine) {
  return { schema: 'shengyue-compatibility-1', machineCode, version: '0.4.6', testedAt: Date.now() - 1000,
    ready: true, heard: true, blocked: false, checks: [], packages: ['light'], results: [{ package: 'light', passed: true, duration: 1, elapsed: 1 }] };
}
const input = () => ({ productId: 'shengyue-pro-perpetual', email: 'customer@example.com', machineCode: machine,
  locale: 'zh-CN' });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'shengyue-fulfillment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keys = generateKeyPairSync('ed25519');
  const keyFile = path.join(directory, 'private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const signer = createLicenseSigner({ privateKeyPath: keyFile, publicKey });
  const orders = createOrderStore({ dataDir: directory, environment: 'live', siteOrigin: 'https://voice.freeteam.top' });
  const { order } = await orders.create(input(), randomUUID());
  const messages = [], logs = [];
  const transport = { async sendMail(mail) { messages.push(mail); return { accepted: [mail.to[0].address], rejected: [], messageId: mail.messageId }; } };
  const mailer = createActivationMailer({ SMTP_FROM: 'sender@example.com' }, transport);
  const options = { dataDir: directory, environment: 'live', orders, signer, mailer, receiverEmail, logger: entry => logs.push(entry) };
  return { directory, orders, order, messages, logs, publicKey, signer, options, queue: createFulfillment(options) };
}
function payment(orderId, overrides = {}) {
  return { source: 'ipn', id: 'PAYMENT-001', completed: true, orderId, amount: '19.00', currency: 'USD', receiverEmail, quantity: '1', ...overrides };
}

test('a matched verified payment issues the desktop-compatible code and emails it once', async t => {
  const f = await fixture(t);
  await Promise.all([f.queue.accept(payment(f.order.orderId)), f.queue.accept(payment(f.order.orderId))]);
  await Promise.all([f.queue.run(), f.queue.run()]);
  assert.equal(f.messages.length, 1);
  const mail = f.messages[0];
  assert.equal(mail.envelope.to[0], 'customer@example.com');
  const code = mail.text.match(/SY2\.[A-Za-z0-9_-]{86}/)[0];
  assert.equal(verifyCode(code, machine, f.publicKey).edition, 'pro');
  assert.throws(() => verifyCode(code, 'SYD1-' + 'B'.repeat(32), f.publicKey));
  assert.equal((await f.queue.status(f.order.orderId)).status, 'delivered');
  await f.queue.accept(payment(f.order.orderId));
  await createFulfillment(f.options).run();
  assert.equal(f.messages.length, 1, 'restarting and replaying must not resend a delivered job');
  assert.ok(!JSON.stringify(f.logs).includes(code));
  assert.ok(!JSON.stringify(f.logs).includes('customer@example.com'));
});

test('wrong receiver, price, currency and reused transaction cannot issue a license', async t => {
  const f = await fixture(t);
  for (const change of [{ receiverEmail: 'attacker@example.com' }, { amount: '0.01' }, { currency: 'EUR' }, { quantity: '2' }, { amount: '19e0' }]) {
    await assert.rejects(f.queue.accept(payment(f.order.orderId, change)), { status: 400 });
  }
  await f.queue.accept(payment(f.order.orderId));
  const other = (await f.orders.create({ ...input(), email: 'other@example.com' }, randomUUID())).order;
  await assert.rejects(f.queue.accept(payment(other.orderId)), { status: 409 });
  await f.queue.run();
  assert.equal(f.messages.length, 1);
});

test('missing, failed, mismatched or expired compatibility records do not block a verified purchase', async t => {
  const f = await fixture(t);
  const contexts = [{}, { compatibilityConfirmed: false, compatibilityReport: { ready: false } },
    { compatibilityReport: report('SYD1-' + 'B'.repeat(32)) }, { compatibilityReport: { ...report(), testedAt: Date.now() - 8 * 86400000 } }];
  for (const [index, context] of contexts.entries()) {
    const key = randomUUID();
    const { order } = await f.orders.create({ ...input(), ...context }, key);
    assert.equal((await f.orders.create({ ...input(), ...context }, key)).duplicate, true);
    await f.queue.accept(payment(order.orderId, { id: `COMPAT-OPTIONAL-${index}` }));
    await f.queue.run();
    assert.equal((await f.queue.status(order.orderId)).status, 'delivered');
    assert.equal(f.messages.length, index + 1);
  }
});

test('only legacy jobs held for a compatibility report resume after payment was verified', async t => {
  for (const reason of ['compatibility_report_required', 'sandbox_no_production_license']) {
    const f = await fixture(t);
    await f.queue.accept(payment(f.order.orderId));
    const folder = path.join(f.directory, 'live/fulfillment/orders');
    const file = path.join(folder, (await readdir(folder))[0]);
    const job = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...job, status: 'needs_review', reason }));
    await createFulfillment(f.options).run();
    assert.equal(f.messages.length, reason === 'compatibility_report_required' ? 1 : 0);
    assert.equal((await f.queue.status(f.order.orderId)).status, reason === 'compatibility_report_required' ? 'delivered' : 'needs_review');
  }
});

test('SMTP failures survive restart and retry the same code and Message-ID', async t => {
  const f = await fixture(t);
  let time = Date.now();
  const attempts = [];
  const mailer = { async send(order, code) {
    attempts.push(code);
    if (attempts.length === 1) throw new Error('SMTP temporary failure with secret details');
    return { messageId: 'fixed-message-id' };
  } };
  const options = { ...f.options, mailer, now: () => time };
  const queue = createFulfillment(options);
  await queue.accept(payment(f.order.orderId));
  await queue.run();
  assert.equal((await queue.status(f.order.orderId)).status, 'delivery_pending');
  const restarted = createFulfillment(options);
  await restarted.run(); assert.equal(attempts.length, 1);
  time += 10 * 60000;
  await restarted.run();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  assert.equal((await restarted.status(f.order.orderId)).status, 'delivered');
  assert.ok(!JSON.stringify(f.logs).includes('secret details'));
});

test('IPN validation posts the original bytes to PayPal and rejects spoofed notifications', async () => {
  const raw = Buffer.from('txn_id=T1&payment_status=Completed&custom=SY123&invoice=SY123&receiver_email=merchant%40example.com&mc_gross=19.00&mc_currency=USD&memo=A%2BB');
  const result = await verifyIpn(raw, { environment: 'live', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://ipnpb.paypal.com/cgi-bin/webscr');
    assert.deepEqual(options.body, Buffer.concat([Buffer.from('cmd=_notify-validate&'), raw]));
    assert.equal(options.redirect, 'error');
    return new Response('VERIFIED');
  } });
  assert.equal(result.completed, true);
  assert.equal(result.receiverEmail, receiverEmail);
  await assert.rejects(verifyIpn(raw, { environment: 'live', fetchImpl: async () => new Response('INVALID') }), { status: 401 });
  await assert.rejects(verifyIpn(Buffer.concat([raw, Buffer.from('&test_ipn=1')]), { environment: 'live' }), { status: 400 });
  await assert.rejects(verifyIpn(Buffer.concat([raw, Buffer.from('&mc_gross=0.01')]), { environment: 'live' }), { status: 400 });
});

test('forged JSON and failed IPN verification never enqueue automatic emails', async t => {
  const f = await fixture(t);
  const server = createWebhookServer({ ...f.options, webhookId: '', siteOrigin: 'https://voice.freeteam.top', fetchImpl: async () => new Response('INVALID') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/paypal/webhook`;
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    id: 'forged', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'forged', status: 'COMPLETED', invoice_id: f.order.orderId, amount: { value: '19.00', currency_code: 'USD' }, payee: { email_address: receiverEmail } },
  }) });
  assert.equal(response.status, 202);
  const ipn = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'txn_id=forged&payment_status=Completed' });
  assert.equal(ipn.status, 401);
  assert.equal(await f.queue.status(f.order.orderId), null);
  assert.equal(f.messages.length, 0);
});

test('verified IPN reaches the durable outbox through the actual HTTP route', async t => {
  const f = await fixture(t);
  const server = createWebhookServer({ ...f.options, webhookId: '', fetchImpl: async () => new Response('VERIFIED') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await server.stopFulfillment(); });
  const body = new URLSearchParams({ txn_id: 'HTTP-IPN-001', payment_status: 'Completed', custom: f.order.orderId, invoice: f.order.orderId,
    receiver_email: receiverEmail, mc_gross: '19.00', mc_currency: 'USD' });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/paypal/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verification, 'verified');
  assert.equal((await f.queue.status(f.order.orderId)).status, 'delivery_pending');
  await f.queue.run();
  assert.equal(f.messages.length, 1);
});

test('email templates escape customer data and English orders get English instructions', async () => {
  const order = { orderId: '<script>bad</script>', customer: { machineCode: machine, locale: 'en' } };
  const mail = activationEmail(order, 'SY2.TEST');
  assert.match(mail.subject, /Shengyue/);
  assert.ok(!mail.html.includes('<script>'));
  assert.match(mail.html, /&lt;script&gt;/);
  const product = JSON.parse(await readFile(new URL('../paypal/product.json', import.meta.url)));
  // Preserve the last paid release for historical orders after the free edition ships.
  assert.equal(product.appVersion, '0.4.7');
});
