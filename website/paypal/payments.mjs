const fail = (status, message) => Object.assign(new Error(message), { status });
export function receiverMatches(payment, { merchantId, receiverEmail }) {
  if (merchantId) return payment.merchantId === merchantId;
  if (receiverEmail) return payment.receiverEmail?.toLowerCase() === receiverEmail.toLowerCase();
  throw fail(503, 'paypal_receiver_not_configured');
}
export function money(value) {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, cents = ''] = value.split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
}
export async function verifyIpn(raw, { environment, fetchImpl = fetch }) {
  const fields = new URLSearchParams(raw.toString('utf8'));
  for (const key of ['txn_id', 'payment_status', 'invoice', 'custom', 'receiver_email', 'receiver_id', 'mc_gross', 'mc_currency', 'test_ipn', 'quantity']) {
    if (fields.getAll(key).length > 1) throw fail(400, 'duplicate_ipn_field');
  }
  if (environment === 'live' && fields.get('test_ipn') === '1') throw fail(400, 'sandbox_ipn_in_live');
  if (!fields.get('txn_id') || fields.get('txn_id').length > 128) throw fail(400, 'invalid_ipn_transaction');
  const origin = environment === 'live' ? 'https://ipnpb.paypal.com' : 'https://ipnpb.sandbox.paypal.com';
  let result;
  try {
    const response = await fetchImpl(`${origin}/cgi-bin/webscr`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Shengyue-PayPal-IPN/1.0' },
      body: Buffer.concat([Buffer.from('cmd=_notify-validate&'), raw]),
    });
    if (!response.ok) throw new Error('upstream');
    result = (await response.text()).trim();
  } catch { throw fail(503, 'paypal_ipn_verification_unavailable'); }
  if (result !== 'VERIFIED') throw fail(401, 'invalid_paypal_ipn');
  if (fields.get('invoice') && fields.get('custom') && fields.get('invoice') !== fields.get('custom')) throw fail(400, 'conflicting_order_references');
  return {
    source: 'ipn', id: fields.get('txn_id'), completed: fields.get('payment_status') === 'Completed',
    orderId: fields.get('invoice') || fields.get('custom'), amount: fields.get('mc_gross'), currency: fields.get('mc_currency'),
    merchantId: fields.get('receiver_id'), receiverEmail: fields.get('receiver_email'), quantity: fields.get('quantity') || '1',
  };
}
export function webhookPayment(event) {
  if (!['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.SALE.COMPLETED'].includes(event.event_type)) return null;
  const resource = event.resource || {};
  if (resource.invoice_id && resource.custom_id && resource.invoice_id !== resource.custom_id) throw fail(400, 'conflicting_order_references');
  return {
    source: 'webhook', id: resource.id, completed: ['COMPLETED', 'completed'].includes(resource.status || resource.state),
    orderId: resource.invoice_id || resource.custom_id || resource.custom,
    amount: resource.amount?.value || resource.amount?.total, currency: resource.amount?.currency_code || resource.amount?.currency,
    merchantId: resource.payee?.merchant_id, receiverEmail: resource.payee?.email_address || resource.payee?.email, quantity: '1',
  };
}
