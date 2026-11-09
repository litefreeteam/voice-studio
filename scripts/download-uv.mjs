import { mkdir, readFile, chmod, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const targets = [
  ['mac-arm64', 'uv-aarch64-apple-darwin.tar.gz', '4beaa9550f93ef7f0fc02f7c28c9c48cd61fe30db00f5ac8947e0a425c3fb282'],
  ['mac-x64', 'uv-x86_64-apple-darwin.tar.gz', 'a9c3653245031304c50dd60ac0301bf6c112e12c38c32302a71d4fa6a63ba2cb'],
  ['win-x64', 'uv-x86_64-pc-windows-msvc.zip', '171b7ccda1bbd562da6babeffcf533a1c6cc7862cf998da826e1db534fc43e48']
];
for (const [target, archive, digest] of targets) {
  const dir = path.resolve('resources/uv', target);
  await mkdir(dir, { recursive: true });
  const temp = path.resolve('resources/uv', archive);
  execFileSync('curl', ['-fL', '--retry', '3', '--max-time', '180', `https://github.com/astral-sh/uv/releases/download/0.11.2/${archive}`, '-o', temp], { stdio: 'inherit' });
  if (createHash('sha256').update(await readFile(temp)).digest('hex') !== digest) throw new Error(`Checksum mismatch: ${archive}`);
  const unpack = path.resolve('resources/uv', `unpack-${target}`);
  await mkdir(unpack, { recursive: true });
  if (archive.endsWith('.zip')) {
    execFileSync('python3', ['-m', 'zipfile', '-e', temp, unpack]);
    await copyFile(path.join(unpack, 'uv.exe'), path.join(dir, 'uv.exe'));
  } else {
    execFileSync('tar', ['-xzf', temp, '-C', unpack]);
    await copyFile(path.join(unpack, archive.replace('.tar.gz', ''), 'uv'), path.join(dir, 'uv'));
    await chmod(path.join(dir, 'uv'), 0o755);
  }
}
await mkdir('resources/uv/licenses', { recursive: true });
for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
  execFileSync('curl', ['-fL', '--retry', '3', '--max-time', '60', `https://raw.githubusercontent.com/astral-sh/uv/0.11.2/${license}`, '-o', `resources/uv/licenses/${license}`], { stdio: 'inherit' });
}
console.log('Verified uv 0.11.2 binaries are ready.');
