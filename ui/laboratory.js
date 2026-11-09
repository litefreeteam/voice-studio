(function (root) {
  root.createLaboratory = function (deps) {
    const $ = id => document.getElementById('lab-' + id), core = root.VoiceLab, media = root.VoiceLabMedia;
    const node = (tag, cls, text) => { const value = document.createElement(tag); if (cls) value.className = cls; if (text !== undefined) value.textContent = text; return value; };
    const button = (text, run, cls = 'button') => { const value = node('button', cls, text); value.type = 'button'; value.onclick = () => Promise.resolve().then(run).catch(error => deps.toast(error.message, true)); return value; };
    let work = null, revision = 0, savedRevision = 0, timer, saving = Promise.resolve(), opening = false, submitting = false, exporting = false, controller;
    let audio = null, audioUrl = null, playbackToken = 0, previewIndex = 0, previewToken = 0, resultSignature = '', visible = false;
    let audioFeedback = null, pendingPlaybackId = '', audioPhase = 'idle';
    let controlId = 0;
    const emotionName = id => deps.emotions.find(emotion => emotion.id === id)?.name || id;
    const compiled = () => core.compile(work, deps.resolveVoice, root.ScriptProjects.fingerprint, deps.emotions.map(emotion => emotion.id));
    const results = () => core.match(compiled(), deps.media().history, work.id, work.selectedTakes);
    const pending = key => deps.media().jobs.some(job => ['queued', 'running', 'paused', 'scheduled'].includes(job.status) && job.rows.some(row => row.labId === work.id && (!key || row.labKey === key)));
    function stopAudio() { playbackToken++; pendingPlaybackId = ''; audioPhase = 'idle'; audioFeedback?.(); audioFeedback = null; audio?.pause(); audio = null; if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; document.querySelectorAll('#lab-results [data-lab-play]').forEach(value => { value.setAttribute('aria-pressed', 'false'); root.SoundFeedback?.set(value); }); }
    function save() {
      clearTimeout(timer); if (!work || revision === savedRevision) return saving;
      const snapshot = structuredClone(work), atRevision = revision;
      saving = saving.catch(() => {}).then(async () => {
        core.validate(snapshot); const result = await deps.api('lab-save', snapshot);
        if (!result?.saved) throw new Error(result?.error || '实验作品没有保存成功');
        if (work?.id === snapshot.id) { savedRevision = Math.max(savedRevision, atRevision); $('save-state').textContent = revision === savedRevision ? '已自动保存到本机' : '有修改待保存'; }
      }).catch(error => { if (work?.id === snapshot.id) $('save-state').textContent = '保存失败：' + error.message; throw error; });
      return saving;
    }
    function changed() {
      revision++; $('save-state').textContent = '正在保存…'; stopAudio(); clearTimeout(timer); timer = setTimeout(() => save().catch(error => deps.toast(error.message, true)), 350);
      resultSignature = ''; refresh(); preview();
    }
    function input(label, value, onChange, { area = false, max = 80, hint = '', rows = 3 } = {}) {
      const wrapper = node('div', 'lab-field'), id = 'lab-control-' + ++controlId, name = node('label', '', label), field = node(area ? 'textarea' : 'input');
      name.htmlFor = id; field.id = id; field.value = value; field.maxLength = max; if (area) field.rows = rows;
      field.oninput = () => { onChange(field.value); changed(); };
      wrapper.append(name, field); if (hint) wrapper.append(node('p', 'lab-hint', hint)); return wrapper;
    }
    function select(label, values, value, onChange) {
      const wrapper = node('div', 'lab-field'), name = node('label', '', label), field = node('select'); field.id = 'lab-control-' + ++controlId; name.htmlFor = field.id;
      values.forEach(entry => { const item = node('option', '', entry.name); item.value = entry.id; field.append(item); });
      if (!values.some(entry => entry.id === value)) { const missing = node('option', '', '声音已移除，请重新选择'); missing.value = value; field.append(missing); }
      field.value = value; field.onchange = () => { onChange(field.value); changed(); }; wrapper.append(name, field); return wrapper;
    }
    function voiceSelect(label, value, onChange) { return select(label, deps.voices().map(voice => ({ id: voice.key, name: voice.name + (voice.mode === 'clone' ? ' · 我的录音' : '') })), value, onChange); }
    function referenceStyleSelect(owner) {
      return select('录音声音的表达方式', [{ id: 'original', name: '沿用录音表达' }, { id: 'expressive', name: '调整语气与情绪 · 可选资源' }], owner.referenceStyle || 'original', value => { owner.referenceStyle = value; renderFields(); });
    }
    function imageField(label, get, set) {
      const wrapper = node('div', 'lab-image-field'), picker = node('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp'; picker.setAttribute('aria-label', label); picker.id = 'lab-control-' + ++controlId;
      const name = node('label', 'text-button', label); name.htmlFor = picker.id;
      picker.onchange = async () => {
        const file = picker.files[0], owner = work; if (!file) return;
        try {
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的 PNG、JPEG 或 WebP 图片');
          const bitmap = await createImageBitmap(file); const canvas = document.createElement('canvas'), ratio = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio)); const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
          const data = canvas.toDataURL('image/jpeg', .82); if (data.length > 1600000) throw new Error('图片过大，请换一张更简单的图片');
          if (work !== owner) return; set(data); changed(); renderFields();
        } catch (error) { deps.toast('配图没有保存：' + error.message, true); } finally { picker.value = ''; }
      };
      wrapper.append(name, picker);
      if (get()) { const img = node('img'); img.src = get(); img.alt = '已选配图'; wrapper.append(img, button('移除配图', () => { set(''); changed(); renderFields(); }, 'text-button')); }
      return wrapper;
    }
    function renderVariants(target) {
      target.append(node('h2', '', '一句文案，多种表达'), input('配音文案', work.text, value => work.text = value, { area: true, max: 600, rows: 5, hint: '最多 600 字；所有候选版本合计最多 5000 字。' }));
      const voices = node('fieldset', 'lab-choices'); voices.append(node('legend', '', '选择声音 · 最多 6 个'));
      for (const voice of deps.voices()) {
        const label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = work.voiceKeys.includes(voice.key); check.value = voice.key;
        check.onchange = () => { if (check.checked && work.voiceKeys.length >= 6) { check.checked = false; return deps.toast('最多选择 6 个声音'); } work.voiceKeys = check.checked ? [...work.voiceKeys, voice.key] : work.voiceKeys.filter(key => key !== voice.key); changed(); };
        label.append(check, node('span', '', voice.name)); voices.append(label);
      }
      const emotions = node('fieldset', 'lab-choices lab-emotion-choices'); emotions.append(node('legend', '', '搭配语气 · 最多 4 种'));
      for (const emotion of deps.emotions) {
        const label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = work.emotions.includes(emotion.id); check.value = emotion.id;
        check.onchange = () => { if (check.checked && work.emotions.length >= 4) { check.checked = false; return deps.toast('最多选择 4 种语气'); } work.emotions = check.checked ? [...work.emotions, emotion.id] : work.emotions.filter(id => id !== emotion.id); changed(); };
        label.append(check, node('span', '', emotion.name)); emotions.append(label);
      }
      target.append(voices, referenceStyleSelect(work), emotions, node('p', 'lab-hint', '人物声音为每个候选分别定声。录音默认沿用原表达；选择调整语气后，首次使用可单独确认下载情绪资源，生成多种表达。满意的候选可收藏后单独打包。'));
      target.append(button('重新确定人物候选的声音', () => { work.voiceRevision = crypto.randomUUID(); changed(); refresh(); }, 'text-button'));
    }
    function renderFamily(target) {
      target.append(node('h2', '', '故事里的主角，就是你'), input('主角名字', work.child, value => work.child = value, { max: 40 }), input('主角喜欢什么', work.interest, value => work.interest = value, { max: 80 }));
      target.append(select('原创故事模板', core.stories.map(story => ({ id: story.id, name: story.name })), work.storyId, value => { work.storyId = value; }));
      target.append(button('填入这个故事', () => { work.story = core.stories.find(story => story.id === work.storyId).text; changed(); renderFields(); }));
      target.append(input('编辑故事', work.story, value => work.story = value, { area: true, max: 5000, rows: 8, hint: '{{name}} 会替换为主角名字，{{interest}} 会替换为兴趣。每段单独生成。' }));
      target.append(voiceSelect('谁来讲故事', work.voiceKey, value => { work.voiceKey = value; renderFields(); }));
      if (deps.resolveVoice(work.voiceKey)?.mode === 'clone') {
        target.append(referenceStyleSelect(work));
        if (work.referenceStyle === 'expressive') target.append(select('讲述语气', deps.emotions, work.emotion || 'natural', value => work.emotion = value));
      }
      if (deps.resolveVoice(work.voiceKey)?.mode === 'design') target.append(node('p', 'lab-hint', '全部段落与重做沿用同一份人物声音样本。'), button('重新定声', () => { work.voiceRevision = crypto.randomUUID(); changed(); }, 'text-button'));
      const recording = node('details', 'lab-recording'), summary = node('summary', '', '用我或家人的声音讲故事'); recording.append(summary, node('p', 'lab-hint', '录制或导入一段 3–30 秒的清晰人声。录音和原话保存在本机。'));
      const consentLabel = node('label', 'lab-consent'), consent = node('input'); consent.type = 'checkbox'; consent.id = 'lab-reference-consent'; consentLabel.append(consent, node('span', '', '我拥有这段声音的使用授权'));
      recording.append(consentLabel);
      recording.append(input('导入录音中的准确原话', work.referenceTranscript || '', value => work.referenceTranscript = value, { area: true, max: 1000, rows: 2, hint: '直接录音时，也可在录音窗口填写原话。' }));
      const actions = node('div', 'lab-inline-actions');
      actions.append(button('直接录音', () => {
        if (!deps.requireVoiceConsent(consent)) return;
        const owner = work; deps.recordVoice(id => { if (work !== owner) return; work.voiceKey = 'clone:' + id; changed(); renderFields(); });
      }), button('导入录音', async () => {
        if (!consent.checked) throw new Error('请先确认你拥有这段声音的使用授权');
        if (!work.referenceTranscript?.trim()) throw new Error('请先填写导入录音中的准确原话');
        const owner = work, result = await deps.importVoice({ consent: true, name: '家人讲故事', text: work.referenceTranscript.trim() });
        if (result && work === owner) { work.voiceKey = 'clone:' + result.id; changed(); renderFields(); }
      })); recording.append(actions); target.append(recording);
    }
    function renderRoles(target) {
      const section = node('div', 'lab-cast'); section.append(node('h3', '', '先为角色选声音'));
      work.roles.forEach(role => {
        const row = node('div', 'lab-role');
        row.append(input('角色名', role.name, value => role.name = value, { max: 40 }), voiceSelect('角色声音', role.voiceKey, value => { role.voiceKey = value; renderFields(); }));
        if (deps.resolveVoice(role.voiceKey)?.mode === 'clone') row.append(referenceStyleSelect(role));
        if (deps.resolveVoice(role.voiceKey)?.mode === 'design') {
          row.append(select('定声语气', deps.emotions, role.emotion || 'natural', value => { role.emotion = value; role.voiceRevision = crypto.randomUUID(); }),
            button('重新定声', () => { role.voiceRevision = crypto.randomUUID(); changed(); }, 'text-button'));
        }
        row.append(button('移除', () => {
          if (work.roles.length === 1) throw new Error('至少保留一个角色');
          if (work.lines.some(line => line.roleId === role.id)) throw new Error('先将这个角色的台词分配给其他角色，再移除');
          work.roles = work.roles.filter(entry => entry !== role); changed(); renderFields();
        }, 'text-button')); section.append(row);
      });
      section.append(button('＋ 添加角色', () => { if (work.roles.length >= 12) throw new Error('最多添加 12 个角色'); work.roles.push({ id: crypto.randomUUID(), name: `角色 ${work.roles.length + 1}`, voiceKey: 'preset:Vivian' }); changed(); renderFields(); }, 'text-button')); target.append(section);
    }
    function renderLines(target) {
      renderRoles(target);
      if (work.type === 'comic') {
        const importer = node('details', 'lab-dialogue-import'); importer.append(node('summary', '', '粘贴对白，按角色拆成台词'));
        const text = node('textarea'); text.placeholder = '小鹿：你听见了吗？\n小熊：我们一起去看看！'; text.rows = 4; text.maxLength = 5000; text.setAttribute('aria-label', '导入短剧对白');
        importer.append(text, node('p', 'lab-hint', '每行写成“角色：台词”，核对后会替换下方台词；原有声音配对会保留。'), button('拆分并替换台词', () => { Object.assign(work, core.importDialogue(text.value, work.roles)); previewIndex = 0; changed(); renderFields(); })); target.append(importer);
      }
      const heading = node('div', 'lab-lines-heading'); heading.append(node('h3', '', work.type === 'buttons' ? '我的语音按钮' : '逐句编辑与配图'), node('small', '', `${work.lines.length} / 80 句`)); target.append(heading);
      work.lines.forEach((line, index) => {
        const row = node('div', 'lab-line'); row.dataset.line = line.id;
        const toolbar = node('div', 'lab-line-toolbar'); toolbar.append(node('strong', '', String(index + 1).padStart(2, '0')));
        toolbar.append(button('↑', () => move(index, -1), 'text-button'), button('↓', () => move(index, 1), 'text-button'), button('移除', () => { work.lines.splice(index, 1); changed(); renderFields(); }, 'text-button')); target.append(row); row.append(toolbar);
        if (work.type === 'buttons') row.append(input('按钮名称', line.title, value => line.title = value, { max: 40 }));
        const choices = node('div', 'lab-line-choices'); choices.append(select('角色', work.roles.map(role => ({ id: role.id, name: role.name || '未命名角色' })), line.roleId, value => { line.roleId = value; renderFields(); }));
        const voice = deps.resolveVoice(work.roles.find(role => role.id === line.roleId)?.voiceKey);
        const role = work.roles.find(role => role.id === line.roleId);
        const fixed = voice?.mode === 'clone' && role?.referenceStyle !== 'expressive' || voice?.mode === 'design';
        choices.append(select('语气', fixed ? [{ id: 'natural', name: voice.mode === 'design' ? '跟随角色定声' : '跟随参考录音' }] : deps.emotions, fixed ? 'natural' : line.emotion, value => line.emotion = value)); row.append(choices);
        row.append(input('台词', line.text, value => line.text = value, { area: true, max: 600, rows: 3 }));
        const actions = node('div', 'lab-line-footer');
        if (work.type === 'comic') actions.append(imageField('选择这句的画面', () => line.image, value => line.image = value));
        actions.append(button('预览这句画面', () => { previewIndex = index; preview(); }, 'text-button')); row.append(actions);
      });
      target.append(button('＋ 添加一句', () => { if (work.lines.length >= 80) throw new Error('最多添加 80 句'); work.lines.push({ id: crypto.randomUUID(), roleId: work.roles[0].id, title: '', text: '', emotion: 'natural', image: '' }); changed(); renderFields(); }, 'button'));
    }
    function move(index, delta) { const next = index + delta; if (next < 0 || next >= work.lines.length) return; [work.lines[index], work.lines[next]] = [work.lines[next], work.lines[index]]; changed(); renderFields(); }
    function renderFields() {
      const target = $('fields'); target.replaceChildren();
      if (work.type === 'variants') renderVariants(target); else if (work.type === 'family') renderFamily(target); else renderLines(target);
      if (work.type !== 'variants') {
        const appearance = node('details', 'lab-appearance'); appearance.open = work.type === 'buttons'; appearance.append(node('summary', '', '作品画面与停顿'));
        appearance.append(select('画面配色', [{ id: 'lavender', name: '薰衣草紫' }, { id: 'peach', name: '暖杏色' }, { id: 'mint', name: '薄荷绿' }, { id: 'rose', name: '玫瑰粉' }], work.theme, value => work.theme = value));
        appearance.append(input('卡片寄语', work.caption, value => work.caption = value, { max: 60, hint: '最多 60 字；选择照片后，寄语也会保留在画面中。' }));
        appearance.append(imageField('选择封面 / 默认画面', () => work.cover, value => work.cover = value));
        appearance.append(select('句间停顿', [0, 200, 350, 600, 1000, 2000, 3000].map(id => ({ id: String(id), name: id ? `${id / 1000} 秒` : '不额外停顿' })), String(work.pause), value => work.pause = Number(value))); target.append(appearance);
      }
      root.CustomSelects?.sync(); refresh(); preview();
    }
    function sceneFor(row) {
      const line = work.lines.find(line => line.id === row?.labSourceId);
      return { title: work.name, theme: work.theme, caption: work.caption, kind: core.kinds[work.type].name,
        label: row?.labLabel || '旁白', text: row?.text || (work.type === 'family' ? core.storyText(work) : work.text), image: line?.image || work.cover };
    }
    async function preview() {
      if (!work || !visible || work.type === 'variants') return; const token = ++previewToken; let rows = [];
      try { rows = compiled(); } catch {}
      const index = Math.min(previewIndex, Math.max(0, rows.length - 1)), scene = sceneFor(rows[index]);
      if (scene.image) { const image = new Image(); image.src = scene.image; try { await image.decode(); scene.image = image; } catch { scene.image = null; } }
      if (token !== previewToken) return;
      media.draw($('canvas'), { ...scene, index: index + 1, total: rows.length || 1 });
      $('preview-meta').textContent = rows.length ? `${index + 1} / ${rows.length}` : '画面示意';
    }
    async function play(entry, index, control) {
      if (!entry.item) return;
      if (pendingPlaybackId === entry.item.id || audio?.dataset.id === entry.item.id && !audio.paused) { stopAudio(); return; }
      stopAudio(); deps.stopOtherAudio(); root.SoundFeedback?.stop(); const token = playbackToken; previewIndex = index; preview(); pendingPlaybackId = entry.item.id; root.SoundFeedback?.set(control, 'loading');
      try {
      const bytes = await deps.api('audio', { id: entry.item.id }); if (token !== playbackToken) return;
      audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); audio = new Audio(audioUrl); audio.dataset.id = entry.item.id;
      audio.onended = () => { if (token === playbackToken) stopAudio(); }; audio.onerror = () => { if (token === playbackToken) { stopAudio(); deps.toast('音频读取失败，可以重新生成这句。', true); } };
      audioFeedback = root.SoundFeedback?.bind(audio, () => [...document.querySelectorAll('#lab-results [data-lab-play]')].filter(button => button.dataset.labPlay === entry.item.id), { initial: 'loading', stop: stopAudio, onState: phase => { audioPhase = phase; } });
      await audio.play(); if (token === playbackToken) control.setAttribute('aria-pressed', 'true');
      } catch (error) { if (token === playbackToken) stopAudio(); throw error; }
      finally { if (token === playbackToken) pendingPlaybackId = ''; }
    }
    async function generate(onlyKey) {
      if (submitting || exporting) return;
      const entries = results(), rows = entries.filter(entry => (!onlyKey ? !entry.item : entry.row.labKey === onlyKey) && !pending(entry.row.labKey)).map(entry => entry.row);
      if (!rows.length) return deps.toast('当前内容已生成，单击候选旁的“重做”可重新配音。');
      if (rows.some(row => !deps.ready(row))) { deps.downloads(rows, null, work.name); return deps.toast('一键准备完整资源后，将返回这份作品继续创作。'); }
      submitting = true; refresh();
      try { await save(); await deps.submit({ project: work.name, rows }); }
      finally { submitting = false; resultSignature = ''; refresh(); }
    }
    function refresh() {
      if (!work || !visible || $('workspace').hidden) return;
      let entries = [], error = '';
      try { entries = results(); } catch (failure) { error = failure.message; }
      const done = entries.filter(entry => entry.item).length, waiting = entries.filter(entry => pending(entry.row.labKey)).length;
      $('summary').textContent = error || `${entries.length} 段配音 · 已完成 ${done} 段${waiting ? ` · ${waiting} 段处理中` : ''}。修改文案或声音后，仅生成需要更新的内容。`;
      $('generate').disabled = !!error || submitting || exporting || waiting > 0 || done === entries.length;
      $('generate').textContent = submitting ? '正在提交…' : waiting ? '正在后台生成…' : done === entries.length && done ? '当前内容已生成' : done ? `生成未完成 · ${entries.length - done} 段` : `生成配音${entries.length ? ' · ' + entries.length + ' 段' : ''}`;
      const signature = JSON.stringify({ rows: entries.map(entry => [entry.row.labKey, entry.item?.id, entry.item?.editedWav, (entry.item?.editedQuality || entry.item?.quality)?.flags, pending(entry.row.labKey)]), favorites: work.favorites, exporting });
      if (signature !== resultSignature) {
        resultSignature = signature; const target = $('results'); target.replaceChildren(); target.classList.toggle('lab-button-grid', work.type === 'buttons');
        entries.forEach((entry, index) => {
          const card = node('article', 'lab-result' + (entry.item ? ' is-ready' : '')), heading = node('div', 'lab-result-heading');
          const title = work.type === 'variants' ? `${entry.row.labLabel} · ${emotionName(entry.row.emotion)}` : entry.row.labLabel;
          heading.append(node('strong', '', title), node('small', '', entry.item ? `${entry.item.duration.toFixed(1)} 秒` : pending(entry.row.labKey) ? '生成中' : '待生成')); card.append(heading, node('p', '', entry.row.text));
          const actions = node('div', 'lab-result-actions'), playButton = button(work.type === 'buttons' ? '点击播放' : '试听', () => play(entry, index, playButton), work.type === 'buttons' ? 'lab-sound-button' : 'text-button');
          playButton.disabled = !entry.item || exporting; playButton.setAttribute('aria-pressed', 'false'); actions.append(playButton);
          playButton.dataset.labPlay = entry.item?.id || ''; root.SoundFeedback?.set(playButton, audio?.dataset.id === entry.item?.id ? audioPhase : pendingPlaybackId && pendingPlaybackId === entry.item?.id ? 'loading' : 'idle');
          const redo = button('重做', () => generate(entry.row.labKey), 'text-button'); redo.disabled = submitting || exporting || pending(entry.row.labKey); actions.append(redo);
          const edit = button('版本 / 波形', () => editAudio(entry.row.labKey), 'text-button'); edit.disabled = !entry.item || exporting || pending(entry.row.labKey); actions.append(edit);
          if ((entry.item?.editedQuality || entry.item?.quality)?.review) card.append(node('p', 'project-line-quality', '建议试听核对：' + (entry.item.editedQuality || entry.item.quality).messages.join('；')));
          if (work.type === 'variants') { const favorite = button(work.favorites.includes(entry.row.labKey) ? '★ 已收藏' : '☆ 收藏', () => { const current = new Set(entries.map(entry => entry.row.labKey)); work.favorites = work.favorites.filter(key => current.has(key)); work.favorites = work.favorites.includes(entry.row.labKey) ? work.favorites.filter(key => key !== entry.row.labKey) : [...work.favorites, entry.row.labKey]; changed(); }, 'text-button'); favorite.disabled = !entry.item || exporting; favorite.setAttribute('aria-pressed', String(work.favorites.includes(entry.row.labKey))); actions.append(favorite); }
          card.append(actions); target.append(card);
        });
      }
      $('export-actions').querySelectorAll('button').forEach(control => { control.disabled = exporting || !done || control.dataset.complete === 'true' && done !== entries.length || control.dataset.favorites === 'true' && !entries.some(entry => entry.item && work.favorites.includes(entry.row.labKey)); });
    }
    async function editAudio(key) {
      const entry = results().find(entry => entry.row.labKey === key), owner = work.id;
      if (!entry?.item) return deps.toast('此内容还没有可试听的版本');
      const versions = deps.media().history.filter(item => item.options?.labId === owner && item.options.labKey === key).sort((a, b) => a.createdAt - b.createdAt).map(item => ({ id: item.id, clips: [item], createdAt: item.createdAt, complete: true }));
      return deps.audioEditor({ versions, selectedId: entry.item.id, onSelect: async version => {
        if (work.id !== owner) throw new Error('作品已经切换，请重新选择版本');
        const keys = new Set(compiled().map(row => row.labKey)); work.selectedTakes = Object.fromEntries(Object.entries(work.selectedTakes || {}).filter(([key]) => keys.has(key)));
        work.selectedTakes[key] = version.id; changed(); await save(); resultSignature = ''; refresh();
      } });
    }
    async function loadClips(entries) {
      const owner = work, clips = [];
      for (const entry of entries) { const bytes = new Uint8Array(await deps.api('audio', { id: entry.item.id })); if (work !== owner) throw new Error('作品已经切换，请重新导出'); const scene = sceneFor(entry.row); clips.push({ ...scene, bytes }); }
      return clips;
    }
    async function saveBytes(format, bytes, name) {
      const result = await deps.api('lab-export', { name, format, bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes });
      if (result?.saved) deps.toast('作品已保存到所选位置');
    }
    async function exportWork(format, favoriteOnly = false) {
      if (exporting) return; const owner = work, all = results(), entries = favoriteOnly ? all.filter(entry => work.favorites.includes(entry.row.labKey) && entry.item) : all;
      if (format !== 'zip' && entries.some(entry => !entry.item)) throw new Error('先生成全部当前内容，再导出完整作品');
      if (!entries.some(entry => entry.item)) throw new Error('请先生成配音');
      if (format === 'zip') return deps.zip(entries.filter(entry => entry.item).map(entry => entry.item.id));
      exporting = true; stopAudio(); deps.stopOtherAudio(); controller = new AbortController(); $('fields').inert = true; $('name').disabled = true; $('back').disabled = true; $('cancel-export').hidden = format !== 'webm'; $('export-progress').hidden = false; $('export-progress').textContent = '正在整理音频…'; refresh();
      try {
        await save(); const clips = await loadClips(entries); if (controller.signal.aborted) throw new Error('已取消制作');
        if (format === 'html') {
          let total = 0; const embedded = [];
          for (const clip of clips) { total += clip.bytes.length; if (total > 60 * 1024 * 1024) throw new Error('语音按钮文件较大，请减少短句后导出'); let binary = ''; for (let offset = 0; offset < clip.bytes.length; offset += 8192) binary += String.fromCharCode(...clip.bytes.subarray(offset, offset + 8192)); embedded.push({ ...clip, audio: 'data:audio/wav;base64,' + btoa(binary) }); }
          await saveBytes('html', media.soundboard(owner.name, embedded), owner.name + '-语音按钮');
        } else {
          const merged = media.merge(clips, owner.pause);
          if (format === 'wav') await saveBytes('wav', merged.bytes, owner.name);
          if (format === 'srt') await saveBytes('srt', media.srt(merged.timeline), owner.name);
          if (format === 'webm') {
            $('export-progress').textContent = '正在制作视频，约需作品播放时长。请保持窗口开启。';
            const blob = await media.video({ merged, title: owner.name, theme: owner.theme, caption: owner.caption, kind: core.kinds[owner.type].name, cover: owner.cover, signal: controller.signal,
              onProgress: fraction => $('export-progress').textContent = `正在制作视频 · ${Math.round(fraction * 100)}% · 可以取消` });
            if (controller.signal.aborted) throw new Error('已取消视频制作'); await saveBytes('webm', new Uint8Array(await blob.arrayBuffer()), owner.name);
          }
        }
      } finally { exporting = false; controller = null; $('fields').inert = false; $('name').disabled = false; $('back').disabled = false; $('cancel-export').hidden = true; $('export-progress').hidden = true; resultSignature = ''; refresh(); }
    }
    function exportActions() {
      const target = $('export-actions'); target.replaceChildren();
      const add = (text, format, complete = false, favorites = false) => { const value = button(text, () => exportWork(format, favorites)); value.dataset.complete = String(complete); value.dataset.favorites = String(favorites); target.append(value); };
      if (work.type === 'variants') { add('打包全部已完成版本', 'zip'); add('只打包收藏版本', 'zip', false, true); $('export-help').textContent = '保存 MP3 音频包。收藏不会改变配音，导出包含对应文案与参数清单。'; }
      else {
        add('打包分段 MP3', 'zip'); add('合并音频 WAV', 'wav', true); add('按句字幕 SRT', 'srt', true); add(work.type === 'buttons' ? '祝福卡视频 WebM' : '竖屏视频 WebM', 'webm', true);
        if (work.type === 'buttons') add('离线语音按钮 HTML', 'html', true);
        $('export-help').textContent = work.type === 'buttons' ? '语音按钮文件自带声音，可在浏览器离线打开。祝福卡视频按当前短句顺序播放，可先移除不需要的短句。' : '完整生成后可合并音频、保存按句字幕或制作竖屏视频。视频按播放时长制作；配图随对应台词切换。';
      }
    }
    async function open(id) {
      if (opening || exporting) return; opening = true;
      try { await save(); const loaded = await deps.api('lab-load', { id }); core.validate(loaded); work = loaded; revision = savedRevision = 0; previewIndex = 0; resultSignature = ''; visible = true; stopAudio();
        $('library').hidden = true; $('workspace').hidden = false; $('workspace').dataset.type = work.type; $('name').value = work.name; $('kind-name').textContent = core.kinds[work.type].name; $('save-state').textContent = '已保存到本机';
        $('preview').hidden = work.type === 'variants';
        $('preview-title').textContent = work.type === 'buttons' ? '祝福卡预览' : '竖屏画面预览';
        $('preview-help').textContent = '配图、寄语和停顿可以随时调整，无需重做声音。';
        exportActions(); renderFields();
      } finally { opening = false; }
    }
    async function create(type) {
      if (opening || exporting) return; opening = true;
      try { await save(); const doc = core.create(type); const result = await deps.api('lab-save', doc); if (!result?.saved) throw new Error('新作品没有保存成功'); opening = false; await open(doc.id); }
      finally { opening = false; }
    }
    async function show() {
      visible = true; if (work && !$('workspace').hidden) { refresh(); preview(); return; }
      await library();
    }
    async function library() {
      if (exporting) return; await save(); stopAudio(); work = null; visible = true; $('library').hidden = false; $('workspace').hidden = true;
      const list = await deps.api('lab-list'); $('count').textContent = `${list.length} 份实验作品`; const target = $('recent'); target.replaceChildren();
      if (!list.length) target.append(node('p', 'lab-empty', '选一个玩法，开始你的第一次声音实验。作品会自动保存在本机。'));
      for (const item of list) { const card = button('', () => open(item.id), 'lab-recent-card'); card.append(node('small', '', core.kinds[item.type]?.name || '实验作品'), node('strong', '', item.name), node('span', '', new Date(item.updatedAt).toLocaleString('zh-CN'))); target.append(card); }
    }
    Object.entries(core.kinds).forEach(([id, kind], index) => {
      const card = button('', () => create(id), 'lab-kind lab-' + kind.color), art = node('img', 'lab-kind-art'), copy = node('div', 'lab-kind-copy');
      art.src = `assets/laboratory/${id}.webp`; art.alt = ''; art.width = 960; art.height = 640; art.draggable = false; art.decoding = 'async';
      copy.append(node('small', '', `实验 0${index + 1}`), node('h2', '', kind.name), node('p', '', kind.description), node('span', 'lab-kind-start', '开始实验 →'));
      card.append(art, copy); $('kinds').append(card);
    });
    $('back').onclick = () => library().catch(error => deps.toast(error.message, true));
    $('name').oninput = () => { if (!work) return; work.name = $('name').value; changed(); };
    $('generate').onclick = () => generate().catch(error => deps.toast(error.message, true));
    $('stop-playback').onclick = stopAudio; $('show-tasks').onclick = deps.showTasks; $('cancel-export').onclick = () => controller?.abort();
    window.addEventListener('beforeunload', () => { clearTimeout(timer); controller?.abort(); stopAudio(); if (work && revision !== savedRevision) { const result = window.studio.saveLabSync?.(structuredClone(work)); if (!result?.saved) console.error('实验作品保存失败', result?.error || '无法保存'); } });
    return { editAudio, show, open, refresh, stopAudio, flush: save,
      resourceLocation: () => work ? { id: work.id, previewIndex } : null,
      async restoreResourceLocation(location) { if (work?.id !== location.id) await open(location.id); visible = true; previewIndex = location.previewIndex || 0; refresh(); preview(); },
      leave(persist = true) { visible = false; previewToken++; stopAudio(); controller?.abort(); if (persist) save().catch(error => deps.toast(error.message, true)); } };
  };
})(window);
