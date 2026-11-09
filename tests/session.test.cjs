const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore } = require('../desktop/session.cjs');

test('editor session survives a database reopen, including empty content and full dialogue', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let store = createSessionStore(root);
  assert.equal(store.load(), null);
  const snapshot = { schema: 'shengyue-project-1', text: '上次编辑的文案', rows: [{ text: '长台词'.repeat(400), voiceKey: 'preset:Serena', emotion: 'happy', filename: '第一句' }], script: true, voiceKey: 'preset:Vivian', emotion: 'sad', batch: false, options: { project: '作品', prefix: 'voice', sampleRate: 48000, pace: 'slow' } };
  store.save(snapshot); store.close(); store = createSessionStore(root);
  assert.deepEqual(store.load(), snapshot);
  const blank = { ...snapshot, text: '', rows: [], options: { project: '' } };
  store.save(blank); store.close(); store = createSessionStore(root);
  assert.deepEqual(store.load(), blank);
  store.close();
  assert.equal(fs.readFileSync(path.join(root, 'studio.sqlite')).subarray(0, 15).toString(), 'SQLite format 3');
});

test('invalid or oversized writes preserve the previous session', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-session-'));
  const store = createSessionStore(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const snapshot = { schema: 'shengyue-project-1', text: '保留我', rows: [], options: {} };
  store.save(snapshot);
  for (const invalid of [null, {}, { ...snapshot, rows: Array(101).fill({ text: '' }) }, { ...snapshot, rows: [null] }, { ...snapshot, options: [] }, { ...snapshot, text: '字'.repeat(1024 * 1024) }]) assert.throws(() => store.save(invalid));
  assert.deepEqual(store.load(), snapshot);
});
