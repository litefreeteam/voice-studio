(function (root) {
  function encodeWav(samples, sampleRate) {
    const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
    const word = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
    return bytes;
  }
  function errorMessage(error, platform = root.studio?.platform) {
    if (['NotAllowedError', 'SecurityError'].includes(error.name)) return platform === 'win32'
      ? 'Windows 未允许使用麦克风。请在 Windows 设置的“麦克风”页面开启“麦克风访问权限”和“允许桌面应用访问麦克风”，再重新录制。'
      : '还没有麦克风权限。请在系统设置中允许声悦使用麦克风，再重新打开软件试试。';
    if (error.name === 'NotFoundError') return '没有找到麦克风，请连接麦克风后重试。';
    if (['NotReadableError', 'AbortError'].includes(error.name)) return '麦克风暂时无法使用，可能正被其他软件占用。请检查连接后重试。';
    return error.message || '录音没有完成，请重新录制。';
  }
  class Recorder {
    constructor(onChange, dependencies = {}) {
      this.onChange = onChange;
      this.deps = { getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints), AudioContext: root.AudioContext,
        MediaRecorder: root.MediaRecorder, Blob: root.Blob, platform: root.studio?.platform, now: () => performance.now(),
        setInterval: (callback, delay) => root.setInterval(callback, delay), clearInterval: id => root.clearInterval(id), ...dependencies };
      this.state = { status: 'idle', seconds: 0, level: 0, message: '', audio: null };
      this.serial = 0;
    }
    notify(values) { Object.assign(this.state, values); this.onChange({ ...this.state }); }
    async start() {
      this.cancel(); const serial = this.serial;
      this.notify({ status: 'requesting', seconds: 0, level: 0, audio: null, message: '正在连接麦克风，首次使用请允许麦克风权限…' });
      try {
        const stream = await this.deps.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true }, video: false });
        if (serial !== this.serial) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        this.context = new this.deps.AudioContext();
        await this.context.resume();
        if (serial !== this.serial) return;
        this.source = this.context.createMediaStreamSource(stream);
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024;
        this.source.connect(this.analyser); this.levelBuffer = new Float32Array(this.analyser.fftSize);
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => this.deps.MediaRecorder.isTypeSupported(type));
        this.recorder = new this.deps.MediaRecorder(stream, mimeType ? { mimeType } : {});
        const chunks = []; let size = 0;
        this.recorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 6 * 1024 * 1024) this.fail(new Error('录音过大，请重新录制。'), serial); } };
        this.recorder.onerror = event => this.fail(event.error || new Error('录音中断，请重新录制。'), serial);
        this.recorder.onstop = () => this.finish(chunks, serial);
        stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (serial === this.serial && this.state.status === 'recording') this.stop(); }));
        this.recorder.start(250); this.started = this.deps.now(); this.lastAudible = this.started;
        this.notify({ status: 'recording', message: '正在录音，像平时说话一样自然地读出文案。' });
        this.timer = this.deps.setInterval(() => this.tick(), 100);
      } catch (error) { this.fail(error, serial); }
    }
    tick() {
      if (this.state.status !== 'recording') return;
      const seconds = (this.deps.now() - this.started) / 1000;
      this.analyser.getFloatTimeDomainData(this.levelBuffer);
      const level = Math.sqrt(this.levelBuffer.reduce((sum, value) => sum + value * value, 0) / this.levelBuffer.length);
      if (level >= .003) this.lastAudible = this.deps.now();
      this.notify({ seconds: Math.min(30, seconds), level,
        message: seconds >= 27 ? '快到 30 秒了，请自然地结束这句话。' : this.deps.now() - this.lastAudible > 2500 ? '声音有点轻，请靠近麦克风，保持自然音量。' : '正在录音，像平时说话一样自然地读出文案。' });
      if (seconds >= 30) this.stop();
    }
    stop() {
      if (this.state.status !== 'recording') return;
      this.notify({ status: 'processing', message: '正在整理录音，马上就能试听…' });
      this.deps.clearInterval(this.timer); this.timer = null;
      this.recorder.stop();
      this.stream?.getTracks().forEach(track => track.stop());
    }
    async finish(chunks, serial) {
      if (serial !== this.serial) return;
      try {
        const blob = new this.deps.Blob(chunks, { type: this.recorder.mimeType });
        const decoded = await this.context.decodeAudioData(await blob.arrayBuffer());
        if (serial !== this.serial) return;
        const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * 30));
        const samples = new Float32Array(length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const values = decoded.getChannelData(channel);
          for (let index = 0; index < length; index++) samples[index] += values[index] / decoded.numberOfChannels;
        }
        const seconds = length / decoded.sampleRate;
        if (seconds < 3) throw new Error('录音不足 3 秒，请多说一句后重新录制。');
        let peak = 0; for (const value of samples) { if (!Number.isFinite(value)) throw new Error('录音数据异常，请重新录制。'); peak = Math.max(peak, Math.abs(value)); }
        if (peak < .001) throw new Error(this.deps.platform === 'win32'
          ? '没有录到声音。请检查 Windows“声音”设置中的默认输入设备、输入音量及麦克风静音开关后重新录制。'
          : '没有录到清晰的声音，请检查麦克风后重新录制。');
        const audio = encodeWav(samples, decoded.sampleRate);
        this.cleanup(); this.notify({ status: 'ready', audio, seconds, level: 0, message: '录好了！先听听效果，再填写录音中的原话。' });
      } catch (error) { this.fail(error, serial); }
    }
    fail(error, serial) {
      if (serial !== this.serial) return;
      this.serial++; this.cleanup();
      this.notify({ status: 'error', audio: null, level: 0, message: errorMessage(error, this.deps.platform) });
    }
    cleanup() {
      this.deps.clearInterval(this.timer); this.timer = null;
      if (this.recorder?.state === 'recording') this.recorder.stop();
      this.stream?.getTracks().forEach(track => track.stop());
      this.source?.disconnect(); this.context?.close().catch(() => {});
      this.stream = null; this.source = null; this.context = null; this.recorder = null;
    }
    cancel() { this.serial++; this.cleanup(); this.state = { status: 'idle', seconds: 0, level: 0, message: '', audio: null }; }
  }
  const exports = { Recorder, encodeWav, errorMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.VoiceRecording = exports;
})(typeof globalThis !== 'undefined' ? globalThis : this);
