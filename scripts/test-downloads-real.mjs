import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStudio } from '../desktop/service.cjs';

// Explicit network/inference test. Uses a new, isolated data directory and no
// developer Python, global uv cache, user license, or previously downloaded model.
const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, '.test-data/downloads', `clean-${Date.now()}`);
for (const key of Object.keys(process.env)) {
  if (/^(VOICE_STUDIO_PYTHON|UV_|PIP_|https?_proxy$|all_proxy$)/i.test(key)) delete process.env[key];
}
fs.mkdirSync(dataDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), dataDir, platform: process.platform, arch: process.arch, proxyEnvironment: false, events: [] };
let interrupted = false, resumed = false, lastLog = 0, studio;
studio = createStudio({ dataDir, onProgress(event) {
  fs.appendFileSync(path.join(dataDir, 'progress.jsonl'), JSON.stringify(event) + '\n');
  if (report.events.length < 100 && event.source && report.events.at(-1)?.source !== event.source) report.events.push({ stage: event.stage, source: event.source, file: event.file });
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now(); console.log(event.stage, event.source || '', event.file || '', event.current ?? '', event.message);
  }
  if (event.stage === 'download' && event.unit === 'B' && event.current >= 8 * 1024 * 1024 && !interrupted) {
    interrupted = true; studio.cancel(); console.log('Interrupting real model transfer to test resume');
  } else if (report.retryStarted && event.stage === 'download' && event.unit === 'B' && event.current > 0 && !resumed) {
    resumed = true; report.firstResumedProgress = { file: event.file, bytes: event.current, source: event.source };
  }
} });

function partialFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? partialFiles(file) : entry.name.endsWith('.incomplete') ? [{ file, size: fs.statSync(file).size }] : [];
  });
}

try {
  const initial = await studio.invoke('preflight', { packages: ['light'], network: true });
  report.network = initial.checks.filter(check => check.id.startsWith('network-'));
  assert.equal(initial.blocked, false, initial.summary);
  assert.ok(report.network.every(check => check.state === 'pass'));
  console.log('Network probes:', report.network.map(check => `${check.id}=${check.source}`).join(', '));
  await assert.rejects(studio.invoke('preflight-prepare', { packages: ['light'] }), /取消/);
  assert.equal(interrupted, true);
  report.partialFiles = partialFiles(path.join(dataDir, 'models'));
  assert.ok(report.partialFiles.some(file => file.size >= 8 * 1024 * 1024));
  assert.equal(fs.existsSync(path.join(dataDir, 'models/voice-light/.complete.json')), false);
  report.retryStarted = true;
  const result = await studio.invoke('preflight-prepare', { packages: ['light'] });
  assert.equal(resumed, true);
  assert.equal(report.firstResumedProgress.bytes, report.partialFiles[0].size, 'first resumed progress must start at the saved byte offset');
  assert.equal(result.results[0].passed, true);
  assert.equal(result.heard, false); // Listening confirmation belongs to the user.
  report.runtime = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime/ready.json'), 'utf8'));
  report.model = JSON.parse(fs.readFileSync(path.join(dataDir, 'models/voice-light/.complete.json'), 'utf8'));
  report.trial = result.results[0];
  assert.ok(Object.values(report.model.sources).every(source => source === 'modelscope'));
  assert.equal(report.runtime.sources.python, 'npmmirror');
  assert.ok(['tsinghua', 'aliyun'].includes(report.runtime.sources.packages));
  const audio = path.join(dataDir, 'preflight/light.mp3');
  assert.ok(fs.statSync(audio).size > 1000);
  report.passed = true;
  console.log('PASS: clean domestic Python + dependencies + model, real interruption/resume, SHA-256 verification and real speech trial');
  console.log('Report:', path.join(dataDir, 'report.json'));
} catch (error) {
  report.passed = false; report.error = error.stack; throw error;
} finally {
  await studio.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'report.json'), JSON.stringify(report, null, 2));
}
