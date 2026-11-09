const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Recorder, encodeWav } = require('../ui/recorder.js');
const { requireMicrophoneAccess, audioPermission, validateRecording, saveRecording } = require('../desktop/recording.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ duration = 5, silent = false, getUserMedia, platform } = {}) {
  let time = 0, stopped = 0, closed = 0;
  const timers = new Map(), changes = [];
  const track = { stop() { stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Context {
    async resume() {}
    async close() { closed++; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(values) { values.fill(.1); } }; }
    async decodeAudioData() {
      const samples = new Float32Array(8000 * duration).fill(silent ? 0 : .15);
      return { sampleRate: 8000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
    }
  }
  class Media {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) }); this.onstop?.(); }
  }
  const recorder = new Recorder(value => changes.push(value), {
    getUserMedia: getUserMedia || (async () => stream), AudioContext: Context, MediaRecorder: Media, Blob, platform,
    now: () => time, setInterval(callback) { timers.set(1, callback); return 1; }, clearInterval(id) { timers.delete(id); }
  });
  return { recorder, changes, stream, timers, setTime(value) { time = value; }, stopped: () => stopped, closed: () => closed };
}

test('recording produces a bounded mono WAV, stops the microphone and releases timers', async () => {
  const f = fixture({ duration: 32 }); await f.recorder.start();
  f.setTime(30050); f.recorder.tick(); await tick();
  assert.equal(f.recorder.state.status, 'ready'); assert.equal(f.recorder.state.seconds, 30);
  assert.ok(f.stopped() > 0); assert.equal(f.closed(), 1); assert.equal(f.timers.size, 0);
  const result = validateRecording({ audio: f.recorder.state.audio, name: '我的声音', text: '原话', consent: true });
  assert.equal(result.audio.readUInt32LE(40), 30 * 8000 * 2);
});

test('cancelled permission requests release late streams without recording', async () => {
  let resolve;
  const f = fixture({ getUserMedia: () => new Promise(done => { resolve = done; }) });
  const pending = f.recorder.start(); f.recorder.cancel(); resolve(f.stream); await pending;
  assert.equal(f.recorder.state.status, 'idle'); assert.equal(f.stopped(), 1); assert.equal(f.timers.size, 0);
});

test('denied permission, short audio and silence give recoverable recording errors', async () => {
  const denied = fixture({ getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  await denied.recorder.start(); assert.match(denied.recorder.state.message, /麦克风权限/);
  for (const options of [{ duration: 2 }, { silent: true }]) {
    const f = fixture(options); await f.recorder.start(); f.recorder.stop(); await tick();
    assert.equal(f.recorder.state.status, 'error'); assert.equal(f.recorder.state.audio, null);
    assert.ok(f.stopped() > 0); assert.equal(f.timers.size, 0);
    await f.recorder.start(); assert.equal(f.recorder.state.status, 'recording'); f.recorder.cancel();
  }
});

test('Windows checks OS microphone privacy on every attempt without blocking unresolved status', () => {
  let status = 'denied', calls = 0;
  const preferences = { getMediaAccessStatus(type) { assert.equal(type, 'microphone'); calls++; return status; } };
  assert.throws(() => requireMicrophoneAccess(preferences, 'win32'), error => error.code === 'MICROPHONE_PERMISSION_DENIED' && /允许桌面应用访问麦克风/.test(error.message));
  status = 'restricted';
  assert.throws(() => requireMicrophoneAccess(preferences, 'win32'), error => error.code === 'MICROPHONE_PERMISSION_DENIED' && /管理员/.test(error.message));
  for (status of ['granted', 'unknown', 'not-determined']) requireMicrophoneAccess(preferences, 'win32');
  assert.equal(calls, 5);
  for (const platform of ['darwin', 'linux']) requireMicrophoneAccess({ getMediaAccessStatus() { assert.fail('Windows-specific API must not be queried'); } }, platform);
});

test('Windows permission and silence failures explain the appropriate settings and allow retry', async () => {
  let denied = true;
  const f = fixture({ platform: 'win32', getUserMedia: async () => {
    if (denied) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    return f.stream;
  } });
  await f.recorder.start();
  assert.equal(f.recorder.state.status, 'error');
  assert.match(f.recorder.state.message, /允许桌面应用访问麦克风/);
  denied = false;
  await f.recorder.start(); f.recorder.stop(); await tick();
  assert.equal(f.recorder.state.status, 'ready');
  const silent = fixture({ platform: 'win32', silent: true });
  await silent.recorder.start(); silent.recorder.stop(); await tick();
  assert.equal(silent.recorder.state.status, 'error');
  assert.match(silent.recorder.state.message, /默认输入设备、输入音量/);
  assert.equal(silent.timers.size, 0);
  assert.ok(silent.stopped() > 0);
});

test('only the armed app main frame can request audio; camera and unrelated permissions stay denied', () => {
  const app = { getURL: () => 'file:///app/ui/index.html' };
  const details = { requestingUrl: app.getURL(), isMainFrame: true, mediaTypes: ['audio'] };
  assert.equal(audioPermission(app, app, 'media', details, true), true);
  assert.equal(audioPermission(app, app, 'media', { ...details, mediaTypes: undefined, mediaType: 'audio' }, true), true);
  for (const change of [{ isMainFrame: false }, { requestingUrl: 'https://example.com' }, { mediaTypes: ['audio', 'video'] }, { mediaTypes: ['video'] }]) assert.equal(audioPermission(app, app, 'media', { ...details, ...change }, true), false);
  assert.equal(audioPermission(app, app, 'media', details, false), false);
  assert.equal(audioPermission({}, app, 'media', details, true), false);
  assert.equal(audioPermission(app, app, 'geolocation', details, true), false);
  const windowsApp = { getURL: () => 'file:///C:/Program%20Files/%E5%A3%B0%E6%82%A6/resources/app.asar/ui/index.html' };
  assert.equal(audioPermission(windowsApp, windowsApp, 'media', { ...details, requestingUrl: windowsApp.getURL() }, true), true);
  assert.equal(audioPermission(windowsApp, windowsApp, 'media', details, true), false);
});

test('saving validates consent, transcript and WAV structure; temporary files are always removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-recording-test-'));
  const audio = encodeWav(new Float32Array(24000 * 4).fill(.1), 24000);
  const data = { audio, name: '我的声音', text: '这是原话', consent: true };
  try {
    for (const change of [{ consent: false }, { text: '' }, { name: '' }, { audio: new Uint8Array(44) }, { audio: audio.slice(0, -2) }]) assert.throws(() => validateRecording({ ...data, ...change }));
    const studio = { async invoke(action, value) {
      assert.equal(action, 'reference'); assert.equal(value.consent, true); assert.equal(value.text, data.text);
      assert.deepEqual(await fs.readFile(value.path), Buffer.from(audio)); return { id: 'saved' };
    } };
    assert.deepEqual(await saveRecording(studio, root, data), { id: 'saved' });
    assert.deepEqual(await fs.readdir(root), []);
    await assert.rejects(saveRecording({ invoke: async () => { throw new Error('引擎不可用'); } }, root, data));
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
