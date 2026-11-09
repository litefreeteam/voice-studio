import http from 'node:http';
import { createHash, randomUUID, verify } from 'node:crypto';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOrderStore } from './orders.mjs';
import { createActivationMailer } from './mailer.mjs';
import { createLicenseSigner } from './licensing.mjs';
import { createFulfillment } from './fulfillment.mjs';
import { verifyIpn, webhookPayment } from './payments.mjs';

export const WEBHOOK_PATH = '/api/paypal/webhook';
const HEADER_NAMES = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig', 'paypal-cert-url', 'paypal-auth-algo'];
const MAX_BODY = 256 * 1024;
const error = (status, message) => Object.assign(new Error(message), { status });

export function crc32(body) {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createVerifier({ webhookId, environment = 'live', fetchImpl = fetch }) {
  const hosts = environment === 'live'
    ? ['api.paypal.com', 'api-m.paypal.com']
    : ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'];
  const certificates = new Map();
  return async (body, headers) => {
    if (HEADER_NAMES.some(name => typeof headers[name] !== 'string' || !headers[name] || headers[name].length > 4096)) {
      throw error(400, 'missing_or_invalid_paypal_headers');
    }
    if (headers['paypal-auth-algo'] !== 'SHA256withRSA') throw error(400, 'unsupported_signature_algorithm');
    let url;
    try { url = new URL(headers['paypal-cert-url']); } catch { throw error(400, 'invalid_certificate_url'); }
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash
      || !/^\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(url.pathname)) {
      throw error(400, 'invalid_certificate_url');
    }
    let certificate = certificates.get(url.href);
    if (!certificate || certificate.expires < Date.now()) {
      try {
        const response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('certificate_download_failed');
        const pem = await response.text();
        if (pem.length > 32768 || !pem.startsWith('-----BEGIN CERTIFICATE-----')) throw new Error('invalid_certificate');
        certificate = { pem, expires: Date.now() + 60 * 60 * 1000 };
        if (certificates.size >= 32) certificates.delete(certificates.keys().next().value);
        certificates.set(url.href, certificate);
      } catch {
        throw error(503, 'paypal_certificate_unavailable');
      }
    }
    const message = `${headers['paypal-transmission-id']}|${headers['paypal-transmission-time']}|${webhookId}|${crc32(body)}`;
    if (!verify('RSA-SHA256', Buffer.from(message), certificate.pem, Buffer.from(headers['paypal-transmission-sig'], 'base64'))) {
      throw error(401, 'invalid_paypal_signature');
    }
  };
}

async function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        chunks.length = 0;
        reject(error(413, 'payload_too_large'));
      } else chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
    request.once('aborted', () => reject(error(400, 'request_aborted')));
  });
}

async function saveEvent(directory, record) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = createHash('sha256').update(record.event.id).digest('hex');
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    // Linking publishes only complete files and never replaces an existing event.
    let duplicate = false;
    try { await link(temporary, path.join(directory, `${name}.json`)); } catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      duplicate = true;
    }
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return duplicate;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function createWebhookServer({
  dataDir = process.env.PAYPAL_DATA_DIR || path.resolve('paypal-data'),
  webhookId = process.env.PAYPAL_WEBHOOK_ID || '',
  environment = process.env.PAYPAL_ENV || 'live',
  fetchImpl = fetch,
  siteOrigin = process.env.PAYPAL_SITE_ORIGIN || 'https://voice.freeteam.top',
  receiverEmail = process.env.PAYPAL_RECEIVER_EMAIL || '',
  merchantId = process.env.PAYPAL_MERCHANT_ID || '',
  signer = createLicenseSigner({ privateKeyPath: process.env.LICENSE_PRIVATE_KEY_PATH }),
  mailer = createActivationMailer(),
  logger = record => console.log(JSON.stringify(record)),
} = {}) {
  if (!['live', 'sandbox'].includes(environment)) throw new Error('PAYPAL_ENV must be live or sandbox');
  if (webhookId === 'WEBHOOK_ID' && environment === 'live') throw new Error('Simulator webhook ID is not allowed in live mode');
  const mode = webhookId ? 'verify' : 'receive-only';
  const verifySignature = createVerifier({ webhookId, environment, fetchImpl });
  if (new URL(siteOrigin).origin !== siteOrigin) throw new Error('PAYPAL_SITE_ORIGIN must be an origin without a trailing slash');
  const orders = createOrderStore({ dataDir, environment, siteOrigin });
  const fulfillment = createFulfillment({ dataDir, environment, orders, signer, mailer, receiverEmail, merchantId, logger });
  const clients = new Map();
  function limitOrders(request) {
    // The service only listens on loopback; Nginx supplies the immediate client address.
    const address = request.headers['x-real-ip'] || request.socket.remoteAddress;
    const now = Date.now();
    const previous = clients.get(address);
    const current = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60 * 1000 };
    if (++current.count > 20) throw error(429, 'too_many_orders');
    clients.delete(address);
    if (clients.size >= 10000) clients.delete(clients.keys().next().value);
    clients.set(address, current);
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Robots-Tag', 'noindex');
    const send = (status, result) => { response.writeHead(status); response.end(JSON.stringify(result)); };
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api/paypal/orders') {
        if (request.method === 'GET') {
          const key = (request.headers.authorization || '').match(/^Bearer ([a-f0-9-]+)$/i)?.[1];
          if (!key) return send(401, { error: 'order_access_required' });
          const order = await orders.get(key);
          if (order) Object.assign(order, await fulfillment.status(order.orderId));
          return order ? send(200, order) : send(404, { error: 'order_not_found' });
        }
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'GET, POST');
          return send(405, { error: 'method_not_allowed' });
        }
        if (request.headers.origin !== siteOrigin) return send(403, { error: 'invalid_origin' });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return send(415, { error: 'expected_application_json' });
        let input;
        try { input = JSON.parse((await readBody(request)).toString('utf8')); }
        catch (cause) { if (cause.status) throw cause; throw error(400, 'invalid_json'); }
        const { order, duplicate } = await orders.create(input, request.headers['idempotency-key'], () => limitOrders(request));
        logger({ action: 'order_created', orderId: order.orderId, duplicate });
        return send(duplicate ? 200 : 201, order);
      }
      if (![WEBHOOK_PATH, '/api/paypal/healthz'].includes(pathname)) return send(404, { error: 'not_found' });
      if (['GET', 'HEAD'].includes(request.method)) return send(200, {
        ok: true, service: 'shengyue-paypal', mode, environment, ipn: 'verify',
        fulfillment: fulfillment.ready() ? 'ready' : 'needs-configuration',
      });
      if (request.method !== 'POST' || pathname !== WEBHOOK_PATH) {
        response.setHeader('Allow', pathname === WEBHOOK_PATH ? 'GET, HEAD, POST' : 'GET, HEAD');
        return send(405, { error: 'method_not_allowed' });
      }
      if (/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        const raw = await readBody(request);
        const payment = await verifyIpn(raw, { environment, fetchImpl });
        const event = { id: `IPN-${createHash('sha256').update(raw).digest('hex')}`,
          event_type: payment.completed ? 'PAYMENT.SALE.COMPLETED' : 'PAYPAL.IPN.NOT_COMPLETED', resource: payment };
        const duplicate = await saveEvent(path.join(dataDir, environment, 'verified'), {
          receivedAt: new Date().toISOString(), environment, verification: 'verified', source: 'ipn', rawBody: raw.toString('utf8'), event,
        });
        await fulfillment.accept(payment);
        logger({ action: 'ipn_received', paymentId: payment.id, completed: payment.completed, duplicate });
        return send(200, { received: true, verification: 'verified', duplicate });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return send(415, { error: 'expected_application_json' });
      const raw = await readBody(request);
      let event;
      try { event = JSON.parse(raw.toString('utf8')); } catch { throw error(400, 'invalid_json'); }
      if (!event || Array.isArray(event) || typeof event.id !== 'string' || !event.id.trim() || event.id.length > 256
        || typeof event.event_type !== 'string' || !event.event_type.trim() || event.event_type.length > 128) {
        throw error(400, 'invalid_webhook_event');
      }
      if (webhookId) await verifySignature(raw, request.headers);
      const verification = webhookId ? 'verified' : 'unverified';
      const record = {
        receivedAt: new Date().toISOString(), environment, verification,
        headers: Object.fromEntries(HEADER_NAMES.filter(name => request.headers[name]).map(name => [name, request.headers[name]])),
        rawBody: raw.toString('utf8'), event,
      };
      const duplicate = await saveEvent(path.join(dataDir, environment, verification), record);
      if (webhookId) await fulfillment.accept(webhookPayment(event));
      logger({ action: 'webhook_received', eventId: event.id, eventType: event.event_type, verification, duplicate });
      send(webhookId ? 200 : 202, { received: true, verification, duplicate });
    } catch (cause) {
      logger({ action: 'request_failed', error: cause.status ? cause.message : 'internal_error' });
      send(cause.status || 500, { error: cause.status ? cause.message : 'internal_error' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('listening', () => fulfillment.start());
  server.on('close', () => fulfillment.stop());
  server.stopFulfillment = () => fulfillment.stop();
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const port = Number(process.env.PAYPAL_PORT || 3087);
  const server = createWebhookServer();
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ action: 'listening', host: '127.0.0.1', port: server.address().port })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(async () => { await server.stopFulfillment(); process.exit(0); });
    setTimeout(() => process.exit(1), 30000).unref();
  });
}
