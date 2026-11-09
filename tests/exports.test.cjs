const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { copyTemporaryExport, cleanupTemporaryExport, cleanupStaleExports } = require('../desktop/exports.cjs');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-export-regression-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  function archive(pid = process.pid) {
    const token = randomUUID().replaceAll('-', '');
    const directory = path.join(dataDir, '.export-tmp', `voice-export-${token}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ schema: 'shengyue-export-v1', token, pid, createdAt: Date.now() }));
    const file = path.join(directory, 'archive.zip');
    fs.writeFileSync(file, 'PK-owned-archive');
    return { path: file, count: 3, directory };
  }
  return { dataDir, archive };
}

test('saved and failed export copies clean only the owned intermediate', async t => {
  const f = fixture(t);
  for (let index = 0; index < 3; index++) {
    const result = f.archive(), destination = path.join(f.dataDir, `saved-${index}.zip`);
    await copyTemporaryExport(f.dataDir, result, destination);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'PK-owned-archive');
    assert.equal(fs.existsSync(result.directory), false);
  }
  const existing = path.join(f.dataDir, 'user.zip');
  fs.writeFileSync(existing, 'user-data');
  const collision = f.archive();
  await assert.rejects(copyTemporaryExport(f.dataDir, collision, existing, fs.constants.COPYFILE_EXCL), { code: 'EEXIST' });
  assert.equal(fs.existsSync(collision.directory), false);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'user-data');
  const failed = f.archive();
  await assert.rejects(copyTemporaryExport(f.dataDir, failed, path.join(f.dataDir, 'missing', 'output.zip')), { code: 'ENOENT' });
  assert.equal(fs.existsSync(failed.directory), false);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, '.export-tmp')), []);
});

test('cleanup refuses unrelated files, foreign directory contents and symlinked archives', t => {
  const f = fixture(t);
  const unrelated = path.join(f.dataDir, 'voice-export-user.zip');
  fs.writeFileSync(unrelated, 'preserve');
  assert.equal(cleanupTemporaryExport(f.dataDir, { path: unrelated }), false);
  const foreign = f.archive();
  fs.writeFileSync(path.join(foreign.directory, 'my-notes.txt'), 'preserve');
  assert.equal(cleanupTemporaryExport(f.dataDir, foreign), false);
  assert.equal(fs.readFileSync(path.join(foreign.directory, 'my-notes.txt'), 'utf8'), 'preserve');
  const symlink = f.archive();
  fs.unlinkSync(symlink.path);
  fs.symlinkSync(unrelated, symlink.path);
  assert.equal(cleanupTemporaryExport(f.dataDir, symlink), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'preserve');
  assert.ok(fs.existsSync(foreign.path));
});

test('startup cleanup removes exited owners but preserves live owners and unknown files', t => {
  const f = fixture(t), active = f.archive(), stale = f.archive(2147483647);
  const root = path.join(f.dataDir, '.export-tmp');
  fs.writeFileSync(path.join(root, 'user-saved.zip'), 'preserve');
  assert.equal(cleanupStaleExports(f.dataDir), 1);
  assert.equal(fs.existsSync(stale.directory), false);
  assert.equal(fs.existsSync(active.directory), true);
  assert.equal(fs.readFileSync(path.join(root, 'user-saved.zip'), 'utf8'), 'preserve');
  assert.equal(cleanupStaleExports(path.join(f.dataDir, 'not-created')), 0);
});

function desktop(f, { choice, invoke, jobs = [], cache = { references: [{ id: 'reference', text: 'old' }] } }) {
  const filename = path.join(__dirname, '../desktop/app.cjs');
  const localRequire = createRequire(filename);
  const window = { webContents: { mainFrame: { url: 'file:///fixture/index.html' } } };
  let handler;
  const electron = { app: { setName() {}, setPath() {}, getPath: () => f.dataDir, requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}) },
    ipcMain: { on() {}, handle(channel, callback) { if (channel === 'studio') handler = callback; } },
    dialog: { showSaveDialog: async () => choice, showOpenDialog: async () => choice }, powerSaveBlocker: {} };
  const sandbox = { require: name => name === 'electron' ? electron : localRequire(name), __dirname: path.dirname(filename),
    process, Promise, console, testWindow: window, testStudio: { invoke },
    testJobs: { snapshot: () => ({ jobs }), hasRunnable: () => jobs.some(job => ['running', 'queued'].includes(job.status)) }, testCache: cache };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nwindow = testWindow; studio = testStudio; jobs = testJobs; licensing = {allow() {}, status() {return {activated: true}}}; statusCache = testCache; globalThis.getCachedReferences = () => statusCache.references;', sandbox);
  return { invoke: async (action, data) => { const reply = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, action, data); if (!reply.ok) throw Object.assign(new Error(reply.error.message), { code: reply.error.code }); return reply.result; }, sandbox };
}

test('desktop cancellation creates no archive; save failures still remove generated ZIP', async t => {
  const f = fixture(t);
  let calls = 0;
  const cancelled = desktop(f, { choice: { canceled: true }, invoke: async () => { calls++; } });
  assert.equal((await cancelled.invoke('zip', { ids: ['one'] })).saved, false);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(f.dataDir, '.export-tmp')), false);
  const archive = f.archive();
  const failed = desktop(f, { choice: { canceled: false, filePath: path.join(f.dataDir, 'missing', 'export.zip') }, invoke: async (action, data) => {
    assert.equal(action, 'zip'); assert.deepEqual(data, { ids: ['one'] }); return archive;
  } });
  await assert.rejects(failed.invoke('zip', { ids: ['one'] }), { code: 'ENOENT' });
  assert.equal(fs.existsSync(archive.directory), false);
});

test('desktop update-reference returns persisted metadata and refreshes paused-job cache', async t => {
  const f = fixture(t);
  const updated = { id: 'reference', text: 'new transcript', name: 'voice' };
  const app = desktop(f, { invoke: async (action, data) => {
    assert.equal(action, 'update-reference'); assert.equal(data.id, updated.id); return updated;
  } });
  assert.equal(await app.invoke('update-reference', { id: updated.id, text: updated.text }), updated);
  assert.equal(app.sandbox.getCachedReferences()[0], updated);
});

test('paused and scheduled jobs allow fresh resource status, while queued and running jobs use cached status', async t => {
  const f = fixture(t);
  for (const status of ['paused', 'scheduled', 'queued', 'running']) {
    let queries = 0;
    const app = desktop(f, { jobs: [{ status }], cache: { backgrounds: [] }, invoke: async action => {
      assert.equal(action, 'status'); queries++;
      return { history: [], backgrounds: [{ id: 'new-music' }] };
    } });
    const result = await app.invoke('status');
    const idle = ['paused', 'scheduled'].includes(status);
    assert.equal(queries, idle ? 1 : 0);
    assert.equal(result.backgrounds.length, idle ? 1 : 0);
  }
});

test('committed audio imports update the cache even while another generation is queued', async t => {
  const f = fixture(t), reference = { id: 'new-reference', name: '录入声音', text: '原话' }, music = { id: 'new-music', name: '音乐' };
  const calls = [];
  const app = desktop(f, { jobs: [{ status: 'queued' }], cache: { references: [], backgrounds: [] },
    choice: { canceled: false, filePaths: ['/fixture/music.wav'] }, invoke: async action => {
      calls.push(action);
      if (action === 'background-import') return music;
      if (action === 'reference-commit') return reference;
      if (action === 'update-reference') return { ...reference, text: '更正后的原话' };
      throw new Error('Unexpected worker request: ' + action);
    } });
  await app.invoke('background-import'); await app.invoke('reference-commit', {});
  await app.invoke('update-reference', { id: reference.id });
  const status = await app.invoke('status');
  assert.equal(status.backgrounds.length, 1); assert.equal(status.backgrounds[0], music);
  assert.equal(status.references.length, 1);
  assert.equal(status.references[0].text, '更正后的原话');
  assert.deepEqual(calls, ['background-import', 'reference-commit', 'update-reference']);
});

function cli(f, onInvoke) {
  const filename = path.join(__dirname, '../cli/studio.cjs'), localRequire = createRequire(filename);
  let stdout = '';
  const mockProcess = { env: process.env, cwd: process.cwd, platform: process.platform, on() {}, removeListener() {}, stdin: { isTTY: true },
    stdout: { write(value) { stdout += value; } }, stderr: { write() {} } };
  const service = { createStudio: () => ({ dataDir: f.dataDir, invoke: onInvoke, close: async () => {}, cancel() {} }),
    studioError: (code, message) => Object.assign(new Error(message), { code }) };
  const sandbox = { module: { exports: {} }, process: mockProcess, Buffer, setTimeout, clearTimeout,
    require: name => name === '../desktop/service.cjs' ? service : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox);
  return { run: sandbox.module.exports.run, output: () => JSON.parse(stdout) };
}

test('CLI export cleans its intermediate after success and after a destination collision race', async t => {
  const f = fixture(t);
  for (const collision of [false, true]) {
    const archive = f.archive(), destination = path.join(f.dataDir, collision ? 'collision.zip' : 'saved.zip');
    const app = cli(f, async (action, data) => {
      assert.equal(action, 'zip'); assert.equal(data.ids[0], 'one');
      if (collision) fs.writeFileSync(destination, 'created-by-user-during-export');
      return archive;
    });
    const code = await app.run(['export', '--id', 'one', '--output', destination]);
    assert.equal(code, collision ? 1 : 0);
    assert.equal(app.output().ok, !collision);
    assert.equal(fs.existsSync(archive.directory), false);
    assert.equal(fs.readFileSync(destination, 'utf8'), collision ? 'created-by-user-during-export' : 'PK-owned-archive');
  }
});

test('failed staging copy and cancelled publication preserve existing destination and leave no stages', async t => {
  const f = fixture(t), destination = path.join(f.dataDir, 'existing.zip');
  fs.writeFileSync(destination, 'existing-user-archive');
  const missingSource = f.archive();
  fs.unlinkSync(missingSource.path);
  await assert.rejects(copyTemporaryExport(f.dataDir, missingSource, destination), { code: 'ENOENT' });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'existing-user-archive');
  assert.equal(fs.existsSync(missingSource.directory), false);
  const cancelled = f.archive();
  await assert.rejects(copyTemporaryExport(f.dataDir, cancelled, destination, 0, () => true), { code: 'CANCELLED' });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'existing-user-archive');
  assert.equal(fs.existsSync(cancelled.directory), false);
  assert.deepEqual(fs.readdirSync(f.dataDir).filter(name => name.startsWith('.voice-export-')), []);
  const saved = f.archive();
  await copyTemporaryExport(f.dataDir, saved, destination);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'PK-owned-archive');
});

test('exclusive export fallback on filesystems without hard links retains no-overwrite behavior', async t => {
  const f = fixture(t), destination = path.join(f.dataDir, 'removable-disk.zip');
  t.mock.method(fs.promises, 'link', async () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); });
  const saved = f.archive();
  await copyTemporaryExport(f.dataDir, saved, destination, fs.constants.COPYFILE_EXCL);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'PK-owned-archive');
  const conflict = f.archive();
  await assert.rejects(copyTemporaryExport(f.dataDir, conflict, destination, fs.constants.COPYFILE_EXCL), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'PK-owned-archive');
  assert.equal(fs.existsSync(conflict.directory), false);
});
