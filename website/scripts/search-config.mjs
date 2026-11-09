import { readFile } from "node:fs/promises";

export async function loadSearchConfig() {
  const config = JSON.parse(await readFile(new URL("../search-verification.json", import.meta.url), "utf8"));
  for (const provider of ["google", "baidu"]) {
    if (!Array.isArray(config[provider]) || config[provider].some(value => typeof value !== "string" || !/^[A-Za-z0-9_-]{10,256}$/.test(value))) {
      throw new Error("Invalid " + provider + " verification tokens; use only the platform's actual content value");
    }
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(config.indexNowKey)) throw new Error("Invalid IndexNow ownership key");
  return config;
}

export function verificationTags(config) {
  return [
    ...config.google.map(value => '<meta name="google-site-verification" content="' + value + '">'),
    ...config.baidu.map(value => '<meta name="baidu-site-verification" content="' + value + '">'),
  ].join("\n");
}
