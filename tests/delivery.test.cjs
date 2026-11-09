const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { licenseMessage } = require('../desktop/license.cjs');
const { createDeliveryController, cleanupDeliveryWork, cleanupDeliveryExport, cleanupStaleDeliveryWork,
  copyTemporaryExport, validateTemporaryExport, cleanupStaleExports } = require('../desktop/exports.cjs');
const { materializeEngine } = require('../desktop/integrity.cjs');
const repo = path.join(__dirname, '..');
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-delivery-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  function owned(kind, token = crypto.randomUUID().replaceAll('-', ''), pid = process.pid) {
    const directory = path.join(dataDir, kind === 'work' ? '.export-work' : '.export-tmp', `voice-export-${token}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ schema: kind === 'work' ? 'shengyue-delivery-work-v1' : 'shengyue-export-v1', token, pid }));
    const file = path.join(directory, kind === 'work' ? 'merged.wav' : 'archive.zip');
    fs.writeFileSync(file, 'owned-delivery');
    return { path: file, directory, token, count: 2, durationSeconds: 1.25, warnings: ['fixture warning'] };
  }
  return { dataDir, owned };
}
function controller(f, overrides = {}) {
  const events = [], destination = path.join(f.dataDir, 'saved.zip');
  let kills = 0, calls = 0;
  const instance = createDeliveryController({ dataDir: f.dataDir, allow() {},
    choose: async () => ({ canceled: false, filePath: destination }),
    invoke: async (action, data, shouldCancel, onStart) => { assert.equal(action, 'project-export'); calls++; if (shouldCancel()) throw Error('cancelled'); onStart(); return f.owned('archive'); },
    cancelWorker: () => { kills++; }, progress: event => events.push(event), ...overrides });
  return { ...instance, events, destination, calls: () => calls, kills: () => kills };
}
const request = (id = 'export-1') => ({ requestId: id, projectId: 'project', projectName: '项目', items: [{ id: 'a'.repeat(32) }], settings: { normalize: true, pauseMs: 350 } });

test('delivery controller snapshots before the dialog and saves through an owned atomic copy', async t => {
  const f = fixture(t), dialog = defer(), input = request();
  let received;
  const c = controller(f, { choose: () => dialog.promise, invoke: async (_action, data, _guard, start) => { received = data; start(); return f.owned('archive'); } });
  const running = c.run(input);
  assert.equal(c.busy(), true);
  input.settings.pauseMs = 999; input.items[0].id = 'b'.repeat(32);
  await assert.rejects(c.run(request('second')), { code: 'BUSY' });
  dialog.resolve({ canceled: false, filePath: c.destination });
  const result = await running;
  assert.equal(result.saved, true); assert.equal(result.count, 2); assert.equal(result.durationSeconds, 1.25);
  assert.equal(received.settings.pauseMs, 350); assert.equal(received.items[0].id, 'a'.repeat(32));
  assert.equal(fs.readFileSync(c.destination, 'utf8'), 'owned-delivery');
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, '.export-tmp')), []);
  assert.deepEqual(c.events.map(event => [event.stage, event.phase, event.requestId]), [['delivery', 'queued', 'export-1'], ['delivery', 'save', 'export-1']]);
  assert.equal(c.busy(), false);
});

test('dialog cancellation and cancellation during dialog create no archive or second dialog', async t => {
  const f = fixture(t);
  const dismissed = controller(f, { choose: async () => ({ canceled: true }) });
  assert.equal((await dismissed.run(request())).cancelled, true);
  assert.equal(dismissed.calls(), 0);
  const dialog = defer(), c = controller(f, { choose: () => dialog.promise });
  const running = c.run(request());
  assert.equal(c.cancel('stale').cancelled, false);
  assert.equal(c.cancel('export-1').cancelled, true);
  await assert.rejects(c.run(request('second')), { code: 'BUSY' });
  dialog.resolve({ canceled: false, filePath: c.destination });
  assert.equal((await running).saved, false); assert.equal(c.calls(), 0); assert.equal(c.kills(), 0);
  assert.equal(fs.existsSync(c.destination), false); assert.equal(c.busy(), false);
});

test('queued cancellation resolves without killing generation and a stale cancel cannot stop the next export', async t => {
  const f = fixture(t), queue = [];
  const c = controller(f, { invoke: (_action, _data, guard, start) => {
    const job = defer(); queue.push({ ...job, guard, start }); return job.promise;
  } });
  const first = c.run(request('old'));
  await flush(); assert.equal(queue.length, 1);
  assert.equal(c.cancel('old').cancelled, true);
  assert.equal((await first).cancelled, true); assert.equal(c.kills(), 0); assert.equal(c.busy(), false);
  const second = c.run(request('new'));
  await flush();
  assert.equal(c.cancel('old').cancelled, false); assert.equal(queue[0].guard(), true);
  queue[0].reject(Error('queued request cancelled'));
  assert.equal(queue[1].guard(), false); queue[1].start(); queue[1].resolve(f.owned('archive'));
  assert.equal((await second).saved, true); assert.equal(c.kills(), 0);
});

test('running cancel waits for its worker and cleans a result racing with cancellation', async t => {
  const f = fixture(t), worker = defer(); let killed;
  const c = controller(f, { invoke: (_action, _data, _guard, start) => { start(); return worker.promise; }, cancelWorker: id => { killed = id; } });
  const running = c.run(request()); await flush();
  c.cancel('export-1'); assert.equal(killed, 'export-1'); assert.equal(c.busy(), true);
  const artifact = f.owned('archive'); worker.resolve(artifact);
  assert.equal((await running).cancelled, true);
  assert.equal(fs.existsSync(artifact.directory), false); assert.equal(fs.existsSync(c.destination), false);
});

test('save cancellation and failure preserve the old destination and release the busy state', async t => {
  const f = fixture(t), copying = defer(); let shouldCancel;
  const c = controller(f, { copy: async (dir, result, destination, flags, guard) => {
    shouldCancel = guard; await copying.promise; return copyTemporaryExport(dir, result, destination, flags, guard);
  } });
  fs.writeFileSync(c.destination, 'existing-final');
  const running = c.run(request()); await flush(); assert.equal(typeof shouldCancel, 'function');
  c.cancel('export-1'); copying.resolve();
  assert.equal((await running).cancelled, true); assert.equal(c.kills(), 0);
  assert.equal(fs.readFileSync(c.destination, 'utf8'), 'existing-final'); assert.equal(c.busy(), false);
  const broken = controller(f, { choose: async () => ({ canceled: false, filePath: path.join(f.dataDir, 'absent', 'result.zip') }) });
  await assert.rejects(broken.run(request()), { code: 'ENOENT' }); assert.equal(broken.busy(), false);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, '.export-tmp')), []);
});

test('license gate runs before the dialog and again before publication', async t => {
  const f = fixture(t); let checks = 0, dialogOpened = false;
  const denied = controller(f, { allow: () => { throw Error('license denied'); }, choose: async () => { dialogOpened = true; } });
  await assert.rejects(denied.run(request()), /license denied/); assert.equal(dialogOpened, false);
  const expires = controller(f, { allow: () => { if (++checks === 2) throw Error('license changed'); } });
  await assert.rejects(expires.run(request()), /license changed/);
  assert.equal(fs.existsSync(expires.destination), false); assert.equal(expires.busy(), false);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, '.export-tmp')), []);
});

test('work cleanup is token and pid scoped and refuses unowned files and symlinks', t => {
  const f = fixture(t), owned = f.owned('work'), foreign = f.owned('work'), stale = f.owned('work', undefined, 2147483647);
  fs.writeFileSync(path.join(foreign.directory, 'my-file.txt'), 'preserve');
  assert.equal(cleanupDeliveryWork(f.dataDir, owned.token), true);
  assert.equal(cleanupDeliveryWork(f.dataDir, foreign.token), false);
  assert.equal(cleanupDeliveryWork(f.dataDir, stale.token), false);
  assert.equal(cleanupDeliveryWork(f.dataDir, '../escape'), false);
  assert.equal(cleanupStaleDeliveryWork(f.dataDir), 1);
  const link = f.owned('work'); fs.unlinkSync(link.path); fs.symlinkSync(path.join(foreign.directory, 'my-file.txt'), link.path);
  assert.equal(cleanupDeliveryWork(f.dataDir, link.token), false);
  assert.equal(fs.readFileSync(path.join(foreign.directory, 'my-file.txt'), 'utf8'), 'preserve');
});

test('temporary archive validation prevents path, token, pid and symlink confusion before copying', async t => {
  const f = fixture(t), valid = f.owned('archive');
  validateTemporaryExport(f.dataDir, valid, valid.token);
  assert.throws(() => validateTemporaryExport(f.dataDir, valid, 'f'.repeat(32)), { code: 'INVALID_EXPORT' });
  const other = f.owned('archive', undefined, 2147483647);
  assert.throws(() => validateTemporaryExport(f.dataDir, other), { code: 'INVALID_EXPORT' });
  assert.equal(cleanupDeliveryExport(f.dataDir, other.token), false);
  const user = path.join(f.dataDir, 'user.wav'); fs.writeFileSync(user, 'private');
  await assert.rejects(copyTemporaryExport(f.dataDir, { path: user }, path.join(f.dataDir, 'out.zip')), { code: 'INVALID_EXPORT' });
  assert.equal(fs.readFileSync(user, 'utf8'), 'private');
  assert.equal(cleanupDeliveryExport(f.dataDir, valid.token), true);
});

test('data root aliases accept canonical worker paths and retain scratch symlink protection', async t => {
  const f = fixture(t), alias = path.join(f.dataDir, 'data-alias');
  fs.symlinkSync(fs.realpathSync(f.dataDir), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const archive = f.owned('archive'), canonical = { ...archive, path: fs.realpathSync(archive.path) };
  validateTemporaryExport(alias, canonical, archive.token);
  const destination = path.join(f.dataDir, 'alias-export.zip');
  await copyTemporaryExport(alias, canonical, destination);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'owned-delivery');
  assert.equal(fs.existsSync(archive.directory), false);
  const work = f.owned('work');
  assert.equal(cleanupDeliveryWork(alias, work.token), true);
  const stale = f.owned('archive', undefined, 2147483647);
  assert.equal(cleanupStaleExports(alias), 1);
  assert.equal(fs.existsSync(stale.directory), false);
  const linked = f.owned('archive'), user = path.join(f.dataDir, 'user.zip');
  fs.writeFileSync(user, 'preserve'); fs.unlinkSync(linked.path); fs.symlinkSync(user, linked.path);
  const linkedPath = path.join(fs.realpathSync(f.dataDir), '.export-tmp', path.basename(linked.directory), 'archive.zip');
  assert.throws(() => validateTemporaryExport(alias, { ...linked, path: linkedPath }), { code: 'INVALID_EXPORT' });
  assert.equal(fs.readFileSync(user, 'utf8'), 'preserve');
  fs.rmSync(linked.directory, { recursive: true });
  const scratchRoot = path.join(f.dataDir, '.export-tmp');
  fs.rmdirSync(scratchRoot); fs.mkdirSync(path.join(f.dataDir, 'foreign'));
  fs.symlinkSync(path.join(f.dataDir, 'foreign'), scratchRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const redirected = f.owned('archive');
  assert.throws(() => validateTemporaryExport(alias, redirected), { code: 'INVALID_EXPORT' });
});

function desktop(f, overrides = {}) {
  const filename = path.join(repo, 'desktop/app.cjs'), localRequire = createRequire(filename);
  const window = { webContents: { mainFrame: { url: 'file:///fixture/index.html' }, send() {} }, isDestroyed: () => false };
  let handler, genericKills = 0, exportKills = 0;
  const electron = { app: { setName() {}, setPath() {}, getPath: () => f.dataDir, requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}) },
    ipcMain: { on() {}, handle(channel, callback) { if (channel === 'studio') handler = callback; } },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path.join(f.dataDir, 'desktop.zip') }) }, powerSaveBlocker: {} };
  const studio = { invoke: async () => f.owned('archive'), cancel() { genericKills++; }, cancelExport() { exportKills++; }, ...overrides };
  const sandbox = { require: name => name === 'electron' ? electron : localRequire(name), __dirname: path.dirname(filename),
    process, Promise, console, testWindow: window, testStudio: studio };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nwindow = testWindow; studio = testStudio; licensing = {allow() {}}; globalThis.queueGeneration = data => invokeStudio("generate", data);', sandbox);
  return { invoke: async (action, data, event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }) => { const reply = await handler(event, action, data); if (!reply.ok) throw Object.assign(new Error(reply.error.message), { code: reply.error.code }); return reply.result; },
    queueGeneration: sandbox.queueGeneration, genericKills: () => genericKills, exportKills: () => exportKills };
}

test('desktop IPC export cancellation cannot kill a queued generation and rejects untrusted frames', async t => {
  const f = fixture(t), generation = defer(); let exports = 0;
  const app = desktop(f, { invoke: async action => { if (action === 'generate') return generation.promise; exports++; return f.owned('archive'); } });
  const generating = app.queueGeneration({});
  const exporting = app.invoke('project-export', request());
  await flush();
  assert.equal((await app.invoke('project-export-cancel', { requestId: 'wrong' })).cancelled, false);
  assert.equal((await app.invoke('cancel')).cancelled, true);
  assert.equal((await exporting).cancelled, true); assert.equal(exports, 0);
  assert.equal(app.genericKills(), 0); assert.equal(app.exportKills(), 0);
  await assert.rejects(app.invoke('project-export', request(), { sender: {}, senderFrame: { url: 'file:///evil.html' } }), /请求来源无效/);
  generation.resolve({ items: [] }); await generating; await flush(); assert.equal(exports, 0);
});

function pythonCommand() {
  const candidates = [process.env.VOICE_STUDIO_PYTHON, path.join(repo, '.venv/bin/python'), 'python3'].filter(Boolean);
  for (const command of candidates) {
    const found = cp.spawnSync(command, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
    if (found.status === 0) return found.stdout.trim();
  }
  throw Error('Python 3 is required for worker delivery lifecycle tests');
}
function service(t, onProgress) {
  const f = fixture(t), resources = path.join(f.dataDir, 'resource'); fs.mkdirSync(path.join(resources, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'backend/worker.py'), `import sys, json, os, time\nfrom pathlib import Path\nroot = Path(sys.argv[sys.argv.index('--data-dir') + 1])\nfor line in sys.stdin:\n r=json.loads(line); d=r.get('data',{}); op=r['op']\n if op=='generate':\n  print(json.dumps({'type':'progress','stage':'generation-wait'}),flush=True); time.sleep(0.25); result={'generated':True}\n else:\n  token=d['exportToken']\n  for kind in ['.export-work','.export-tmp']:\n   p=root/kind/('voice-export-'+token); p.mkdir(parents=True)\n   (p/'owner.json').write_text(json.dumps({'schema':'shengyue-delivery-work-v1' if kind=='.export-work' else 'shengyue-export-v1','token':token,'pid':os.getppid()}))\n   (p/('merged.wav' if kind=='.export-work' else 'archive.zip')).write_bytes(b'owned-worker-file')\n  print(json.dumps({'type':'progress','stage':'delivery','phase':'render','current':1,'total':2}),flush=True)\n  if d.get('wait'): time.sleep(60)\n  if d.get('fail'):\n   print(json.dumps({'type':'error','id':r['id'],'message':'fixture failure'}),flush=True); continue\n  result={'path':str(root/'.export-tmp'/('voice-export-'+token)/'archive.zip'),'count':2,'token':token}\n  if d.get('foreign'): result['path']=str(root/'foreign.zip')\n print(json.dumps({'type':'result','id':r['id'],'result':result}),flush=True)\n`);
  const { createStudio } = require('../desktop/service.cjs');
  const keys = crypto.generateKeyPairSync('ed25519'), previous = process.env.VOICE_STUDIO_PYTHON;
  process.env.VOICE_STUDIO_PYTHON = pythonCommand();
  let studio;
  try { studio = createStudio({ dataDir: f.dataDir, resourceDir: resources, trustedPublicKey: keys.publicKey, onProgress }); }
  finally { if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous; }
  studio.licensing.activate('SY2.' + crypto.sign(null, licenseMessage(studio.licensing.machine), keys.privateKey).toString('base64url'));
  t.after(async () => { await studio.close(); });
  return { ...f, studio, resources, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
}
function artifacts(f, kind) { try { return fs.readdirSync(path.join(f.dataDir, kind)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }

test('service assigns its own export token, scopes progress and cleans only scratch on success', async t => {
  const events = [], f = service(t, event => events.push(event));
  const result = await f.studio.invoke('project-export', { ...request(), exportToken: 'a'.repeat(32) });
  assert.notEqual(result.token, 'a'.repeat(32));
  assert.equal(events[0].requestId, 'export-1'); assert.equal(events[0].projectId, 'project');
  assert.deepEqual(artifacts(f, '.export-work'), []); assert.equal(artifacts(f, '.export-tmp').length, 1);
  await copyTemporaryExport(f.dataDir, result, path.join(f.dataDir, 'published.zip'));
  assert.deepEqual(artifacts(f, '.export-tmp'), []);
});

test('service cancelExport never kills generation; matching running export cancellation reclaims parent-owned artifacts after worker close', async t => {
  const seen = defer(), f = service(t, event => { if (event.stage === 'delivery') seen.resolve(event); });
  const generation = f.studio.invoke('generate', {});
  assert.equal(f.studio.cancelExport('export-1'), false);
  assert.equal((await generation).generated, true);
  const running = f.studio.invoke('project-export', { ...request(), wait: true });
  const rejected = assert.rejects(running, { code: 'CANCELLED' });
  await seen.promise;
  assert.equal(f.studio.cancelExport('stale'), false);
  assert.equal(f.studio.cancelExport('export-1'), true);
  await rejected;
  assert.deepEqual(artifacts(f, '.export-work'), []); assert.deepEqual(artifacts(f, '.export-tmp'), []);
  assert.equal(fs.existsSync(path.join(f.dataDir, '.operation.lock')), false);
  assert.equal((await f.studio.invoke('generate', {})).generated, true);
});

test('worker errors and forged archive paths leave no current-token artifacts or busy lock', async t => {
  const f = service(t, () => {}); fs.writeFileSync(path.join(f.dataDir, 'foreign.zip'), 'user data');
  for (const data of [{ fail: true }, { foreign: true }]) {
    await assert.rejects(f.studio.invoke('project-export', { ...request(), ...data }), data.fail ? /fixture failure/ : { code: 'INVALID_EXPORT' });
    assert.deepEqual(artifacts(f, '.export-work'), []); assert.deepEqual(artifacts(f, '.export-tmp'), []);
    assert.equal(fs.readFileSync(path.join(f.dataDir, 'foreign.zip'), 'utf8'), 'user data');
    assert.equal(fs.existsSync(path.join(f.dataDir, '.operation.lock')), false);
  }
});

test('packaged engine materialization carries delivery module through the existing verified source path', () => {
  const payload = materializeEngine(repo);
  try {
    assert.equal(fs.readFileSync(path.join(payload.root, 'backend/delivery.py'), 'utf8'), fs.readFileSync(path.join(repo, 'backend/delivery.py'), 'utf8'));
    for (const voice of require('../shared/catalog.json').characters.filter(voice => voice.reference)) {
      const sample = path.join('backend', voice.reference.file);
      assert.deepEqual(fs.readFileSync(path.join(payload.root, sample)), fs.readFileSync(path.join(repo, sample)));
    }
  } finally { payload.cleanup(); }
});

test('free real worker project-export reaches project validation without activation', t => {
  const f = fixture(t);
  const run = cp.spawnSync(pythonCommand(), ['-I', '-X', 'utf8', '-u', path.join(repo, 'backend/worker.py'), '--data-dir', f.dataDir], {
    input: JSON.stringify({ id: 7, op: 'project-export', data: request() }) + '\n', encoding: 'utf8', timeout: 15000
  });
  assert.equal(run.status, 0, run.stderr);
  const messages = run.stdout.trim().split('\n').map(line => JSON.parse(line));
  const error = messages.find(message => message.id === 7);
  assert.equal(error.type, 'error'); assert.equal(error.code, 'ENGINE_ERROR');
  assert.equal(fs.existsSync(path.join(f.dataDir, '.export-tmp')), false);
  assert.equal(fs.existsSync(path.join(f.dataDir, '.export-work')), false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'history.json')), false);
});

test('licensed real worker delivers audio and subtitles through service and atomic publication without loading a model', async t => {
  const f = service(t, () => {});
  // The production source and trust anchor are never changed. Only this isolated
  // worker wrapper accepts a test key, and model loading is a hard test failure.
  fs.writeFileSync(path.join(f.resources, 'backend/worker.py'), `import importlib.util\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('fixture_worker', ${JSON.stringify(path.join(repo, 'backend/worker.py'))})\nw=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)\nw.PUBLIC_KEY_PEM=${JSON.stringify(f.publicKeyPem)}.encode()\ndef no_model(*args, **kwargs): raise AssertionError('delivery must not load a model')\nw.Studio.load=no_model\nw.main()\n`);
  const id = 'a'.repeat(32), folder = path.join(f.dataDir, 'outputs', id); fs.mkdirSync(folder);
  const sampleRate = 24000, samples = 2400, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * 440 * 2 * Math.PI / sampleRate) * 3000), 44 + index * 2);
  fs.writeFileSync(path.join(folder, 'sample.wav'), wav);
  const history = JSON.stringify([{ id, wav: 'sample.wav', text: '真实边界测试。', options: {} }]);
  fs.writeFileSync(path.join(f.dataDir, 'history.json'), history);
  const result = await f.studio.invoke('project-export', request());
  assert.equal(result.count, 1); assert.equal(result.durationSeconds, 0.1);
  const destination = path.join(f.dataDir, 'delivered.zip'); await copyTemporaryExport(f.dataDir, result, destination);
  const inspect = cp.spawnSync(pythonCommand(), ['-c', 'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"files":z.namelist(),"error":z.testzip(),"srt":z.read("subtitles.srt").decode(),"manifest":json.loads(z.read("manifest.json"))},ensure_ascii=False))', destination], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr);
  const zip = JSON.parse(inspect.stdout);
  assert.equal(zip.error, null); assert.ok(zip.files.includes('merged.wav')); assert.ok(zip.files.includes('merged.mp3'));
  assert.ok(zip.files.some(name => name.startsWith('segments/'))); assert.match(zip.srt, /真实边界测试。/);
  assert.equal(zip.manifest.segments[0].sourceSha256, crypto.createHash('sha256').update(wav).digest('hex'));
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'history.json'), 'utf8'), history);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'sample.wav')), wav);
  assert.deepEqual(artifacts(f, '.export-work'), []); assert.deepEqual(artifacts(f, '.export-tmp'), []);
});

test('partial delivery save names are visibly marked, path-safe and fit UTF-8 filesystem limits', async t => {
  const f = fixture(t); let shown;
  const c = controller(f, { choose: async options => { shown = options; return { canceled: true }; } });
  await c.run({ ...request(), projectName: '../' + '𐐀'.repeat(150), partial: true });
  assert.equal(path.basename(shown.defaultPath), shown.defaultPath);
  assert.ok(shown.defaultPath.endsWith('-节选成品.zip'));
  assert.ok(Buffer.byteLength(shown.defaultPath) <= 255);
});

test('cleanup failure still removes the archive and releases busy without masking an original worker error', async t => {
  const f = service(t, () => {}), original = fs.unlinkSync;
  const mock = t.mock.method(fs, 'unlinkSync', file => {
    if (String(file).includes('.export-work') && path.basename(String(file)) === 'merged.wav') throw Object.assign(Error('fixture cleanup denied'), { code: 'EACCES' });
    return original(file);
  });
  try {
    await assert.rejects(f.studio.invoke('project-export', request()), { code: 'EACCES' });
    assert.deepEqual(artifacts(f, '.export-tmp'), []);
    assert.equal(fs.existsSync(path.join(f.dataDir, '.operation.lock')), false);
    await assert.rejects(f.studio.invoke('project-export', { ...request('next'), fail: true }), /fixture failure/);
    assert.deepEqual(artifacts(f, '.export-tmp'), []);
    assert.equal(fs.existsSync(path.join(f.dataDir, '.operation.lock')), false);
  } finally { mock.mock.restore(); }
  for (const name of artifacts(f, '.export-work')) assert.equal(cleanupDeliveryWork(f.dataDir, name.slice('voice-export-'.length)), true);
  assert.equal((await f.studio.invoke('generate')).generated, true);
});
