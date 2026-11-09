import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import product from './product.json' with { type: 'json' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const requestKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function normalize(input) {
  const keys = ['productId', 'email', 'machineCode', 'compatibilityConfirmed', 'compatibilityReport', 'locale'];
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key))) throw fail(400, 'invalid_order');
  if (input.productId !== product.id) throw fail(400, 'invalid_product');
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const machineCode = typeof input.machineCode === 'string' ? input.machineCode.trim().toUpperCase() : '';
  if (email.length > 254 || /[(),;:"\\\[\]\x00-\x1f]/.test(email) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw fail(400, 'invalid_email');
  if (!/^SYD1-[0-9A-F]{32}$/.test(machineCode)) throw fail(400, 'invalid_machine_code');
  if (!['zh-CN', 'en'].includes(input.locale)) throw fail(400, 'invalid_locale');
  // Retain legacy fields and their key order so existing idempotent retries still match.
  // Compatibility records are optional context, never authorization to purchase.
  return { productId: product.id, email, machineCode,
    ...(typeof input.compatibilityConfirmed === 'boolean' ? { compatibilityConfirmed: input.compatibilityConfirmed } : {}), locale: input.locale,
    ...(input.compatibilityReport !== undefined ? { compatibilityReport: input.compatibilityReport } : {}) };
}

export function createOrderStore({ dataDir, environment, siteOrigin }) {
  const directory = path.join(dataDir, environment, 'orders');
  const filename = key => {
    if (!requestKeyPattern.test(key || '')) throw fail(400, 'invalid_request_key');
    return path.join(directory, `${hash(key)}.json`);
  };
  async function get(key) {
    try { return JSON.parse(await readFile(filename(key), 'utf8')); }
    catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
  }
  function publicOrder(record) {
    const home = record.customer.locale === 'en' ? '/en/' : '/';
    return {
      orderId: record.orderId, createdAt: record.createdAt, status: record.status,
      customer: { email: record.customer.email, machineCode: record.customer.machineCode,
        compatibilityConfirmed: record.customer.compatibilityConfirmed, locale: record.customer.locale }, product: record.product,
      checkout: {
        action: environment === 'live' ? 'https://www.paypal.com/cgi-bin/webscr' : 'https://www.sandbox.paypal.com/cgi-bin/webscr',
        fields: {
          cmd: '_s-xclick', hosted_button_id: record.product.hostedButtonId,
          currency_code: record.product.currency, item_number: record.product.id,
          invoice: record.orderId, custom: record.orderId, quantity: '1', no_shipping: '1', charset: 'utf-8',
          notify_url: `${siteOrigin}/api/paypal/webhook`,
          return: `${siteOrigin}${home}?paypal=returned#purchase`,
          cancel_return: `${siteOrigin}${home}?paypal=cancelled#purchase`,
        },
      },
    };
  }
  async function create(input, key, beforeCreate = () => {}) {
    const target = filename(key);
    const customer = normalize(input);
    const fingerprint = hash(JSON.stringify(customer));
    const existing = await get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw fail(409, 'request_key_conflict');
      return { order: publicOrder(existing), duplicate: true };
    }
    beforeCreate();
    const now = new Date();
    const record = {
      schema: 'shengyue-order-1',
      orderId: `SY${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(12).toString('hex').toUpperCase()}`,
      createdAt: now.toISOString(), status: 'pending_payment', environment,
      fingerprint, customer, product: { ...product },
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    let duplicate = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); }
      finally { await file.close(); }
      try { await link(temporary, target); }
      catch (cause) { if (cause.code !== 'EEXIST') throw cause; duplicate = true; }
      const handle = await open(directory, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    } finally { await unlink(temporary).catch(() => {}); }
    const saved = duplicate ? await get(key) : record;
    if (saved.fingerprint !== fingerprint) throw fail(409, 'request_key_conflict');
    return { order: publicOrder(saved), duplicate };
  }
  const byId = new Map();
  async function findById(orderId) {
    if (!/^SY\d{8}-[0-9A-F]{24}$/.test(orderId || '')) return null;
    if (byId.has(orderId)) return byId.get(orderId);
    const files = await readdir(directory).catch(cause => { if (cause.code === 'ENOENT') return []; throw cause; });
    for (const name of files.filter(name => /^[0-9a-f]{64}\.json$/.test(name))) {
      const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      if (record.orderId === orderId) {
        if (byId.size >= 1000) byId.delete(byId.keys().next().value);
        byId.set(orderId, record);
        return record;
      }
    }
    return null;
  }
  return { create, findById, get: async key => { const record = await get(key); return record ? publicOrder(record) : null; } };
}
