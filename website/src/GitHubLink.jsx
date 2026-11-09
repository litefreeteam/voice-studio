import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react";
import { createTranslator } from "./i18n.mjs";

export const repositoryUrl = "https://github.com/litefreeteam/voice-studio";

export function GitHubLink({ locale = "zh-CN", showRepository = false }) {
  const t = createTranslator(locale);
  return <a className={"github-link" + (showRepository ? " github-link-repository" : "")} href={repositoryUrl} target="_blank" rel="noopener noreferrer" title={t("查看 GitHub 开源项目并点亮星标（新窗口打开）")}>
    <GithubLogoIcon size={19} weight="fill" aria-hidden="true" />
    <span className="github-label">{showRepository ? "litefreeteam/voice-studio" : "GitHub"}</span>
    <span className="github-stars"><StarIcon size={14} aria-hidden="true" /><github-star-count locale={locale} label={t("GitHub 星标数")}>Star</github-star-count></span>
  </a>;
}
