const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { deleteStoredItem, deleteStoredWorks, deleteProjectAudio } = require('../desktop/deletion.cjs');
const { createStudio } = require('../desktop/service.cjs');
const { licenseMessage } = require('../desktop/license.cjs');
const { createJobQueue } = require('../desktop/jobs.cjs');
const first = 'a'.repeat(32), second = 'b'.repeat(32);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-delete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'references'));
  for (const id of [first, second]) {
    fs.mkdirSync(path.join(root, 'outputs', id), { recursive: true });
    for (const name of ['voice.wav', 'voice.mp3', 'metadata.json']) fs.writeFileSync(path.join(root, 'outputs', id, name), name);
    fs.writeFileSync(path.join(root, 'references', `${id}.json`), JSON.stringify({ id, name: id }));
    fs.writeFileSync(path.join(root, 'references', `${id}.wav`), 'audio');
  }
  fs.writeFileSync(path.join(root, 'history.json'), JSON.stringify([{ id: first }, { id: second }]));
  return root;
}
test('work deletion removes only the selected audio and history, preserves references and licensing', async t => {
  const root = fixture(t), resources = path.join(root, 'resources'), keys = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(resources, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'shared/license-public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const studio = createStudio({ dataDir: root, resourceDir: resources, trustedPublicKey: keys.publicKey }); t.after(() => studio.close());
  studio.licensing.activate(`SY2.${crypto.sign(null, licenseMessage(studio.licensing.machine), keys.privateKey).toString('base64url')}`);
  const license = studio.licensing.status();
  assert.deepEqual(await studio.invoke('delete-work', { id: first }), { deleted: true, id: first });
  assert.equal(fs.existsSync(path.join(root, 'outputs', first)), false);
  assert.equal(fs.existsSync(path.join(root, 'outputs', second, 'voice.wav')), true);
  assert.equal(fs.existsSync(path.join(root, 'references', `${first}.wav`)), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'history.json'))), [{ id: second }]);
  assert.deepEqual(studio.licensing.status(), license);
});
test('reference deletion removes metadata and recording without touching generated works', t => {
  const root = fixture(t);
  deleteStoredItem(root, 'reference', first);
  assert.equal(fs.existsSync(path.join(root, 'references', `${first}.json`)), false);
  assert.equal(fs.existsSync(path.join(root, 'references', `${first}.wav`)), false);
  assert.equal(fs.existsSync(path.join(root, 'references', `${second}.wav`)), true);
  assert.equal(fs.existsSync(path.join(root, 'outputs', first, 'voice.wav')), true);
});

test('bulk deletion removes selected version families, preserves other works and rejects project ownership', t => {
  const root = fixture(t), third = 'c'.repeat(32), projectClip = 'd'.repeat(32);
  fs.cpSync(path.join(root, 'outputs', first), path.join(root, 'outputs', third), { recursive: true });
  fs.writeFileSync(path.join(root, 'outputs', third, 'edited.wav'), 'edited');
  const history = [{ id: first }, { id: third, options: { generationGroupId: first } }, { id: second }, { id: projectClip, options: { projectId: 'project', generationGroupId: first } }];
  fs.writeFileSync(path.join(root, 'history.json'), JSON.stringify(history));
  assert.throws(() => deleteStoredWorks(root, [first, projectClip]), /不存在或已删除/);
  for (const ids of [[], ['../references'], [first, 'e'.repeat(32)], null]) assert.throws(() => deleteStoredWorks(root, ids));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'history.json'))), history);
  assert.deepEqual(deleteStoredWorks(root, [third, third]).deletedIds, [first, third]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'history.json'))), [history[2], history[3]]);
  for (const id of [first, third]) assert.equal(fs.existsSync(path.join(root, 'outputs', id)), false);
  assert.equal(fs.existsSync(path.join(root, 'outputs', second, 'voice.wav')), true);
  assert.equal(fs.existsSync(path.join(root, 'references', first + '.wav')), true);
});

test('bulk deletion rolls back every file on a failed commit and refuses redirected audio folders', t => {
  const root = fixture(t), historyFile = path.join(fs.realpathSync(root), 'history.json');
  const before = fs.readFileSync(historyFile), rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === historyFile) throw Object.assign(new Error('disk failure'), { code: 'EIO' });
    return rename(source, target);
  });
  assert.throws(() => deleteStoredWorks(root, [first, second]), { code: 'EIO' }); mock.mock.restore();
  assert.deepEqual(fs.readFileSync(historyFile), before);
  for (const id of [first, second]) assert.equal(fs.existsSync(path.join(root, 'outputs', id, 'voice.wav')), true);
  assert.equal(fs.readdirSync(path.join(root, 'outputs')).some(name => name.startsWith('.deleting-')), false);
  fs.renameSync(path.join(root, 'outputs', second), path.join(root, 'retained'));
  fs.symlinkSync(path.join(root, 'retained'), path.join(root, 'outputs', second), 'dir');
  assert.throws(() => deleteStoredWorks(root, [first, second]), /目录无效/);
  assert.equal(fs.existsSync(path.join(root, 'outputs', first, 'voice.wav')), true);
});

test('bulk task cleanup commits every deleted version together and survives restart', async t => {
  const root = fixture(t), queue = createJobQueue({ dataDir: root, execute: async () => ({ items: [{ id: first }, { id: second }] }), cancel() {} });
  queue.submit({ rows: [{ text: '一' }, { text: '二' }] });
  assert.throws(() => queue.forgetItems([first, second]), /配音完成/);
  await new Promise(resolve => setImmediate(resolve));
  queue.forgetItems([first, second]); assert.equal(queue.snapshot().jobs.length, 0); queue.shutdown();
  const restored = createJobQueue({ dataDir: root, execute() {}, cancel() {} }); t.after(() => restored.shutdown());
  assert.equal(restored.snapshot().jobs.length, 0);
});
test('invalid ids, unknown records and redirected directories cannot delete adjacent files', t => {
  const root = fixture(t);
  for (const id of ['../history', '', 'Vivian', 'c'.repeat(32)]) assert.throws(() => deleteStoredItem(root, 'work', id));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'history.json'))).length, 2);
  fs.renameSync(path.join(root, 'outputs'), path.join(root, 'other-outputs'));
  fs.symlinkSync(path.join(root, 'other-outputs'), path.join(root, 'outputs'), 'dir');
  assert.throws(() => deleteStoredItem(root, 'work', first), /目录无效/);
  assert.equal(fs.existsSync(path.join(root, 'other-outputs', first, 'voice.wav')), true);
});
test('deleted clips stay removed from task snapshots after restart; completed tasks disappear when empty', async t => {
  const root = fixture(t);
  const queue = createJobQueue({ dataDir: root, execute: async () => ({ items: [{ id: first }, { id: second }] }), cancel() {} });
  queue.submit({ rows: [{ text: '一' }, { text: '二' }] });
  assert.throws(() => queue.forgetItem(first), /配音完成/);
  await new Promise(resolve => setImmediate(resolve));
  queue.forgetItem(first);
  assert.deepEqual(queue.snapshot().jobs[0].items, [{ id: second }]);
  assert.equal(queue.snapshot().jobs[0].completed, 2);
  queue.shutdown();
  const restored = createJobQueue({ dataDir: root, execute() {}, cancel() {} }); t.after(() => restored.shutdown());
  assert.deepEqual(restored.snapshot().jobs[0].items, [{ id: second }]);
  restored.forgetItem(second); assert.equal(restored.snapshot().jobs.length, 0);
});

test('project audio deletion removes every take and edit but preserves other projects and recorded voices', t => {
  const root = fixture(t), third = 'c'.repeat(32), projectId = 'project-to-delete';
  fs.cpSync(path.join(root, 'outputs', first), path.join(root, 'outputs', third), { recursive: true });
  fs.writeFileSync(path.join(root, 'outputs', first, 'edit-voice.wav'), 'edited audio');
  const history = [{ id: first, options: { projectId } }, { id: second, options: { projectId: 'keep-project' } }, { id: third, options: { projectId } }];
  fs.writeFileSync(path.join(root, 'history.json'), JSON.stringify(history));
  fs.writeFileSync(path.join(root, 'exported.wav'), 'user export');
  assert.deepEqual(deleteProjectAudio(root, projectId).deletedIds, [first, third]);
  assert.equal(fs.existsSync(path.join(root, 'outputs', first)), false);
  assert.equal(fs.existsSync(path.join(root, 'outputs', third)), false);
  assert.equal(fs.existsSync(path.join(root, 'outputs', second, 'voice.wav')), true);
  assert.equal(fs.existsSync(path.join(root, 'references', first + '.wav')), true);
  assert.equal(fs.readFileSync(path.join(root, 'exported.wav'), 'utf8'), 'user export');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'history.json'))), [history[1]]);
  assert.deepEqual(deleteProjectAudio(root, projectId).deletedIds, [], 'retrying an already cleaned project is safe');
});

test('failed project history commit restores all staged audio, and unsafe records fail before deletion', t => {
  const root = fixture(t), historyFile = path.join(fs.realpathSync(root), 'history.json'), projectId = 'project-to-delete';
  const history = [{ id: first, options: { projectId } }, { id: second, options: { projectId } }];
  fs.writeFileSync(historyFile, JSON.stringify(history));
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === historyFile) throw Object.assign(new Error('disk failure'), { code: 'EIO' });
    return rename(source, target);
  });
  assert.throws(() => deleteProjectAudio(root, projectId), { code: 'EIO' }); mock.mock.restore();
  assert.deepEqual(JSON.parse(fs.readFileSync(historyFile)), history);
  for (const id of [first, second]) assert.equal(fs.readFileSync(path.join(root, 'outputs', id, 'voice.wav'), 'utf8'), 'voice.wav');
  assert.equal(fs.readdirSync(path.join(root, 'outputs')).some(name => name.startsWith('.deleting-')), false);
  fs.writeFileSync(historyFile, JSON.stringify([...history, { id: '../references', options: { projectId } }]));
  assert.throws(() => deleteProjectAudio(root, projectId), /记录无效/);
  assert.equal(fs.existsSync(path.join(root, 'outputs', first)), true);
});

test('deleting a project also removes its terminal generation jobs across a restart', async t => {
  const root = fixture(t), projectId = 'deleted-project';
  const queue = createJobQueue({ dataDir: root, execute: async data => ({ items: [{ id: data.projectId === projectId ? first : second }] }), cancel() {} });
  t.after(() => queue.shutdown());
  const options = id => ({ projectId: id, projectBatch: true, rows: [{ text: '项目台词', lineId: 'line', lineVersion: 'a'.repeat(32) }] });
  queue.submit(options(projectId));
  assert.throws(() => queue.forgetProject(projectId), /完成或取消/);
  await new Promise(resolve => setImmediate(resolve));
  queue.submit(options('retained-project')); await new Promise(resolve => setImmediate(resolve));
  queue.forgetProject(projectId);
  assert.deepEqual(queue.snapshot().jobs.map(job => job.projectId), ['retained-project']);
  queue.shutdown();
  const restored = createJobQueue({ dataDir: root, execute() {}, cancel() {} }); t.after(() => restored.shutdown());
  assert.deepEqual(restored.snapshot().jobs.map(job => job.projectId), ['retained-project']);
});
