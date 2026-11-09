import nodemailer from 'nodemailer';

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function activationEmail(order, code) {
  const english = order.customer.locale === 'en';
  const subject = english ? 'Your Shengyue Voice activation code' : '声悦配音 · 你的专业版激活码';
  const lines = english ? [
    'Thank you for purchasing Shengyue Voice Pro.', '', `Order: ${order.orderId}`, `Device: ${order.customer.machineCode}`, '',
    'Your permanent, device-bound activation code:', code, '',
    'Open Shengyue Voice, paste the complete code into the activation screen, and activate.',
    'This code is for the device above. Keep it private. Device transfers require support.', '',
    'For help, scan the WeChat QR code at https://voice.freeteam.top/en/#contact. Download: https://voice.freeteam.top/en/download/',
  ] : [
    '感谢购买声悦配音专业版。', '', `订单号：${order.orderId}`, `设备码：${order.customer.machineCode}`, '',
    '你的专业版永久激活码：', code, '',
    '打开声悦软件，在激活页粘贴完整激活码，点击激活即可。',
    '此授权绑定上述设备，请妥善保管，不要转发；换机请联系售后。', '',
    '需要帮助可在官网扫码联系：https://voice.freeteam.top/#contact。下载：https://voice.freeteam.top/download/',
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#252335"><h1 style="font-size:24px">${escapeHtml(subject)}</h1>${lines.map(line => line === code
    ? `<p style="padding:16px;background:#f1eefb;overflow-wrap:anywhere;font-family:monospace">${escapeHtml(code)}</p>`
    : `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('')}</div>`;
  return { subject, text, html };
}

export function createActivationMailer(env = process.env, transport) {
  if (!transport && ![env.SMTP_HOST, env.SMTP_USERNAME, env.SMTP_PASSWORD, env.SMTP_FROM].every(Boolean)) return null;
  const secure = env.SMTP_SSL === 'true';
  const mailer = transport || nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || (secure ? 465 : 587)), secure,
    requireTLS: !secure, auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    verify: () => mailer.verify(),
    close: () => mailer.close?.(),
    async send(order, code) {
      const result = await mailer.sendMail({
        from: { name: '声悦配音 · Shengyue Voice', address: env.SMTP_FROM },
        to: [{ address: order.customer.email }], replyTo: 'freeteamlite@gmail.com',
        envelope: { from: env.SMTP_FROM, to: [order.customer.email] },
        messageId: `<shengyue-${order.orderId}@voice.freeteam.top>`, ...activationEmail(order, code),
      });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('smtp_recipient_rejected');
      return { messageId: result.messageId };
    },
  };
}
