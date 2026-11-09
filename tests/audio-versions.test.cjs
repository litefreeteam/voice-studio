const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../ui/projects.js');
const Lab = require('../ui/lab-core.js');
const { createProjectStore } = require('../desktop/projects.cjs');
const { createTranscriptionPreparation, selectAudioVersion } = require('../desktop/audio-operations.cjs');

function fixture() {
  const project = M.create(), line = M.line('这句台词。', project.roles[0].id); project.chapters[0].lines.push(line);
  const entry = M.entries(project)[0], resolve = () => ({ mode: 'preset', speaker: 'Vivian', engine: 'standard' });
  const options = M.optionsFor(project, entry, resolve), version = M.fingerprint(options);
  const clip = (take, at, part = 0, count = 1) => ({ id: String(at).padStart(32, '0'), text: line.text, duration: 4, createdAt: at,
    options: { ...options, lineVersion: version, lineTakeId: take, partIndex: part, partCount: count } });
  return { project, line, entry, resolve, options, version, clip };
}

test('selected older complete take survives a new generation, SQLite restart and export snapshot', () => {
  const f = fixture(), history = [f.clip('new', 3), f.clip('old', 1)];
  f.line.generationAttempt = { id: 'new', version: f.version }; f.line.selectedTake = { id: 'old', version: f.version };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-versions-'));
  try {
    let store = createProjectStore(directory); store.save(f.project); store.close(); store = createProjectStore(directory);
    const saved = store.load(f.project.id); store.close();
    const entry = M.entries(saved)[0], current = { ...entry, options: f.options, ...M.lineState(entry, f.options, M.audioIndex(history, f.project.id)) };
    assert.equal(current.clips[0].options.lineTakeId, 'old'); assert.equal(current.status, 'complete');
    const snapshot = M.deliverySnapshot({ project: saved, entries: [current] }); assert.equal(snapshot.items[0].id, history[1].id);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('versions keep multi-part takes separate and selected missing clips never fall back silently', () => {
  const f = fixture(), history = [f.clip('full', 1, 0, 2), f.clip('full', 2, 1, 2), f.clip('partial', 3, 0, 2)];
  const index = M.audioIndex(history, f.project.id), takes = M.takeVersions(f.entry, f.options, index);
  assert.equal(takes[0].complete, true); assert.equal(takes[1].complete, false);
  f.line.selectedTake = { id: 'deleted', version: f.version };
  assert.equal(M.lineState(f.entry, f.options, index).status, 'changed');
  f.line.selectedTake = { id: 'full', version: f.version };
  const changed = { ...f.options, text: '改过的文案。' };
  assert.equal(M.lineState(f.entry, changed, index).status, 'changed');
});

test('edited durations and mix settings enter immutable delivery snapshots', () => {
  const f = fixture(), clip = { ...f.clip('old', 1), editedWav: 'edit-abc.wav', editedDuration: 2 };
  f.project.mix = { backgroundId: 'a'.repeat(32), gainDb: -20, loop: true, ducking: true, offsetMs: 500 };
  const entry = { ...f.entry, options: f.options, status: 'complete', clips: [clip] };
  assert.equal(M.durationEstimate([entry], 0).seconds, 2);
  const snapshot = M.deliverySnapshot({ project: f.project, entries: [entry] }); f.project.mix.gainDb = -5;
  assert.equal(snapshot.mix.gainDb, -20); assert.equal(snapshot.items[0].editRevision, 'edit-abc.wav');
  assert.throws(() => M.validateMix({ ...f.project.mix, offsetMs: NaN }));
});

test('laboratory pinned versions are scoped by candidate and use edited duration', () => {
  const rows = [{ labKey: 'candidate-one' }], first = { id: 'a'.repeat(32), createdAt: 1, duration: 4, editedDuration: 2, options: { labId: 'work', labKey: 'candidate-one' } };
  const latest = { ...first, id: 'b'.repeat(32), createdAt: 2 };
  const result = Lab.match(rows, [latest, first], 'work', { 'candidate-one': first.id });
  assert.equal(result[0].item.id, first.id); assert.equal(result[0].item.duration, 2);
  assert.equal(Lab.match(rows, [first], 'other')[0].item, null);
});

test('cancelling queued transcription preparation never cancels an unrelated generation', async () => {
  let cancelledWorker = 0, skipped;
  const controller = createTranscriptionPreparation({ invoke: (_action, _data, shouldCancel) => { skipped = shouldCancel; return new Promise(() => {}); }, cancelWorker: () => cancelledWorker++ });
  const result = controller.run({ requestId: 'queued' });
  assert.equal(controller.cancel('other').cancelled, false);
  assert.equal(controller.cancel('queued').cancelled, true);
  assert.deepEqual(await result, { ready: false, cancelled: true });
  assert.equal(skipped(), true); assert.equal(cancelledWorker, 0);
});

test('running preparation cancels its worker once and then permits a fresh retry', async () => {
  let reject, cancelledWorker = 0;
  const controller = createTranscriptionPreparation({ invoke: (_action, _data, _cancelled, start) => { start(); return new Promise((_resolve, fail) => reject = fail); }, cancelWorker: () => { cancelledWorker++; reject(new Error('cancelled')); } });
  const first = controller.run({ requestId: 'first' });
  await assert.rejects(controller.run({ requestId: 'duplicate' }), /正在准备/);
  controller.cancel('first'); controller.cancel('first');
  assert.deepEqual(await first, { ready: false, cancelled: true }); assert.equal(cancelledWorker, 1);
  const next = controller.run({ requestId: 'next' }); reject(new Error('network failure')); await assert.rejects(next, /network failure/);
});

test('desktop version selection needs no inference worker and refuses foreign or redirected metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-choice-')), group = 'a'.repeat(32), chosen = 'b'.repeat(32);
  try {
    const output = path.join(directory, 'outputs', chosen); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify({ id: chosen, options: { generationGroupId: group } }));
    assert.equal(selectAudioVersion(directory, { groupId: group, id: chosen })[group], chosen);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'audio-selections.json')))[group], chosen);
    assert.throws(() => selectAudioVersion(directory, { groupId: 'c'.repeat(32), id: chosen }), /不属于/);
    fs.unlinkSync(path.join(output, 'metadata.json')); fs.symlinkSync(path.join(directory, 'audio-selections.json'), path.join(output, 'metadata.json'));
    assert.throws(() => selectAudioVersion(directory, { groupId: group, id: chosen }), /路径无效/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
