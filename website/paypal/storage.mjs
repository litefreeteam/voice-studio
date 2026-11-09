import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, link, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
}
export async function writeJson(file, data, { exclusive = false } = {}) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    let created = true;
    if (exclusive) {
      try { await link(temporary, file); }
      catch (cause) { if (cause.code !== 'EEXIST') throw cause; created = false; }
    } else await rename(temporary, file);
    const handleDirectory = await open(directory, 'r');
    try { await handleDirectory.sync(); } finally { await handleDirectory.close(); }
    return created;
  } finally { await unlink(temporary).catch(() => {}); }
}
