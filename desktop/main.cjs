// Do not allow Chromium's remote debugger to reopen a release renderer boundary.
if (require('electron').app.isPackaged && process.argv.some(arg => /^--(?:remote-debugging|inspect|js-flags|no-sandbox|disable-web-security)(?:[-=]|$)/.test(arg))) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'UNSAFE_LAUNCH', message: '发行版不支持调试或禁用安全保护的启动参数' } }) + '\n');
  process.exit(1);
}
// Packaged applications expose the same CLI without opening a desktop window.
if (process.argv.includes('--cli')) {
  require('../cli/studio.cjs').run(process.argv.slice(process.argv.indexOf('--cli') + 1), {
    resourceDir: require('electron').app.isPackaged ? process.resourcesPath : require('node:path').join(__dirname, '..')
  }).then(code => process.stdout.write('', () => process.exit(code)));
} else {
  require('./app.cjs');
}
