import { GlobeIcon, CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { localizedPath } from "./i18n.mjs";

export function LanguageSwitcher({ locale = "zh-CN", path = "/" }) {
  const label = locale === "en" ? "Choose language (English)" : "选择语言（中文）";
  return <details className="language-switcher">
    <summary className="language-toggle" aria-label={label} title={label}>
      <GlobeIcon size={20} aria-hidden="true" />
      <CaretDownIcon className="language-caret" size={11} aria-hidden="true" />
    </summary>
    <div className="language-menu" role="group" aria-label={locale === "en" ? "Website language" : "网站语言"}>
      {[{ id: "zh-CN", label: "中文" }, { id: "en", label: "English" }].map(language => <a
        key={language.id}
        href={localizedPath(path, language.id)}
        lang={language.id}
        hrefLang={language.id}
        aria-current={locale === language.id ? "page" : undefined}
      ><span>{language.label}</span>{locale === language.id && <CheckIcon size={16} weight="bold" aria-hidden="true" />}</a>)}
    </div>
  </details>;
}
