import { copyFile, mkdir, stat, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

const release = new URL("../../release/", import.meta.url);
const destination = new URL("../public/downloads/", import.meta.url);
const { version, sha256 } = JSON.parse(await readFile(new URL("../src/release.json", import.meta.url), "utf8"));
const filenames = [
  `Shengyue-${version}-mac-arm64.dmg`,
  `Shengyue-${version}-mac-arm64.zip`,
  `Shengyue-${version}-mac-x64.dmg`,
  `Shengyue-${version}-mac-x64.zip`,
  `Shengyue-${version}-windows-setup.exe`,
  `Shengyue-${version}-win-x64.zip`,
];

// Publish only customer installers, never seller tools or activation material.
const checksums = new Map(Object.entries(sha256));
await Promise.all(filenames.map((name) => stat(new URL(name, release))));
for (const name of filenames) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(new URL(name, release))) hash.update(chunk);
  if (hash.digest("hex") !== checksums.get(name)) throw new Error(`Installer checksum mismatch: ${name}`);
}
await mkdir(destination, { recursive: true });
for (const name of filenames) {
  await copyFile(new URL(name, release), new URL(name, destination));
  const { size } = await stat(new URL(name, destination));
  console.log(`${name}: ${(size / 1_000_000).toFixed(1)} MB`);
}
await writeFile(new URL("SHA256SUMS.txt", destination), filenames
  .map((name) => `${checksums.get(name)}  ${name}\n`).join(""));
// Remove only generated website copies; release originals remain untouched.
for (const name of await readdir(destination)) {
  if (/^Shengyue-.*\.(dmg|exe|zip)$/.test(name) && !filenames.includes(name)) {
    await rm(new URL(name, destination));
  }
}
console.log(`Downloads ready: ${fileURLToPath(destination)}`);
