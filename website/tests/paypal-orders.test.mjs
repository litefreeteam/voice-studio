import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWebhookServer } from '../paypal/server.mjs';

const origin = 'https://voice.freeteam.top';
const input = { productId: 'shengyue-pro-perpetual', email: 'customer@example.com', machineCode: 'SYD1-' + 'A'.repeat(32), locale: 'zh-CN' };
async function start(t, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'shengyue-orders-'));
  const options = { dataDir: directory, environment: 'live', webhookId: '', logger: () => {}, ...overrides };
  const servers = [];
  async function listen() {
    const server = createWebhookServer(options);
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/api/paypal/orders`;
  }
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, listen, url: await listen() };
}
const post = (url, key, value = input, extra = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': key, ...extra }, body: JSON.stringify(value),
});

test('saved orders bind product/email/device and pass one order number to invoice/custom', async t => {
  const logs = [];
  const { directory, url } = await start(t, { logger: value => logs.push(value) });
  const key = randomUUID();
  const response = await post(url, key);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const order = await response.json();
  assert.match(order.orderId, /^SY\d{8}-[0-9A-F]{24}$/);
  assert.equal(order.status, 'pending_payment');
  assert.equal(order.product.amount, '19.00');
  assert.equal(order.product.currency, 'USD');
  assert.equal(order.product.hostedButtonId, '9CXPDVNDNZXJ2');
  assert.equal(order.customer.email, input.email);
  assert.equal(order.customer.machineCode, input.machineCode);
  assert.equal(order.checkout.action, 'https://www.paypal.com/cgi-bin/webscr');
  assert.equal(order.checkout.fields.invoice, order.orderId);
  assert.equal(order.checkout.fields.custom, order.orderId);
  assert.equal(order.checkout.fields.hosted_button_id, order.product.hostedButtonId);
  assert.equal(order.checkout.fields.item_number, input.productId);
  assert.equal(order.checkout.fields.return, origin + '/?paypal=returned#purchase');
  assert.equal(order.checkout.fields.cancel_return, origin + '/?paypal=cancelled#purchase');
  const folder = path.join(directory, 'live/orders');
  const files = await readdir(folder);
  assert.equal(files.length, 1);
  const savedFile = path.join(folder, files[0]);
  const saved = JSON.parse(await readFile(savedFile, 'utf8'));
  assert.equal(saved.orderId, order.orderId);
  assert.equal((await stat(savedFile)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(logs).includes(input.email));
  assert.ok(!JSON.stringify(logs).includes(input.machineCode));
  assert.ok(!JSON.stringify(saved).includes(key));
});

test('concurrent retries, lost responses and a restart recover one immutable order', async t => {
  const { directory, url, listen } = await start(t);
  const key = randomUUID();
  const replies = await Promise.all(Array.from({ length: 5 }, () => post(url, key)));
  assert.equal(replies.filter(reply => reply.status === 201).length, 1);
  const orders = await Promise.all(replies.map(reply => reply.json()));
  assert.equal(new Set(orders.map(order => order.orderId)).size, 1);
  assert.equal((await readdir(path.join(directory, 'live/orders'))).length, 1);
  const afterRestart = await listen();
  const recovered = await fetch(afterRestart, { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), orders[0]);
  assert.equal((await post(afterRestart, key)).status, 200);
  assert.equal((await post(afterRestart, key, { ...input, machineCode: 'SYD1-' + 'B'.repeat(32) })).status, 409);
  const separate = await post(afterRestart, randomUUID());
  assert.equal(separate.status, 201);
  assert.notEqual((await separate.json()).orderId, orders[0].orderId);
});

test('checkout accepts email and device code without compatibility prerequisites, including legacy retries', async t => {
  const { url } = await start(t);
  for (const context of [{}, { compatibilityConfirmed: false }, { compatibilityConfirmed: true, compatibilityReport: null },
    { compatibilityConfirmed: true, compatibilityReport: { ready: false } }]) {
    const key = randomUUID();
    const value = { ...input, ...context };
    const response = await post(url, key, value);
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.checkout.fields.invoice, order.orderId);
    const retry = await post(url, key, value);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).orderId, order.orderId);
    const recovered = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal((await recovered.json()).orderId, order.orderId);
  }
});

test('private orders require the browser key and cannot be fetched by order number', async t => {
  const { url } = await start(t);
  const order = await (await post(url, randomUUID())).json();
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${randomUUID()}` } })).status, 404);
  assert.equal((await fetch(`${url}/${order.orderId}`)).status, 404);
  assert.equal((await fetch(url.replace('/api/paypal/orders', '/paypal-data/live/orders'))).status, 404);
});

test('invalid inputs, cross-site orders and price/status overrides are rejected', async t => {
  const { url } = await start(t);
  for (const value of [null, [], {}, { ...input, amount: '0.01' }, { ...input, status: 'paid' },
    { ...input, productId: 'other-game' }, { ...input, email: 'invalid' }, { ...input, email: 'a\r\n@example.com' },
    { ...input, machineCode: '../../key' }, { ...input, locale: 'other' }]) {
    assert.equal((await post(url, randomUUID(), value)).status, 400, JSON.stringify(value));
  }
  assert.equal((await post(url, 'fixed-order-number')).status, 400);
  assert.equal((await post(url, randomUUID(), input, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post(url, randomUUID(), input, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(url, { method: 'PUT' })).status, 405);
});

test('English checkout returns to English, and rate limits still allow existing-order retries', async t => {
  const { url } = await start(t);
  const key = randomUUID();
  const english = await (await post(url, key, { ...input, locale: 'en' })).json();
  assert.equal(english.checkout.fields.return, origin + '/en/?paypal=returned#purchase');
  for (let index = 0; index < 19; index++) assert.equal((await post(url, randomUUID())).status, 201);
  assert.equal((await post(url, randomUUID())).status, 429);
  assert.equal((await post(url, key, { ...input, locale: 'en' })).status, 200);
});

test('failed persistence never returns checkout parameters or successful order creation', async t => {
  const { directory, listen } = await start(t);
  await writeFile(path.join(directory, 'live'), 'not a directory');
  const response = await post(await listen(), randomUUID());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal_error' });
});
