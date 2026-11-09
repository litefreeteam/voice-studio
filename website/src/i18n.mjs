import english from "./locales/en.json" with { type: "json" };

export const contactQr = "/assets/contact-qr.png";
export const locales = ["zh-CN", "en"];
export const localeFromPath = pathname => /^\/en(?:\/|$)/.test(pathname) ? "en" : "zh-CN";
export function localizedPath(pathname = "/", locale = "zh-CN") {
  const source = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  return locale === "en" ? "/en" + source : source;
}
export const contactHref = (locale = "zh-CN") => localizedPath("/", locale) + "#contact";

export function createTranslator(locale = "zh-CN") {
  return (message, ...values) => {
    const key = message.replace(/\s+/g, " ").trim();
    let translated = message;
    if (locale === "en" && /[\u3400-\u9fff]/u.test(message)) {
      if (!Object.hasOwn(english, key)) throw new Error("Missing English translation: " + key);
      translated = english[key];
    }
    return translated.replace(/\{(\d+)\}/g, (_, index) => String(values[index] ?? ""));
  };
}

// Keep the same IDs, portraits, audio, transcripts and waveform data in both languages.
export function localizeVoice(voice, locale) {
  if (locale !== "en") return voice;
  const t = createTranslator(locale);
  return { ...voice, name: t(voice.name), description: t(voice.description), native: t(voice.native || "中文示例") };
}
