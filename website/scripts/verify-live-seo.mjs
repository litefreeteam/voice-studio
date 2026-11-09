import https from "node:https";
import http from "node:http";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pages, origin } from "../src/site-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const client = path.join(root, "dist/client");
const address = process.env.SEO_ADDRESS || "139.224.83.72";
const hostname = new URL(origin).hostname;
const report = { checkedAt: new Date().toISOString(), origin, pages: [], checks: [] };
const digest = body => createHash("sha256").update(body).digest("hex");

function request(pathname, { host = hostname, secure = true, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = (secure ? https : http).get({ hostname: address, servername: host, port: secure ? 443 : 80, path: pathname, headers: { Host: host, "User-Agent": "Shengyue-SEO-Audit/1.0", "Accept-Encoding": "gzip", ...headers } }, response => {
      const ttfb = performance.now() - started;
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const wire = Buffer.concat(chunks);
        const body = response.headers["content-encoding"] === "gzip" ? gunzipSync(wire) : wire;
        resolve({ status: response.statusCode, headers: response.headers, body, bytes: body.length, transferred: wire.length, ttfbMs: Math.round(ttfb) });
      });
      response.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Request timed out: " + pathname)));
  });
}

for (const page of pages) {
  const response = await request(page.path);
  assert.equal(response.status, 200, page.path);
  const expected = await readFile(path.join(client, page.path, "index.html"));
  assert.equal(digest(response.body), digest(expected), page.path + " matches local prerender");
  assert.equal(response.headers["cache-control"], "no-cache");
  assert.ok(!response.headers["x-robots-tag"]);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.equal(response.headers["content-encoding"], "gzip");
  const html = response.body.toString();
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.ok(graph["@graph"].length >= 3);
  for (const userAgent of ["Googlebot", "Baiduspider"]) {
    const crawler = await request(page.path, { headers: { "User-Agent": userAgent } });
    assert.equal(crawler.status, 200);
    assert.equal(digest(crawler.body), digest(response.body), "same content for " + userAgent);
  }
  report.pages.push({ path: page.path, status: response.status, htmlBytes: response.bytes, gzipBytes: response.transferred, ttfbMs: response.ttfbMs, hasStaticBody: !html.includes('<div id="root"></div>') });
}
report.checks.push(`All ${pages.length} pages match local static HTML over valid TLS; Googlebot and Baiduspider receive identical content`);

for (const pathname of ["/robots.txt", "/sitemap.xml", "/assets/social-card.png", "/assets/social-card-en.png", "/assets/favicon-48.png", "/assets/brand-logo.png", "/assets/apple-touch-icon.png"]) {
  const response = await request(pathname);
  assert.equal(response.status, 200, pathname);
  assert.equal(digest(response.body), digest(await readFile(path.join(client, pathname))));
}
report.checks.push("Robots, sitemap, social card and current brand icons are public and match local files");

const index = await readFile(path.join(client, "index.html"), "utf8");
for (const asset of [...index.matchAll(/(?:src|href)="(\/assets\/[^"#]+\.(?:js|css|woff2))"/g)].map(match => match[1])) {
  const response = await request(asset);
  assert.equal(response.status, 200);
  assert.equal(digest(response.body), digest(await readFile(path.join(client, asset))));
  // Stable-name enhancements use short caching; only hashed bundles are immutable.
  const hashed = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2)$/.test(asset);
  assert.match(response.headers["cache-control"], hashed ? /max-age=31536000, immutable/ : /max-age=3600/);
  // Match Nginx's gzip_min_length=1024; tiny scripts need no compression.
  if (!asset.endsWith("woff2") && response.bytes >= 1024) assert.equal(response.headers["content-encoding"], "gzip");
}
report.checks.push("Hashed bundles and font use immutable caching; HTML/CSS/JS compression works");

for (const [pathname, target] of [["/index.html?from=seo-check", "/?from=seo-check"], ["/download/index.html?from=seo-check", "/download/?from=seo-check"], ["/guides/course-narration/index.html", "/guides/course-narration/"], ["/download", "/download/"], ["/en", "/en/"], ["/en/index.html", "/en/"], ["/en/download", "/en/download/"], ["/en/download/index.html?lang=check", "/en/download/?lang=check"]]) {
  const response = await request(pathname);
  assert.equal(response.status, 301, pathname);
  assert.equal(response.headers.location, origin + target);
}
for (const [host, secure] of [[hostname, false], ["freeteam.top", false], ["freeteam.top", true]]) {
  const pathname = "/guides/course-narration/?from=seo-check";
  const response = await request(pathname, { host, secure });
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, origin + pathname);
}
report.checks.push("HTTPS, main host, directory slashes and explicit index.html redirects preserve paths and queries");

for (const pathname of ["/missing-seo-page", "/assets/missing-seo-file.js", "/downloads/missing-seo-file.exe", "/.env", "/api/missing-seo-route", "/en/missing-seo-page"]) {
  const response = await request(pathname);
  assert.equal(response.status, 404, pathname);
  assert.match(response.body.toString(), /name="robots" content="noindex"/);
}
report.checks.push("Missing pages, assets, installers, API and dotfiles return real 404, not the homepage");

const release = JSON.parse(await readFile(path.join(root, "src/release.json"), "utf8"));
for (const filename of Object.keys(release.sha256)) {
  const response = await request("/downloads/" + filename, { headers: { Range: "bytes=0-1023" } });
  assert.equal(response.status, 206);
  assert.equal(response.body.length, 1024);
  assert.equal(response.headers["x-robots-tag"], "noindex");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
}
for (const pathname of ["/docs/agent-cli.md", "/docs/example-script.json", "/healthz"]) {
  const response = await request(pathname);
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-robots-tag"], "noindex");
}
report.checks.push("All 3 approved installer ranges work; binary/raw-document/health URLs carry noindex");
report.passed = true;
await mkdir(path.join(root, ".qa/seo"), { recursive: true });
await writeFile(path.join(root, ".qa/seo/live-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
