const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Lab = require('../ui/lab-core.js');
const Media = require('../ui/lab-media.js');
const { fingerprint } = require('../ui/projects.js');
const { createLabStore, exportBytes } = require('../desktop/laboratory.cjs');
const catalog = require('../shared/catalog.json');
const emotions = catalog.emotions.map(item => item.id);
const resolve = key => key.startsWith('clone:') ? { mode: 'clone', referenceId: key.slice(6), referenceText: '这是一段参考声音。', voiceName: '家人' }
  : key.startsWith('preset:') ? { mode: 'preset', speaker: key.slice(7), voiceName: key.slice(7) } : null;
const compile = doc => Lab.compile(doc, resolve, fingerprint, emotions);
function wav(samples, rate = 24000) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => bytes.writeInt16LE(value, 44 + i * 2)); return bytes;
}

test('one script produces distinct voice/emotion candidates; clone expressions collapse safely', () => {
  const doc = Lab.create('variants'); let rows = compile(doc);
  assert.equal(rows.length, 4); assert.equal(new Set(rows.map(row => row.labKey)).size, 4);
  assert.deepEqual(rows.map(row => [row.speaker, row.emotion]), [['Vivian', 'natural'], ['Vivian', 'happy'], ['Dylan', 'natural'], ['Dylan', 'happy']]);
  doc.voiceKeys.push('clone:family'); rows = compile(doc);
  assert.equal(rows.length, 5); assert.equal(rows.at(-1).emotion, 'natural'); assert.equal(rows.at(-1).instruction, '');
  assert.throws(() => Lab.compile(doc, key => key.startsWith('clone:') ? { mode: 'clone' } : resolve(key), fingerprint, emotions), /参考录音和对应文字/);
  doc.text = '字'.repeat(600); doc.voiceKeys = Array.from({ length: 6 }, (_, index) => 'preset:' + index);
  assert.throws(() => compile(doc), /5000 字/);
});

test('speech edits invalidate only their sentence; display edits, reordering and different works stay independent', () => {
  const doc = Lab.create('comic'); doc.lines[1].text = doc.lines[0].text; doc.lines[1].roleId = doc.lines[0].roleId;
  const original = compile(doc); assert.notEqual(original[0].labKey, original[1].labKey, 'identical dialogue still has separate results');
  const history = original.map((row, index) => ({ id: String(index), createdAt: 10, options: row }));
  history.push({ id: 'newest', createdAt: 20, options: original[0] });
  doc.name = '作品重命名'; doc.caption = '新寄语'; doc.pause = 600; doc.theme = 'mint'; doc.roles[0].name = '新的角色名';
  doc.lines[0].image = 'data:image/png;base64,YQ==';
  assert.deepEqual(compile(doc).map(row => row.labKey), original.map(row => row.labKey));
  assert.equal(Lab.match(compile(doc), history, doc.id)[0].item.id, 'newest');
  doc.lines.reverse(); assert.deepEqual(compile(doc).map(row => row.labKey), original.map(row => row.labKey).reverse());
  doc.lines[0].text = '只有这句发生了修改。'; const current = Lab.match(compile(doc), history, doc.id);
  assert.equal(current[0].item, null); assert.equal(current[1].item.id, 'newest');
  assert.ok(Lab.match(original, history, crypto.randomUUID()).every(entry => !entry.item));
  doc.roles[0].voiceKey = 'preset:Serena'; assert.ok(Lab.match(compile(doc), history, doc.id).every(entry => !entry.item));
});

test('family stories substitute literal user names, split long paragraphs, and track changed audio', () => {
  const doc = Lab.create('family'); doc.child = '小$&朋友'; doc.interest = '搭积木'; doc.voiceKey = 'clone:family';
  let rows = compile(doc); assert.equal(rows.length, 4); assert.ok(rows.every(row => row.mode === 'clone' && row.scene === 'bedtime'));
  assert.match(rows[0].text, /小\$&朋友喜欢搭积木/); assert.ok(rows.every(row => !row.text.includes('{{')));
  const before = rows.map(row => row.labKey); doc.child = '安安'; rows = compile(doc); assert.ok(rows.some((row, index) => row.labKey !== before[index]));
  doc.story = '啊'.repeat(1201); rows = compile(doc); assert.deepEqual(rows.map(row => row.text.length), [600, 600, 1]);
  doc.story = ' '; assert.throws(() => compile(doc), /先写下/);
});

test('family story chunks retain complete graphemes and word separators through queue preparation', () => {
  const { prepareGeneration } = require('../desktop/jobs.cjs');
  const doc = Lab.create('family');
  for (const text of ['甲'.repeat(599) + '😀结束', '甲'.repeat(598) + '👨‍👩‍👧‍👦结尾',
    '甲'.repeat(599) + 'e\u0301结尾', '甲'.repeat(595) + 'hello world.', 'hello world. '.repeat(90)]) {
    doc.story = text;
    const rows = compile(doc);
    assert.equal(rows.map(row => row.text).join(''), text);
    assert.ok(rows.every(row => row.text.isWellFormed() && row.text.length <= 600));
    assert.deepEqual(prepareGeneration({ rows }).rows, rows);
    const boundaries = new Set([...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map(x => x.index + x.segment.length));
    let offset = 0;
    for (const row of rows) { offset += row.text.length; assert.ok(boundaries.has(offset)); }
  }
});

test('dialogue imports retain cast mappings and reject malformed or excessive content', () => {
  const doc = Lab.create('comic'), imported = Lab.importDialogue('小鹿：第一句。\n新角色: 第二句。\n小鹿：第三句。', doc.roles);
  assert.equal(imported.roles.length, 3); assert.equal(imported.roles[0].voiceKey, 'preset:Vivian');
  assert.equal(imported.lines[0].roleId, doc.roles[0].id); assert.equal(imported.lines[2].roleId, doc.roles[0].id);
  assert.throws(() => Lab.importDialogue('没有角色名的台词', doc.roles), /每行/);
  assert.throws(() => Lab.importDialogue('小鹿：' + '字'.repeat(601), doc.roles), /600 字/);
  assert.throws(() => Lab.importDialogue(Array(81).fill('小鹿：台词').join('\n'), doc.roles), /80 句/);
  Object.assign(doc, imported); assert.equal(compile(doc).length, 3);
});

test('designed lab roles, stories and candidates keep stable voice identities through edits, reorder and reopening', () => {
  const design = key => key.startsWith('design:') ? { mode: 'design', character: key.slice(7), voiceDescription: '成年女性温暖自然', voiceName: '人物声音' } : resolve(key);
  const build = doc => Lab.compile(doc, design, fingerprint, emotions);
  for (const type of ['comic', 'buttons', 'family', 'variants']) {
    const doc = Lab.create(type);
    if (type === 'family') doc.voiceKey = 'design:custom';
    else if (type === 'variants') { doc.voiceKeys = ['design:custom']; doc.emotions = ['natural', 'happy']; }
    else { doc.roles.forEach(role => role.voiceKey = 'design:custom'); doc.lines.forEach(line => line.roleId = doc.roles[0].id); }
    const rows = build(doc), reopened = build(JSON.parse(JSON.stringify(doc)));
    assert.ok(rows.every(row => row.lockVoice && row.voiceScopeId === 'lab:' + doc.id));
    assert.deepEqual(reopened, rows);
    const voiceCount = new Set(rows.map(row => row.voiceId)).size;
    assert.equal(voiceCount, type === 'variants' ? 2 : 1, 'each alternative is an independent persistent candidate');
    if (['comic', 'buttons'].includes(type)) {
      assert.ok(rows.every(row => row.emotion === 'natural'), 'line performance follows the role sample');
      doc.lines[0].text += '修改。'; doc.lines.reverse(); doc.name = '重命名'; doc.roles[0].name = '新名字';
      assert.deepEqual(new Set(build(doc).map(row => row.voiceId)), new Set(rows.map(row => row.voiceId)));
      doc.lines[0].roleId = doc.roles[1].id;
      const changed = build(doc);
      assert.notEqual(changed[0].voiceId, changed[1].voiceId);
      assert.notEqual(changed[0].labKey, rows[0].labKey);
      doc.roles[0].voiceRevision = '重新定声';
      assert.equal(build(doc).find(row => row.voiceId === doc.roles[0].id).voiceRevision, '重新定声');
    }
    const other = { ...structuredClone(doc), id: crypto.randomUUID() };
    assert.notEqual(build(other)[0].voiceScopeId, build(doc)[0].voiceScopeId);
  }
});

test('SQLite experiments survive reopening without mixing types; invalid documents do not overwrite saved work', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-lab-')); let store;
  try {
    store = createLabStore(folder); const docs = Object.keys(Lab.kinds).map(Lab.create);
    docs.forEach(doc => store.save(doc)); store.close(); store = createLabStore(folder);
    assert.equal(store.list().length, 4);
    for (const doc of docs) assert.deepEqual({ ...store.load(doc.id), updatedAt: 0 }, { ...doc, updatedAt: 0 });
    const doc = docs[0]; assert.throws(() => store.save({ ...doc, roles: [null] }), /有效角色/);
    assert.throws(() => store.save({ ...doc, type: 'toString' }), /格式/);
    assert.throws(() => store.save({ ...doc, roles: [{ ...doc.roles[0], name: ' ' }] }), /角色名/);
    assert.throws(() => store.save({ ...doc, cover: 'https://remote/image.png' }), /配图格式/);
    assert.equal(store.load(doc.id).name, doc.name); assert.throws(() => store.load('missing'), /不存在/);
  } finally { store?.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});

test('WAV concatenation preserves PCM, inserts exact silence, and yields matching sentence subtitle timestamps', () => {
  const first = wav(Array(2400).fill(1000)), second = wav(Array(4800).fill(-1000));
  const merged = Media.merge([{ bytes: first, text: '第一句' }, { bytes: second, text: '第二句\n换行' }], 350);
  assert.equal(merged.duration, .65); assert.deepEqual(merged.timeline.map(clip => [clip.start, clip.end]), [[0, .1], [.45, .65]]);
  const samples = Media.pcm(merged.bytes).samples;
  assert.deepEqual(samples.subarray(0, 4800), new Uint8Array(first.subarray(44)));
  assert.ok(samples.subarray(4800, 21600).every(value => !value));
  assert.deepEqual(samples.subarray(21600), new Uint8Array(second.subarray(44)));
  assert.equal(Media.srt(merged.timeline), '1\n00:00:00,000 --> 00:00:00,100\n第一句\n\n2\n00:00:00,450 --> 00:00:00,650\n第二句 换行\n');
  assert.equal(Media.timestamp(3661.9996), '01:01:02,000');
  assert.throws(() => Media.merge([{ bytes: first }, { bytes: wav([1], 16000) }]), /采样率不一致/);
  assert.throws(() => Media.pcm(first.subarray(0, 50)), /不完整/);
  assert.throws(() => Media.merge([], 350), /参数/);
});

test('offline soundboard embeds audio and escapes executable titles or dialogue', () => {
  const evil = '</script><img src=x onerror=alert(1)>', audio = 'data:audio/wav;base64,' + wav([1]).toString('base64');
  const html = Media.soundboard(evil, [{ label: evil, text: evil, audio }]);
  assert.ok(html.includes(audio)); assert.ok(!html.includes(evil)); assert.match(html, /&lt;\/script&gt;/);
  assert.equal((html.match(/<script>/g) || []).length, 1); assert.ok(!html.includes('https://'));
  assert.throws(() => Media.soundboard('恶意', [{ audio: 'javascript:alert(1)' }]), /格式/);
});

test('desktop export rejects malformed data and creates portable filenames', () => {
  assert.equal(exportBytes({ format: 'wav', name: '祝福/生日:*', bytes: wav([1]) }).name, '祝福_生日__.wav');
  assert.equal(exportBytes({ format: 'webm', bytes: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]) }).name, '实验作品.webm');
  assert.throws(() => exportBytes({ format: 'wav', bytes: new Uint8Array(45) }), /音频数据/);
  assert.throws(() => exportBytes({ format: 'webm', bytes: new Uint8Array(5) }), /视频数据/);
  assert.throws(() => exportBytes({ format: 'exe', bytes: new Uint8Array(5) }), /格式/);
  assert.throws(() => exportBytes({ format: 'html', bytes: [] }), /格式/);
});

test('optional expressive recordings generate separate emotions while keeping their reference identity', () => {
  const doc = Lab.create('variants'); doc.voiceKeys = ['clone:family']; doc.emotions = ['happy', 'sad'];
  assert.equal(compile(doc).length, 1, 'original expression remains the default');
  doc.referenceStyle = 'expressive';
  const rows = compile(doc);
  assert.deepEqual(rows.map(row => row.emotion), ['happy', 'sad']);
  assert.ok(rows.every(row => row.referenceId === 'family' && row.referenceStyle === 'expressive'));
  assert.notEqual(rows[0].labKey, rows[1].labKey);
  const comic = Lab.create('comic'); comic.roles[0].voiceKey = 'clone:family'; comic.roles[0].referenceStyle = 'expressive';
  comic.lines = [{ ...comic.lines[0], emotion: 'sad' }];
  assert.equal(compile(comic)[0].emotion, 'sad');
});
