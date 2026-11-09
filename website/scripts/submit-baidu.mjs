import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { origin, pages } from "../src/site-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const privateDir = path.join(root, ".qa/seo");
let auth;
try { auth = JSON.parse(await readFile(path.join(privateDir, "baidu-auth.json"), "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("Baidu: private push credentials are not configured; skipped");
  process.exit(0);
}
if (new URL(auth.site).origin !== origin || !/^[A-Za-z0-9_-]+$/.test(auth.token)) throw new Error("Invalid Baidu push configuration");
let state = {};
const stateFile = path.join(privateDir, "baidu-state.json");
try { state = JSON.parse(await readFile(stateFile, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

function liveHtml(url) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: process.env.SEO_ADDRESS || "139.224.83.72", servername: parsed.hostname, path: parsed.pathname, headers: { Host: parsed.hostname, "User-Agent": "Shengyue-Baidu-Push/1.0" } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Published page request timed out")));
  });
}

const pending = [];
for (const page of pages) {
  const url = origin + page.path;
  const html = await readFile(path.join(root, "dist/client", page.path, "index.html"), "utf8");
  const body = html.split("<body>")[1]?.split("</body>")[0];
  if (!body) throw new Error("Build the static website first");
  const text = body.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const fingerprint = createHash("sha256").update(page.title + "\n" + page.description + "\n" + text).digest("hex");
  if (state[url]?.fingerprint === fingerprint) continue;
  const live = await liveHtml(url);
  if (live.status !== 200 || live.html !== html || live.headers["x-robots-tag"]?.includes("noindex")) throw new Error("Live page is not the published indexable build: " + url);
  pending.push({ url, fingerprint });
}
if (!pending.length) { console.log("Baidu: no changed pages to submit"); process.exit(0); }
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ dryRun: true, site: auth.site, urls: pending.map(item => item.url) }, null, 2));
  process.exit(0);
}

const body = pending.map(item => item.url).join("\n");
const query = new URLSearchParams({ site: auth.site, token: auth.token });
// Use the endpoint/protocol explicitly provided by Baidu's current API page.
// Do not disable TLS checks or invent an HTTPS endpoint for this legacy API.
const result = await new Promise((resolve, reject) => {
  const req = http.request({ hostname: "data.zz.baidu.com", path: "/urls?" + query, method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body) } }, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    response.on("error", reject);
  });
  req.on("error", reject);
  req.setTimeout(20000, () => req.destroy(new Error("Baidu push request timed out")));
  req.end(body);
});
let response;
try { response = JSON.parse(result.body); }
catch { response = { message: result.body.slice(0, 1000) }; }
const accepted = result.status === 200 && response.success === pending.length && !response.not_same_site?.length && !response.not_valid?.length;
const record = { submittedAt: new Date().toISOString(), endpoint: "http://data.zz.baidu.com/urls", site: auth.site, status: result.status, urls: pending.map(item => item.url), response, accepted, indexingConfirmed: false };
const safe = JSON.stringify(record, null, 2).replaceAll(auth.token, "[redacted]");
await mkdir(privateDir, { recursive: true });
await writeFile(path.join(privateDir, "baidu-submission.json"), safe + "\n");
console.log(safe);
if (!accepted) process.exit(1);
for (const item of pending) state[item.url] = { fingerprint: item.fingerprint, submittedAt: record.submittedAt };
await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
