import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/assets/github-stars.js', import.meta.url), 'utf8');
const key = 'shengyue:github-stars:v1';
const repository = 'litefreeteam/voice-studio';
const settle = () => new Promise(setImmediate);

function browser({ cache, response = { full_name: repository, stargazers_count: 0 }, ok = true, reject = false, blockedStorage = false } = {}) {
  const definitions = new Map(), storage = new Map(cache ? [[key, JSON.stringify(cache)]] : []), requests = [];
  class Element {
    getAttribute(name) { return { locale: 'en', label: 'GitHub stars' }[name]; }
    attachShadow() {
      this.shadowRoot = { children: [], append(node) { this.children.push(node); }, replaceChildren(...nodes) { this.children = nodes; } };
      return this.shadowRoot;
    }
  }
  const registry = { get: name => definitions.get(name), define: (name, definition) => definitions.set(name, definition) };
  const context = vm.createContext({
    window: { customElements: registry }, customElements: registry, HTMLElement: Element,
    document: { createElement: tagName => ({ tagName }) },
    localStorage: {
      getItem(name) { if (blockedStorage) throw Error('disabled'); return storage.get(name) ?? null; },
      setItem(name, value) { if (blockedStorage) throw Error('disabled'); storage.set(name, value); }
    },
    fetch: async (url, options) => { requests.push({ url, options }); if (reject) throw Error('offline'); return { ok, json: async () => response }; },
    AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  function counter() { const element = new (definitions.get('github-star-count'))(); element.connectedCallback(); return element; }
  return { counter, requests, storage, repeat: () => vm.runInContext(source, context) };
}

test('header and footer share one public request, preserve a genuine zero and leave React fallback content alone', async () => {
  const app = browser(); const first = app.counter(), second = app.counter();
  app.repeat(); first.connectedCallback();
  await settle();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, 'https://api.github.com/repos/' + repository);
  assert.equal(app.requests[0].options.credentials, 'omit');
  assert.equal(app.requests[0].options.referrerPolicy, 'no-referrer');
  assert.equal(first.shadowRoot.children[0].textContent, '0');
  assert.equal(second.shadowRoot.children[0].textContent, '0');
  assert.equal(JSON.parse(app.storage.get(key)).count, 0);
});

test('fresh cached counts avoid network calls; large counts retain their precise value in the title', async () => {
  const app = browser({ cache: { count: 1234, updatedAt: Date.now() - 1000 } }); const element = app.counter();
  await settle();
  assert.equal(app.requests.length, 0);
  assert.equal(element.shadowRoot.children[0].textContent, '1.2K');
  assert.match(element.shadowRoot.children[0].title, /1,234/);
});

test('expired, malformed and future caches are refreshed; disabled storage does not prevent a real count', async () => {
  for (const options of [
    { cache: { count: 8, updatedAt: Date.now() - 3600001 } },
    { cache: { count: '8', updatedAt: Date.now() } },
    { cache: { count: 8, updatedAt: Date.now() + 100000 } },
    { blockedStorage: true }
  ]) {
    const app = browser(options), element = app.counter(); await settle();
    assert.equal(app.requests.length, 1);
    assert.equal(element.shadowRoot.children[0].textContent, '0');
  }
});

test('offline, rate-limited, wrong-repository and invalid-count responses retain the neutral Star fallback', async () => {
  for (const options of [
    { reject: true }, { ok: false },
    { response: { full_name: 'other/repository', stargazers_count: 999 } },
    ...[-1, 1.5, '99', null, Number.MAX_SAFE_INTEGER + 1].map(stargazers_count => ({ response: { full_name: repository, stargazers_count } }))
  ]) {
    const app = browser(options), element = app.counter(); await settle();
    assert.equal(element.shadowRoot.children[0].tagName, 'slot');
    assert.equal(app.storage.size, 0);
  }
});
