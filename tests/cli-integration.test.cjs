const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { cliConfiguration, cliDocumentPath } = require('../desktop/cli-integration.cjs');

test('copied POSIX commands preserve actual paths and profile without shell expansion', () => {
  const appPath = '/软件/声悦 app/John\'s $(exit 9) `exit 8` $HOME';
  const dataDir = '/数据/Voice Studio/John\'s $HOME';
  // Node acts as an executable that reports the exact arguments received from sh.
  const config = cliConfiguration({ platform: 'darwin', executable: process.execPath,
    appPath, packaged: false, dataDir });
  const command = config.generate.replace(`'${appPath.replaceAll("'", "'\"'\"'")}'`, "'-e' 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' '--'");
  assert.deepEqual(JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })),
    ['--cli', 'generate', '--input', 'script.json', '--output-dir', './audio', '--timeout', '1800', '--data-dir', dataDir]);
  assert.ok(config.guide.includes(JSON.stringify({ executable: process.execPath, args: [appPath, '--cli', '--data-dir', dataDir] }, null, 2)));
});

test('packaged Windows configuration uses PowerShell literals, actual exe and current data directory', () => {
  const config = cliConfiguration({ platform: 'win32', executable: "C:\\Apps\\John's $声悦\\声悦.exe",
    appPath: 'C:\\ignored\\app.asar', packaged: true, dataDir: 'D:\\我的配音\\Voice Studio' });
  assert.equal(config.status, "& 'C:\\Apps\\John''s $声悦\\声悦.exe' '--cli' 'status' '--data-dir' 'D:\\我的配音\\Voice Studio' | Out-String");
  assert.ok(!config.generate.includes('app.asar'));
  assert.ok(config.generate.includes("'--input' 'script.json'"));
  assert.equal(config.platform, 'Windows · PowerShell');
});

test('packaged macOS configuration invokes its executable without an app.asar argument', () => {
  const config = cliConfiguration({ platform: 'darwin', executable: '/Other Apps/声悦.app/Contents/MacOS/声悦',
    appPath: '/Other Apps/声悦.app/Contents/Resources/app.asar', packaged: true, dataDir: '/我的数据' });
  assert.equal(config.status, "'/Other Apps/声悦.app/Contents/MacOS/声悦' '--cli' 'status' '--data-dir' '/我的数据'");
});

test('CLI docs resolve to the bundled extraResource for releases and source docs during development', () => {
  assert.equal(cliDocumentPath({ packaged: true, resourceDir: '/app/Resources', appPath: '/app/Resources/app.asar' }), '/app/Resources/docs/Agent-CLI.md');
  assert.equal(cliDocumentPath({ packaged: false, appPath: '/source' }), '/source/docs/Agent-CLI.md');
});
