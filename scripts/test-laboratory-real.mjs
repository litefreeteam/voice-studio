// Optional local-model smoke test. Reuses installed models read-only; writes to an isolated test directory.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStudio } from '../desktop/service.cjs';
import { createLabStore } from '../desktop/laboratory.cjs';
import Lab from '../ui/lab-core.js';
import Media from '../ui/lab-media.js';
import Projects from '../ui/projects.js';

const root = path.resolve(import.meta.dirname, '..');
const installed = process.env.VOICE_LAB_REAL_DATA || path.join(os.homedir(), 'Library/Application Support/Voice Studio');
const artifacts = path.join(root, '.test-data/laboratory'); await mkdir(artifacts, { recursive: true });
const data = await mkdtemp(path.join(artifacts, 'real-'));
await symlink(path.join(installed, 'models'), path.join(data, 'models'), 'dir');
await copyFile(path.join(installed, 'license.txt'), path.join(data, 'license.txt'));
process.env.VOICE_STUDIO_PYTHON ||= path.join(root, '.venv/bin/python');
const studio = createStudio({ dataDir: data, resourceDir: root }); const store = createLabStore(data);
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8')), references = new Map(), report = [];
function resolve(key) {
  if (key.startsWith('clone:')) { const ref = references.get(key.slice(6)); return ref && { mode: 'clone', speaker: 'Vivian', referenceId: ref.id, referenceText: ref.text, voiceName: ref.name, language: 'Chinese' }; }
  const [type, id] = key.split(':'), voice = (type === 'preset' ? catalog.voices : catalog.characters).find(voice => voice.id === id);
  return voice && { mode: type === 'preset' ? 'preset' : 'design', speaker: type === 'preset' ? id : 'Vivian', character: type === 'design' ? id : undefined, voiceDescription: voice.prompt || '', voiceName: voice.name, language: voice.language || 'Chinese' };
}
async function generate(doc) {
  store.save(doc); const rows = Lab.compile(doc, resolve, Projects.fingerprint, catalog.emotions.map(emotion => emotion.id));
  const started = Date.now(), result = await studio.invoke('generate', { project: doc.name, rows });
  assert.equal(result.items.length, rows.length); const clips = [];
  for (const item of result.items) {
    const bytes = await readFile(path.join(data, 'outputs', item.id, item.wav)), decoded = Media.pcm(bytes);
    const samples = new DataView(decoded.samples.buffer, decoded.samples.byteOffset, decoded.samples.byteLength); let peak = 0;
    for (let offset = 0; offset < decoded.samples.length; offset += 2) peak = Math.max(peak, Math.abs(samples.getInt16(offset, true)));
    assert.ok(decoded.duration > .2 && peak > 100, 'model output must contain valid non-silent audio');
    assert.equal(item.options.labId, doc.id); assert.ok(rows.some(row => row.labKey === item.options.labKey));
    clips.push({ bytes, text: item.text });
  }
  const merged = Media.merge(clips, doc.pause); await writeFile(path.join(data, doc.type + '.wav'), merged.bytes); await writeFile(path.join(data, doc.type + '.srt'), Media.srt(merged.timeline));
  report.push({ type: doc.type, id: doc.id, segments: rows.length, modes: [...new Set(rows.map(row => row.mode))], duration: merged.duration, elapsed: (Date.now() - started) / 1000 });
  console.log(`${doc.type}: ${rows.length} real segments, ${merged.duration.toFixed(2)} seconds of audio`); return result;
}
try {
  const variants = Lab.create('variants'); variants.name = '真实模型 · 一稿多配'; variants.text = '安安，今天我们一起讲一个温暖的故事。忙碌的一天结束了，闭上眼睛，慢慢休息吧。';
  const first = (await generate(variants)).items[0];
  const reference = await studio.invoke('reference', { consent: true, path: path.join(data, 'outputs', first.id, first.wav), name: '实验讲故事声音', text: first.text }); references.set(reference.id, reference);
  const comic = Lab.create('comic'); comic.name = '真实模型 · 有声短剧'; comic.roles[0].voiceKey = 'design:girl-clear'; await generate(comic);
  const family = Lab.create('family'); family.name = '真实模型 · 专属故事'; family.child = '安安'; family.interest = '搭积木'; family.voiceKey = 'clone:' + reference.id;
  family.story = '{{name}}喜欢{{interest}}。今天，月亮送来了一颗温暖的小星星。'; await generate(family);
  const buttons = Lab.create('buttons'); buttons.name = '真实模型 · 语音祝福'; await generate(buttons);
  assert.equal(store.list().length, 4); await writeFile(path.join(artifacts, 'real-model-report.json'), JSON.stringify({ data, report }, null, 2));
  console.log('All four laboratory modes passed with the existing local speech models.');
} finally { await studio.close(); store.close(); await rm(path.join(data, 'license.txt'), { force: true }); }
