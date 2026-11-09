import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pages, origin } from "../src/site-content.mjs";
import { localizedPath, contactHref, contactQr, localizeVoice } from "../src/i18n.mjs";
import { loadSearchConfig, verificationTags } from "../scripts/search-config.mjs";

const client = fileURLToPath(new URL("../dist/client/", import.meta.url));
const release = JSON.parse(await readFile(new URL("../src/release.json", import.meta.url), "utf8"));
const searchConfig = await loadSearchConfig();
const documents = await Promise.all(pages.map(async page => ({ page, html: await readFile(path.join(client, page.path, "index.html"), "utf8") })));

test("every canonical page contains useful HTML before JavaScript runs", () => {
  assert.equal(new Set(pages.map(page => page.title)).size, pages.length);
  assert.equal(new Set(pages.map(page => page.description)).size, pages.length);
  for (const { page, html } of documents) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1, page.path);
    assert.ok(html.includes('<html lang="' + page.locale + '">'));
    assert.ok(html.includes('<link rel="canonical" href="' + origin + page.path + '">'), page.path);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.match(html, /name="robots" content="index, follow/);
    const body = html.split("<body>")[1].replace(/<[^>]*>/g, "");
    assert.ok(body.length > 800, page.path + " substantive visible content");
    assert.ok(!html.includes('<div id="root"></div>'));
    if (page.sections) for (const section of page.sections) assert.ok(html.includes(section.heading));
    if (page.sourcePath !== "/") assert.ok(!html.includes('type="module"'), "guides and downloads work without JS");
  }
});

test("structured data identifies real entities without fabricated prices or reviews", () => {
  for (const { page, html } of documents) {
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(data["@context"], "https://schema.org");
    const graph = data["@graph"];
    assert.ok(graph.some(node => node["@type"] === "WebSite"));
    const software = graph.find(node => node["@type"] === "SoftwareApplication");
    if (software) {
      assert.equal(software.softwareVersion, release.version);
      assert.equal(software.isAccessibleForFree, true);
      assert.ok(!software.offers && !software.review && !software.aggregateRating);
      assert.deepEqual(software.downloadUrl, Object.keys(release.sha256).map(filename => origin + "/downloads/" + filename));
    }
    if (page.sourcePath !== "/") {
      const breadcrumb = graph.find(node => node["@type"] === "BreadcrumbList");
      assert.equal(breadcrumb.itemListElement.at(-1).item, origin + page.path);
    }
  }
});

test("internal links, local assets and in-page anchors resolve in the static build", async () => {
  for (const { page, html } of documents) {
    for (const [, raw] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(raw.replaceAll("&amp;", "&"), origin + page.path);
      if (url.origin !== origin) continue;
      const file = path.join(client, url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname);
      await access(file);
      if (url.hash) {
        const content = await readFile(file, "utf8");
        assert.ok(content.includes('id="' + decodeURIComponent(url.hash.slice(1)) + '"'), page.path + " -> " + raw);
      }
    }
    const image = html.match(/property="og:image" content="([^"]+)"/)[1];
    await access(path.join(client, new URL(image).pathname));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
  }
});

test("sitemap lists exactly canonical HTML pages and robots allows resources", async () => {
  const xml = await readFile(path.join(client, "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(urls, pages.map(page => origin + page.path));
  assert.ok(urls.every(url => !url.includes("#") && !url.includes("?")));
  const robots = await readFile(path.join(client, "robots.txt"), "utf8");
  assert.match(robots, /User-agent: \*\nAllow: \/\n/);
  assert.ok(!robots.includes("Disallow:"));
  assert.ok(robots.includes("Sitemap: " + origin + "/sitemap.xml"));
  const errorPage = await readFile(path.join(client, "404.html"), "utf8");
  assert.match(errorPage, /name="robots" content="noindex"/);
});

test("download page uses all and only the approved release installers and hashes", () => {
  const html = documents.find(document => document.page.path === "/download/").html;
  const links = [...html.matchAll(/href="\/downloads\/([^"#]+\.(?:dmg|exe|zip))"/g)].map(match => match[1]);
  assert.deepEqual(links.sort(), Object.keys(release.sha256).sort());
  for (const hash of Object.values(release.sha256)) assert.ok(html.includes(hash));
  assert.match(html, /免费使用/);
  assert.ok(!html.includes('id="purchase"'));
});

test("ownership file persists in builds and only configured account verification tags are published", async () => {
  const key = await readFile(path.join(client, searchConfig.indexNowKey + ".txt"), "utf8");
  assert.equal(key, searchConfig.indexNowKey);
  for (const { html } of documents) {
    const head = html.split("</head>")[0];
    for (const tag of verificationTags(searchConfig).split("\n").filter(Boolean)) assert.ok(head.includes(tag));
    assert.equal((head.match(/name="google-site-verification"/g) || []).length, searchConfig.google.length);
    assert.equal((head.match(/name="baidu-site-verification"/g) || []).length, searchConfig.baidu.length);
  }
});


test("each language has reciprocal alternatives, its own canonical and a matching language switch", async () => {
  const xml = await readFile(path.join(client, "sitemap.xml"), "utf8");
  assert.equal(documents.length, 10);
  for (const {page, html} of documents) {
    for (const locale of ["zh-CN", "en"]) {
      const target = origin + localizedPath(page.sourcePath, locale);
      assert.ok(html.includes('<link rel="alternate" hreflang="' + locale + '" href="' + target + '">'), page.path);
      assert.ok(html.includes('href="' + localizedPath(page.sourcePath, locale) + '" lang="' + locale + '"'), page.path);
      assert.ok(xml.includes('hreflang="' + locale + '" href="' + target + '"'));
    }
    assert.ok(html.includes('href="' + contactHref(page.locale) + '"'), page.path);
    assert.ok(!html.includes('mailto:'), page.path + ' QR contact channel');
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])["@graph"];
    assert.equal(graph.find(node => ["Article", "WebPage"].includes(node["@type"])).inLanguage, page.locale);
    assert.equal(graph.find(node => node["@type"] === "Organization").contactPoint.url, origin + contactHref(page.locale));
    if (page.locale === "en") {
      assert.match(page.title, /Shengyue Voice/);
      assert.ok(!/[\u3400-\u9fff]/u.test(page.title + page.description));
      const navigation = html.split("<body>")[1].replace(/<a\b[^>]*lang="zh-CN"[^>]*>[\s\S]*?<\/a>/g, "");
      assert.ok(!navigation.includes('href="/download/"') && !navigation.includes('href="/guides/'), page.path + " same-language navigation");
    }
  }
  const qr = await readFile(new URL('../../ui/assets/contact-qr.png', import.meta.url));
  assert.deepEqual(await readFile(path.join(client, contactQr)), qr, 'Website and desktop preserve the same original QR image');
});

test("English labels preserve original audio, transcripts, IDs and illustrations", async () => {
  const catalog = JSON.parse(await readFile(new URL("../src/catalog.json", import.meta.url), "utf8"));
  for (const voice of [...catalog.voices, ...catalog.characters]) {
    const english = localizeVoice(voice, "en");
    assert.equal(english.id, voice.id);
    assert.deepEqual(english.preview, voice.preview);
    assert.equal(english.portrait, voice.portrait);
    assert.ok(!/[\u3400-\u9fff]/u.test(english.name + english.description + english.native), voice.id);
  }
  const englishHome = documents.find(item => item.page.path === "/en/").html;
  assert.match(englishHome, /current desktop app and screenshots use a Chinese interface/);
  assert.match(englishHome, /Audio samples remain in their original languages/);
});


test("all ten static pages include no paid checkout or activation sales claims, including closed FAQs", () => {
  for (const { page, html } of documents) {
    const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ");
    assert.doesNotMatch(text, /PayPal|购买授权|专业版永久|19 美元|US\$19|before buying|before purchasing|requires a paid|device-bound license|understand device activation/i, page.path);
    assert.ok(!html.includes('id="purchase"') && !html.includes('href="#purchase"'), page.path);
  }
});

test('all ten static pages expose the real repository and a progressive star counter in both header and footer', () => {
  for (const { page, html } of documents) {
    assert.equal((html.match(/href="https:\/\/github\.com\/litefreeteam\/voice-studio"/g) || []).length, 2, page.path);
    assert.equal((html.match(/<github-star-count\b/g) || []).length, 2, page.path);
    assert.equal((html.match(/src="\/assets\/github-stars\.js"/g) || []).length, 1, page.path);
    assert.ok(html.includes('litefreeteam/voice-studio'), page.path);
    assert.match(html, /<github-star-count[^>]*>Star<\/github-star-count>/);
  }
});
