/* Native Web Audio preview; saved edits and exports use the local Python DSP. */
(function () {
  const node = (tag, cls, text) => { const result = document.createElement(tag); if (cls) result.className = cls; if (text !== undefined) result.textContent = text; return result; };
  const button = (text, action, cls = 'button') => { const result = node('button', cls, text); result.type = 'button'; result.onclick = action; return result; };
  const number = (label, value, min, max, step = .01) => {
    const wrapper = node('label', '', label), input = node('input'); input.type = 'number'; input.value = value; input.min = min; input.max = max; input.step = step; wrapper.append(input); return { wrapper, input };
  };
  const defaults = { trimStartMs: 0, trimEndMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 };
  const time = value => Math.floor(value / 60) + ':' + (value % 60).toFixed(2).padStart(5, '0');

  function createWaveform(parent, { start = 0, end = null, minimum = .05, maximum = Infinity, onChange = () => {} } = {}) {
    const box = node('div', 'audio-wave'), canvas = node('canvas'), times = node('div', 'audio-wave-times');
    const elapsed = node('span', '', '0:00.00'), total = node('span', '', '正在读取音频…'); times.append(elapsed, total);
    const ranges = node('div', 'audio-wave-selection');
    const startField = number('保留起点（秒）', 0, 0, 0), endField = number('保留终点（秒）', 0, 0, 0);
    ranges.append(startField.wrapper, endField.wrapper); box.append(canvas, times, ranges); parent.append(box);
    let context = null, buffer = null, bins = [], source = null, frame = null, token = 0, cursor = 0, drag = '', playbackStart = 0, playbackOffset = 0;
    let duration = 0, left = start, right = end, destroyed = false;
    let playButton = null, playEpoch = 0; const playbackOwner = {};
    const resize = new ResizeObserver(() => draw()); resize.observe(canvas);
    function update(a, b, changed = false) {
      left = Math.max(0, Math.min(a, duration - minimum)); right = Math.max(left + minimum, Math.min(b, duration));
      if (right - left > maximum) { if (changed === 'start') right = Math.min(duration, left + maximum); else left = Math.max(0, right - maximum); }
      startField.input.value = left.toFixed(3); endField.input.value = right.toFixed(3);
      draw(); if (changed) { stop(); onChange({ start: left, end: right, duration }); }
    }
    function draw() {
      const width = Math.max(1, canvas.clientWidth), height = 150, ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio; canvas.height = height * ratio;
      const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#e0eee2'; ctx.fillRect(duration ? left / duration * width : 0, 0, duration ? (right - left) / duration * width : width, height);
      ctx.strokeStyle = '#c5d6c9'; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
      ctx.strokeStyle = '#458768'; ctx.lineWidth = Math.max(1, width / Math.max(1, bins.length) * .7); ctx.beginPath();
      bins.forEach(([min, max], i) => { const x = (i + .5) / bins.length * width; ctx.moveTo(x, height / 2 - max * 68); ctx.lineTo(x, height / 2 - min * 68); }); ctx.stroke();
      if (duration) {
        for (const x of [left / duration * width, right / duration * width]) { ctx.fillStyle = '#2b7655'; ctx.fillRect(x - 2, 0, 4, height); ctx.fillRect(x - 5, 60, 10, 30); }
        if (cursor > 0) { ctx.fillStyle = '#b2783e'; ctx.fillRect(cursor / duration * width, 0, 2, height); }
      }
      elapsed.textContent = time(cursor || left); total.textContent = duration ? time(duration) + ' · 保留 ' + (right - left).toFixed(2) + ' 秒' : '正在读取音频…';
    }
    startField.input.onchange = () => update(Number(startField.input.value), right, 'start');
    endField.input.onchange = () => update(left, Number(endField.input.value), 'end');
    canvas.onpointerdown = event => {
      if (!duration) return; const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width * duration;
      if (Math.min(Math.abs(x - left), Math.abs(x - right)) / duration * bounds.width <= 22) {
        drag = Math.abs(x - left) <= Math.abs(x - right) ? 'start' : 'end'; canvas.setPointerCapture(event.pointerId);
      } else { stop(); cursor = Math.max(left, Math.min(right, x)); draw(); }
    };
    canvas.onpointermove = event => {
      if (!drag) return; const bounds = canvas.getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width * duration;
      if (drag === 'start') update(Math.min(x, right - minimum), right, 'start'); else update(left, Math.max(x, left + minimum), 'end');
    };
    canvas.onpointerup = canvas.onpointercancel = () => { drag = ''; };
    async function load(bytes, selection = null) {
      const current = ++token; stop(); buffer = null;
      context ||= new AudioContext();
      const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const decoded = await context.decodeAudioData(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      if (destroyed || current !== token) return;
      buffer = decoded; duration = buffer.duration;
      startField.input.max = endField.input.max = duration; endField.input.min = minimum;
      const data = buffer.getChannelData(0), count = Math.min(1200, data.length), step = Math.ceil(data.length / count); bins = [];
      for (let offset = 0; offset < data.length; offset += step) {
        let min = 0, max = 0;
        for (let i = offset; i < Math.min(data.length, offset + step); i++) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
        bins.push([min, max]);
      }
      update(selection?.start ?? start, selection?.end ?? end ?? duration); cursor = left; draw();
      return duration;
    }
    function stop() { playEpoch++; window.SoundFeedback?.release(playbackOwner); window.SoundFeedback?.set(playButton); playButton = null; if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; } cancelAnimationFrame(frame); frame = null; }
    async function play(settings = {}, original = false, control = null) {
      if (!buffer || destroyed) throw new Error('音频尚未准备好');
      if (source && control && playButton === control) { stop(); return; }
      stop(); window.SoundFeedback?.stop(); playButton = control; const current = playEpoch; window.SoundFeedback?.set(control, 'loading');
      try {
      await context.resume(); if (destroyed || current !== playEpoch) return;
      const a = original ? 0 : left, b = original ? duration : right, rate = buffer.sampleRate;
      const from = Math.round(a * rate), to = Math.min(buffer.length, Math.round(b * rate));
      const output = context.createBuffer(1, to - from, rate), pcm = output.getChannelData(0), sourcePcm = buffer.getChannelData(0);
      const gain = original ? 1 : 10 ** ((settings.gainDb || 0) / 20), fadeIn = original ? 0 : Math.round((settings.fadeInMs || 0) * rate / 1000), fadeOut = original ? 0 : Math.round((settings.fadeOutMs || 0) * rate / 1000);
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) {
        const rampIn = fadeIn && i < fadeIn ? (fadeIn === 1 ? 0 : i / (fadeIn - 1)) : 1;
        const remaining = pcm.length - 1 - i, rampOut = fadeOut && remaining < fadeOut ? (fadeOut === 1 ? 0 : remaining / (fadeOut - 1)) : 1;
        pcm[i] = sourcePcm[from + i] * gain * rampIn * rampOut; peak = Math.max(peak, Math.abs(pcm[i]));
      }
      if (!original && peak > .98) for (let i = 0; i < pcm.length; i++) pcm[i] *= .98 / peak;
      source = context.createBufferSource(); source.buffer = output; source.connect(context.destination);
      const seek = original ? 0 : Math.max(0, Math.min(cursor - a, b - a - .01));
      playbackStart = context.currentTime; playbackOffset = a + seek; cursor = playbackOffset;
      const tick = () => { if (!source) return; cursor = Math.min(b, playbackOffset + context.currentTime - playbackStart); draw(); frame = requestAnimationFrame(tick); };
      source.onended = () => { stop(); cursor = a; draw(); }; window.SoundFeedback?.activate(playbackOwner, stop); source.start(0, seek); window.SoundFeedback?.set(control, 'playing'); tick();
      } catch (error) { if (current === playEpoch) stop(); throw error; }
    }
    function destroy() { destroyed = true; token++; stop(); resize.disconnect(); context?.close().catch(() => {}); context = null; buffer = null; bins = []; box.remove(); }
    return { load, play, stop, destroy, get: () => ({ start: left, end: right, duration }), set: (a, b) => update(a, b) };
  }

  function dialog(title, subtitle) {
    const element = node('dialog', 'audio-studio-dialog'), heading = node('div', 'audio-studio-heading'), copy = node('div');
    const h2 = node('h2', '', title); h2.id = 'audio-heading-' + crypto.randomUUID(); element.setAttribute('aria-labelledby', h2.id);
    copy.append(h2, node('p', '', subtitle)); const close = button('×', () => element.close(), 'audio-studio-close'); close.setAttribute('aria-label', '关闭'); heading.append(copy, close); element.append(heading);
    const error = node('p', 'audio-studio-error'); error.setAttribute('role', 'alert');
    document.body.append(element);
    return { element, error, close };
  }

  window.createAudioStudio = function ({ api, toast, refresh, stopOtherAudio = () => {} }) {
    let active = null;
    async function open({ versions, selectedId, onSelect, title = '版本与波形编辑' }) {
      active?.close(); stopOtherAudio();
      const modal = dialog(title, '比较不同版本，选定成品。裁剪、音量和淡入淡出会保存到本段音频，并用于试听与导出。');
      modal.element.id = 'audio-editor-dialog'; active = modal.element;
      let currentVersion = versions.find(version => version.id === selectedId) || versions.at(-1), clipIndex = 0, wave = null, busy = false, loadToken = 0, dirty = false;
      const versionRow = node('div', 'audio-version-row'), select = node('select'); select.id = 'audio-editor-version'; select.setAttribute('aria-label', '试听哪个生成版本');
      versions.forEach((version, index) => { const option = node('option', '', `第 ${index + 1} 版 · ${new Date(version.createdAt || Date.now()).toLocaleString('zh-CN')}${version.id === selectedId ? ' · 当前成品' : ''}${version.complete === false ? ' · 未齐段' : ''}`); option.value = version.id; select.append(option); });
      select.value = currentVersion.id;
      const choose = button('选为成品', async () => guard(async () => { await onSelect(currentVersion); selectedId = currentVersion.id; choose.textContent = '已选为成品'; toast('已选定此版本，项目试听和导出将使用它'); }), 'primary'); choose.id = 'audio-editor-select';
      versionRow.append(select, choose); modal.element.append(versionRow);
      const parts = node('select'), partsHost = node('div'); parts.id = 'audio-editor-part'; parts.setAttribute('aria-label', '编辑哪一段自动拆分音频'); partsHost.append(parts); modal.element.append(partsHost);
      const waveformHost = node('div'); modal.element.append(waveformHost);
      const fields = node('div', 'audio-studio-fields'), gain = number('人声音量（dB）', 0, -40, 12, .5), fadeIn = number('淡入（毫秒）', 0, 0, 30000, 10), fadeOut = number('淡出（毫秒）', 0, 0, 30000, 10);
      gain.input.id = 'audio-editor-gain'; fadeIn.input.id = 'audio-editor-fade-in'; fadeOut.input.id = 'audio-editor-fade-out'; fields.append(gain.wrapper, fadeIn.wrapper, fadeOut.wrapper);
      const quality = node('div', 'audio-quality'); quality.setAttribute('role', 'status');
      const transport = node('div', 'audio-studio-transport');
      const preview = button('试听编辑效果', () => guard(() => wave.play(settings(), false, preview))), original = button('对比原声', () => guard(() => wave.play({}, true, original))), stop = button('停止', () => wave?.stop()); transport.append(preview, original, stop);
      preview.id = 'audio-editor-preview'; original.id = 'audio-editor-original'; [preview, original].forEach(button => window.SoundFeedback?.set(button));
      const save = button('保存本段编辑', () => guard(async () => {
        const updated = await api('audio-edit', { id: currentVersion.clips[clipIndex].id, edit: settings() });
        currentVersion.clips[clipIndex] = updated; dirty = false; await refresh(); quality.textContent = updated.editPeakLimited ? '已保存。音量超过峰值上限，已自动降低增益以避免削波。' : '已保存；原始音频保留，可随时恢复。'; toast('波形编辑已保存');
      }), 'primary'); save.id = 'audio-editor-save';
      const reset = button('恢复原声设置', () => { wave?.set(0, wave.get().duration); gain.input.value = fadeIn.input.value = fadeOut.input.value = 0; dirty = true; });
      const inspect = button('重新检查音频', () => guard(async () => { const updated = await api('audio-inspect', { id: currentVersion.clips[clipIndex].id }); currentVersion.clips[clipIndex] = updated; quality.textContent = (updated.editedQuality || updated.quality).messages.join('；') || '未发现明显信号异常，仍需试听核对读音。'; await refresh(); }));
      const actions = node('div', 'audio-studio-actions'); actions.append(reset, inspect, save); modal.element.append(fields, transport, quality, modal.error, actions);
      function settings() { const region = wave.get(); return { trimStartMs: region.start * 1000, trimEndMs: Math.max(0, region.duration - region.end) * 1000, gainDb: Number(gain.input.value), fadeInMs: Number(fadeIn.input.value), fadeOutMs: Number(fadeOut.input.value) }; }
      async function guard(fn) {
        if (busy) return; busy = true; modal.error.textContent = ''; modal.close.disabled = true; modal.element.classList.add('audio-studio-busy');
        [select, parts, save, choose, reset, inspect].forEach(control => control.disabled = true);
        try { await fn(); } catch (error) { modal.error.textContent = error.message; }
        finally { busy = false; modal.close.disabled = false; modal.element.classList.remove('audio-studio-busy'); [select, parts, save, choose, reset, inspect].forEach(control => control.disabled = false); choose.disabled = currentVersion.complete === false; }
      }
      async function loadClip() {
        const current = ++loadToken; wave?.destroy(); wave = createWaveform(waveformHost, { onChange: () => dirty = true });
        const item = currentVersion.clips[clipIndex], edit = { ...defaults, ...item.edit };
        const bytes = await api('audio', { id: item.id, original: true });
        if (current !== loadToken || !modal.element.open) return;
        const duration = await wave.load(bytes);
        wave.set(edit.trimStartMs / 1000, duration - edit.trimEndMs / 1000);
        gain.input.value = edit.gainDb; fadeIn.input.value = edit.fadeInMs; fadeOut.input.value = edit.fadeOutMs;
        quality.textContent = (item.editedQuality || item.quality)?.messages?.join('；') || '';
        choose.textContent = currentVersion.id === selectedId ? '当前成品版本' : '选为成品'; choose.disabled = currentVersion.complete === false; dirty = false;
      }
      function updateParts() { parts.replaceChildren(); currentVersion.clips.forEach((item, i) => { const option = node('option', '', `第 ${i + 1} / ${currentVersion.clips.length} 段 · ${item.text}`); option.value = i; parts.append(option); }); partsHost.hidden = currentVersion.clips.length < 2; }
      select.onchange = () => guard(async () => { if (dirty) throw new Error('请先保存本段编辑，再切换版本'); currentVersion = versions.find(version => version.id === select.value); clipIndex = 0; updateParts(); await loadClip(); }).finally(() => select.value = currentVersion.id);
      parts.onchange = () => guard(async () => { if (dirty) throw new Error('请先保存本段编辑，再切换片段'); clipIndex = Number(parts.value); await loadClip(); }).finally(() => parts.value = clipIndex);
      [gain.input, fadeIn.input, fadeOut.input].forEach(input => input.oninput = () => dirty = true);
      modal.element.oncancel = event => { if (busy) event.preventDefault(); };
      modal.element.onclose = () => { loadToken++; wave?.destroy(); modal.element.remove(); if (active === modal.element) active = null; };
      updateParts(); modal.element.showModal(); await guard(loadClip);
    }
    return { open, close: () => active?.close() };
  };
  window.AudioWaveform = { create: createWaveform };
  window.AudioStudioUI = { node, button, number, dialog };
})();
