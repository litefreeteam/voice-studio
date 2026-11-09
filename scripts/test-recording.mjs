import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { assertSound } from '../tests/playback-ui.mjs';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopFixture } from '../tests/desktop-fixture.mjs';
import recording from '../ui/recorder.js';
import { validateRecording } from '../desktop/recording.cjs';

// A real Electron recording/decoding/playback/save flow with deterministic microphone
// input. Run on Windows too; running on another OS does not validate Windows drivers.
const root = path.resolve(import.meta.dirname, '..');
const { errorMessage } = recording;
const artifacts = path.join(root, '.test-data/recording-regression');
const fixture = await createDesktopFixture({ activated: true });
const python = process.env.VOICE_STUDIO_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
let app;
const errors = [], report = { hostPlatform: process.platform, input: 'Chromium simulated microphone', checks: [] };
try {
  await mkdir(artifacts, { recursive: true });
  await cp(path.join(root, 'backend'), path.join(fixture.appDir, 'backend'), { recursive: true, filter: file => path.basename(file) !== '__pycache__' });
  await copyFile(path.join(root, 'backend/worker.py'), path.join(fixture.appDir, 'backend/studio_worker.py'));
  await copyFile(path.join(root, 'tests/fixtures/audio-worker.py'), path.join(fixture.appDir, 'backend/worker.py'));
  app = await electron.launch({ args: [fixture.appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, VOICE_STUDIO_DATA: fixture.data, VOICE_STUDIO_PYTHON: python } });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof sessionReady !== 'undefined' && sessionReady);
  await page.locator('[data-view="roles"]').click();
  await page.locator('#reference-consent').check(); await page.locator('#record-reference').click();
  await page.locator('#recording-start').click();
  await page.waitForFunction(() => voiceRecorder.state.status === 'recording');
  await page.waitForFunction(() => voiceRecorder.state.level > .003);
  await page.waitForFunction(() => voiceRecorder.state.seconds >= 3.5);
  await page.locator('#recording-stop').click();
  await page.waitForFunction(() => voiceRecorder.state.status === 'ready');
  const recorded = await page.evaluate(() => ({ audio: [...voiceRecorder.state.audio], seconds: voiceRecorder.state.seconds, released: voiceRecorder.stream === null && voiceRecorder.context === null }));
  const { audio } = validateRecording({ audio: Uint8Array.from(recorded.audio), consent: true, name: '录音测试', text: '模拟麦克风输入' });
  let peak = 0;
  for (let i = 44; i < audio.length; i += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(i)));
  assert.ok(peak > 1000); assert.equal(recorded.released, true);
  report.recording = { seconds: recorded.seconds, sampleRate: audio.readUInt32LE(24), peak, microphoneReleased: true };
  report.checks.push('Live signal, MediaRecorder, WebM decoding, non-silent mono PCM WAV and microphone release');
  await page.locator('#recording-dialog .sound-media-toggle').click();
  await page.waitForFunction(() => document.querySelector('#recording-preview').currentTime > .2);
  await assertSound(page, '#recording-dialog .sound-media-toggle');
  await page.locator('#recording-dialog .sound-media-toggle').click();
  await assertSound(page, '#recording-dialog .sound-media-toggle', 'paused');
  await page.locator('#recording-name').fill('录音回归测试');
  await page.locator('#recording-text').fill('模拟麦克风输入，仅用于录音流程测试。');
  await page.locator('#recording-save').click();
  await page.waitForFunction(() => !document.querySelector('#recording-dialog').open);
  const reference = await page.evaluate(async () => (await studio.invoke('status')).references.find(item => item.name === '录音回归测试'));
  assert.ok(reference); assert.ok(reference.duration >= 3 && reference.duration <= 30);
  assert.equal(reference.text, '模拟麦克风输入，仅用于录音流程测试。');
  const saved = JSON.parse(await readFile(path.join(fixture.data, 'references', reference.id + '.json'), 'utf8'));
  assert.equal(saved.name, '录音回归测试');
  report.checks.push('Actual audio playback and recording-save IPC through production reference import');

  await page.locator('[data-view="roles"]').click(); await page.locator('#record-reference').click();
  await page.evaluate(() => {
    voiceRecorder.cancel(); voiceRecorder = new VoiceRecording.Recorder(renderRecording, { platform: 'win32', getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } });
  });
  await page.locator('#recording-start').click();
  await page.waitForFunction(() => voiceRecorder.state.status === 'error');
  assert.match(await page.locator('#recording-status').innerText(), /允许桌面应用访问麦克风/);
  assert.equal(await page.locator('#recording-save').isDisabled(), true);
  await page.evaluate(() => { voiceRecorder.cancel(); voiceRecorder = new VoiceRecording.Recorder(renderRecording); renderRecording(); });
  await page.locator('#recording-start').click();
  await page.waitForFunction(() => voiceRecorder.state.status === 'recording');
  await page.locator('#recording-discard').click();
  assert.equal(await page.evaluate(() => voiceRecorder.stream === null && voiceRecorder.context === null && voiceRecorder.timer === null), true);
  report.checks.push('Injected Windows permission failure shows desktop privacy instructions; retry and cancel release microphone');
  assert.match(errorMessage({ name: 'NotAllowedError' }, 'win32'), /允许桌面应用访问麦克风/);
  assert.deepEqual(errors, []); report.passed = true;
  report.limitations = ['Chromium fake device and permission UI bypass are enabled. Permission-handler scope is covered by unit tests; physical Windows microphone, privacy switches, drivers and exclusive-access devices require a Windows machine.'];
} catch (error) { report.passed = false; report.failure = error.stack; throw error; }
finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await app?.close(); await fixture.cleanup();
}
console.log(JSON.stringify(report, null, 2));
