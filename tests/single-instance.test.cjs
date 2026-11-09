const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function desktop(primary, window) {
  const filename = path.join(__dirname, '../desktop/app.cjs'), localRequire = createRequire(filename);
  const events = new Map(); let ready, quits = 0, writes = 0;
  const app = { setName() {}, setPath() {}, getPath: () => '/unused-test-profile',
    requestSingleInstanceLock: () => primary, quit() { quits++; },
    on: (event, handler) => events.set(event, handler), whenReady: () => ({ then(callback) { ready = callback; } }) };
  const sandbox = { require: name => name === 'electron' ? { app, ipcMain: { on() {}, handle() {} }, powerSaveBlocker: {} }
    : name === 'node:fs' ? { ...fs, mkdirSync() { writes++; throw new Error('secondary touched storage'); } } : localRequire(name),
    __dirname: path.dirname(filename), process, console, testWindow: window };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nwindow = testWindow;', sandbox);
  return { events, ready: () => ready(), quits: () => quits, writes: () => writes };
}

test('a second desktop exits without initializing storage even if ready fires', async () => {
  const app = desktop(false);
  assert.equal(app.quits(), 1);
  await app.ready();
  assert.equal(app.writes(), 0);
});

test('a second launch restores and focuses the primary window safely', () => {
  for (const minimized of [true, false]) {
    const calls = [], window = { isDestroyed: () => false, isMinimized: () => minimized,
      restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') };
    const app = desktop(true, window);
    app.events.get('second-instance')();
    assert.equal(app.quits(), 0);
    assert.deepEqual(calls, minimized ? ['restore', 'show', 'focus'] : ['show', 'focus']);
    window.isDestroyed = () => true; app.events.get('second-instance')();
    assert.equal(calls.length, minimized ? 3 : 2);
  }
  desktop(true).events.get('second-instance')();
});
