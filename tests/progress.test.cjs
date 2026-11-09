const { test } = require('node:test');
const assert = require('node:assert/strict');
const progress = require('../ui/progress.js');

test('a long single segment stays indeterminate until audio has been saved', () => {
  const task = progress.create({ text: '长文'.repeat(150), voiceName: '知夏' }, 1000);
  progress.advance(task, { stage: 'loading' });
  assert.match(progress.view(task).title, /唤醒/);
  progress.advance(task, { stage: 'generating', current: 1, total: 1 });
  const waiting = progress.view(task, 92000);
  assert.equal(waiting.fraction, 0); assert.equal(waiting.indeterminate, true);
  assert.equal(waiting.elapsed, '1 分 31 秒'); assert.match(waiting.note, /仍在处理中/);
  progress.advance(task, { stage: 'encoding', current: 1, total: 1 });
  assert.equal(progress.view(task).fraction, 0);
  progress.advance(task, { stage: 'clip', item: { id: 'saved' } });
  assert.equal(task.running, true); assert.equal(task.stage, 'finishing');
  progress.finish(task, 'complete', '', 95000);
  assert.equal(progress.view(task, 200000).elapsed, '1 分 34 秒');
  assert.equal(progress.view(task).fraction, 1);
});

test('late progress during cancellation preserves saved clips without reviving animation', () => {
  const task = progress.create({ rows: [{ text: '第一段' }, { text: '第二段' }] }, 0);
  task.stopping = true;
  progress.advance(task, { stage: 'clip', item: { id: 'first' } });
  progress.advance(task, { stage: 'generating', current: 2, total: 2 });
  assert.match(progress.view(task).title, /停止/); assert.equal(task.completed, 1);
  progress.finish(task, 'cancelled', '', 12000);
  progress.advance(task, { stage: 'clip', item: { id: 'late' } });
  assert.equal(task.completed, 1); assert.equal(task.running, false);
});
