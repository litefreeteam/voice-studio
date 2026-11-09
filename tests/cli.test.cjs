const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { createStudio } = require('../desktop/service.cjs');
const { LicenseStore, licenseMessage } = require('../desktop/license.cjs');
const project = path.join(__dirname, '..');
const localPython = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonCommand = process.env.VOICE_STUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
const python = spawnSync(pythonCommand, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout?.trim();
assert.ok(python, 'CLI integration tests require Python 3');
const fixtureWorker = `import sys, json, pathlib, uuid, time, os
root = pathlib.Path(sys.argv[2])
(root/'worker-started').write_text('started')
def emit(value): print(json.dumps(value), flush=True)
def history():
    return json.loads((root/'history.json').read_text()) if (root/'history.json').exists() else []
emit({'type':'ready'})
for line in sys.stdin:
    q=json.loads(line); d=q.get('data',{}); op=q['op']
    if op=='status': r={'history':history(),'references':[],'packages':[]}
    elif op=='generate':
        items=[]
        rows=d.get('rows') or [{'text':x} for x in (d['text'].splitlines() if d.get('batch') else [d['text']]) if x.strip()]
        for row in rows:
            if row['text']=='SLOW':
                emit({'type':'progress','stage':'generating','message':'waiting'})
                time.sleep(20)
            if row['text']=='EXIT': os._exit(7)
            if row['text']=='FAIL':
                emit({'type':'error','id':q['id'],'message':'fixture failure'})
                break
            ident=uuid.uuid4().hex; folder=root/'outputs'/ident; folder.mkdir()
            item={'id':ident,'wav':'voice.wav','mp3':'voice.mp3','text':row['text'],'speaker':d.get('speaker','Vivian'),'sampleRate':d.get('sampleRate',48000)}
            (folder/'voice.wav').write_bytes(b'RIFFfixture')
            (folder/'voice.mp3').write_bytes(b'fixture-mp3')
            (folder/'metadata.json').write_text(json.dumps(item))
            (root/'history.json').write_text(json.dumps([item]+history()))
            items.append(item); emit({'type':'progress','stage':'clip','item':item})
        else:
            emit({'type':'result','id':q['id'],'result':{'items':items}})
        continue
    elif op=='zip':
        token=uuid.uuid4().hex; folder=root/'.export-tmp'/('voice-export-'+token); folder.mkdir(parents=True)
        (folder/'owner.json').write_text(json.dumps({'schema':'shengyue-export-v1','token':token,'pid':os.getppid(),'createdAt':int(time.time()*1000)}))
        target=folder/'archive.zip'; target.write_bytes(b'PKfixture'); r={'path':str(target),'count':len(d['ids'])}
    else: r=d
    emit({'type':'result','id':q['id'],'result':r})
`;

function fixture(t, { activated = true, realWorker = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue cli 中文-'));
  const data = path.join(base, 'data');
  fs.mkdirSync(data);
  fs.mkdirSync(path.join(base, 'backend'));
  fs.mkdirSync(path.join(base, 'shared'));
  fs.writeFileSync(path.join(base, 'backend/worker.py'), fixtureWorker);
  fs.copyFileSync(path.join(project, 'shared/catalog.json'), path.join(base, 'shared/catalog.json'));
  const keys = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(base, 'shared/license-public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  if (realWorker) {
    for (const file of ['edition.json', 'model-manifest.json', 'download-sources.json', 'transcription-manifest.json']) fs.copyFileSync(path.join(project, 'shared', file), path.join(base, 'shared', file));
    for (const file of fs.readdirSync(path.join(project, 'backend')).filter(file => file.endsWith('.py') && file !== 'worker.py')) {
      fs.copyFileSync(path.join(project, 'backend', file), path.join(base, 'backend', file));
    }
    const source = fs.readFileSync(path.join(project, 'backend/worker.py'), 'utf8')
      .replace(/PUBLIC_KEY_PEM = b"""[\s\S]*?"""/, 'PUBLIC_KEY_PEM = b"""' + keys.publicKey.export({ type: 'spki', format: 'pem' }) + '"""');
    const inference = `
def fixture_synthesis(self, text, speaker, instruction, options):
    import numpy as np
    with (self.root / 'inference.jsonl').open('a') as file:
        file.write(json.dumps({'text': text, 'mode': options.get('mode'), 'refPath': options.get('refPath')}) + '\\n')
    if text == 'FAIL_ONCE' and not (self.root / 'failed-once').exists():
        (self.root / 'failed-once').write_text('failed')
        raise RuntimeError('simulated inference failure')
    return np.full(4 * 24000, .1, dtype=np.float32), 24000
Studio._synthesize = fixture_synthesis
Studio.load = lambda self, key: None
Studio.model_ready = lambda self, key: True
`;
    fs.writeFileSync(path.join(base, 'backend/worker.py'), source.replace('if __name__ == "__main__":', inference + '\nif __name__ == "__main__":'));
  }
  const licensing = new LicenseStore(data, keys.publicKey);
  function sign(overrides = {}) {
    return `SY2.${crypto.sign(null, licenseMessage(overrides.machine ?? licensing.machine), keys.privateKey).toString('base64url')}`;
  }
  if (activated) licensing.activate(sign());
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const launcher = `require(${JSON.stringify(path.join(project, 'cli/studio.cjs'))}).run(JSON.parse(process.argv[1]), {resourceDir:process.argv[2], trustedPublicKey:require('node:fs').readFileSync(require('node:path').join(process.argv[2],'shared/license-public.pem'),'utf8')}).then(code=>{process.exitCode=code})`;
  function start(args, { input, keepOpen, interpreter = python } = {}) {
    const child = spawn(process.execPath, ['-e', launcher, JSON.stringify(['--data-dir', data, ...args]), base], { env: { ...process.env, VOICE_STUDIO_PYTHON: interpreter }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', x => { stdout += x; });
    child.stderr.on('data', x => { stderr += x; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => {
        try { resolve({ code, stdout, stderr, json: JSON.parse(stdout) }); } catch (error) { reject(new Error(`${error.message}: ${stdout} / ${stderr}`)); }
      });
    });
    if (input !== undefined) child.stdin.end(input); else if (!keepOpen) child.stdin.end();
    return { child, done };
  }
  return { base, data, trustedPublicKey: keys.publicKey, start, sign, call: (args, opts) => start(args, opts).done };
}

test('CLI discovery, strict flags and malformed JSON never load an engine', async t => {
  const f = fixture(t);
  assert.equal((await f.call(['describe'])).json.schema, 'shengyue-cli-1');
  for (const args of [['generate'], ['status', '--speaker', 'Vivian'], ['generate', '--text', 'a', '--sample-rate', 'bad'], ['setup', '--package', 'invalid'], ['generate', '--text', 'a', '--text-file', 'b']]) {
    const r = await f.call(args);
    assert.equal(r.code, 2, JSON.stringify(r));
    assert.equal(r.json.error.code, 'INVALID_ARGUMENT');
  }
  assert.equal((await f.call(['generate', '--input', '-'], { input: '{bad' })).code, 2);
  assert.equal((await f.call(['generate', '--input', '-'], { input: '[]' })).code, 2);
  for (const data of [{ text: 'a', spekaer: 'Vivian' }, { text: 'a', batch: 'false' }, { rows: [{ speaker: 'Vivian' }] }, { text: 'a', intensity: true },
    { text: 'a', lockVoice: 'true' }, { text: 'a', voiceScopeId: 'x'.repeat(65) }, { text: 'a', voiceAnchorId: '../escape' }]) {
    assert.equal((await f.call(['generate', '--input', '-'], { input: JSON.stringify(data) })).code, 2);
  }
});

test('unactivated CLI preflight only inspects the environment and never starts a worker', async t => {
  const f = fixture(t, { activated: false });
  for (const args of [['preflight', '--package', 'all'], ['preflight', 'prepare', '--package', 'light']]) {
    const response = await f.call(args);
    assert.equal(response.code, 0, JSON.stringify(response));
    assert.equal(response.json.result.scope, 'environment');
    assert.equal(response.json.result.schema, 'shengyue-compatibility-2');
    assert.ok(response.json.result.results.every(result => result.duration === undefined));
    assert.equal(fs.existsSync(path.join(f.data, 'worker-started')), false);
    assert.equal(fs.existsSync(path.join(f.data, 'models')), false);
    assert.equal(fs.existsSync(path.join(f.data, 'preflight')), false);
  }
  assert.equal((await f.call(['preflight', 'confirm', '--heard'])).code, 2);
});

test('CLI and actual backend keep designed voices through partial failure, process restart, redo and explicit reset', async t => {
  // The service intentionally uses -I. Select a complete test interpreter through
  // VOICE_STUDIO_PYTHON; PYTHONPATH alone must not relax production isolation.
  const dependencies = spawnSync(python, ['-I', '-c', 'import numpy, soundfile, lameenc, cryptography'], { encoding: 'utf8' });
  assert.equal(dependencies.status, 0, `The isolated test Python requires audio and signature dependencies: ${dependencies.error?.message || dependencies.stderr}`);
  const f = fixture(t, { realWorker: true });
  const identity = ['--mode', 'design', '--character', 'meditation-female', '--voice-scope-id', 'story', '--voice-id', 'narrator'];
  const partial = await f.call(['generate', ...identity, '--text', '第一句\nFAIL_ONCE\n第三句', '--batch']);
  assert.equal(partial.code, 1, JSON.stringify(partial));
  const history = (await f.call(['history'])).json.result.items;
  assert.equal(history.length, 1, JSON.stringify(partial));
  const anchor = history[0].voiceAnchorId;
  assert.match(anchor, /^[a-f0-9]{64}$/); assert.equal(history[0].synthesisMode, 'clone');
  const resume = await f.call(['generate', ...identity, '--input', '-'], { input: JSON.stringify({ rows: [
    { text: 'FAIL_ONCE', emotion: 'happy' }, { text: '第三句', instruction: '不同的逐句指令' }] }) });
  assert.equal(resume.code, 0, JSON.stringify(resume));
  assert.ok(resume.json.result.items.every(item => item.voiceAnchorId === anchor && item.synthesisMode === 'clone'));
  const redo = await f.call(['generate', ...identity, '--voice-anchor-id', anchor, '--text', '修改后的第一句']);
  assert.equal(redo.code, 0, JSON.stringify(redo)); assert.equal(redo.json.result.items[0].voiceAnchorId, anchor);
  const calls = () => fs.readFileSync(path.join(f.data, 'inference.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls().filter(call => call.mode === 'design').length, 1, 'all processes share the original persisted sample');
  const reset = await f.call(['generate', ...identity, '--voice-revision', 'new-choice', '--text', '重新确定声音']);
  assert.equal(reset.code, 0, JSON.stringify(reset)); assert.notEqual(reset.json.result.items[0].voiceAnchorId, anchor);
  const free = await f.call(['generate', ...identity, '--free-voice', '--text', '自由一句\n自由两句', '--batch']);
  assert.equal(free.code, 0, JSON.stringify(free)); assert.ok(free.json.result.items.every(item => !item.voiceAnchorId));
  for (const text of ['默认范围第一句', '默认范围第二句']) {
    const result = await f.call(['generate', '--mode', 'design', '--character', 'meditation-female', '--text', text]);
    assert.equal(result.code, 0, JSON.stringify(result));
    if (text.endsWith('第一句')) history.push(result.json.result.items[0]);
    else assert.equal(result.json.result.items[0].voiceAnchorId, history.at(-1).voiceAnchorId);
  }
  const cast = await f.call(['generate', '--mode', 'design', '--character', 'meditation-female', '--voice-scope-id', 'two-roles', '--input', '-'], {
    input: JSON.stringify({ rows: [{ text: '甲第一句', voiceId: 'a' }, { text: '乙第一句', voiceId: 'b' }, { text: '甲第二句', voiceId: 'a' }] }) });
  assert.equal(cast.code, 0, JSON.stringify(cast));
  assert.equal(cast.json.result.items[0].voiceAnchorId, cast.json.result.items[2].voiceAnchorId);
  assert.notEqual(cast.json.result.items[0].voiceAnchorId, cast.json.result.items[1].voiceAnchorId);
});

test('free CLI works on a fresh profile and ignores missing or corrupt legacy activation', async t => {
  const f = fixture(t, { activated: false });
  assert.equal((await f.call(['describe'])).json.licensing.required, false);
  const license = (await f.call(['license'])).json.result;
  assert.equal(license.edition, '免费版'); assert.equal(license.activationRequired, false);
  assert.equal(license.machineCode, '');
  for (const code of [null, 'old corrupt code']) {
    if (code) fs.writeFileSync(path.join(f.data, 'license.txt'), code);
    assert.equal((await f.call(['catalog'])).code, 0);
    assert.equal((await f.call(['generate', '--text', '免费配音'])).code, 0);
  }
  assert.equal((await f.call(['history'])).json.result.items.length, 2);
});

test('free shared service preserves existing data without activation', async t => {
  const f = fixture(t, { activated: false });
  fs.writeFileSync(path.join(f.data, 'history.json'), JSON.stringify([{ id: 'old-work' }]));
  const previous = process.env.VOICE_STUDIO_PYTHON; process.env.VOICE_STUDIO_PYTHON = python;
  t.after(() => { if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous; });
  const service = createStudio({ dataDir: f.data, resourceDir: f.base }); t.after(() => service.close());
  assert.equal((await service.invoke('status')).history[0].id, 'old-work');
  assert.ok((await service.invoke('catalog')).voices.length);
  assert.equal((await service.invoke('generate', { text: '免费生成' })).items.length, 1);
});

test('stdin batch, separate progress, absolute files, shared activation and safe exports', async t => {
  const f = fixture(t);
  const r = await f.call(['generate', '--input', '-', '--output-dir', path.join(f.base, 'exports'), '--sample-rate', '24000'], { input: JSON.stringify({ rows: [{ text: '你好' }, { text: '再见' }] }) });
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(r.json.result.items.length, 2);
  assert.equal(r.stderr.trim().split('\n').map(JSON.parse).filter(x => x.stage === 'clip').length, 2);
  for (const item of r.json.result.items) {
    assert.equal(item.sampleRate, 24000);
    assert.ok(path.isAbsolute(item.paths.wav));
    assert.equal(fs.readFileSync(item.exportPath, 'utf8'), 'RIFFfixture');
  }
  const lic = await f.call(['license', 'status']);
  assert.equal(lic.json.result.activated, true);
  assert.equal('remaining' in lic.json.result, false);
  const history = await f.call(['history']);
  assert.equal(history.json.result.items.length, 2);
  const output = path.join(f.base, 'result.zip');
  const exported = await f.call(['export', '--ids', r.json.result.items.map(x => x.id).join(','), '--output', output]);
  assert.equal(exported.code, 0, JSON.stringify(exported));
  assert.equal(exported.json.result.count, 2);
  assert.equal(fs.readFileSync(output, 'utf8'), 'PKfixture');
  assert.deepEqual(fs.readdirSync(path.join(f.data, '.export-tmp')), []);
  assert.equal((await f.call(['export', '--id', r.json.result.items[0].id, '--output', output])).json.error.code, 'OUTPUT_EXISTS');
  const noOverwrite = await f.call(['generate', '--text', 'a', '--output', output]);
  assert.equal(noOverwrite.json.error.code, 'OUTPUT_EXISTS');
  assert.equal(fs.existsSync(path.join(f.data, 'usage.json')), false);
});

test('partial failure preserves saved clips; free use still requires reference consent', async t => {
  const f = fixture(t);
  const failed = await f.call(['generate', '--input', '-'], { input: JSON.stringify({ rows: [{ text: 'saved' }, { text: 'FAIL' }] }) });
  assert.equal(failed.json.error.code, 'ENGINE_ERROR');
  assert.equal((await f.call(['license'])).json.result.activated, true);
  assert.equal((await f.call(['history'])).json.result.items.length, 1);
  const consent = await f.call(['references', 'import', '--file', '/tmp/test.wav', '--text', 'reference']);
  assert.equal(consent.json.error.code, 'CONSENT_REQUIRED');
  fs.rmSync(path.join(f.data, 'license.txt'), { force: true });
  assert.equal((await f.call(['generate', '--text', '无需激活'])).code, 0);
  assert.notEqual((await f.call(['generate', '--text', 'EXIT'])).code, 5);
});

test('desktop service and separate CLI serialize tasks; cancellation releases lock', async t => {
  const f = fixture(t);
  const previous = process.env.VOICE_STUDIO_PYTHON;
  process.env.VOICE_STUDIO_PYTHON = python;
  t.after(() => { if (previous === undefined) delete process.env.VOICE_STUDIO_PYTHON; else process.env.VOICE_STUDIO_PYTHON = previous; });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const desktop = createStudio({ dataDir: f.data, resourceDir: f.base, trustedPublicKey: f.trustedPublicKey, onProgress: event => { if (event.stage === 'generating') started(); } });
  const active = desktop.invoke('generate', { text: 'SLOW' });
  const rejection = assert.rejects(active, { code: 'CANCELLED' });
  await ready;
  assert.equal((await f.call(['generate', '--text', 'competing'])).code, 3);
  desktop.cancel();
  await rejection;
  await desktop.close();
  assert.equal((await f.call(['generate', '--text', 'after cancel'])).code, 0);
  assert.ok(!fs.existsSync(path.join(f.data, '.operation.lock')));
});

test('timeouts and engine exits return JSON, stop workers and allow retry', async t => {
  const f = fixture(t);
  const timeout = await f.call(['generate', '--text', 'SLOW', '--timeout', '0.4']);
  assert.equal(timeout.code, 124);
  assert.equal(timeout.json.error.code, 'TIMEOUT');
  assert.ok(!fs.existsSync(path.join(f.data, '.operation.lock')));
  assert.equal((await f.call(['generate', '--text', 'EXIT'])).json.error.code, 'ENGINE_EXITED');
  assert.equal((await f.call(['generate', '--text', 'retry', '--quiet'])).stderr, '');
  const waitingInput = f.start(['generate', '--input', '-', '--timeout', '0.1'], { keepOpen: true });
  assert.equal((await waitingInput.done).code, 124);
});

test('SIGINT keeps completed audio and returns a structured cancellation', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const running = f.start(['generate', '--input', '-'], { input: JSON.stringify({ rows: [{ text: 'completed' }, { text: 'SLOW' }] }) });
  await new Promise(resolve => running.child.stderr.on('data', chunk => { if (chunk.toString().includes('waiting')) resolve(); }));
  running.child.kill('SIGINT');
  const result = await running.done;
  assert.equal(result.code, 130);
  assert.equal(result.json.error.code, 'CANCELLED');
  assert.equal((await f.call(['history'])).json.result.items.length, 1);
  assert.equal(fs.existsSync(path.join(f.data, 'usage.json')), false);
});

test('missing runtime is actionable and stale locks recover', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.data, { recursive: true });
  fs.mkdirSync(path.join(f.data, '.operation.lock'));
  fs.writeFileSync(path.join(f.data, '.operation.lock/2147483647-stale'), '');
  assert.equal((await f.call(['status'])).code, 0);
  const result = await f.call(['generate', '--text', 'a'], { interpreter: path.join(f.base, 'missing-python') });
  assert.equal(result.code, 4);
  assert.equal(result.json.error.code, 'RUNTIME_NOT_READY');
});
