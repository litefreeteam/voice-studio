import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { hash, readJson, writeJson } from './storage.mjs';
import { receiverMatches, money } from './payments.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function createFulfillment({ dataDir, environment, orders, signer, mailer, merchantId = '', receiverEmail = '', logger = () => {}, now = Date.now }) {
  const directory = path.join(dataDir, environment, 'fulfillment');
  const jobFile = orderId => path.join(directory, 'orders', `${hash(orderId)}.json`);
  let running = false, timer, stopped = false, currentRun;
  const ready = () => environment === 'live' && !!signer && !!mailer && !!(merchantId || receiverEmail);

  async function accept(payment) {
    if (!payment?.completed) return { queued: false };
    if (!payment.orderId) {
      logger({ action: 'payment_needs_review', reason: 'missing_order_reference', paymentId: payment.id });
      return { queued: false };
    }
    if (!payment.id || payment.id.length > 128) throw fail(400, 'invalid_payment_id');
    if (!receiverMatches(payment, { merchantId, receiverEmail })) throw fail(400, 'payment_receiver_mismatch');
    const order = await orders.findById(payment.orderId);
    if (!order) throw fail(400, 'payment_order_not_found');
    if (order.environment !== environment || payment.currency !== order.product.currency || money(payment.amount) !== money(order.product.amount)
      || money(payment.amount) === null || payment.quantity !== '1') throw fail(400, 'payment_order_mismatch');
    const claimFile = path.join(directory, 'transactions', `${hash(payment.id)}.json`);
    await writeJson(claimFile, { orderId: order.orderId, paymentId: payment.id }, { exclusive: true });
    if ((await readJson(claimFile)).orderId !== order.orderId) throw fail(409, 'payment_already_used');
    let status = 'pending', reason = '';
    if (environment !== 'live') { status = 'needs_review'; reason = 'sandbox_no_production_license'; }
    const created = await writeJson(jobFile(order.orderId), {
      orderId: order.orderId, paymentId: payment.id, paymentSource: payment.source,
      status, reason, attempts: 0, nextAttemptAt: 0, createdAt: new Date(now()).toISOString(),
    }, { exclusive: true });
    logger({ action: 'fulfillment_queued', orderId: order.orderId, status, duplicate: !created });
    return { queued: true, duplicate: !created };
  }

  async function run() {
    if (running || stopped || !ready()) return;
    running = true;
    try {
      const files = await readdir(path.join(directory, 'orders')).catch(cause => { if (cause.code === 'ENOENT') return []; throw cause; });
      for (const name of files.filter(name => name.endsWith('.json'))) {
        if (stopped) break;
        const file = path.join(directory, 'orders', name);
        const job = await readJson(file);
        // These jobs already passed payment verification and were held only for a report.
        if (job.status === 'needs_review' && job.reason === 'compatibility_report_required') {
          job.status = 'pending'; job.reason = '';
          await writeJson(file, job);
        }
        if (!['pending', 'retry'].includes(job.status) || job.nextAttemptAt > now()) continue;
        const order = await orders.findById(job.orderId);
        if (!order) continue;
        try {
          const code = signer(order.customer.machineCode);
          job.attempts++;
          job.lastAttemptAt = new Date(now()).toISOString();
          // Persist the attempt before SMTP; retry always reuses the same deterministic code and Message-ID.
          await writeJson(file, job);
          const delivery = await mailer.send(order, code);
          job.status = 'delivered'; job.deliveredAt = new Date(now()).toISOString(); job.messageId = delivery.messageId;
          delete job.lastError;
          await writeJson(file, job);
          logger({ action: 'activation_email_accepted', orderId: job.orderId, attempts: job.attempts });
        } catch {
          job.status = job.attempts >= 10 ? 'needs_review' : 'retry';
          job.lastError = 'activation_delivery_failed';
          job.nextAttemptAt = now() + Math.min(6 * 3600000, 60000 * 2 ** Math.min(job.attempts, 8));
          await writeJson(file, job);
          logger({ action: 'activation_email_failed', orderId: job.orderId, attempts: job.attempts, status: job.status });
        }
      }
    } finally { running = false; }
  }
  return {
    accept, run, ready,
    async status(orderId) {
      const job = await readJson(jobFile(orderId));
      if (!job) return null;
      return { status: job.status === 'delivered' ? 'delivered' : job.status === 'needs_review' ? 'needs_review' : 'delivery_pending', deliveredAt: job.deliveredAt || null };
    },
    start() {
      const tick = () => { currentRun = run().catch(() => logger({ action: 'fulfillment_worker_failed' })); };
      stopped = false; tick(); timer = setInterval(tick, 15000); timer.unref();
    },
    async stop() { stopped = true; clearInterval(timer); await currentRun; mailer?.close?.(); },
  };
}
