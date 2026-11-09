import { useEffect, useRef, useState } from 'react';
import { ArrowUpRightIcon, CopyIcon } from '@phosphor-icons/react';
import product from '../paypal/product.json';
import { createTranslator, contactHref, localizedPath } from './i18n.mjs';
import './purchase.css';

const storageKey = 'shengyue-pending-order-v1';
const errorMessages = {
  invalid_email: '请填写有效的邮箱地址。',
  invalid_machine_code: '请粘贴软件激活页显示的完整设备码。',
  too_many_orders: '创建订单过于频繁，请稍后再试。',
};

export function PurchaseSection({ locale }) {
  const t = createTranslator(locale);
  const [email, setEmail] = useState('');
  const [machineCode, setMachineCode] = useState('');
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [returnState, setReturnState] = useState('');
  const attempt = useRef(null);
  const orderHeading = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setReturnState(new URLSearchParams(window.location.search).get('paypal') || '');
    async function restore() {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (!saved?.key || !saved.input) return;
        attempt.current = saved;
        setEmail(saved.input.email || '');
        setMachineCode(saved.input.machineCode || '');
        const response = await fetch('/api/paypal/orders', {
          headers: { Authorization: `Bearer ${saved.key}` }, signal: controller.signal,
        });
        if (response.status === 404) return;
        if (!response.ok) throw new Error('restore_failed');
        setOrder(await response.json());
      } catch (cause) {
        if (cause.name !== 'AbortError') setMessage('暂时无法恢复订单，请重试或凭订单号扫码联系客服。');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    restore();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!order || ['delivered', 'needs_review'].includes(order.status) || !attempt.current?.key) return;
    const controller = new AbortController();
    let tries = 0;
    const timer = setInterval(async () => {
      if (++tries > 60) { clearInterval(timer); return; }
      try {
        const response = await fetch('/api/paypal/orders', { headers: { Authorization: `Bearer ${attempt.current.key}` }, signal: controller.signal });
        if (response.ok) setOrder(await response.json());
      } catch { /* Reloading can recover an order after a network interruption. */ }
    }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [order?.orderId, order?.status]);

  async function createOrder(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const input = { productId: product.id, email: email.trim(), machineCode: machineCode.trim().toUpperCase(), locale };
      if (!attempt.current || Object.entries(input).some(([key, value]) => attempt.current.input[key] !== value)) {
        attempt.current = { key: crypto.randomUUID(), input };
      }
      // Keep the same key for a retry, including after a lost response or page reload.
      try { sessionStorage.setItem(storageKey, JSON.stringify(attempt.current)); } catch { /* In-memory retries still work if browser storage is unavailable. */ }
      const response = await fetch('/api/paypal/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
        body: JSON.stringify(attempt.current.input), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(errorMessages[result.error] || '订单未能保存，请重试；确认出现订单号后再付款。');
      setOrder(result);
      window.shengyueAnalytics?.track('order_created');
      requestAnimationFrame(() => orderHeading.current?.focus());
    } catch (cause) {
      setMessage(Object.values(errorMessages).includes(cause.message) || cause.message === '订单未能保存，请重试；确认出现订单号后再付款。'
        ? cause.message : '订单未能保存，请重试；确认出现订单号后再付款。');
    } finally { setBusy(false); }
  }

  async function copyOrder() {
    try { await navigator.clipboard.writeText(order.orderId); setMessage('订单号已复制。'); }
    catch { setMessage('请手动选择并复制上方订单号。'); }
  }

  function editOrder() {
    setOrder(null);
    setReturnState('');
    setMessage('');
    // A saved order is immutable. Edited details create a new purchase intent.
    attempt.current = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional browser storage. */ }
  }

  return <section className="purchase-section section" id="purchase" aria-labelledby="purchase-title">
    <div className="container purchase-layout">
      <div className="purchase-copy">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h2 id="purchase-title">{t('为你的电脑，开启专业创作。')}</h2>
        <p>{t('声悦专业版永久授权')}<br />{t('绑定当前设备，激活后不限生成次数。')}</p>
        <p className="purchase-price">US${Number(product.amount)} <span>{t('一次性付款')}</span></p>
        <ol className="purchase-steps">
          <li>{t('下载安装软件，复制激活页的设备码。')}</li>
          <li>{t('填写邮箱和设备码，生成本次购买的订单号。')}</li>
          <li>{t('通过 PayPal 付款，验证通过后激活码会自动发送到填写的邮箱。')}</li>
        </ol>
        <p className="purchase-help">{t('如未收到邮件，请检查垃圾邮件，或凭订单号联系售后。')} <a href={contactHref(locale)}>{t('扫码联系客服')}</a></p>
        <a className="text-link" href={localizedPath('/download/', locale)}>{t('查看安装包与设备要求')}<ArrowUpRightIcon size={17} /></a>
      </div>
      <div className="purchase-card" aria-busy={busy}>
        {!order ? <form onSubmit={createOrder} className="purchase-form">
          <h3>{t('创建购买订单')}</h3>
          <p>{t('邮箱和设备码将用于核对订单与签发授权，请确认无误。')}</p>
          <label htmlFor="purchase-email">{t('接收激活码邮箱')}<input id="purchase-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
          <label htmlFor="purchase-machine">{t('设备码')}<input id="purchase-machine" type="text" autoCapitalize="characters" autoComplete="off" spellCheck="false" placeholder="SYD1-…" pattern="[Ss][Yy][Dd]1-[0-9A-Fa-f]{32}" maxLength={37} required value={machineCode} onChange={event => setMachineCode(event.target.value.trim().toUpperCase())} disabled={busy} aria-describedby="purchase-machine-help" /></label>
          <p id="purchase-machine-help" className="purchase-field-help">{t('从声悦软件的激活页复制设备码；授权将绑定这台电脑。')}</p>
          <button className="button primary" type="submit" disabled={busy}>{busy ? t('正在准备订单…') : t('生成订单')}</button>
          <small>{t('生成订单不会扣款，下一步将在 PayPal 确认并付款。')}</small>
        </form> : <div className="purchase-order">
          <h3 ref={orderHeading} tabIndex={-1}>{t('订单已保存')}</h3>
          <p className="purchase-status">{order.status === 'delivered' ? t('激活码邮件已提交发送，请检查收件箱和垃圾邮件。') : order.status === 'delivery_pending' ? t('付款已验证，正在发送激活码邮件，请勿重复付款。') : order.status === 'needs_review' ? t('付款已记录，此订单需要人工核实，请凭订单号联系售后。') : returnState === 'returned' ? t('已返回官网，付款结果仍需核实。请勿重复付款。') : returnState === 'cancelled' ? t('你已返回官网；订单仍保留，尚未确认付款。') : t('等待付款，请先核对以下购买信息。')}</p>
          <dl>
            <div><dt>{t('网站订单号')}</dt><dd><code className="purchase-order-id">{order.orderId}</code><button type="button" className="text-link" onClick={copyOrder}><CopyIcon size={15} />{t('复制订单号')}</button></dd></div>
            <div><dt>{t('购买商品')}</dt><dd>{locale === 'en' ? order.product.nameEn : order.product.name}</dd></div>
            <div><dt>{t('付款金额')}</dt><dd>US${order.product.amount}</dd></div>
            <div><dt>{t('接收激活码邮箱')}</dt><dd>{order.customer.email}</dd></div>
            <div><dt>{t('设备码')}</dt><dd><code>{order.customer.machineCode}</code></dd></div>
          </dl>
          {order.status === 'pending_payment' && <form action={order.checkout.action} method="post" target="_top" className="paypal-checkout-form">
            {Object.entries(order.checkout.fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            <button type="submit" className="button primary">{t('前往 PayPal 付款')}<ArrowUpRightIcon size={18} /></button>
          </form>}
          <p className="purchase-field-help">{t('如已付款，请保留订单号并等待激活码邮件，不要再次支付。')}</p>
          {order.status === 'pending_payment' && <button type="button" className="text-link purchase-edit" onClick={editOrder}>{t('修改购买信息并重新生成订单')}</button>}
        </div>}
        {message && <p className="purchase-message" role="status">{t(message)}</p>}
        <noscript><p>{t('在线下单需要启用 JavaScript，也可扫码联系购买。')} <a href={contactHref(locale)}>{t('扫码联系客服')}</a></p></noscript>
      </div>
    </div>
  </section>;
}
