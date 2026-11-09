const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createStudio } = require('../desktop/service.cjs');
const { licenseMessage } = require('../desktop/license.cjs');
const { RESOURCE_PACKAGES, resourceSelection, resourcePlan } = require('../desktop/resources.cjs');
const root = path.join(__dirname, '..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = require('node:child_process').spawnSync(process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3'),
  ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout?.trim();

test('resource selection keeps optional expressive cloning out of defaults and rejects invalid batches', () => {
  assert.deepEqual(resourceSelection(), RESOURCE_PACKAGES);
  assert.deepEqual(resourceSelection({ packages: ['character', 'reference', 'character'] }), ['character', 'reference']);
  assert.ok(!RESOURCE_PACKAGES.includes('expressive'));
  assert.deepEqual(resourceSelection({ packages: ['expressive'] }), ['expressive']);
  for (const packages of [[], 'standard', ['unknown'], Array(6).fill('light')]) assert.throws(() => resourceSelection({ packages }), { code: 'INVALID_ARGUMENT' });
});

test('resource planning counts resumable files and rejects incomplete or obsolete installation markers', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-resource-plan-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const filename = path.join(root, 'desktop/resources.cjs'), localRequire = createRequire(filename);
  const pinned = { revision: 'current', weights: { 'model.bin': 'fixed' }, files: {
    'model.bin': { size: 100, sha256: 'fixed' }, 'config.json': { size: 20, sha256: 'config' }
  } };
  const sandbox = { module: { exports: {} }, process, require: name => name === '../shared/model-manifest.json'
    ? { repositories: { 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice': pinned } } : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox);
  const plan = () => sandbox.module.exports.resourcePlan(base, ['standard'], 'win32', 'x64');
  const folder = path.join(base, 'models/qwen3-custom');
  fs.mkdirSync(path.join(folder, '.cache/downloads'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'config.json'), Buffer.alloc(20));
  fs.writeFileSync(path.join(folder, '.cache/downloads/model.bin.fixed.incomplete'), Buffer.alloc(40));
  assert.equal(plan().downloadBytes, 60);
  assert.equal(plan().ready, false);
  fs.writeFileSync(path.join(folder, 'model.bin'), Buffer.alloc(100));
  const marker = { repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', revision: 'current', weights: pinned.weights, files: { 'model.bin': 100, 'config.json': 20 } };
  const save = value => fs.writeFileSync(path.join(folder, '.complete.json'), JSON.stringify(value));
  save(marker); assert.equal(plan().ready, true); assert.equal(plan().downloadBytes, 0);
  save({ ...marker, revision: 'old' }); assert.equal(plan().ready, false);
  save({ ...marker, files: { 'model.bin': 100 } }); assert.equal(plan().ready, false);
  save(marker); fs.unlinkSync(path.join(folder, 'config.json')); assert.equal(plan().ready, false);
  fs.writeFileSync(path.join(folder, '.cache/downloads/config.json.config.incomplete'), Buffer.alloc(30));
  assert.equal(plan().downloadBytes, 20, 'oversized partial files must not count as reusable');
});

const worker = `import json,sys,pathlib,time
root=pathlib.Path(sys.argv[2]); ready=root/'test-ready.json'
def status():
 ids=json.loads(ready.read_text()) if ready.exists() else []
 unverified=root/'unverified'; blocked=unverified.read_text() if unverified.exists() else None
 return {'packages':[{'id':key,'ready':key in ids,'verified':key!=blocked} for key in ['standard','light','character','reference']]}
for line in sys.stdin:
 q=json.loads(line); data=q.get('data',{}); op=q['op']
 if op=='status': result=status()
 elif op=='download':
  key=data['package']
  with (root/'calls.jsonl').open('a') as log: log.write(json.dumps(key)+'\\n')
  print(json.dumps({'type':'progress','stage':'download','aggregateCurrent':50,'aggregateTotal':100,'downloadPhase':'transferring'}),flush=True)
  time.sleep(.1)
  if (root/'fail-package').exists() and (root/'fail-package').read_text()==key:
   print(json.dumps({'type':'error','id':q['id'],'message':'fixture network failure'}),flush=True); continue
  ids=[p['id'] for p in status()['packages'] if p['ready']]; ready.write_text(json.dumps(list(set(ids+[key]))))
  result=status()
 else: raise ValueError(op)
 print(json.dumps({'type':'result','id':q['id'],'result':result}),flush=True)
`;
function fixture(t, onProgress = () => {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-resource-batch-'));
  fs.mkdirSync(path.join(base, 'backend')); fs.writeFileSync(path.join(base, 'backend/worker.py'), worker);
  const dataDir = path.join(base, 'data'), keys = crypto.generateKeyPairSync('ed25519'), studios = [];
  function create() {
    const previous = process.env.VOICE_STUDIO_PYTHON;
    process.env.VOICE_STUDIO_PYTHON = python;
    let studio;
    try { studio = createStudio({ dataDir, resourceDir: base, trustedPublicKey: keys.publicKey, onProgress }); }
    finally { if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous; }
    studio.licensing.activate('SY2.' + crypto.sign(null, licenseMessage(studio.licensing.machine), keys.privateKey).toString('base64url'));
    studios.push(studio); return studio;
  }
  const studio = create();
  t.after(async () => { await Promise.all(studios.map(item => item.close())); fs.rmSync(base, { recursive: true, force: true }); });
  return { studio, create, dataDir, calls: () => fs.readFileSync(path.join(dataDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) };
}

test('one resource task skips verified packages, aggregates bytes and only completes when all packages are ready', async t => {
  const events = [], f = fixture(t, event => events.push(event));
  fs.writeFileSync(path.join(f.dataDir, 'test-ready.json'), JSON.stringify(['standard']));
  const result = await f.studio.invoke('setup', { packages: RESOURCE_PACKAGES });
  assert.deepEqual(f.calls(), ['light', 'character', 'reference']);
  assert.ok(result.packages.every(pack => pack.ready));
  assert.equal(result.resources.preparation.status, 'complete');
  const transfers = events.filter(event => event.stage === 'download');
  assert.equal(transfers.length, 3);
  assert.ok(transfers.every(event => event.resourcesTotal === resourcePlan(f.dataDir).total));
  assert.ok(transfers.every((event, index) => !index || event.resourcesCurrent >= transfers[index - 1].resourcesCurrent));
  await f.studio.invoke('setup', { packages: RESOURCE_PACKAGES });
  assert.equal(f.calls().length, 3, 'preparing again does not download installed packages');
  await f.studio.invoke('setup', { packages: RESOURCE_PACKAGES, checkUpdates: true });
  assert.deepEqual(f.calls().slice(3), RESOURCE_PACKAGES, 'explicit update checks verify every selected package');
});

test('a failed batch remains incomplete and a retry skips packages completed before failure', async t => {
  const f = fixture(t), failure = path.join(f.dataDir, 'fail-package');
  fs.writeFileSync(failure, 'character');
  await assert.rejects(f.studio.invoke('setup', { packages: RESOURCE_PACKAGES }), /fixture network failure/);
  assert.equal((await f.studio.invoke('status')).resources.preparation.status, 'failed');
  assert.deepEqual(f.calls(), ['standard', 'light', 'character']);
  fs.unlinkSync(failure);
  await f.studio.invoke('setup', { packages: RESOURCE_PACKAGES });
  assert.deepEqual(f.calls(), ['standard', 'light', 'character', 'character', 'reference']);
});

test('an installed package lacking current verification cannot make the complete resource task succeed', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dataDir, 'test-ready.json'), JSON.stringify(RESOURCE_PACKAGES));
  fs.writeFileSync(path.join(f.dataDir, 'unverified'), 'reference');
  await assert.rejects(f.studio.invoke('setup', { packages: RESOURCE_PACKAGES }), { code: 'RESOURCE_INCOMPLETE' });
  assert.deepEqual(f.calls(), ['reference'], 'unverified resources must be included in preparation');
  assert.equal((await f.studio.invoke('status')).resources.preparation.status, 'failed');
});

test('pause stops the batch, persists progress, and resumes remaining packages after service restart', async t => {
  let paused = false, f;
  f = fixture(t, event => {
    if (!paused && event.stage === 'download' && event.package === 'character') { paused = true; f.studio.cancel(); }
  });
  await assert.rejects(f.studio.invoke('setup', { packages: RESOURCE_PACKAGES }), { code: 'CANCELLED' });
  const first = (await f.studio.invoke('status')).resources.preparation;
  assert.equal(first.status, 'paused'); assert.ok(first.current > 0);
  assert.deepEqual(f.calls(), ['standard', 'light', 'character']);
  await f.studio.close();
  const restarted = f.create();
  assert.equal((await restarted.invoke('status')).resources.preparation.status, 'paused');
  await restarted.invoke('setup', { packages: RESOURCE_PACKAGES });
  assert.deepEqual(f.calls(), ['standard', 'light', 'character', 'character', 'reference']);
  fs.writeFileSync(path.join(f.dataDir, 'resource-preparation.json'), JSON.stringify({ ...first, status: 'running' }));
  await restarted.close();
  assert.equal((await f.create().invoke('status')).resources.preparation.status, 'paused', 'unexpected shutdown must not leave a permanently running task');
});

test('packaged engine materializes the pinned optional Python adapter recursively without model weights', t => {
  const { materializeEngine } = require('../desktop/integrity.cjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-vendor-materialize-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'backend/vendor/voxcpm/model'), { recursive: true });
  fs.mkdirSync(path.join(base, 'shared'));
  fs.writeFileSync(path.join(base, 'backend/worker.py'), '# worker');
  fs.writeFileSync(path.join(base, 'backend/vendor/voxcpm/__init__.py'), '# package');
  fs.writeFileSync(path.join(base, 'backend/vendor/voxcpm/model/voxcpm2.py'), '# adapter');
  fs.writeFileSync(path.join(base, 'backend/vendor/voxcpm/LICENSE'), 'Apache-2.0');
  fs.writeFileSync(path.join(base, 'backend/vendor/voxcpm/model/weights.pth'), 'excluded');
  const engine = materializeEngine(base); t.after(engine.cleanup);
  assert.equal(fs.readFileSync(path.join(engine.root, 'backend/vendor/voxcpm/model/voxcpm2.py'), 'utf8'), '# adapter');
  assert.equal(fs.readFileSync(path.join(engine.root, 'backend/vendor/voxcpm/LICENSE'), 'utf8'), 'Apache-2.0');
  assert.equal(fs.existsSync(path.join(engine.root, 'backend/vendor/voxcpm/model/weights.pth')), false);
});
