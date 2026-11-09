import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { analyticsTag } from '../scripts/analytics-config.mjs';

const source = await readFile(new URL('../public/assets/analytics.js', import.meta.url), 'utf8');
const config = JSON.parse(await readFile(new URL('../analytics.json', import.meta.url), 'utf8'));
const release = JSON.parse(await readFile(new URL('../src/release.json', import.meta.url), 'utf8'));

function load(href = 'https://voice.freeteam.top/') {
  const listeners = {}, scripts = [], window = {};
  const document = {
    currentScript: { dataset: { measurementId: config.measurementId, hostname: config.hostname } },
    documentElement: { lang: 'zh-CN' },
    referrer: 'https://t.co/source?email=private@example.com#private',
    addEventListener(name, listener) { listeners[name] = listener; },
    createElement() { return {}; },
    head: { append(script) { scripts.push(script); } },
  };
  const context = vm.createContext({ window, document, location: new URL(href), URL, Date, Set });
  vm.runInContext(source, context);
  return { window, listeners, scripts, repeat: () => vm.runInContext(source, context), calls: () => Array.from(window.dataLayer || [], args => Array.from(args)) };
}

test('production analytics preserves campaign attribution while excluding checkout data and arbitrary event fields', () => {
  const app = load('https://voice.freeteam.top/en/?utm_source=x&utm_campaign=launch&email=private@example.com&machineCode=SYD1-private&orderId=private#secret');
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + config.measurementId);
  const setup = app.calls().find(call => call[0] === 'config');
  assert.equal(setup[1], config.measurementId);
  assert.equal(setup[2].page_location, 'https://voice.freeteam.top/en/?utm_source=x&utm_campaign=launch');
  assert.equal(setup[2].page_referrer, 'https://t.co/');
  assert.equal(setup[2].allow_google_signals, false);
  assert.equal(setup[2].allow_ad_personalization_signals, false);
  app.window.shengyueAnalytics.track('audio_preview', { voice_id: 'clear-female', email: 'private@example.com', machineCode: 'SYD1-private' });
  app.window.shengyueAnalytics.track('order_created', { orderId: 'private' });
  app.window.shengyueAnalytics.track('purchase', { transaction_id: 'private' });
  const events = app.calls().filter(call => call[0] === 'event');
  assert.deepEqual(events.map(call => call[1]), ['audio_preview', 'order_created']);
  assert.equal(events[0][2].voice_id, 'clear-female');
  assert.ok(!JSON.stringify(app.calls()).includes('private'));
});

test('download and checkout events describe actions without reading form data or interrupting navigation', () => {
  const app = load();
  const click = href => app.listeners.click({ target: { closest: () => ({ href }) }, preventDefault() { throw new Error('Must not block downloads'); } });
  for (const filename of Object.keys(release.sha256)) click('https://voice.freeteam.top/downloads/' + filename);
  click('https://voice.freeteam.top/downloads/SHA256SUMS.txt');
  click('https://voice.freeteam.top/#purchase');
  click('https://other.example/#purchase');
  app.listeners.submit({ target: { matches: selector => selector === '.paypal-checkout-form', get elements() { throw new Error('Must not read checkout fields'); } } });
  const events = app.calls().filter(call => call[0] === 'event');
  assert.deepEqual(events.filter(call => call[1] === 'file_download').map(call => call[2].file_name).sort(), Object.keys(release.sha256).sort());
  assert.equal(events.filter(call => call[1] === 'purchase_click').length, 1);
  assert.equal(events.filter(call => call[1] === 'begin_checkout').length, 1);
});

test('local previews send no analytics and repeated initialization produces no duplicate pageviews or listeners', () => {
  const local = load('http://127.0.0.1:4173/');
  assert.equal(local.scripts.length, 0);
  assert.equal(local.calls().length, 0);
  const production = load();
  const listener = production.listeners.click;
  production.repeat();
  assert.equal(production.scripts.length, 1);
  assert.equal(production.calls().filter(call => call[0] === 'config').length, 1);
  assert.equal(production.listeners.click, listener);
});

test('all ten built Chinese and English pages include the same real Google Analytics tag exactly once', async () => {
  const tag = await analyticsTag();
  // Read actual sitemap routes rather than assuming guide slugs.
  const sitemap = await readFile(new URL('../dist/client/sitemap.xml', import.meta.url), 'utf8');
  const paths = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]).pathname);
  assert.equal(paths.length, 10);
  for (const path of paths) {
    const html = await readFile(new URL('../dist/client' + path + 'index.html', import.meta.url), 'utf8');
    assert.ok(html.includes(tag), path);
    assert.equal((html.match(/data-measurement-id=/g) || []).length, 1, path);
  }
  assert.equal(await readFile(new URL('../dist/client/assets/analytics.js', import.meta.url), 'utf8'), source);
});
