/* Mix drafts are previewed independently, then applied to the current project. */
window.createProjectMixer = function (hooks) {
  const $ = selector => document.querySelector(selector), M = window.ScriptProjects;
  const dialog = $('#project-mix-dialog'), form = $('#project-mix-form'), music = $('#project-mix-music');
  const gain = $('#project-mix-gain'), gainRange = $('#project-mix-gain-range'), offset = $('#project-mix-offset'), offsetRange = $('#project-mix-offset-range');
  const loop = $('#project-mix-loop'), duck = $('#project-mix-duck'), seek = $('#project-mix-seek');
  const defaults = () => ({ backgroundId: '', gainDb: -20, loop: true, ducking: true, offsetMs: 0 });
  const clock = seconds => `${Math.floor(Math.max(0, seconds || 0) / 60)}:${String(Math.floor(Math.max(0, seconds || 0) % 60)).padStart(2, '0')}`;
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const icon = name => { const n = node('span', 'ui-icon icon-' + name); n.setAttribute('aria-hidden', 'true'); return n; };
  let draft = null, owner = '', session = 0, saving = false, importing = false, pending = null, playback = 0;
  let audio = null, audioURL = null, audioFeedback = null, audioPhase = 'idle', librarySignature = '';
  const entry = node('div', 'project-mix-entry'); entry.id = 'project-mix-panel';
  const open = node('button', 'mix-entry-button'); open.id = 'project-mix-open'; open.type = 'button'; open.setAttribute('aria-haspopup', 'dialog');
  const cover = node('img'); cover.src = 'assets/mix-cover.svg'; cover.alt = ''; cover.width = 47; cover.height = 47;
  const copy = node('span', 'mix-entry-copy'), summary = node('small', '', '未添加背景音乐 · 点击配置');
  copy.append(node('strong', '', '背景音乐与混音'), summary); open.append(cover, copy, icon('sliders-horizontal'), icon('arrow-right')); entry.append(open);
  const error = message => { $('#project-mix-error').textContent = String(message?.message || message).replace(/^Error invoking remote method '[^']+': Error: /, ''); };
  const status = message => { $('#project-mix-status').textContent = message; };
  const backgrounds = () => hooks.media().backgrounds || [];
  const selectedMusic = () => backgrounds().find(item => item.id === draft?.backgroundId);
  const available = () => !!selectedMusic();
  const hasVoice = () => !!hooks.project() && M.deliveryReadiness(hooks.entries()).complete > 0;
  function sliderFill(input) {
    const progress = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--mix-progress', Math.max(0, Math.min(100, progress)) + '%');
  }
  function transport() {
    const playing = !!audio && !audio.paused && audioPhase === 'playing', waiting = !!pending || audioPhase === 'loading';
    dialog.classList.toggle('is-playing', playing);
    const button = $('#project-mix-preview'); button.disabled = saving || importing || waiting || !available() || !hasVoice();
    button.classList.toggle('is-loading', waiting); button.classList.toggle('is-playing', playing);
    button.setAttribute('aria-busy', String(waiting)); button.setAttribute('aria-pressed', String(playing));
    button.querySelector('.ui-icon').className = 'ui-icon icon-' + (playing ? 'pause' : 'play');
    button.setAttribute('aria-label', waiting ? '正在准备混音试听' : playing ? '暂停混音试听' : audio ? '继续混音试听' : '试听混音');
    window.SoundFeedback?.set(button, waiting ? 'loading' : playing ? 'playing' : audio ? 'paused' : 'idle');
    $('#project-mix-stop').disabled = !audio && !waiting;
    seek.disabled = !audio || !Number.isFinite(audio.duration);
    if (!seek.matches(':active')) seek.value = audio?.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    sliderFill(seek);
    $('#project-mix-time').textContent = `${clock(audio?.currentTime)} / ${clock(audio?.duration || 30)}`;
  }
  function stop() {
    playback++;
    audioFeedback?.(); audioFeedback = null;
    audioPhase = 'idle';
    if (audio) { audio.pause(); audio = null; }
    if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
    transport();
  }
  function updateLibrary(force = false) {
    if (!draft) return;
    const rows = backgrounds(), signature = JSON.stringify(rows.map(item => [item.id, item.name, item.duration]));
    if (!force && signature === librarySignature) return;
    librarySignature = signature;
    const option = (value, text) => { const n = node('option', '', text); n.value = value; music.append(n); };
    music.replaceChildren(); option('', '不添加背景音乐');
    rows.forEach(item => option(item.id, `${item.name} · ${clock(item.duration)}`));
    if (draft.backgroundId && !available()) option(draft.backgroundId, '原音乐不可用，请重新选择');
    music.value = draft.backgroundId;
    window.CustomSelects?.sync();
  }
  function drawDraft() {
    if (!draft) return;
    const item = selectedMusic(), enabled = !!item && !saving && !importing;
    dialog.classList.toggle('has-music', !!item);
    $('#mix-music-heading').textContent = item?.name || (draft.backgroundId ? '原音乐暂不可用' : '给配音加一点氛围');
    $('#mix-music-heading').title = item?.name || '';
    $('#project-mix-music-info').textContent = item ? `${clock(item.duration)} · 已保存在本机` : draft.backgroundId ? '请重新选择，或移除本项目音乐' : '从电脑导入一首喜欢的音乐';
    music.value = draft.backgroundId; gain.value = draft.gainDb; gainRange.value = draft.gainDb;
    offset.value = draft.offsetMs / 1000;
    offsetRange.max = Math.max(60, Math.ceil(draft.offsetMs / 10000) * 10); offsetRange.value = draft.offsetMs / 1000;
    $('#project-mix-offset-end').textContent = offsetRange.max + ' 秒';
    loop.checked = draft.loop; duck.checked = draft.ducking;
    [gain, gainRange, offset, offsetRange, loop, duck, $('#project-mix-reset')].forEach(input => { input.disabled = !enabled; });
    gainRange.setAttribute('aria-valuetext', draft.gainDb + ' 分贝'); offsetRange.setAttribute('aria-valuetext', draft.offsetMs / 1000 + ' 秒后开始');
    [gainRange, offsetRange].forEach(sliderFill);
    document.querySelectorAll('[data-mix-gain]').forEach(button => {
      const selected = Number(button.dataset.mixGain) === draft.gainDb; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = !enabled;
    });
    document.querySelectorAll('[data-mix-offset]').forEach(button => {
      const selected = Number(button.dataset.mixOffset) * 1000 === draft.offsetMs; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = !enabled;
    });
    $('#project-mix-remove').disabled = !draft.backgroundId || saving || importing;
    $('#project-mix-import').disabled = saving || importing; music.disabled = saving || importing;
    $('#project-mix-import').classList.toggle('is-loading', importing);
    $('#project-mix-import-label').textContent = importing ? '正在导入…' : '导入本地音乐';
    $('#project-mix-apply').disabled = saving || importing || !!draft.backgroundId && !item;
    $('#project-mix-apply').classList.toggle('is-loading', saving);
    $('#project-mix-apply-label').textContent = saving ? '正在保存…' : '保存混音';
    $('#project-mix-close').disabled = saving; $('#project-mix-cancel').disabled = saving;
    transport(); window.CustomSelects?.sync();
  }
  function refresh() {
    const project = hooks.project(); if (!project) { if (dialog.open) dialog.close(); return; }
    if (dialog.open && project.id !== owner) dialog.close();
    const item = backgrounds().find(item => item.id === project.mix?.backgroundId);
    summary.textContent = item ? `${item.name} · ${project.mix.gainDb} dB${project.mix.ducking ? ' · 人声优先' : ''}` : project.mix?.backgroundId ? '原背景音乐不可用 · 点击更换' : '未添加背景音乐 · 点击配置';
    summary.title = summary.textContent; entry.classList.toggle('has-music', !!item);
    if (dialog.open && draft) { const previous = librarySignature; updateLibrary(); if (previous !== librarySignature) drawDraft(); else transport(); }
  }
  function changed(patch) {
    if (!draft || saving || importing) return;
    Object.assign(draft, patch); stop(); error(''); drawDraft();
    status(hasVoice() ? '设置尚未保存，可以先试听，再应用到项目。' : '设置尚未保存；生成一段配音后，即可试听混音。');
  }
  function numberChange(input, patch) {
    if (!input.checkValidity() || !input.value.trim() || !Number.isFinite(input.valueAsNumber)) return;
    changed(patch(input.valueAsNumber));
  }
  open.onclick = () => {
    const project = hooks.project(); if (!project) return;
    hooks.stopOtherAudio(); stop(); owner = project.id; session++; draft = structuredClone(project.mix || defaults());
    librarySignature = ''; error(''); updateLibrary(true); drawDraft();
    status(hasVoice() ? '修改后先试听，保存后用于成品试听与导出。' : '先选好音乐和混音设置；生成配音后即可试听。');
    dialog.showModal(); $('.mix-dialog-body').scrollTop = 0; $('#project-mix-close').focus({ preventScroll: true });
  };
  music.onchange = () => changed({ backgroundId: music.value });
  gainRange.oninput = () => changed({ gainDb: Number(gainRange.value) });
  offsetRange.oninput = () => changed({ offsetMs: Math.round(Number(offsetRange.value) * 1000) });
  gain.oninput = gain.onchange = () => numberChange(gain, gainDb => ({ gainDb }));
  offset.oninput = offset.onchange = () => numberChange(offset, seconds => ({ offsetMs: Math.round(seconds * 1000) }));
  loop.onchange = () => changed({ loop: loop.checked }); duck.onchange = () => changed({ ducking: duck.checked });
  document.querySelectorAll('[data-mix-gain]').forEach(button => { button.onclick = () => changed({ gainDb: Number(button.dataset.mixGain) }); });
  document.querySelectorAll('[data-mix-offset]').forEach(button => { button.onclick = () => changed({ offsetMs: Number(button.dataset.mixOffset) * 1000 }); });
  $('#project-mix-reset').onclick = () => changed({ ...defaults(), backgroundId: draft.backgroundId });
  $('#project-mix-remove').onclick = () => changed({ backgroundId: '' });
  $('#project-mix-import').onclick = async () => {
    if (importing || saving) return;
    const current = session; importing = true; error(''); drawDraft(); status('正在导入本地音乐…');
    try {
      const item = await hooks.api('background-import');
      if (!item) { if (current === session) status('已取消导入，当前设置保留。'); return; }
      await hooks.refresh();
      if (current !== session || !dialog.open || !draft) return;
      draft.backgroundId = item.id; updateLibrary(true); stop();
      status('音乐已加入本地素材，保存混音后应用到本项目。');
    } catch (failure) { if (current === session) error(failure); }
    finally { importing = false; if (dialog.open && draft) drawDraft(); }
  };
  $('#project-mix-preview').onclick = async () => {
    if (pending || saving || importing || !available() || !hasVoice()) return;
    if (audio) {
      try { if (audio.paused) await audio.play(); else audio.pause(); transport(); } catch (failure) { error(failure); }
      return;
    }
    hooks.stopOtherAudio(); stop(); window.SoundFeedback?.stop(); error('');
    const token = playback, current = session, request = { id: crypto.randomUUID() }; pending = request; transport(); status('正在准备前 30 秒混音试听…');
    try {
      const snapshot = M.deliverySnapshot({ project: { ...hooks.project(), mix: structuredClone(draft) }, entries: hooks.entries(), settings: hooks.settings(), allowPartial: true, scopeLabel: hooks.scopeLabel() });
      const result = await hooks.api('project-preview', { ...structuredClone(snapshot), requestId: request.id });
      if (token !== playback || current !== session || !dialog.open) return;
      const bytes = Uint8Array.from(atob(result.audio), value => value.charCodeAt(0));
      audioURL = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio = new Audio(audioURL);
      audio.onended = () => { stop(); status('试听结束，满意后保存混音。'); };
      audio.onerror = () => { stop(); error('试听播放失败，请重试。'); };
      audio.ontimeupdate = audio.onloadedmetadata = audio.onplay = audio.onpause = transport;
      audioFeedback = window.SoundFeedback?.bind(audio, $('#project-mix-preview'), { initial: 'loading', stop, onState: phase => { audioPhase = phase; transport(); } });
      await audio.play(); status(`正在试听 ${result.durationSeconds.toFixed(1)} 秒 · 使用当前未保存的混音设置`);
    } catch (failure) { if (token === playback && current === session) { stop(); error(failure); } }
    finally { if (pending === request) pending = null; transport(); }
  };
  $('#project-mix-stop').onclick = () => { stop(); status('已停止试听，当前设置保留。'); };
  seek.oninput = () => { if (audio && Number.isFinite(audio.duration)) { audio.currentTime = Number(seek.value) / 1000 * audio.duration; sliderFill(seek); } };
  form.onsubmit = async event => {
    event.preventDefault(); if (!draft || saving || importing) return;
    if (!gain.reportValidity() || !offset.reportValidity()) return;
    saving = true; stop(); error(''); drawDraft();
    try {
      M.validateMix(draft); if (draft.backgroundId && !available()) throw new Error('所选音乐不可用，请重新选择。');
      await hooks.apply(structuredClone(draft), owner);
      dialog.close(); refresh(); hooks.toast('混音设置已保存，成品试听与导出会使用相同设置。');
    } catch (failure) { error(failure); status('保存未完成，原项目混音设置保留，请重试。'); }
    finally { saving = false; if (dialog.open && draft) drawDraft(); }
  };
  $('#project-mix-close').onclick = $('#project-mix-cancel').onclick = () => { if (!saving) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { session++; draft = null; stop(); refresh(); open.focus({ preventScroll: true }); });
  return { entry, refresh, stop };
};
