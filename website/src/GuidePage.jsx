import release from "./release.json";
import { guides as chineseGuides, englishGuides } from "./guide-links.mjs";
import { createTranslator, localizedPath, contactHref } from "./i18n.mjs";
import { LanguageSwitcher } from "./LanguageSwitcher.jsx";
import { GitHubLink } from "./GitHubLink.jsx";
import { updated } from "./site-content.mjs";
function Header({
  page
}) {
  const locale = page.locale;
  const t = createTranslator(locale);
  return <header className="reader-header container">
    <a className="brand" href={localizedPath("/", locale)} aria-label={t("声悦配音首页")}><img src="/assets/brand-wave.svg" width="44" height="44" alt="" /><span><strong>{t("声悦")}<span className="brand-product">{t("配音")}</span></strong><small>{t("好声音，让表达更动人")}</small></span></a>
    <nav aria-label={t("主导航")}><a href={localizedPath("/", locale) + "#voices"}>{t("声音试听")}</a><a href={localizedPath("/", locale) + "#guides"}>{t("使用指南")}</a><a href={contactHref(locale)}>{t("联系我们")}</a><a className="button primary" href={localizedPath("/download/", locale)}>{t("下载安装")}</a></nav>
    <GitHubLink locale={locale} />
    <LanguageSwitcher locale={locale} path={page.sourcePath} />
  </header>;
}
function Footer({
  page
}) {
  const locale = page.locale;
  const t = createTranslator(locale);
  const current = page.path;
  const guides = locale === "en" ? englishGuides : chineseGuides;
  return <footer className="reader-footer container"><nav aria-label={t("相关内容")}><GitHubLink locale={locale} showRepository /><a href={localizedPath("/", locale)}>{t("声悦配音首页")}</a><a href={localizedPath("/download/", locale)}>{t("桌面版下载")}</a>{guides.filter(guide => guide.path !== current).map(guide => <a key={guide.path} href={guide.path}>{guide.label}</a>)}<a href={contactHref(locale)}>{t("联系我们")}</a></nav><p>© {new Date().getFullYear()}{t(" 声悦配音 · v")}{release.version}{t(" · 好声音，让表达更动人")}</p></footer>;
}
export function GuidePage({
  page
}) {
  const locale = page.locale;
  const t = createTranslator(locale);
  return <><a className="skip-link" href="#article">{t("跳到正文")}</a><Header page={page} />
    <main className="reader-main container" id="article">
      <nav className="breadcrumbs" aria-label={t("面包屑")}><a href={localizedPath("/", locale)}>{t("首页")}</a><span aria-hidden="true">/</span><span aria-current="page">{page.label}</span></nav>
      <article>
        <header className="article-heading"><p className="eyebrow">{t("声悦配音使用指南")}</p><h1>{page.heading}</h1><p className="article-meta">{t("对应官网 v")}{release.version}{t(" 安装包 · 更新于 ")}<time dateTime={updated}>{updated}</time></p><p className="article-intro">{page.intro}</p></header>
        <nav className="article-toc" aria-label={t("本文目录")}><h2>{t("本文内容")}</h2><ol>{page.sections.map(section => <li key={section.id}><a href={"#" + section.id}>{section.heading}</a></li>)}</ol></nav>
        {page.sections.map(section => <section className="article-section" key={section.id} id={section.id}>
          <h2>{section.heading}</h2>
          {section.table && <div className="article-table"><table><thead><tr>{section.table.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, index) => <tr key={index}>{row.map((cell, i) => i === 0 ? <th scope="row" key={i}>{cell}</th> : <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>}
          {section.paragraphs?.map(text => <p key={text}>{text}</p>)}
          {section.code && <pre><code>{section.code}</code></pre>}
          {section.steps && <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}
          {section.list && <ul>{section.list.map(text => <li key={text}>{text}</li>)}</ul>}
        </section>)}
        {page.links && <section className="article-section"><h2>{t("文档与示例下载")}</h2><ul>{page.links.map(link => <li key={link.href}><a href={link.href} download>{link.label}</a></li>)}</ul></section>}
        <aside className="article-next"><h2>{t("准备开始创作？")}</h2><p>{t("先听真实声音示例，安装免费版后检查配置、下载模型，即可开始创作。")}</p><a className="button primary" href={localizedPath("/download/", locale)}>{t("查看安装包与设备要求")}</a><a className="text-link" href={localizedPath("/", locale) + "#voices"}>{t("先听声音示例 →")}</a></aside>
      </article>
    </main><Footer page={page} /></>;
}
export function DownloadPage({
  page
}) {
  const locale = page.locale;
  const t = createTranslator(locale);
const platforms = [{
  label: t("Apple 芯片 Mac"),
  suffix: "mac-arm64.dmg",
  archiveSuffix: "mac-arm64.zip",
  system: t("macOS 14+ · M 系列芯片"),
  disk: "13 GB / 25 GB"
}, {
  label: "Intel Mac",
  suffix: "mac-x64.dmg",
  archiveSuffix: "mac-x64.zip",
  system: "macOS 14+ · Intel x64 · CPU",
  disk: "17 GB / 41 GB"
}, {
  label: "Windows x64",
  suffix: "windows-setup.exe",
  archiveSuffix: "win-x64.zip",
  system: t("Windows 10 2004（19041）及以上，推荐 Windows 11 · x64 · CPU"),
  disk: "17 GB / 41 GB"
}];
  return <><a className="skip-link" href="#downloads">{t("跳到下载列表")}</a><Header page={page} /><main className="reader-main download-page container" id="downloads">
    <nav className="breadcrumbs" aria-label={t("面包屑")}><a href={localizedPath("/", locale)}>{t("首页")}</a><span aria-hidden="true">/</span><span aria-current="page">{t("桌面版下载")}</span></nav>
    <header className="article-heading"><p className="eyebrow">{t("声悦配音 · v")}{release.version}</p><h1>{page.heading}</h1><p className="article-intro">{t("本版本免费使用，无需购买、设备码或激活。安装后先检查电脑配置，选择模型并下载运行组件；完成后即可离线创作。")}</p></header>
    <div className="download-grid">{platforms.map(platform => {
          const filename = "Shengyue-" + release.version + "-" + platform.suffix;
          const archiveFilename = "Shengyue-" + release.version + "-" + platform.archiveSuffix;
          return <section className="download-platform" key={platform.suffix}><h2>{t(platform.label)}</h2><p>{t(platform.system)}</p><a className="button primary" href={"/downloads/" + filename} download>{t("下载 ")}{platform.suffix.endsWith("dmg") ? "DMG" : "Setup"}{t(" 安装包")}</a><p><a href={"/downloads/" + archiveFilename} download>{t("下载 ZIP 压缩包")}</a></p><details><summary>{t("SHA-256 校验值")}</summary><p>{platform.suffix.endsWith("dmg") ? "DMG" : "Setup"}</p><code>{release.sha256[filename]}</code><p>ZIP</p><code>{release.sha256[archiveFilename]}</code></details><p className="fine-print">{t("首次标准资源 / 全部基础资源预留：")}{platform.disk}{t("。最终以软件检测为准。")}</p></section>;
        })}</div>
    <p className="fine-print">{t("Windows ZIP 不自动安装系统运行库，新电脑建议使用 Setup 安装包。")}</p>
    {locale === "en" && <p className="english-product-note">The current desktop app and product screenshots use a Chinese interface. The website and these guides are available in English; existing audio samples retain their original languages.</p>}
    <section className="article-section"><h2>{t("安装与设备要求")}</h2><ul><li>{t("轻量配音最低需 8 GB 内存；标准配音、人物创作与声音克隆至少需 16 GB，可通过配置检测了解本机条件。")}</li><li>{t("Mac 下载后将声悦拖入“应用程序”再打开。当前安装包未经 Apple 公证，首次打开可能需要在“系统设置 → 隐私与安全性”中确认。")}</li><li>{t("Intel Mac 与 Windows 安装版使用 CPU，不包含 CUDA 加速；完整功能仍待相应平台实机验收。暂不支持 Linux 和 Windows ARM。")}</li><li>{t("客户端检测仅检查配置与环境，不下载模型或生成配音。网页预存试听可以直接收听。")}</li></ul><p><a href={localizedPath("/guides/offline-tts/", locale)}>{t("阅读完整的本地与离线使用指南 →")}</a></p></section>
    <section className="article-section"><h2>{t("免费版首次使用")}</h2><p>{t("本版本免费使用，无需购买、设备码或激活。安装后先检查电脑配置，选择模型并下载运行组件；完成后即可离线创作。")}</p></section>
    <section className="article-section"><h2>{t("安装包校验与 CLI 文档")}</h2><p>{t("可使用系统的 SHA-256 工具计算下载文件的校验值，并与本页或校验清单逐项比较。安装包中包含 CLI，无需另装 Node.js。")}</p><ul><li><a href="/downloads/SHA256SUMS.txt">{t("查看 v")}{release.version}{t(" 安装包校验清单")}</a></li><li><a href={localizedPath("/guides/agent-cli/", locale)}>{t("阅读智能体与 CLI 接入教程")}</a></li><li><a href="/docs/agent-cli.md" download>{t("下载完整 CLI 文档")}</a></li></ul></section>
  </main><Footer page={page} /></>;
}
