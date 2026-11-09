const { test } = require('node:test');
const assert = require('node:assert/strict');
const history = require('../ui/history.js');
const now = new Date(2026, 9, 9, 14, 0);
const at = (day, hour = 12) => new Date(2026, 9, day, hour).getTime();
const items = [
  { id: 'today', text: '你好，秋天', project: '秋日旅行', voiceName: '知夏', wav: 'trip_01.wav', mp3: 'trip_01.mp3', duration: 30, createdAt: at(9), options: { scene: 'video' } },
  { id: 'week-edge', text: '一起出发', project: '秋日旅行', speaker: 'Vivian', duration: 30.1, createdAt: at(3, 0), options: { scene: 'video' } },
  { id: 'before-week', text: '晚安故事', project: '睡前故事', voiceName: '温宁', duration: 120, createdAt: at(2), options: { scene: 'bedtime' } },
  { id: 'long', text: '很长的文案', duration: 120.1, createdAt: at(1), options: { project: '旧版作品', voiceName: '知夏' } },
  { id: 'legacy', text: '很久以前', speaker: 'Serena' },
  { id: 'future', duration: 3, createdAt: at(10) }
];
const names = { Vivian: '知夏', Serena: '温宁' };
const ids = (filters, data = items) => history.filter(data, filters, names, now).map(item => item.id);

test('standalone works exclude project audio by ownership while preserving named and legacy works', () => {
  const data = [
    ...items,
    { id: 'project-line', project: '秋日旅行', options: { projectId: 'project-1', chapterId: 'chapter', lineId: 'line' } },
    { id: 'removed-project-line', options: { projectId: 'removed-project' } },
    { id: 'quick-voice', options: { voiceScopeId: 'quick-1', project: '秋日旅行' } }
  ];
  const before = JSON.stringify(data);
  const works = history.standalone(data);
  assert.deepEqual(works.map(item => item.id), [...items.map(item => item.id), 'quick-voice']);
  assert.equal(works[0], data[0]);
  assert.equal(JSON.stringify(data), before, 'project audio stays available to project playback and export');
});

test('work search combines words and covers project, transcript, voice and both filenames', () => {
  assert.deepEqual(ids({ search: '秋日 知夏', scene: 'video' }), ['today', 'week-edge']);
  assert.deepEqual(ids({ search: ' TRIP_01.MP3 ' }), ['today']);
  assert.deepEqual(ids({ project: '秋日旅行', voice: '知夏', period: 'today', duration: 'short' }), ['today']);
  assert.deepEqual(ids({ voice: '温宁' }), ['before-week', 'legacy']);
  assert.deepEqual(ids({ scene: '__unknown__', project: '旧版作品' }), ['long']);
  assert.deepEqual(ids({ search: '没有这段文案' }), []);
});

test('recent periods use local calendar days with inclusive starts and exclusive tomorrow', () => {
  assert.deepEqual(ids({ period: 'today' }), ['today']);
  assert.deepEqual(ids({ period: 'week' }), ['today', 'week-edge']);
  assert.deepEqual(ids({ period: 'month' }), ['today', 'week-edge', 'before-week', 'long']);
  const edge = new Date(now); edge.setHours(0, 0, 0, 0); edge.setDate(edge.getDate() - 29);
  assert.deepEqual(ids({ period: 'month' }, [{ id: 'edge', createdAt: +edge }, { id: 'old', createdAt: +edge - 1 }]), ['edge']);
});

test('duration boundaries, stable sorting and missing legacy metadata keep correct results', () => {
  assert.deepEqual(ids({ duration: 'short' }), ['future', 'today']);
  assert.deepEqual(ids({ duration: 'medium' }), ['week-edge', 'before-week']);
  assert.deepEqual(ids({ duration: 'long' }), ['long']);
  const before = JSON.stringify(items);
  assert.deepEqual(ids({ sort: 'oldest' }), ['long', 'before-week', 'week-edge', 'today', 'future', 'legacy']);
  assert.deepEqual(ids({ sort: 'longest' }), ['long', 'before-week', 'week-edge', 'today', 'future', 'legacy']);
  assert.equal(JSON.stringify(items), before);
  assert.equal(history.project(items[4]), '未命名作品');
  assert.equal(history.timestamp({ createdAt: 'invalid' }), 0);
});

test('pagination clamps stale pages, respects page sizes and stays compact with many works', () => {
  const data = Array.from({ length: 67 }, (_, id) => ({ id }));
  const first = history.paginate(data); assert.equal(first.items.length, 12); assert.equal(first.start, 1); assert.equal(first.end, 12); assert.equal(first.pages, 6);
  const last = history.paginate(data, 99); assert.equal(last.page, 6); assert.equal(last.start, 61); assert.equal(last.end, 67); assert.equal(last.items.length, 7);
  assert.equal(history.paginate(data, -2, 24).items.length, 24);
  assert.equal(history.paginate(data, 1, 48).pages, 2);
  assert.equal(history.paginate(data, 1, 500).size, 12);
  const empty = history.paginate([], 9); assert.equal(empty.page, 1); assert.equal(empty.start, 0); assert.equal(empty.end, 0);
  const many = history.paginate(Array.from({ length: 10000 }), 400); assert.equal(many.numbers.length, 7); assert.deepEqual(many.numbers, [1, 398, 399, 400, 401, 402, 834]);
});
