const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../ui/projects.js');
const jobs = require('../desktop/jobs.cjs');
const { parseScript } = require('../ui/csv.js');
const { emotions } = require('../shared/catalog.json');

function check(text) {
  const chunks = M.splitText(text);
  assert.deepEqual(chunks, jobs.splitText(text));
  assert.equal(chunks.join(''), text);
  const ends = new Set([0, ...[...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map(x => x.index + x.segment.length)]);
  let offset = 0;
  for (const chunk of chunks) {
    assert.ok(chunk.trim()); assert.ok(chunk.length <= 600); assert.ok(chunk.isWellFormed());
    assert.equal(Buffer.from(chunk).toString('utf8'), chunk);
    offset += chunk.length; assert.ok(ends.has(offset), 'a chunk ends only at a complete grapheme');
    assert.deepEqual(M.splitText(chunk), [chunk], 'already split rows are stable on retry');
  }
  return chunks;
}

test('shared splitter preserves supplementary characters, combining marks and compound emoji', () => {
  assert.equal(M.splitText, jobs.splitText);
  for (const symbol of ['𠮷', 'e\u0301', '👩🏽', '👨‍👩‍👧‍👦', '🇨🇳', '。\u0301']) {
    for (let padding = 588; padding <= 601; padding++) check('甲'.repeat(padding) + symbol + '结尾保留。');
  }
});

test('natural boundaries preserve English words and all separating whitespace', () => {
  assert.equal(check('甲'.repeat(598) + 'hello world，结尾保留。')[1], 'hello world，结尾保留。');
  assert.equal(check('甲'.repeat(595) + 'hello world，结尾保留。')[1], ' world，结尾保留。');
  for (const text of ['hello world. '.repeat(100), '甲'.repeat(598) + 'café works.',
    '  first\tsecond\r\n'.repeat(70), '甲'.repeat(600) + ' ', ' '.repeat(599) + 'hello',
    'a' + ' '.repeat(1000) + 'b', '甲'.repeat(599) + '\r\n结束']) check(text);
});

test('overlong tokens split safely; impossible graphemes and malformed text fail explicitly', () => {
  assert.deepEqual(check('a'.repeat(1201)).map(x => x.length), [600, 600, 1]);
  check('𠮷'.repeat(601));
  assert.throws(() => M.splitText('a' + '\u0301'.repeat(600)), /组合字符/);
  assert.throws(() => M.splitText('a' + ' '.repeat(1200) + 'b'), /连续空白/);
  for (const value of ['\ud842', '\udfb7', '正文\ud842结尾']) assert.throws(() => M.splitText(value), /Unicode/);
  for (const limit of [0, -1, 601, 1.5, Infinity]) assert.throws(() => M.splitText('text', limit), /1–600/);
  assert.deepEqual(M.splitText(' \t\n '), []);
});

test('queue preparation and project re-preparation retain exact chunk text and numbering', () => {
  const text = '甲'.repeat(595) + 'hello world，结尾保留。';
  const rows = jobs.prepareGeneration({ text }).rows;
  assert.equal(rows.map(x => x.text).join(''), text);
  const prepared = jobs.prepareProjectGeneration({ projectId: 'p', rows: rows.map((row, index) => ({ ...row,
    lineId: 'line', lineVersion: 'a'.repeat(32), partIndex: index, partCount: rows.length })) });
  assert.equal(prepared.rows.map(x => x.text).join(''), text);
  assert.deepEqual(prepared.rows.map(x => x.partIndex), [0, 1]);
  const imported = M.parse('旁白：' + text, '.txt', emotions, parseScript);
  assert.equal(imported.chapters[0].lines.map(x => x.text).join(''), text);
});

test('TXT times, URLs and drive paths remain intact while explicit roles and cues still parse', () => {
  for (const text of ['现在是15:30，请准时到场。', '15:30开始。', '现在是15：30，请准时到场。',
    '比例为1:2。', '请打开https://example.com页面。', 'https://example.com:8080/path',
    'ftp://example.com/file', 'mailto:hello@example.com', 'C:\\audio\\voice.wav']) {
    const parsed = M.parse(text, '.txt', emotions, parseScript);
    assert.equal(parsed.chapters[0].lines[0].text, text); assert.equal(parsed.chapters[0].lines[0].role, '旁白');
  }
  for (const [source, role, text, emotion] of [
    ['旁白：现在是15:30，请准时到场。', '旁白', '现在是15:30，请准时到场。', ''],
    ['小兔子（开心）：请打开https://example.com。', '小兔子', '请打开https://example.com。', 'happy'],
    ['角色1:现在是15:30。', '角色1', '现在是15:30。', ''],
    ['角色1: 30个人到了。', '角色1', '30个人到了。', ''],
    ['角色1:30个人到了。', '角色1', '30个人到了。', ''],
    ['旁白：/usr/bin目录。', '旁白', '/usr/bin目录。', ''],
    ['小兔子：/usr/bin 是目录。', '小兔子', '/usr/bin 是目录。', ''],
    ['Alice: /help opens help.', 'Alice', '/help opens help.', ''],
    ['Alice: [开心]Hello world!', 'Alice', 'Hello world!', 'happy'],
  ]) {
    const line = M.parse(source, '.txt', emotions, parseScript).chapters[0].lines[0];
    assert.equal(line.role, role); assert.equal(line.text, text); assert.equal(line.emotion, emotion);
  }
});

test('browser script loading provides the same splitter without CommonJS', () => {
  const context = vm.createContext({ Intl, crypto, structuredClone });
  for (const file of ['text.js', 'projects.js', 'lab-core.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui', file), 'utf8'), context);
  assert.equal(context.ScriptProjects.splitText('甲'.repeat(599) + '𠮷').join(''), '甲'.repeat(599) + '𠮷');
  assert.equal(context.VoiceLab.paragraphs('甲'.repeat(599) + '😀结束').join(''), '甲'.repeat(599) + '😀结束');
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.ok(html.indexOf('src="text.js"') < html.indexOf('src="projects.js"'));
  assert.ok(html.indexOf('src="text.js"') < html.indexOf('src="lab-core.js"'));
});
