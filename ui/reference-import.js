window.createReferenceImporter = function ({ api, refresh, toast, stopOtherAudio }) {
  const { node, button, number, dialog } = window.AudioStudioUI;
  let active = null;
  async function open(preset = {}) {
    if (active) return null;
    stopOtherAudio();
    let imported;
    try { imported = await api('reference-open', { consent: true }); }
    catch (error) { toast(error.message, true); return null; }
    if (!imported) return null;
    const modal = dialog('导入参考声音', '选取 3–30 秒清晰人声，填写并核对录音原话。可使用本地识别辅助填写，录音不会上传。');
    modal.element.id = 'reference-import-dialog'; active = modal.element;
    let busy = false, finished = false, recognizedRegion = '', recognizedText = '', result = null, preparationId = '';
    const name = node('input'); name.id = 'reference-import-name'; name.maxLength = 48; name.value = preset.name || imported.name;
    name.setAttribute('aria-label', '声音名称'); modal.element.append(node('label', '', '声音名称'), name);
    const wave = window.AudioWaveform.create(modal.element, { minimum: 3, maximum: 30, end: Math.min(30, imported.duration), onChange: () => {
      if (recognizedText && text.value === recognizedText) text.value = '';
      recognizedRegion = ''; hint.textContent = '选区已改变，请重新识别或核对填写该片段的原话。';
    } });
    const transport = node('div', 'audio-studio-transport'), listen = button('试听所选录音', () => guard(() => wave.play({}, false, listen))); listen.id = 'reference-import-preview'; window.SoundFeedback?.set(listen); transport.append(listen, button('停止', () => wave.stop()));
    const fields = node('div', 'audio-studio-fields'), language = node('select'); language.id = 'reference-import-language'; language.setAttribute('aria-label', '录音语言');
    for (const [value, label] of [['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['auto', '自动识别语言']]) { const option = node('option', '', label); option.value = value; language.append(option); }
    const languageLabel = node('label', '', '识别语言'); languageLabel.append(language); fields.append(languageLabel);
    const prepare = button('准备本地识别资源（约 ' + Math.ceil((imported.transcription?.bytes || 486000000) / 1e6) + ' MB）', () => guard(async () => {
      hint.textContent = '正在准备识别资源，完成后可离线识别。此过程不会下载新的配音模型。';
      preparationId = crypto.randomUUID(); pause.hidden = false; pause.disabled = false;
      try { const status = await api('transcription-setup', { requestId: preparationId }); imported.transcription = status; update(); hint.textContent = status.cancelled ? '准备已暂停，下载进度会保留；可以继续准备或手动填写原话。' : '识别资源已就绪，可以自动识别原话。'; }
      finally { preparationId = ''; pause.hidden = true; }
    })); prepare.id = 'reference-import-prepare';
    const pause = button('暂停准备', async () => { pause.disabled = true; try { await api('transcription-cancel', { requestId: preparationId }); } catch (error) { modal.error.textContent = error.message; pause.disabled = false; } }); pause.id = 'reference-import-pause'; pause.hidden = true;
    const transcribe = button('自动识别原话', () => guard(async () => {
      wave.stop(); const selected = region(); const transcript = await api('reference-transcribe', { token: imported.token, ...selected, language: language.value });
      text.value = transcript.text; recognizedText = transcript.text; recognizedRegion = JSON.stringify(selected);
      quality.textContent = transcript.quality.messages.join('；'); hint.textContent = '已在本机识别。请边听边核对，改正错字、多音字和数字后再保存。';
      await refresh();
    })); transcribe.id = 'reference-import-transcribe';
    const text = node('textarea'); text.id = 'reference-import-text'; text.rows = 4; text.maxLength = 1000; text.placeholder = '准确填写所选录音里说的原话，或点击自动识别'; text.setAttribute('aria-label', '所选录音原话');
    text.value = preset.text || '';
    const hint = node('p', 'audio-studio-note', '可以手动填写原话；自动识别需要首次联网准备资源，之后在本机运行。'); hint.setAttribute('role', 'status');
    const quality = node('div', 'audio-quality', imported.quality.messages.join('；'));
    const recognize = node('div', 'audio-studio-transport'); recognize.append(prepare, pause, transcribe);
    const save = button('保存并使用声音', () => guard(async () => {
      const selected = region();
      if (recognizedText && text.value === recognizedText && recognizedRegion !== JSON.stringify(selected)) throw new Error('录音选区已改变，请重新识别或核对原话');
      result = await api('reference-commit', { token: imported.token, ...selected, consent: true, name: name.value.trim(), text: text.value.trim() });
      finished = true; await refresh(); toast('参考声音已保存'); modal.element.close();
    }), 'primary'); save.id = 'reference-import-save';
    const actions = node('div', 'audio-studio-actions'); actions.append(button('取消', () => modal.element.close()), save);
    modal.element.append(transport, fields, recognize, node('label', '', '这段录音里说了什么？'), text, hint, quality, modal.error, actions);
    function region() { const selected = wave.get(); return { startMs: selected.start * 1000, endMs: selected.end * 1000 }; }
    function update() { prepare.hidden = !!imported.transcription?.ready; transcribe.disabled = !imported.transcription?.ready || busy; }
    async function guard(action) {
      if (busy) return; busy = true; modal.error.textContent = ''; modal.close.disabled = true;
      modal.element.querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = true);
      try { await action(); } catch (error) { modal.error.textContent = error.message; }
      finally { busy = false; modal.element.querySelectorAll('button,input,select,textarea').forEach(control => control.disabled = false); update(); }
    }
    const unsubscribe = window.studio.onProgress(progress => {
      if (!busy) return;
      if (progress.stage === 'transcribing') hint.textContent = '正在本机识别，请稍候…';
      else if (progress.stage === 'download' && progress.aggregateTotal) hint.textContent = `正在准备识别资源 · ${(progress.aggregateCurrent / 1e6).toFixed(1)} / ${(progress.aggregateTotal / 1e6).toFixed(1)} MB`;
      else if (['runtime', 'dependencies'].includes(progress.stage)) hint.textContent = '正在准备本地识别组件…';
    });
    modal.element.oncancel = event => { if (busy) event.preventDefault(); };
    const closed = new Promise(resolve => modal.element.onclose = () => {
      wave.destroy(); unsubscribe(); modal.element.remove(); active = null;
      if (!finished) api('reference-cancel', { token: imported.token }).catch(() => {});
      resolve(result);
    });
    modal.element.showModal(); update(); await guard(async () => wave.load(await api('reference-import-audio', { token: imported.token })));
    return closed;
  }
  return { open, close: () => active?.close() };
};
