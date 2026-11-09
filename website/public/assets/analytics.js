(() => {
  'use strict';
  const source = document.currentScript;
  const id = source?.dataset.measurementId;
  if (!/^G-[A-Z0-9]{10}$/.test(id || '') || location.hostname !== source.dataset.hostname || window.shengyueAnalytics) return;

  // Keep checkout query strings, fragments and form contents out of analytics.
  const page = new URL(location.origin + location.pathname);
  const incoming = new URL(location.href);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = incoming.searchParams.get(key);
    if (value && /^[a-zA-Z0-9._~-]{1,100}$/.test(value)) page.searchParams.set(key, value);
  }
  let referrer = '';
  try { referrer = new URL(document.referrer).origin + '/'; } catch { /* No external referrer. */ }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  const gtag = window.gtag;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('js', new Date());
  gtag('config', id, {
    page_location: page.href,
    page_referrer: referrer,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const supported = new Set(['audio_preview', 'download_options', 'file_download', 'purchase_click', 'order_created', 'begin_checkout']);
  function track(name, details = {}) {
    try {
      if (!supported.has(name)) return;
      const parameters = { send_to: id, page_location: page.href, page_referrer: referrer, language: document.documentElement.lang };
      if (name === 'audio_preview' && /^[a-zA-Z0-9_-]{1,60}$/.test(details.voice_id || '')) parameters.voice_id = details.voice_id;
      if (name === 'file_download') {
        const filename = details.file_name || '';
        if (!/^Shengyue-[0-9.]+-(?:mac-(?:arm64|x64)\.(?:dmg|zip)|windows-setup\.exe|win-x64\.zip)$/.test(filename)) return;
        parameters.file_name = filename;
        parameters.file_extension = filename.split('.').at(-1);
        parameters.link_url = location.origin + '/downloads/' + filename;
      }
      gtag('event', name, parameters);
    } catch { /* Statistics must never interrupt playback, downloads or checkout. */ }
  }
  window.shengyueAnalytics = Object.freeze({ track });

  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    try {
      const target = new URL(anchor.href, location.href);
      if (target.origin !== location.origin) return;
      if (target.pathname.startsWith('/downloads/')) track('file_download', { file_name: target.pathname.split('/').at(-1) });
      else if (target.hash === '#purchase') track('purchase_click');
    } catch { /* Ignore unrelated links. */ }
  }, true);
  document.addEventListener('submit', event => {
    if (event.target.matches?.('.paypal-checkout-form')) track('begin_checkout');
  }, true);

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  document.head.append(script);
})();
