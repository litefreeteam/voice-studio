const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync, crc32 } = require('node:zlib');
const { officeParts } = require('../desktop/documents.cjs');
const M = require('../ui/projects.js');
const Home = require('../ui/home.js');
const { parseScript } = require('../ui/csv.js');
const catalog = require('../shared/catalog.json');

test('ordinary industry terms find applicable scenes and partial searches suggest related scenes', () => {
  assert.ok(Home.filter(catalog, 'all', '门店促销').some(scene => scene.id === 'ecommerce'));
  assert.ok(Home.filter(catalog, 'all', '房产').some(scene => scene.id === 'brand-ad'));
  assert.ok(Home.filter(catalog, 'all', '老师备课').some(scene => scene.id === 'course-batch'));
  assert.ok(Home.suggestions(catalog, 'all', '门店促销播报文案').length);
  assert.equal(Home.filter(catalog, 'course', '房产').length, 0);
});
test('single speaker import preserves headings, punctuation and quoted narrative as spoken text', () => {
  const text = '教学目标：认识长方形的面积。\n知识点：面积等于长乘宽。\n注意事项：长度单位要统一。\n张明放下伞：“路上堵车，让你久等了。”';
  const parsed = M.parse(text, '.txt', catalog.emotions, parseScript, { scriptMode: 'narration' });
  assert.deepEqual(parsed.roleNames, ['旁白']); assert.equal(parsed.pending, 0);
  assert.deepEqual(parsed.chapters[0].lines.map(line => line.text), text.split('\n'));
  const project = M.create(), imported = M.importInto(project, parsed, {}, 'chapters');
  assert.equal(imported.roles.length, 1); assert.equal(imported.chapters[0].lines.length, 4);
});
test('dialogue import keeps narrative and teaching labels intact without making them characters', () => {
  const parsed = M.parse('张明放下伞：“你好。”\n教学目标：认识面积。\n小林：你好。', '.txt', catalog.emotions, parseScript);
  assert.deepEqual(parsed.roleNames, ['旁白', '小林']); assert.equal(parsed.pending, 1);
  assert.equal(parsed.chapters[0].lines[0].text, '张明放下伞：“你好。”');
});
test('duration planning uses complete audio over text guesses, includes pauses and validates persisted targets', () => {
  const entries = [{ line: { text: '非常长的文稿'.repeat(50) }, status: 'complete', clips: [{ duration: 4 }, { duration: 1 }] },
    { line: { text: '测试文本' }, options: { pace: 'normal' } }];
  assert.deepEqual(M.durationEstimate(entries), { seconds: 6.35, recorded: 1, total: 2, estimated: true });
  entries[1].status = 'complete'; entries[1].clips = [{ duration: 2 }];
  assert.equal(M.durationEstimate(entries, 500).seconds, 7.5);
  const project = M.create(); project.targetSeconds = 15; assert.equal(M.validate(project), project);
  for (const invalid of [NaN, -1, '15', Infinity, 21601]) { project.targetSeconds = invalid; assert.throws(() => M.validate(project), /目标时长/); }
});
function zip(name, text, compressed = true) {
  const bytes = Buffer.from(text), filename = Buffer.from(name), data = compressed ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(crc32(bytes), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
test('Office import accepts stored and compressed XML without extracting files', () => {
  for (const compressed of [false, true]) {
    const input = zip('word/document.xml', '<w:document>课程 &amp; 知识</w:document>', compressed);
    assert.equal(officeParts(input, '.docx').parts['word/document.xml'], '<w:document>课程 &amp; 知识</w:document>');
  }
});
test('Office import rejects corrupt, encrypted and oversized expansion archives', () => {
  assert.throws(() => officeParts(Buffer.from('not a zip'), '.docx'), /损坏/);
  const bad = zip('word/document.xml', '<doc>text</doc>', false); bad[30 + 'word/document.xml'.length] ^= 1;
  assert.throws(() => officeParts(bad, '.docx'), /损坏/);
  const encrypted = zip('word/document.xml', '<doc/>'); const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); encrypted.writeUInt16LE(1, central + 8);
  assert.throws(() => officeParts(encrypted, '.docx'), /加密/);
  assert.throws(() => officeParts(zip('word/document.xml', 'x'.repeat(8 * 1024 * 1024 + 1)), '.docx'), /文字过多/);
});
