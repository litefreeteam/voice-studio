(function (root) {
  const palettes = { lavender: ['#f2eeff', '#6a51dc', '#28213e'], peach: ['#fff0e5', '#be643f', '#422a22'], mint: ['#e9f5ef', '#3b8265', '#213c32'], rose: ['#fcecf1', '#ae5477', '#432735'] };
  function pcm(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const word = (offset, length) => String.fromCharCode(...data.subarray(offset, offset + length));
    if (data.length < 44 || word(0, 4) !== 'RIFF' || word(8, 4) !== 'WAVE') throw new Error('无法读取这段 WAV 音频');
    let format, samples;
    for (let offset = 12; offset + 8 <= data.length;) {
      const size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > data.length) throw new Error('音频文件不完整');
      if (word(offset, 4) === 'fmt ') { if (size < 16) throw new Error('音频格式不完整'); format = { codec: view.getUint16(start, true), channels: view.getUint16(start + 2, true), rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) }; }
      if (word(offset, 4) === 'data') samples = data.slice(start, start + size);
      offset = start + size + (size % 2);
    }
    if (!format || !samples?.length || format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || samples.length % 2 || format.rate < 8000 || format.rate > 96000) throw new Error('请使用声悦生成的单声道 WAV 音频');
    return { ...format, samples, duration: samples.length / 2 / format.rate };
  }
  function merge(clips, pause = 350) {
    if (!clips.length || clips.length > 100 || !Number.isInteger(pause) || pause < 0 || pause > 3000) throw new Error('合成参数不正确');
    const decoded = clips.map(clip => pcm(clip.bytes)), rate = decoded[0].rate;
    if (decoded.some(clip => clip.rate !== rate)) throw new Error('音频采样率不一致，请在实验室重新生成后导出');
    const silence = Math.round(pause * rate / 1000) * 2;
    const size = decoded.reduce((sum, clip) => sum + clip.samples.length, 0) + silence * (clips.length - 1);
    if (size > 120 * 1024 * 1024) throw new Error('作品较长，请拆分后合成（合并音频最多 120 MB）');
    const bytes = new Uint8Array(44 + size), view = new DataView(bytes.buffer), write = (offset, text) => [...text].forEach((letter, i) => bytes[offset + i] = letter.charCodeAt(0));
    write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, size, true);
    let offset = 44; const timeline = [];
    decoded.forEach((clip, index) => {
      const start = (offset - 44) / 2 / rate;
      bytes.set(clip.samples, offset); offset += clip.samples.length;
      timeline.push({ ...clips[index], bytes: undefined, start, end: (offset - 44) / 2 / rate });
      if (index < decoded.length - 1) offset += silence;
    });
    return { bytes, timeline, duration: size / 2 / rate };
  }
  function timestamp(seconds) {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  const srt = timeline => timeline.map((clip, index) => `${index + 1}\n${timestamp(clip.start)} --> ${timestamp(clip.end)}\n${String(clip.text).replace(/\r?\n/g, ' ')}\n`).join('\n');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function soundboard(title, clips) {
    if (!clips.length || clips.length > 100) throw new Error('请先生成语音按钮');
    const cards = clips.map((clip, index) => {
      if (!/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(clip.audio || '')) throw new Error('声音文件格式不正确');
      return `<article><button type="button" data-play="${index}" aria-pressed="false"><small><b>${index < 9 ? index + 1 : '▶'}</b><span class="button-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></small><strong>${escape(clip.label)}</strong><span>${escape(clip.text)}</span></button><audio preload="none" src="${clip.audio}"></audio></article>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escape(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f3fd;color:#302643;font:16px/1.6 system-ui,sans-serif}main{max-width:960px;margin:60px auto;padding:24px}h1{font-size:32px}p{color:#70647f}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}button{font:inherit;cursor:pointer}article button{width:100%;height:100%;padding:26px;border:1px solid #ded7ed;border-radius:18px;background:white;text-align:left;color:inherit}article button[aria-pressed=true]{background:#eee6ff;border-color:#7a56ce}strong,span{display:block}small{display:inline-grid;place-items:center;border-radius:50%;width:32px;height:32px;background:#f2ecff;color:#7150b7;margin-bottom:12px}span{font-size:13px;color:#70647f;margin-top:8px}#stop{padding:9px 18px;border:1px solid #ded7ed;background:white;border-radius:10px;margin:10px 0 25px}.button-wave{display:none;align-items:center;justify-content:center;gap:2px;width:17px;height:16px;margin:0}.button-wave i{width:2.5px;height:15px;border-radius:3px;background:currentColor;animation:sound-level .82s ease-in-out infinite alternate}.button-wave i:nth-child(2){animation-delay:-.43s}.button-wave i:nth-child(3){animation-delay:-.18s}.button-wave i:nth-child(4){animation-delay:-.58s}button[aria-pressed=true] small b{display:none}button[aria-pressed=true] .button-wave{display:flex}button[aria-busy=true] small{opacity:.5}@keyframes sound-level{from{transform:scaleY(.25)}to{transform:scaleY(.95)}}@media(prefers-reduced-motion:reduce){.button-wave i{animation:none;transform:scaleY(.45)}.button-wave i:nth-child(2n){transform:scaleY(.85)}}</style><main><p>声悦 · 我的语音按钮</p><h1>${escape(title)}</h1><p>点击播放，重复点击停止。键盘 1–9 播放对应短句，Esc 停止。声音保存在这份文件中，断网也能播放。</p><button id="stop">停止播放</button><section>${cards}</section></main><script>const buttons=[...document.querySelectorAll('[data-play]')],audios=[...document.querySelectorAll('audio')];let chosen=-1,sequence=0;function stop(){sequence++;chosen=-1;audios.forEach((a,i)=>{a.pause();a.currentTime=0;buttons[i].setAttribute('aria-pressed','false');buttons[i].setAttribute('aria-busy','false')})}function play(i){const active=chosen===i;stop();if(!active){chosen=i;const current=sequence;buttons[i].setAttribute('aria-busy','true');audios[i].play().catch(()=>{if(current===sequence)stop()})}}buttons.forEach((b,i)=>{b.onclick=()=>play(i);audios[i].onplaying=()=>{if(chosen!==i){audios[i].pause();return}b.setAttribute('aria-busy','false');b.setAttribute('aria-pressed','true')};audios[i].onwaiting=()=>{if(chosen===i){b.setAttribute('aria-busy','true');b.setAttribute('aria-pressed','false')}};audios[i].onended=audios[i].onerror=()=>{b.setAttribute('aria-pressed','false');b.setAttribute('aria-busy','false');if(chosen===i)chosen=-1};audios[i].onpause=()=>b.setAttribute('aria-pressed','false')});document.querySelector('#stop').onclick=stop;document.onkeydown=e=>{if(e.key==='Escape')stop();else if(/^[1-9]$/.test(e.key)&&buttons[Number(e.key)-1]){e.preventDefault();play(Number(e.key)-1)}};</script></html>`;
  }
  function wrap(ctx, text, width) {
    const lines = []; let line = '';
    for (const char of [...String(text)]) { if (char === '\n' || ctx.measureText(line + char).width > width) { lines.push(line); line = char === '\n' ? '' : char; } else line += char; }
    if (line) lines.push(line); return lines;
  }
  function draw(canvas, scene) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, colors = palettes[scene.theme] || palettes.lavender;
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = colors[1] + '12'; ctx.beginPath(); ctx.arc(w - 30, 120, 235, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors[1]; ctx.font = '24px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('声悦 · ' + (scene.kind || '声音小剧场'), 46, 68);
    ctx.fillStyle = colors[2]; ctx.font = 'bold 38px sans-serif';
    wrap(ctx, scene.title || '我的声音作品', w - 92).slice(0, 2).forEach((text, index) => ctx.fillText(text, 46, 135 + index * 48));
    const top = 235, imageHeight = 460;
    ctx.fillStyle = '#ffffffb8'; ctx.fillRect(40, top, w - 80, imageHeight);
    if (scene.image?.naturalWidth) {
      const ratio = Math.min((w - 80) / scene.image.naturalWidth, imageHeight / scene.image.naturalHeight);
      const iw = scene.image.naturalWidth * ratio, ih = scene.image.naturalHeight * ratio;
      ctx.drawImage(scene.image, (w - iw) / 2, top + (imageHeight - ih) / 2, iw, ih);
    } else {
      ctx.fillStyle = colors[1] + '1b'; ctx.beginPath(); ctx.arc(w / 2, top + 210, 100, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors[1]; ctx.textAlign = 'center'; ctx.font = 'bold 70px sans-serif'; ctx.fillText([...String(scene.label || '声').replace(/\s/g, '')].slice(0, 2).join(''), w / 2, top + 234);
    }
    ctx.fillStyle = colors[1]; ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
    wrap(ctx, scene.caption || '每一句话，都有温度。', w - 92).slice(0, 2).forEach((text, index) => ctx.fillText(text, w / 2, top + imageHeight + 42 + index * 28));
    ctx.textAlign = 'left'; ctx.fillStyle = colors[1]; ctx.font = 'bold 27px sans-serif'; ctx.fillText(String(scene.label || '旁白').slice(0, 20), 46, 805);
    ctx.fillStyle = colors[2]; ctx.font = '34px sans-serif';
    const pages = []; const chars = [...String(scene.text || '写下你的台词，听见故事的声音。')];
    for (let offset = 0; offset < chars.length; offset += 80) pages.push(chars.slice(offset, offset + 80).join(''));
    const current = pages[Math.min(pages.length - 1, Math.floor((scene.fraction || 0) * pages.length))] || '';
    wrap(ctx, current, w - 92).slice(0, 6).forEach((text, index) => ctx.fillText(text, 46, 875 + index * 52));
    ctx.fillStyle = colors[1]; ctx.font = '20px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${scene.index || 1} / ${scene.total || 1}`, w - 46, h - 40);
    ctx.fillStyle = colors[1] + '40'; ctx.fillRect(46, h - 75, w - 92, 3); ctx.fillStyle = colors[1]; ctx.fillRect(46, h - 75, (w - 92) * Math.min(1, scene.progress || 0), 3);
  }
  async function video({ merged, title, theme, caption, kind, cover, signal, onProgress }) {
    if (!root.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('当前环境不支持视频导出，请先保存合并音频和字幕');
    if (merged.duration > 600) throw new Error('单个视频最多 10 分钟，请拆分作品或先导出音频');
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('当前环境不支持 WebM 视频');
    const images = new Map();
    for (const src of new Set([cover, ...merged.timeline.map(clip => clip.image)].filter(Boolean))) { const img = new Image(); img.src = src; await img.decode(); images.set(src, img); }
    if (signal?.aborted) throw new Error('已取消视频制作');
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
    const context = new AudioContext(); let stream, timer, recorder, source, abort;
    try {
      await context.resume(); const buffer = await context.decodeAudioData(merged.bytes.buffer.slice(0));
      if (signal?.aborted) throw new Error('已取消视频制作');
      const destination = context.createMediaStreamDestination(); source = context.createBufferSource(); source.buffer = buffer; source.connect(destination);
      const frame = time => {
        const index = Math.max(0, merged.timeline.findIndex(clip => time < clip.end)); const clip = merged.timeline[index] || merged.timeline.at(-1);
        draw(canvas, { title, theme, caption, kind, ...clip, image: images.get(clip.image || cover), index: index + 1, total: merged.timeline.length, progress: time / merged.duration, fraction: Math.max(0, Math.min(.999, (time - clip.start) / (clip.end - clip.start))) });
      };
      frame(0); stream = canvas.captureStream(24); stream.addTrack(destination.stream.getAudioTracks()[0]);
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1800000 });
      return await new Promise((resolve, reject) => {
        const chunks = []; let size = 0, failure = null;
        const stop = error => { failure ||= error; if (recorder.state !== 'inactive') recorder.stop(); };
        abort = () => stop(new Error('已取消视频制作')); signal?.addEventListener('abort', abort, { once: true });
        recorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 240 * 1024 * 1024) stop(new Error('视频超过 240 MB，请缩短作品')); } };
        recorder.onerror = event => stop(event.error || new Error('视频制作中断'));
        recorder.onstop = () => failure ? reject(failure) : resolve(new Blob(chunks, { type: 'video/webm' }));
        recorder.start(1000); const started = context.currentTime; source.start(); source.onended = () => stop();
        timer = setInterval(() => { const time = context.currentTime - started; frame(time); onProgress?.(Math.min(1, time / merged.duration)); }, 1000 / 24);
      });
    } finally { clearInterval(timer); signal?.removeEventListener('abort', abort); source?.disconnect(); try { source?.stop(); } catch {} stream?.getTracks().forEach(track => track.stop()); await context.close(); }
  }
  const api = { pcm, merge, timestamp, srt, soundboard, draw, video, palettes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VoiceLabMedia = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
