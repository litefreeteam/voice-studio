import { constants } from 'node:fs';
import { cp, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultDataDir } from '../desktop/service.cjs';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');

export async function createDevFixture({ installedData = defaultDataDir(), activated = true } = {}) {
  const fixture = await createDesktopFixture({ activated });
  try {
    // Real installers and engine code must be present in the temporary app too.
    await symlink(path.join(root, 'resources'), path.join(fixture.appDir, 'resources'), 'dir');
    await cp(path.join(root, 'backend'), path.join(fixture.appDir, 'backend'), {
      recursive: true, filter: source => path.basename(source) !== '__pycache__'
    });
    const worker = path.join(fixture.appDir, 'backend/worker.py');
    const source = await readFile(worker, 'utf8');
    const publicKey = await readFile(path.join(fixture.appDir, 'shared/license-public.pem'), 'utf8');
    const anchor = /^PUBLIC_KEY_PEM = b"""[\s\S]*?"""/m;
    if (!anchor.test(source)) throw new Error('调试引擎缺少验签公钥');
    // Only the disposable engine copy trusts the fixture's disposable signing key.
    await writeFile(worker, source.replace(anchor, `PUBLIC_KEY_PEM = b"""${publicKey}"""`));
    for (const name of ['models', 'runtime', 'python', 'cache', 'references']) {
      try {
        // APFS clones reuse existing downloads without letting setup modify user data.
        await cp(path.join(installedData, name), path.join(fixture.data, name), {
          recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE
        });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return fixture;
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
