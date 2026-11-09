import { build } from "vite";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { origin, updated } from "../src/site-content.mjs";
import { localizedPath, contactHref } from "../src/i18n.mjs";
import { loadSearchConfig, verificationTags } from "./search-config.mjs";
import { analyticsTag } from "./analytics-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const client = path.join(root, "dist/client");
const temporary = path.join(root, "dist/.prerender");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const jsonLd = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const release = JSON.parse(await readFile(path.join(root, "src/release.json"), "utf8"));
const searchConfig = await loadSearchConfig();
const analytics = await analyticsTag();
const alternates = sourcePath => [
  { language: "zh-CN", url: origin + localizedPath(sourcePath, "zh-CN") },
  { language: "en", url: origin + localizedPath(sourcePath, "en") },
  { language: "x-default", url: origin + localizedPath(sourcePath, "zh-CN") },
];

try {
  await build({ root, build: { ssr: "src/entry-server.jsx", outDir: temporary, emptyOutDir: true, copyPublicDir: false, minify: false } });
  const { pages, renderPage } = await import(pathToFileURL(path.join(temporary, "entry-server.js")).href);
  const template = await readFile(path.join(client, "index.html"), "utf8");
  const styles = [...template.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join("\n");
  const scripts = [...template.matchAll(/<script\b[^>]*type="module"[^>]*><\/script>/g)].map(match => match[0]).join("\n");
  if (!styles || !scripts) throw new Error("Missing built CSS or client entry");
  const assets = await readdir(path.join(client, "assets"));
  const latinFont = assets.find(name => /^manrope-latin-wght-normal-.*\.woff2$/.test(name));
  for (const page of pages) {
    const english = page.locale === "en";
    const name = english ? "Shengyue Voice" : "声悦配音";
    const url = origin + page.path;
    const image = origin + "/assets/social-card" + (english ? "-en" : "") + ".png";
    const website = { "@type": "WebSite", "@id": origin + "/#website", url: origin + "/", name: "声悦配音", alternateName: "Shengyue Voice", inLanguage: ["zh-CN", "en"], publisher: { "@id": origin + "/#organization" } };
    const organization = { "@type": "Organization", "@id": origin + "/#organization", name, alternateName: english ? "声悦配音" : "Shengyue Voice", url: origin + "/", contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: origin + contactHref(page.locale), availableLanguage: ["zh-CN", "en"] }, logo: { "@type": "ImageObject", url: origin + "/assets/brand-logo.png", width: 512, height: 512 } };
    const webpage = { "@type": page.sections ? "Article" : "WebPage", "@id": url + "#page", url, name: page.heading || page.title, headline: page.heading || page.title, description: page.description, inLanguage: page.locale, isPartOf: { "@id": website["@id"] }, publisher: { "@id": organization["@id"] }, image };
    const graph = [organization, website, webpage];
    if (page.sourcePath === "/" || page.sourcePath === "/download/") {
      // This describes the downloadable software, whose current interface is Chinese.
      const software = { "@type": "SoftwareApplication", "@id": origin + "/#software", name, url: origin + localizedPath("/", page.locale), description: pages.find(item => item.locale === page.locale && item.sourcePath === "/").description, softwareVersion: release.version, applicationCategory: "MultimediaApplication", operatingSystem: ["macOS 14+ (Apple Silicon / Intel x64)", "Windows 10 2004 (19041)+ / Windows 11 (x64)"], inLanguage: "zh-CN", isAccessibleForFree: true, screenshot: origin + "/assets/workspace-0.4.6.png", downloadUrl: Object.keys(release.sha256).map(filename => origin + "/downloads/" + filename), publisher: { "@id": organization["@id"] } };
      graph.push(software);
      webpage.mainEntity = { "@id": software["@id"] };
    }
    if (page.sections) { webpage.dateModified = updated; webpage.author = { "@id": organization["@id"] }; webpage.about = { "@id": origin + "/#software" }; }
    if (page.sourcePath !== "/") {
      const crumbs = [{ "@type": "ListItem", position: 1, name: english ? "Shengyue Voice home" : "声悦配音首页", item: origin + localizedPath("/", page.locale) }, { "@type": "ListItem", position: 2, name: page.label || (english ? "Desktop downloads" : "桌面版下载"), item: url }];
      const breadcrumb = { "@type": "BreadcrumbList", "@id": url + "#breadcrumb", itemListElement: crumbs };
      webpage.breadcrumb = { "@id": breadcrumb["@id"] };
      graph.push(breadcrumb);
    }
    const html = `<!doctype html>
<html lang="${page.locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#090912">
<link rel="canonical" href="${url}">
${alternates(page.sourcePath).map(item => `<link rel="alternate" hreflang="${item.language}" href="${item.url}">`).join("\n")}
<link rel="icon" type="image/svg+xml" href="/assets/brand-wave.svg">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="${page.sections ? "article" : "website"}">
<meta property="og:site_name" content="${name}">
<meta property="og:locale" content="${english ? "en_US" : "zh_CN"}">
<meta property="og:locale:alternate" content="${english ? "zh_CN" : "en_US"}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${english ? "Shengyue Voice: local AI narration for courses, characters and offline workflows" : "声悦配音，本地 AI 配音工作台，支持课程与多角色配音"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(page.title)}">
<meta name="twitter:description" content="${escape(page.description)}">
<meta name="twitter:image" content="${image}">
${latinFont ? `<link rel="preload" href="/assets/${latinFont}" as="font" type="font/woff2" crossorigin>\n` : ""}${styles}
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@graph": graph })}</script>
${verificationTags(searchConfig)}
${analytics}
<script src="/assets/language-menu.js" defer></script>
<script src="/assets/github-stars.js" defer></script>
${page.sourcePath === "/" ? scripts : ""}
</head>
<body><div id="root">${renderPage(page)}</div></body>
</html>
`;
    const target = path.join(client, page.path, "index.html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
    console.log("Prerendered " + page.path);
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(page => `  <url><loc>${origin + page.path}</loc><lastmod>${updated}</lastmod>${alternates(page.sourcePath).map(item => `<xhtml:link rel="alternate" hreflang="${item.language}" href="${item.url}"/>`).join("")}</url>`).join("\n")}
</urlset>
`;
  await writeFile(path.join(client, "sitemap.xml"), sitemap);
  await writeFile(path.join(client, "robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: " + origin + "/sitemap.xml\n");
  await writeFile(path.join(client, searchConfig.indexNowKey + ".txt"), searchConfig.indexNowKey);
  await writeFile(path.join(client, "404.html"), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>页面未找到 / Page not found | Shengyue Voice</title>' + styles + '</head><body><main class="reader-main container"><div class="article-heading"><p class="eyebrow">404</p><h1>页面未找到 <span lang="en">/ Page not found</span></h1><p class="article-intro">可以返回官网试听声音。<span lang="en"> Return to the website to explore voice samples.</span></p></div><aside class="article-next"><a class="button primary" href="/" lang="zh-CN">中文首页</a><a class="button primary" href="/en/" lang="en">English home</a><a class="text-link" href="/#contact">微信扫码联系 / Contact via QR code</a></aside></main></body></html>');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
