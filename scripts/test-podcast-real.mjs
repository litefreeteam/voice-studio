// Optional local-model regression and audition. Uses a disposable data directory.
import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStudio } from '../desktop/service.cjs';
import Projects from '../ui/projects.js';

const root = path.resolve(import.meta.dirname, '..');
const installed = process.env.VOICE_PODCAST_REAL_DATA || path.join(os.homedir(), 'Library/Application Support/Voice Studio');
const artifacts = path.join(root, '.test-data/podcast-real');
await mkdir(artifacts, { recursive: true });
const data = await mkdtemp(path.join(artifacts, 'run-'));
await symlink(path.join(installed, 'models'), path.join(data, 'models'), 'dir');
await copyFile(path.join(installed, 'license.txt'), path.join(data, 'license.txt'));
process.env.VOICE_STUDIO_PYTHON ||= path.join(root, '.venv/bin/python');
const catalog = JSON.parse(await readFile(path.join(root, 'shared/catalog.json'), 'utf8'));
const template = catalog.templates.find(template => template.id === 'interview-dialogue');
const resolve = key => {
  const voice = catalog.voices.find(voice => key === 'preset:' + voice.id);
  return voice && { mode: 'preset', speaker: voice.id, voiceName: voice.name, language: 'Chinese', engine: 'standard' };
};
const studio = createStudio({ dataDir: data, resourceDir: root, onProgress(event) {
  if (event.stage === 'clip') console.log(`Generated: ${event.item.text} (${event.item.duration}s)`);
} });
const report = { data, model: '', exports: {}, items: [] };
async function generate(project) {
  const rows = Projects.entries(project).map(entry => {
    const options = Projects.optionsFor(project, entry, resolve);
    return { ...options, lineVersion: Projects.fingerprint(options) };
  });
  const { items } = await studio.invoke('generate', { rows });
  assert.equal(items.length, rows.length);
  for (const [i, item] of items.entries()) {
    assert.equal(item.mode, 'preset'); assert.equal(item.speaker, rows[i].speaker);
    assert.equal(item.options.instruction, rows[i].instruction);
    assert.ok(item.instruction.includes(rows[i].instruction));
    assert.ok(item.model.includes('CustomVoice'));
    assert.ok(item.duration > .3 && item.quality.peak > .01);
    assert.ok(!item.quality.flags.includes('SILENT_AUDIO'));
    assert.ok(!item.quality.flags.includes('LONG_INTERNAL_SILENCE'));
  }
  report.model = items[0].model;
  report.items.push(...items.map(({ id, text, duration, speaker, instruction, quality }) => ({ id, text, duration, speaker, instruction, quality })));
  return items;
}
async function delivery(name, project, items, settings = project.deliverySettings || Projects.DELIVERY_DEFAULTS) {
  const result = await studio.invoke('project-export', { requestId: randomUUID(), projectId: project.id, projectName: project.name,
    items: items.map(item => ({ id: item.id })), settings });
  const archive = path.join(data, name + '.zip'); await copyFile(result.path, archive);
  await promisify(execFile)(process.env.VOICE_STUDIO_PYTHON, ['-c',
    'from pathlib import Path; import sys,zipfile; p=Path(sys.argv[1]); z=zipfile.ZipFile(p); [(p.with_suffix(ext)).write_bytes(z.read(src)) for src,ext in [("merged.mp3",".mp3"),("merged.wav",".wav"),("subtitles.srt",".srt"),("report.json",".json")]]', archive]);
  report.exports[name] = { archive, audio: path.join(data, name + '.mp3'), seconds: result.durationSeconds, settings };
  return result;
}
try {
  // An existing podcast can be compared without modifying its project or audio.
  let previous = [];
  try {
    const history = JSON.parse(await readFile(path.join(installed, 'history.json'), 'utf8'));
    const latest = history.find(item => item.project === '双人播客');
    if (latest) previous = history.filter(item => item.options?.projectId === latest.options?.projectId)
      .sort((a, b) => (a.options?.filename || '').localeCompare(b.options?.filename || ''));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous.length === 3) {
    for (const item of previous) await cp(path.join(installed, 'outputs', item.id), path.join(data, 'outputs', item.id), { recursive: true });
    await writeFile(path.join(data, 'history.json'), JSON.stringify(previous));
    await delivery('before', { id: previous[0].options.projectId, name: '原双人播客' }, previous);
    const comparison = Projects.fromTemplate({ ...template, rows: previous.map((item, i) => ({ ...template.rows[i], text: item.text,
      instruction: ['轻松、好奇地向朋友提问，语调自然提起，把话交给对方。', '像回忆自己的经历，随和地回答对方，按意思连贯说话。', '听懂后认同地接话，带一点笑意，是理解对方的陈述，句尾下落。'][i] })) }, catalog, '双人播客 · 原文对照');
    await delivery('same-script', comparison, await generate(comparison));
  }
  const project = Projects.fromTemplate(template, catalog, '双人播客 · 对谈示例');
  const items = await generate(project);
  assert.equal(new Set(items.map(item => item.speaker)).size, 2);
  await delivery('conversation', project, items);
  await writeFile(path.join(data, 'project.json'), JSON.stringify(project, null, 2));
  console.log(`Passed: stable speakers, per-turn controls, real synthesis and delivery. Audio ZIPs: ${data}`);
} finally {
  await studio.close(); await rm(path.join(data, 'license.txt'), { force: true });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
