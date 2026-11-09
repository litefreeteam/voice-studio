// Optional integration test: local models, isolated outputs, no changes to everyday projects.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../desktop/service.cjs';
import Projects from '../ui/projects.js';
import Media from '../ui/lab-media.js';

const root = path.resolve(import.meta.dirname, '..');
const installed = process.env.VOICE_ROLE_REAL_DATA || path.join(os.homedir(), 'Library/Application Support/Voice Studio');
const artifacts = path.join(root, '.test-data/role-voice'); await mkdir(artifacts, { recursive: true });
const data = await mkdtemp(path.join(artifacts, 'real-'));
await symlink(path.join(installed, 'models'), path.join(data, 'models'), 'dir');
await copyFile(path.join(installed, 'license.txt'), path.join(data, 'license.txt'));
process.env.VOICE_STUDIO_PYTHON ||= path.join(root, '.venv/bin/python');
let studio = createStudio({ dataDir: data, resourceDir: root });
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const template = catalog.templates.find(template => template.id === 'relaxation');
const project = Projects.fromTemplate({ ...template, instruction: '轻声、舒缓地引导，给听众留下自然呼吸和感受的时间，避免催促。' }, catalog, '冥想与放松 · 固定声音验证');
const resolve = key => {
  const voice = catalog.characters.find(voice => key === 'design:' + voice.id);
  return { mode: 'design', character: voice.id, voiceDescription: voice.prompt, voiceName: voice.name, language: 'Chinese' };
};
const rows = () => Projects.entries(project).map(entry => {
  const options = Projects.optionsFor(project, entry, resolve);
  return { ...options, lineVersion: Projects.fingerprint(options) };
});
try {
  const prepared = await studio.invoke('prepare-voice', rows()[0]);
  await writeFile(path.join(data, 'role-preview.wav'), Buffer.from(prepared.audio, 'base64'));
  assert.equal((await studio.invoke('status')).history.length, 0, 'role setup must not create a script work');
  const role = project.roles[0]; role.options.voiceAnchorId = prepared.voiceAnchorId;
  role.options.voiceAnchorSignature = Projects.voiceSettingsSignature(rows()[0]);
  console.log(`Role prepared before script generation: ${prepared.duration}s`);
  const first = await studio.invoke('generate', { rows: rows().slice(0, 2) });
  await studio.close(); studio = createStudio({ dataDir: data, resourceDir: root });
  const second = await studio.invoke('generate', { rows: rows().slice(2) });
  const redo = await studio.invoke('generate', { rows: rows().slice(0, 1) });
  const items = [...first.items, ...second.items];
  for (const item of [...items, ...redo.items]) {
    assert.equal(item.voiceAnchorId, prepared.voiceAnchorId);
    assert.equal(item.synthesisMode, 'clone');
    const pcm = Media.pcm(await readFile(path.join(data, 'outputs', item.id, item.wav)));
    assert.ok(pcm.duration > .3);
    const samples = new DataView(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength);
    let peak = 0; for (let offset = 0; offset < pcm.samples.length; offset += 2) peak = Math.max(peak, Math.abs(samples.getInt16(offset, true)));
    assert.ok(peak > 100, 'valid non-silent model audio');
  }
  const clips = await Promise.all(items.map(async item => ({ bytes: await readFile(path.join(data, 'outputs', item.id, item.wav)), text: item.text })));
  const merged = Media.merge(clips, 500); await writeFile(path.join(data, 'meditation-fixed.wav'), merged.bytes);
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ data, voiceAnchorId: prepared.voiceAnchorId,
    items: [...items, ...redo.items].map(({ id, text, duration, synthesisMode, voiceAnchorId }) => ({ id, text, duration, synthesisMode, voiceAnchorId })) }, null, 2));
  console.log('Passed: role setup, three real lines, split requests, worker restart and single-line redo use the same reference.');
  console.log(`Audio: ${path.join(data, 'meditation-fixed.wav')}`);
} finally { await studio.close(); await rm(path.join(data, 'license.txt'), { force: true }); }
