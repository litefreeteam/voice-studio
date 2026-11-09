import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyRedist, verifyWindowsRedist } = require('./windows-redist.cjs');
const root = path.resolve(import.meta.dirname, '..');
const folder = path.join(root, 'resources/windows');
const manifest = require('../resources/windows/vc-redist.json');
try {
  verifyWindowsRedist(root);
  console.log(`Verified existing Microsoft VC++ x64 ${manifest.version}`);
} catch {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Microsoft VC++ download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyRedist(bytes, manifest);
  const target = path.join(folder, manifest.filename), temporary = target + '.tmp';
  try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
  verifyWindowsRedist(root);
  console.log(`Downloaded and verified Microsoft VC++ x64 ${manifest.version}`);
}
