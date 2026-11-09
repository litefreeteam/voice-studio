import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { origin, pages } from "../src/site-content.mjs";
import { loadSearchConfig } from "./search-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = await loadSearchConfig();
const keyUrl = origin + "/" + config.indexNowKey + ".txt";
const endpoint = "https://api.indexnow.org/indexnow";
const stateFile = path.join(root, ".qa/seo/indexnow-state.json");
const reportFile = path.join(root, ".qa/seo/indexnow-submission.json");
let state = {};
try { state = JSON.parse(await readFile(stateFile, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }

// Website preflight connects to the ECS address with normal TLS validation.
// External IndexNow requests use public DNS, without custom TLS or proxy bypasses.
function getPublished(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return reject(new Error("Unexpected verification origin"));
    const req = https.get({ hostname: process.env.SEO_ADDRESS || "139.224.83.72", servername: parsed.hostname, path: parsed.pathname, headers: { Host: parsed.hostname, "User-Agent": "Shengyue-IndexNow/1.0" } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error("Published page request timed out")));
    req.on("error", reject);
  });
}

const ownership = await getPublished(keyUrl);
if (ownership.status !== 200 || ownership.body.trim() !== config.indexNowKey) throw new Error("Publish the ownership file before submitting URLs");
const pending = [];
let deferred = 0;
for (const page of pages) {
  const url = origin + page.path;
  const html = await readFile(path.join(root, "dist/client", page.path, "index.html"), "utf8");
  const body = html.split("<body>")[1]?.split("</body>")[0];
  if (!body) throw new Error("Build the static website first");
  // Ignore bundle filenames and visual-only changes; notify on actual text changes.
  const text = body.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const fingerprint = createHash("sha256").update(page.title + "\n" + page.description + "\n" + text).digest("hex");
  if (state[url]?.fingerprint === fingerprint) continue;
  if (state[url]?.submittedAt && Date.now() - Date.parse(state[url].submittedAt) < 300000) { deferred++; continue; }
  const live = await getPublished(url);
  if (live.status !== 200 || live.body !== html || live.headers["x-robots-tag"]?.includes("noindex")) throw new Error("Live page does not match the indexable build: " + url);
  pending.push({ url, fingerprint });
}
if (!pending.length) {
  console.log("IndexNow: no new content to submit" + (deferred ? "; " + deferred + " updates deferred by the five-minute interval" : ""));
  process.exit(0);
}
const payload = { host: new URL(origin).hostname, key: config.indexNowKey, keyLocation: keyUrl, urlList: pending.map(item => item.url) };
const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "Shengyue-IndexNow/1.0" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
const responseText = (await response.text()).slice(0, 2000);
const report = { submittedAt: new Date().toISOString(), endpoint, status: response.status, received: [200, 202].includes(response.status), keyValidationPending: response.status === 202, urls: payload.urlList, response: responseText, indexingConfirmed: false };
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
if (!report.received) throw new Error("IndexNow returned HTTP " + response.status + ": " + responseText);
for (const item of pending) state[item.url] = { fingerprint: item.fingerprint, submittedAt: report.submittedAt, status: response.status };
await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
