if (window.studio?.platform) document.documentElement.dataset.platform = window.studio.platform;

const $ = selector => document.querySelector(selector);
const api = async (action, data = {}) => {
  try { const result = await window.studio.invoke(action, data); return action === 'import-script' && result?.office ? { ...result, ...window.OfficeDocuments.parse(result.office) } : result; }
  catch (error) {
    if (error.code === 'LICENSE_REQUIRED' || /请先激活软件后再使用/.test(error.message)) {
      state.license = await window.studio.invoke('license'); renderLicense();
    }
    throw error;
  }
};
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const DEFAULT_VOICE_KEY = 'design:warm-female';
const QUICK_EXAMPLES = {
  'warm-male': { voiceKey: 'design:warm-male', scene: 'story', text: '街角那家书店，还亮着一盏灯。我推开门，老板抬头笑了笑。忙碌一天后，留点时间给喜欢的事，就刚刚好。' },
  'warm-female': { voiceKey: DEFAULT_VOICE_KEY, scene: 'dialogue', text: '忙了一天，陪我出去走走吧。点杯热饮，找个靠窗的位置，聊聊今天的小事。等路灯亮起来，再慢慢走回家。' },
  course: { voiceKey: 'preset:Uncle_Fu', scene: 'course', text: '第一节，认识课程目标。今天我们学习如何把一个大任务，拆成清晰的小步骤。\n第二节，跟着示例练习。先写下目标，再列出三个可以马上开始的行动。\n第三节，回顾与巩固。请暂停课程，试着用今天的方法安排你自己的学习计划。', batch: true },
};
let catalog, state = { busy: false, history: [], references: [], packages: [], results: [], rows: [], script: false, voiceKey: DEFAULT_VOICE_KEY, emotion: 'natural', license: null, hardware: null };
let roles = [], filter = 'all', sceneFilter = 'all', playing, toastTimer, draftTimer;
let quickVoiceScopeId = crypto.randomUUID(), quickVoiceRevisions = {}, quickVoiceBindings = {};
let sessionReady = false, draftRevision = 0;
let referenceTextDrafts = {}, referenceTextTimer, referenceTextSaving = null;
try {
  const saved = JSON.parse(localStorage.getItem('shengyue-reference-texts-1') || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) referenceTextDrafts = Object.fromEntries(Object.entries(saved).filter(([id, text]) => /^[\w-]{1,64}$/.test(id) && typeof text === 'string' && text.length <= 1000));
} catch {}
let workspaceReady = false, workspaceBuilt = false, workspaceStarting = null;
let firstRunGuide;
let samplePlaying = null, sampleSequence = 0, samplePendingKey = '', sampleFeedback = null, clipFeedback = null;
let generationTask = null, generationTimer;
let packageDownload = null, packageTask = null, voiceDetails = null, recentRequest = 0;
try {
  const saved = JSON.parse(localStorage.getItem('shengyue-resource-return-1') || 'null');
  if (saved && ['editor', 'projects', 'laboratory', 'home', 'voices'].includes(saved.origin?.view) && Array.isArray(saved.ids)) packageTask = saved;
} catch {}
let jobsStorageError = '';
let backgroundJobs = [], jobsRevision = -1, selectedJobId = null, submitting = false, dockDismissed = true;
let inlineJobId = null, inlineJobIds = new Set();
try { const saved = JSON.parse(sessionStorage.getItem('shengyue-inline-jobs') || '{}'); inlineJobId = saved.id || null; inlineJobIds = new Set(saved.ids || []); selectedJobId = inlineJobId; } catch {}
let outputJobIds = new Set();
try { outputJobIds = new Set(JSON.parse(sessionStorage.getItem('shengyue-output-jobs') || '[]')); } catch {}
function rememberOutputJob(id) { if (!id || outputJobIds.has(id)) return; outputJobIds.add(id); sessionStorage.setItem('shengyue-output-jobs', JSON.stringify([...outputJobIds].slice(-50))); }
function saveInlineJobs() { sessionStorage.setItem('shengyue-inline-jobs', JSON.stringify({ id: inlineJobId, ids: [...inlineJobIds].slice(-100) })); }
function inlineJob() { return backgroundJobs.find(job => job.id === inlineJobId && ['running', 'queued'].includes(job.status)); }
let voiceRecorder = null, recordingURL = null, recordingSession = 0, recordingSaving = false, recordingStarting = false, recordingTransport = null;
let recordingSoundUntil = 0, recordingVisualLevel = 0;
const recordingScripts = [
  '傍晚，书店里只剩下最后一位客人。他从书架上抽出一本旧书，一张泛黄的车票轻轻落在脚边，日期恰好是二十年前的今天。',
  '清晨的阳光落在窗台上，微风轻轻吹动窗帘。我给自己倒了一杯温水，打开喜欢的音乐，准备从容地开始新的一天。',
  '周末，我们沿着小路走进公园。树叶在风中轻轻摇晃，远处传来孩子们的笑声。原来，快乐就藏在这些平凡的小事里。',
  '夜幕降临，小镇的灯光一盏盏亮起。忙碌了一天的人们慢慢回家，饭菜的香气飘出窗外，熟悉的声音让人觉得格外安心。',
  '如果今天有一点累，就先停下来，深深地呼吸。喝口水，看看窗外，再给自己一点时间。每一个小小的进步，都值得被认真记住。',
  '把一张长方形纸沿着中线对折，再展开，纸上就出现了两个同样大的长方形。每一部分都是原来的一半，两部分合起来，还是完整的一张纸。',
  '小兔子背上行囊，准备去山的另一边看看。出发前，朋友送给它一张地图，还笑着说，别着急，沿途的风景也值得好好欣赏。',
  '旅行最让人期待的，往往是那些偶然遇见的瞬间。一家安静的小店，一段陌生的街道，或是一句亲切的问候，都可能成为难忘的回忆。',
  '好久没有和你认真聊聊天了。最近过得怎么样？有开心的事情，也有想说的烦恼吧。慢慢说，我会在这里，好好听你把故事讲完。',
  '雨后的空气清新又明亮，屋檐上的水珠慢慢落下。一只小鸟停在树枝上，唱起轻快的歌。抬头看看，天空已经悄悄露出了蓝色。'
];
function randomRecordingScript(current = '') {
  const candidates = recordingScripts.filter(text => text !== current.trim());
  return candidates[Math.floor(Math.random() * candidates.length)];
}
let historyPage = 1, clipSequence = 0, pendingClip = null;
const historySelection = new Set();
let historyOperation = null;
let pickerFilter = 'all';
let templateCategory = 'all', templateUndo = null;
let homeCategory = 'all', homeStarting = false;
let pendingDeletion = null;
let projectWorkspace = null;
let audioStudio = null, referenceImporter = null;
let laboratory = null, recordingOnSaved = null;
const icon = name => { const node = el('span', `ui-icon icon-${name}`); node.setAttribute('aria-hidden', 'true'); return node; };
const sceneName = id => catalog.scenes.find(scene => scene.id === id)?.name || id;
const sceneIcons = { dialogue: 'message-circle', game: 'gamepad-2', story: 'book-open', video: 'video', course: 'graduation-cap', ad: 'megaphone', service: 'headset', bedtime: 'moon' };
const emotionIcons = { natural: 'message-circle', happy: 'smile', excited: 'zap', gentle: 'heart', calm: 'leaf', sad: 'frown', melancholy: 'cloud', angry: 'flame', afraid: 'shield-alert', nervous: 'activity', urgent: 'clock', surprised: 'circle-alert', relief: 'wind', hopeful: 'sunrise', doubtful: 'circle-help', firm: 'shield-check', tired: 'battery-low', whisper: 'volume-1' };
function deleteButton(kind, item) {
  const button = el('button', 'delete-item'); button.type = 'button'; button.append(icon('trash-2'));
  const label = `删除${kind === 'work' ? '作品' : '声音'}：${kind === 'work' ? WorkHistory.project(item) : item.name}`;
  button.setAttribute('aria-label', label); button.title = label;
  button.disabled = state.busy || !!pendingJobs().length;
  button.onclick = () => openDelete(kind, item); return button;
}
function jobDeleteButton(job) {
  const button = el('button', 'text-button delete-job', '删除记录'); button.type = 'button';
  button.setAttribute('aria-label', `删除任务记录：${job.name}`);
  button.title = '删除任务记录，保留已生成的音频';
  button.disabled = state.busy;
  button.onclick = () => openDelete('job', job); return button;
}
function openDelete(kind, item) {
  if (state.busy || kind !== 'job' && pendingJobs().length) return;
  if (kind === 'job' && !['complete', 'partial', 'cancelled', 'failed', 'interrupted'].includes(item.status)) return;
  pendingDeletion = { kind, item };
  $('#delete-heading').textContent = kind === 'job' ? '删除这条任务记录？' : kind === 'work' ? '删除这条作品？' : '删除这个声音？';
  const audioLocation = item.projectId ? '对应项目' : item.rows?.some(row => row.labId) ? '声音实验室' : '我的作品';
  $('#delete-description').textContent = kind === 'job' ? `将移除这条配音任务记录，无法再从此记录继续未完成段落。已生成的音频会保留在“${audioLocation}”中，可以继续试听、保存或删除。` : kind === 'work' ? '将删除这条作品的音频和记录。已经导出到其他位置的文件会保留。' : kind === 'role' ? '将移除保存的声音和语气设置，已生成的作品会保留。' : '将删除这段参考录音及使用它的声音设置，已生成的作品会保留。';
  if (kind === 'work') {
    const group = item.options?.generationGroupId || item.id, family = state.history.filter(other => other.id === group || other.options?.generationGroupId === group);
    if (family.length > 1) { $('#delete-heading').textContent = '删除当前这个版本？'; $('#delete-description').textContent = `将删除当前版本的音频和编辑记录，另 ${family.length - 1} 个版本会保留，并选用最近的可用版本。已经导出的文件会保留。`; }
  }
  $('#delete-item-name').textContent = kind === 'job' ? `${item.name} · ${item.rows.map(row => row.text).join(' ')}` : kind === 'work' ? `${WorkHistory.project(item)} · ${item.text}` : item.name;
  $('#delete-error').classList.add('hidden'); $('#delete-confirm').textContent = '确认删除';
  $('#delete-dialog').showModal(); $('#delete-cancel').focus();
}
async function confirmDelete() {
  if (!pendingDeletion || state.busy || pendingDeletion.kind !== 'job' && pendingJobs().length) return;
  if (pendingDeletion.kind === 'works') return confirmHistoryDelete();
  const { kind, item } = pendingDeletion;
  state.busy = true; state.action = 'delete'; update();
  $('#delete-confirm').disabled = true; $('#delete-cancel').disabled = true; $('#delete-confirm').textContent = '正在删除…';
  try {
    if (kind === 'job') {
      const result = await api('jobs-delete', { id: item.id });
      outputJobIds.delete(item.id); sessionStorage.setItem('shengyue-output-jobs', JSON.stringify([...outputJobIds].slice(-50)));
      inlineJobIds.delete(item.id); if (inlineJobId === item.id) inlineJobId = null; saveInlineJobs();
      if (selectedJobId === item.id) selectedJobId = null;
      applyJobs(result);
      $('#delete-dialog').close(); pendingDeletion = null;
      toast('任务记录已删除，已生成的音频已保留');
      return;
    }
    if (kind !== 'role') await api(kind === 'work' ? 'delete-work' : 'delete-reference', { id: item.id });
    if (kind === 'work' && (playing?.id === item.id || pendingClip?.id === item.id)) stopClip();
    if (kind !== 'work') {
      if (kind === 'reference' && samplePlaying?.key === `clone:${item.id}`) stopPreview();
      const removed = roles.filter(role => kind === 'role' ? role.id === item.id : role.voiceKey === `clone:${item.id}` || role.options.referenceId === item.id);
      const replacements = new Map(removed.map(role => [`role:${role.id}`, kind === 'role' ? role.voiceKey : DEFAULT_VOICE_KEY]));
      const replacement = key => replacements.get(key) || (kind === 'reference' && key === `clone:${item.id}` ? DEFAULT_VOICE_KEY : key);
      state.rows.forEach(row => { row.voiceKey = replacement(row.voiceKey); });
      const previous = state.voiceKey; state.voiceKey = replacement(previous);
      roles = roles.filter(role => !removed.includes(role)); localStorage.setItem('shengyue-roles-1', JSON.stringify(roles));
      if (previous !== state.voiceKey) selectVoice(state.voiceKey, false);
      renderScript(); saveDraft(true);
    }
    $('#delete-dialog').close(); pendingDeletion = null;
    await refresh();
    toast(kind === 'work' ? '作品已删除' : '声音已删除');
  } catch (error) {
    $('#delete-error').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); $('#delete-error').classList.remove('hidden');
  } finally {
    state.busy = false; state.action = null; $('#delete-confirm').disabled = false; $('#delete-cancel').disabled = false; $('#delete-confirm').textContent = '确认删除'; update();
    if ($('#jobs-dialog').open) renderJobs();
  }
}
function voiceAvatar(voice) {
  const avatar = el('span', `avatar ${voice.gender || ''}`, voice.name[0]); avatar.setAttribute('aria-hidden', 'true');
  if (voice.portrait) {
    const img = el('img'); img.src = voice.portrait; img.alt = ''; img.width = 160; img.height = 160;
    img.decoding = 'async'; img.loading = 'lazy'; img.addEventListener('error', () => img.remove());
    avatar.classList.add('illustrated'); avatar.append(img);
  } else { avatar.replaceChildren(icon(voice.mode === 'clone' ? 'mic' : 'sparkles')); }
  return avatar;
}
const clock = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const packages = [
  { id: 'standard', name: '日常配音', tag: '多数人从这里开始', description: '给视频配旁白、讲故事、做课程。9 个声音任选，还能调整语气，让表达更生动。', mac: '约 2.3 GB', win: '约 4.5 GB' },
  { id: 'light', name: '轻松朗读', tag: '更省电脑资源', description: '自然地读出你的文字，适合日常朗读。想调整开心、温柔等语气，请选择日常配音。', mac: '约 1.7 GB', win: '约 2.5 GB' },
  { id: 'character', name: '人物与童声', tag: '给故事里的角色配音', description: '童声、长辈、卡通和故事人物都在这里。也可以用自己的话，描述想要的声音。', mac: '约 2.3 GB', win: '约 4.5 GB' },
  { id: 'reference', name: '我的专属声音', tag: '让熟悉的声音说新文案', description: '用一段有权使用的清晰录音作为参考，让新文案延续熟悉的音色和表达。', mac: '约 2.3 GB', win: '约 4.5 GB' },
  { id: 'expressive', name: '我的声音·情绪表达', optional: true, tag: '可选下载', description: '保持录音的音色，调整情绪、强度与节奏。', mac: '约 2.30 GB', win: '约 4.96 GB' }
];
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), error ? 12000 : 4000); }
const voiceConsentReminders = new WeakMap();
function requireVoiceConsent(consent) {
  if (consent.checked) return true;
  clearTimeout(voiceConsentReminders.get(consent));
  consent.classList.remove('consent-reminder');
  void consent.offsetWidth;
  consent.classList.add('consent-reminder');
  voiceConsentReminders.set(consent, setTimeout(() => {
    consent.classList.remove('consent-reminder');
    voiceConsentReminders.delete(consent);
  }, 900));
  toast('请先确认你拥有这段声音的使用授权');
  return false;
}
function status(message) { if ($('#status-text').textContent !== message) $('#status-text').textContent = message; $('#status-dot').className = state.busy ? 'busy' : readyFor() ? 'ready' : ''; }
function navigate(view, openExisting = false) {
  if (view === 'downloads') view = 'account';
  window.CustomSelects?.close(false);
  if (view !== 'projects') projectWorkspace?.stopAudio();
  if (view !== 'laboratory') laboratory?.leave();
  document.querySelectorAll('.view').forEach(node => node.classList.toggle('hidden', node.id !== `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (view === 'home' && catalog) { renderHomeDraft(); renderHomeRecent(); }
  if (view === 'account') loadCliConfiguration();
  if (view === 'laboratory' && !openExisting) laboratory?.show().catch(error => toast(error.message, true));
  window.scrollTo(0, 0);
}
let cliConfigurationLoading = false;
async function loadCliConfiguration() {
  if (cliConfigurationLoading) return;
  cliConfigurationLoading = true;
  $('#cli-load-status').textContent = '正在获取本机接入配置…';
  $('#cli-retry').hidden = true;
  $('#cli-content').hidden = true;
  try {
    const config = await api('cli-config');
    $('#cli-platform').textContent = config.platform;
    $('#cli-status-command').textContent = config.status;
    $('#cli-generate-command').textContent = config.generate;
    $('#cli-guide-text').textContent = config.guide;
    $('#cli-content').hidden = false;
    $('#cli-load-status').textContent = '以下命令已使用当前软件的实际路径，可直接复制。';
  } catch (error) {
    $('#cli-load-status').textContent = `无法获取接入配置：${error.message}`;
    $('#cli-retry').hidden = false;
  } finally { cliConfigurationLoading = false; }
}
async function cliAction(button, action, data = {}) {
  button.disabled = true;
  try {
    const result = await api(action, data);
    if (action === 'cli-copy') toast(data.kind === 'guide' ? '智能体接入说明已复制' : '命令已复制');
    if (action === 'cli-save-script' && result.saved) toast('脚本示例已保存，请在脚本所在目录运行配音命令。');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}
function referenceTextFor(id, fallback = '') {
  if (!id) return '';
  if (Object.hasOwn(referenceTextDrafts, id)) return referenceTextDrafts[id];
  const reference = state.references.find(reference => reference.id === id);
  return reference?.textUpdatedAt ? reference.text : reference?.text || fallback;
}
function validateReferenceTexts(data) {
  const rows = data.rows || [data];
  if (rows.some(row => { const options = { ...data, ...row }; return options.mode === 'clone' && (!options.referenceId || !String(options.referenceText || '').trim()); })) throw new Error('请先在“我的声音”中填写这段参考录音的准确原话。');
}
function persistReferenceDrafts() {
  localStorage.setItem('shengyue-reference-texts-1', JSON.stringify(referenceTextDrafts));
}
function rememberReferenceText() {
  const voice = currentVoice(); if (voice.mode !== 'clone') return;
  const text = $('#reference-text').value.trim();
  if (text.length > 1000) return;
  referenceTextDrafts[voice.id] = text; persistReferenceDrafts();
  clearTimeout(referenceTextTimer);
  referenceTextTimer = setTimeout(() => flushReferenceTexts().catch(error => toast('参考原话保存失败，已保留在本机，下次编辑或打开软件会重试：' + error.message, true)), 300);
}
async function flushReferenceTexts() {
  clearTimeout(referenceTextTimer);
  if (referenceTextSaving) return referenceTextSaving;
  // One writer serializes edits, including changes typed while an IPC call is pending.
  referenceTextSaving = (async () => {
    while (Object.keys(referenceTextDrafts).length) {
      const [id, text] = Object.entries(referenceTextDrafts)[0];
      if (!state.references.some(reference => reference.id === id)) { delete referenceTextDrafts[id]; persistReferenceDrafts(); continue; }
      const updated = await api('update-reference', { id, text });
      if (updated?.id !== id || updated.text !== text) throw new Error('参考原话未能保存');
      state.references = state.references.map(reference => reference.id === id ? { ...reference, ...updated } : reference);
      if (referenceTextDrafts[id] === text) delete referenceTextDrafts[id];
      persistReferenceDrafts();
    }
  })();
  try { await referenceTextSaving; } finally { referenceTextSaving = null; }
}
const preferredVoiceOrder = new Map([['design:warm-male', 0], ['design:warm-female', 1]]);
function compareVoices(a, b, scene = 'all') {
  return (preferredVoiceOrder.get(a.key) ?? preferredVoiceOrder.size) - (preferredVoiceOrder.get(b.key) ?? preferredVoiceOrder.size)
    || Number(b.scenes?.[0] === scene) - Number(a.scenes?.[0] === scene);
}
function voices() { return [...catalog.voices.map(v => ({ ...v, key: `preset:${v.id}`, mode: 'preset' })), ...catalog.characters.map(v => ({ ...v, key: `design:${v.id}`, mode: 'design', native: v.native || '中文', language: v.language || 'Chinese' })), ...state.references.map(v => ({ ...v, text: referenceTextFor(v.id, v.text), key: `clone:${v.id}`, mode: 'clone', description: '我的录音', gender: 'reference', native: '我的录音' }))].sort(compareVoices); }
function currentVoice(key = state.voiceKey) { const resolved = key?.startsWith('role:') ? roles.find(role => `role:${role.id}` === key)?.voiceKey : key; return voices().find(v => v.key === resolved) || { key: 'design:custom', name: '自定义人物', mode: 'design', gender: 'cartoon', description: '自由描述声线', prompt: '' }; }
function canPerform(options) { return options.mode === 'clone' ? options.referenceStyle === 'expressive' : !(options.mode === 'preset' && options.engine === 'light'); }
function requiredPackage(options = settings()) { return options.mode === 'design' ? 'character' : options.mode === 'clone' ? options.referenceStyle === 'expressive' ? 'expressive' : 'reference' : options.engine; }
function requiredPackages(options = settings()) { return options.mode === 'design' && options.lockVoice !== false ? ['character', 'reference'] : [requiredPackage(options)]; }
function packageReady(id) { return state.packages.some(pack => pack.id === id && pack.ready && pack.verified !== false); }
function readyFor(options) { return requiredPackages(options).every(packageReady); }
function neededPackages() { const options = state.script ? state.rows.filter(r => r.text.trim()).map(rowOptions) : [settings()]; if (!options.length) options.push(settings()); return [...new Set(options.flatMap(requiredPackages).filter(id => !packageReady(id)))]; }
function quickVoiceIdentity(key = state.voiceKey) {
  const binding = Object.hasOwn(quickVoiceBindings, key) && quickVoiceBindings[key];
  if (binding && typeof binding.voiceScopeId === 'string' && typeof binding.voiceId === 'string' && typeof binding.voiceRevision === 'string') return binding;
  return { voiceScopeId: quickVoiceScopeId, voiceId: key, voiceRevision: quickVoiceRevisions[key] || '' };
}
function settings() {
  const voice = currentVoice();
  const performance = canPerform({ ...voice, engine: $('#engine').value, referenceStyle: $('#reference-style').value });
  return { mode: voice.mode, speaker: voice.mode === 'preset' ? voice.id : 'Vivian', character: voice.mode === 'design' ? voice.id : undefined,
    ...(voice.mode === 'design' ? { lockVoice: $('#lock-voice').checked, ...quickVoiceIdentity() } : {}),
    voiceName: voice.name, voiceDescription: voice.mode === 'design' ? $('#voice-description').value : '',
    referenceId: voice.mode === 'clone' ? voice.id : undefined, referenceText: $('#reference-text').value,
    ...(voice.mode === 'clone' ? { referenceStyle: $('#reference-style').value || 'original' } : {}),
    language: $('#language').value || 'Chinese', emotion: performance ? state.emotion : 'natural', scene: $('#scene').value || 'dialogue',
    intensity: Number($('#intensity').value), pace: $('#pace').value, instruction: performance ? $('#instruction').value : '',
    engine: $('#engine').value, prefix: $('#prefix').value, sampleRate: Number($('#sample-rate').value), project: $('#project-name').value.trim() };
}
function selectVoice(key, goBack = true) {
  if (currentVoice(key).key !== currentVoice().key) stopPreview();
  state.voiceKey = key; delete quickVoiceBindings[key]; const voice = currentVoice();
  $('#voice-description').value = voice.prompt || '';
  $('#language').value = voice.language || 'Chinese';
  if (voice.scenes?.length) $('#scene').value = sceneFilter !== 'all' && voice.scenes.includes(sceneFilter) ? sceneFilter : voice.scenes[0];
  if (voice.mode === 'clone') { $('#reference-select').value = voice.id; $('#reference-text').value = voice.text || ''; }
  renderSelection(); update(); saveDraft(); if (goBack) { navigate('editor'); update(); }
}
function option(select, value, text) { const node = document.createElement('option'); node.value = value; node.textContent = text; select.append(node); }
function renderSelection() {
  const voice = currentVoice(), target = $('#selected-voice'); target.replaceChildren();
  $('#selected-scenes').replaceChildren(...(voice.scenes || []).map(id => el('span', '', sceneName(id))));
  $('#preview-voice').dataset.previewKey = voice.key;
  $('#preview-voice').disabled = !voice.preview && voice.mode !== 'clone';
  syncPreviewButtons();
  $('.preview-note').textContent = voice.mode === 'clone' ? '直接试听你保存的原始录音。' : voice.reference ? '默认固定使用这份精选声音；修改声线描述或关闭固定人物声音可另行设计。' : voice.preview ? '已备好声音示例，点击即可试听。' : '先生成一段配音，满意后存为声音，就能随时试听。';
  $('#selected-voice-avatar').replaceChildren(voiceAvatar(voice));
  target.append(el('strong', '', voice.name), el('small', '', voice.description));
  $('#design-fields').classList.toggle('hidden', voice.mode !== 'design'); $('#reference-fields').classList.toggle('hidden', voice.mode !== 'clone');
  $('#engine').disabled = voice.mode !== 'preset';
  const expressive = $('#reference-style').value === 'expressive';
  const can = canPerform({ ...voice, engine: $('#engine').value, referenceStyle: $('#reference-style').value });
  $('#performance-fields').classList.toggle('hidden', !can); $('#performance-note').classList.toggle('hidden', can);
  $('#performance-note').textContent = voice.mode === 'clone' ? '沿用录音中的表达。想调整语气，可切换上方的“调整语气与情绪”。' : '现在使用轻松朗读。想调整语气，可在更多设置中切换到生动表达。';
  $('#reference-style-note').textContent = expressive ? `使用同一份录音保留音色，按下面的设置调整表达。${packageReady('expressive') ? '可选资源已就绪。' : '首次使用需单独确认下载可选资源，选择此项不会开始下载。'}情绪效果请以试听为准。` : '新配音会参考这段录音的音色与语气。';
  $('#scene').disabled = !can;
  $('#reset-voice').hidden = !$('#lock-voice').checked;
  $('#voice-lock-hint').textContent = $('#lock-voice').checked ? '全部台词沿用同一声线' : '逐句自由设计，声线可能变化';
  window.CustomSelects?.sync();
}
function resetVoiceParameters() {
  const voice = currentVoice();
  state.emotion = 'natural';
  $('#language').value = voice.language || 'Chinese';
  $('#scene').value = voice.scenes?.[0] || 'dialogue';
  $('#engine').value = 'standard';
  $('#intensity').value = '50'; $('#intensity-label').textContent = '自然';
  $('#pace').value = 'normal'; $('#instruction').value = '';
  $('#voice-description').value = voice.prompt || '';
  $('#lock-voice').checked = true; $('#reference-style').value = 'original';
  $('#saved-role-select').value = '';
  renderSelection(); renderEmotions(); renderScript(); update(); saveDraft();
  toast('已恢复当前声音的默认配音参数');
}
function update() {
  if (!catalog) return;
  laboratory?.refresh();
  const count = state.script ? state.rows.filter(r => r.text.trim()).length : $('#batch').checked ? $('#text').value.split('\n').filter(t => t.trim()).length : Number(!!$('#text').value.trim());
  const needed = neededPackages(), ready = !needed.length;
  const queued = pendingJobs().length;
  const foreground = inlineJob();
  $('#generate').disabled = state.busy || submitting || !!foreground || !count || queued >= 10;
  if (!foreground && !submitting) {
    $('#generate').classList.remove('generating'); $('#generate').setAttribute('aria-busy', 'false');
    const mark = icon(state.busy ? 'audio-lines' : ready ? 'sparkles' : 'download');
    $('#generate').firstElementChild.replaceWith(mark);
    $('#generate-label').textContent = state.busy ? '正在处理…' : queued >= 10 ? '待处理任务已满' : !ready && count ? '先准备声音' : `生成配音${count > 1 ? ' · ' + count + ' 段' : ''}`;
    $('#generate-arrow').classList.remove('hidden');
  }
  $('#char-count').textContent = `${$('#text').value.length} / 5000 字`;
  $('#line-count').textContent = count ? `准备好啦，共 ${count} 段配音` : '写点什么，试试你的第一段配音';
  $('#generation-summary').textContent = queued ? '后台任务正在处理，新配音会按顺序生成' : '点击后在这里等待，完成即可试听和保存';
  $('#result-count').textContent = state.results.length;
  $('#export-zip').disabled = state.busy || !!activeGenerationJobs().length || !state.results.length;
  $('#cancel').classList.toggle('hidden', !state.busy);
  $('#cancel').disabled = (!!generationTask?.running && generationTask.stopping) || (state.action === 'setup' && !!packageDownload?.stopping);
  $('#cancel').textContent = state.action === 'setup' ? packageDownload?.stopping ? '正在暂停…' : '暂停下载'
    : generationTask?.running && generationTask.stopping ? '正在停止…' : state.action === 'generate' ? '停止生成' : '停止处理';
  $('#setup-banner').classList.toggle('hidden', state.busy || ready || $('#view-editor').classList.contains('hidden'));
  $('#setup-message').textContent = `这次配音需要${needed.map(id => '“' + (packages.find(p => p.id === id)?.name || '对应声音') + '”').join('、')}，准备好就能开始。`;
  $('#history-count').textContent = workHistory().length;
  document.querySelectorAll('.package-download').forEach(button => button.disabled = state.busy || !!queued);
  renderPackageDownload();
  $('#refresh-device').disabled = state.busy;
  $('#import-reference').disabled = state.busy || !!queued;
  $('#record-reference').disabled = state.busy || !!queued;
  document.querySelectorAll('.delete-item').forEach(button => { button.disabled = state.busy || !!queued; button.title = queued ? '配音完成后可删除' : button.getAttribute('aria-label'); });
  updateHistoryExport();
  if (!state.busy) $('#status-detail').textContent = '文字和声音，都留在本机';
  renderGeneration();
  projectWorkspace?.refreshMedia();
  window.CustomSelects?.sync();
}

function jobTask(job) {
  return job && { ...job, started: job.started || job.createdAt, running: job.status === 'running',
    stage: job.status === 'running' ? job.stage : job.status, ids: job.items.map(item => item.id) };
}
function activeGenerationJobs() { return backgroundJobs.filter(job => ['running', 'queued'].includes(job.status)); }
function pendingJobs() { return backgroundJobs.filter(job => ['running', 'queued', 'scheduled', 'paused'].includes(job.status)); }
function applyJobs(snapshot, selectId) {
  if (!snapshot || !Array.isArray(snapshot.jobs)) return;
  if (snapshot.revision < jobsRevision) {
    if (selectId) { selectedJobId = selectId; rememberOutputJob(selectId); update(); }
    return;
  }
  const storageError = typeof snapshot.storageError === 'string' ? snapshot.storageError : '';
  if (storageError && storageError !== jobsStorageError) toast(storageError, true);
  jobsStorageError = storageError;
  const previous = new Map(backgroundJobs.map(job => [job.id, job.status]));
  const initialized = jobsRevision >= 0;
  jobsRevision = snapshot.revision; backgroundJobs = snapshot.jobs;
  if (selectId) selectedJobId = selectId;
  if (!selectedJobId && backgroundJobs.length) selectedJobId = backgroundJobs.at(-1).id;
  rememberOutputJob(selectedJobId);
  pendingJobs().forEach(job => rememberOutputJob(job.id));
  if (!submitting && initialized && backgroundJobs.some(job => !inlineJobIds.has(job.id) && previous.get(job.id) !== job.status)) dockDismissed = false;
  const known = new Set(state.history.map(item => item.id)); let historyChanged = false;
  for (const job of backgroundJobs) for (const item of job.items) if (!known.has(item.id)) { state.history.unshift(item); known.add(item.id); historyChanged = true; }
  clearInterval(generationTimer); generationTimer = null;
  if (pendingJobs().length) generationTimer = setInterval(renderGeneration, 1000);
  for (const job of backgroundJobs) if (initialized && previous.has(job.id) && previous.get(job.id) !== job.status && ['complete', 'partial', 'failed'].includes(job.status)) {
    if (!storageError) toast(job.status === 'complete' ? `「${job.name}」已完成，共 ${job.completed} 段配音。` : inlineJobIds.has(job.id) ? job.error || '这次配音没有完成，请重试。' : `「${job.name}」暂未完成，可在后台任务中重试。`, job.status === 'failed');
    refresh().catch(() => {});
  }
  if (historyChanged) { renderHistoryFilters(); renderHistory(); } update();
  if ($('#jobs-dialog').open) renderJobs();
}
function renderGeneration() {
  renderInlineGeneration();
  renderOutputJobs();
  const background = backgroundJobs.filter(job => !inlineJobIds.has(job.id));
  generationTask = jobTask(background.find(job => job.status === 'running') || background.find(job => ['queued', 'scheduled', 'paused'].includes(job.status)) || background.at(-1));
  const task = generationTask, pending = pendingJobs().filter(job => !inlineJobIds.has(job.id)), running = pending.find(job => job.status === 'running');
  const visible = !submitting && !!task && (!dockDismissed || pending.length > 0);
  $('#generation-dock').classList.toggle('hidden', !visible); $('#idle-status').classList.toggle('hidden', visible);
  if (!visible) return;
  const info = GenerationProgress.view(task);
  $('#generation-dock').dataset.stage = task.stopping ? 'stopping' : task.stage;
  const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  setText('#generation-title', info.title);
  setText('#generation-count', task.stage === 'queued' ? '轮到后自动开始' : info.count);
  setText('#generation-elapsed', ['queued', 'scheduled', 'paused'].includes(task.stage) ? '' : ` · ${info.elapsed}`);
  setText('#generation-queue-count', pending.length ? [running && '1 项生成中', ...[['queued', '排队'], ['scheduled', '预约'], ['paused', '暂停']].map(([status, label]) => { const count = pending.filter(job => job.status === status).length; return count && `${count} 项${label}`; })].filter(Boolean).join(' · ') : '任务已保存');
  $('#generation-results').classList.toggle('hidden', !task.completed);
  $('#generation-dismiss').classList.toggle('hidden', !!pending.length);
}
function renderInlineGeneration() {
  const job = inlineJob(), button = $('#generate');
  button.dataset.stage = submitting ? 'preparing' : job?.stopping ? 'stopping' : job?.stage || 'idle';
  if (job || submitting) {
    button.classList.add('generating'); button.setAttribute('aria-busy', 'true');
    if (!button.querySelector('.voice-orb')) { const orb = el('span', 'voice-orb'); orb.setAttribute('aria-hidden', 'true'); orb.append(el('i'), el('i'), el('i'), el('b')); button.firstElementChild.replaceWith(orb); }
    $('#generate-arrow').classList.add('hidden');
    $('#generate-label').textContent = submitting ? '正在准备…' : job.stopping ? '正在停止…' : job.status === 'queued' ? '等待生成…' : job.total > 1 ? `生成中 · ${job.completed} / ${job.total}` : '正在生成…';
  }
  const elapsed = job ? Math.max(0, (Date.now() - (job.started || job.createdAt)) / 1000) : 0;
  // Avoid a fabricated ETA: use document length, queue state and actual waiting time.
  const slow = job && (job.characters >= 200 || job.total > 1 || job.status === 'queued' || elapsed >= 20);
  $('#background-generation').classList.toggle('hidden', !slow || job.stopping || submitting);
  $('#stop-generation').classList.toggle('hidden', !job);
  $('#stop-generation').disabled = !!job?.stopping;
  $('#stop-generation').textContent = job?.stopping ? '正在停止…' : '停止生成';
  if (job) {
    const info = GenerationProgress.view(jobTask(job));
    $('#line-count').textContent = job.status === 'queued' ? '等待前一项配音完成' : info.title;
    $('#generation-summary').textContent = `${info.count} · 已等待 ${info.elapsed}${slow && !job.stopping ? ' · 需要一点时间，可转为后台处理' : ''}`;
  } else if (submitting) {
    $('#line-count').textContent = '正在准备这次配音'; $('#generation-summary').textContent = '准备好后会立即开始生成';
  }
}
function moveGenerationToBackground() {
  const job = inlineJob(); if (!job || job.stopping) return;
  inlineJobIds.delete(job.id); inlineJobId = null; dockDismissed = false; saveInlineJobs();
  applyJobs({ revision: jobsRevision, jobs: backgroundJobs });
  toast('已转为后台处理，可以继续创作。');
}
function renderJobs() {
  const target = $('#jobs-list'); target.replaceChildren();
  const pending = pendingJobs(); $('#jobs-summary').textContent = pending.length ? `${pending.length} 个待处理任务（含预约和暂停）` : '任务记录与生成结果';
  const labels = { queued: '等待中', scheduled: '已预约', paused: '已暂停', running: '生成中', complete: '已完成', partial: '有段落待补做', cancelled: '已取消', failed: '未完成', interrupted: '已中断' };
  for (const job of [...backgroundJobs].reverse()) {
    const row = el('article', 'job-row'); row.dataset.jobId = job.id; row.dataset.status = job.status;
    const mark = el('span', 'job-mark'); mark.append(icon(job.status === 'complete' ? 'check' : job.status === 'running' ? 'audio-lines' : job.status === 'queued' ? 'headphones' : 'pause'));
    const copy = el('div', 'job-copy'), top = el('div', 'job-title'); top.append(el('strong', '', job.name), el('span', 'job-status', job.stopping ? '正在停止' : job.pausing ? '保存当前段后暂停' : labels[job.status]));
    copy.append(top, el('small', '', `${job.voiceName} · ${job.characters} 字 · 已完成 ${job.completed} / ${job.total} 段`));
    if (job.managed) {
      const progress = el('progress', 'managed-job-progress'); progress.max = job.total; progress.value = job.cursor; progress.setAttribute('aria-label', '托管已处理段落'); copy.append(progress);
      copy.append(el('small', 'managed-job-note', job.status === 'scheduled' ? '托管 · ' + new Date(job.scheduledAt).toLocaleString('zh-CN') + ' 开始' : job.stage === 'retrying' ? '托管 · 第 ' + job.current + ' 段自动重试 ' + job.retryAttempt + ' / 2' : '托管 · 逐段保存 · 失败自动重试'));
      if (job.failedRows?.length) {
        const details = el('details', 'managed-failures'); details.append(el('summary', '', job.failedRows.length + ' 段待补做 · 查看原因'));
        for (const failure of job.failedRows) { const part = job.rows[failure.index]; details.append(el('p', '', (part?.chapterName ? part.chapterName + ' · ' : '') + '第 ' + (failure.index + 1) + ' 段：' + (part?.text || '').slice(0, 60) + ' — ' + failure.error)); }
        copy.append(details);
      }
    }
    if (job.error) copy.append(el('p', 'job-error', job.error));
    const actions = el('div', 'job-actions');
    if (job.items.length) { const view = el('button', 'text-button', '听听作品'); view.onclick = () => showJob(job.id); actions.append(view); }
    if (job.managed && ['running', 'queued', 'scheduled', 'paused'].includes(job.status)) {
      const pause = el('button', 'button', job.pausing ? '正在暂停…' : job.status === 'paused' ? '继续生成' : '暂停托管'); pause.disabled = job.stopping || job.pausing;
      pause.onclick = async () => { pause.disabled = true; try { applyJobs(await api(job.status === 'paused' ? 'jobs-resume' : 'jobs-pause', { id: job.id })); } catch (error) { toast(error.message, true); renderJobs(); } }; actions.append(pause);
    }
    if (['running', 'queued', 'scheduled', 'paused'].includes(job.status)) {
      const cancel = el('button', 'button', job.stopping ? '正在停止…' : job.status === 'queued' ? '取消排队' : job.status === 'scheduled' ? '取消预约' : '停止'); cancel.disabled = job.stopping;
      cancel.onclick = () => cancelJob(job.id); actions.append(cancel);
    } else if (['failed', 'partial', 'interrupted', 'cancelled'].includes(job.status) && job.completed < job.total) {
      const retry = el('button', 'button', job.status === 'partial' ? '只补做失败段落' : '继续未完成段落'); retry.disabled = pending.length >= 10 || state.busy;
      retry.onclick = async () => { retry.disabled = true; try { const result = await api('jobs-retry', { id: job.id, requestId: window.crypto?.randomUUID?.() }); applyJobs(result, result.id); } catch (error) { toast(error.message, true); renderJobs(); } }; actions.append(retry);
    }
    if (['complete', 'partial', 'cancelled', 'failed', 'interrupted'].includes(job.status)) actions.append(jobDeleteButton(job));
    row.append(mark, copy, actions); target.append(row);
  }
  if (!backgroundJobs.length) target.append(empty('还没有后台任务', '提交一份文案后，你可以继续创作下一份。'));
}
function showGeneration() { renderJobs(); if (!$('#jobs-dialog').open) $('#jobs-dialog').showModal(); }
function showJob(id) {
  const job = backgroundJobs.find(job => job.id === id); if (!job) return;
  selectedJobId = id; rememberOutputJob(id);
  if ($('#jobs-dialog').open) $('#jobs-dialog').close();
  const labId = job.rows?.find(row => row.labId)?.labId;
  if (labId && laboratory) {
    laboratory.open(labId).then(() => navigate('laboratory')).catch(error => toast(error.message, true));
    return;
  }
  if (job.projectId && projectWorkspace) {
    projectWorkspace.open(job.projectId).catch(() => { navigate('editor'); update(); });
    return;
  }
  navigate('editor'); update();
  const output = [...$('#results').children].find(node => node.dataset.outputJobId === id);
  if (output) output.scrollIntoView({ block: 'center', behavior: 'instant' });
  else if (job.items.length) {
    resetHistory(); $('#history-project').value = WorkHistory.project(job.items[0]); changeHistoryFilters(); navigate('history');
  }
}
async function cancelJob(id) {
  try { applyJobs(await api('jobs-cancel', { id })); } catch (error) { toast(error.message, true); }
}
async function cancelOperation() {
  if (!state.busy) return;
  if (state.action === 'setup' && packageDownload) { packageDownload.stopping = true; update(); }
  status('正在停止，已完成的内容会保留…');
  try { await api('cancel'); } catch {
    if (state.action === 'setup' && packageDownload) { packageDownload.stopping = false; update(); }
    toast('暂时无法停止，请重试。', true);
  }
}

function renderEmotions() {
  $('#emotion-options').replaceChildren(); $('#more-emotions').replaceChildren();
  const common = new Set(['natural', 'happy', 'gentle', 'calm', 'excited', 'sad', 'firm', 'whisper', 'doubtful']);
  for (const emotion of catalog.emotions) {
    const button = el('button', emotion.id === state.emotion ? 'selected' : ''); button.type = 'button';
    button.append(icon(emotionIcons[emotion.id] || 'audio-lines'), el('span', '', emotion.name));
    button.dataset.emotion = emotion.id; button.setAttribute('aria-pressed', String(emotion.id === state.emotion));
    button.addEventListener('click', () => { state.emotion = emotion.id; renderEmotions(); saveDraft(); });
    $(common.has(emotion.id) ? '#emotion-options' : '#more-emotions').append(button);
  }
  if (!common.has(state.emotion)) $('.more-expression').open = true;
  $('#emotion-label').textContent = catalog.emotions.find(e => e.id === state.emotion)?.name || '自然';
}
function voiceCard(voice, target, extraActions, actionsOverride = {}) {
  const chosen = actionsOverride.chosen ?? voice.key === state.voiceKey;
  const card = el('div', 'voice-card' + (chosen ? ' chosen' : '')); card.dataset.voice = voice.key;
  const top = el('div', 'voice-card-top'), detail = el('div');
  detail.append(el('h3', '', voice.name), el('p', '', voice.description || '我的声音'));
  top.append(voiceAvatar(voice), detail);
  const tags = el('div', 'voice-tags');
  [...new Set([voice.gender === 'child' ? '童声' : voice.gender === 'elder' ? '长辈' : voice.gender === 'cartoon' ? '卡通' : voice.gender === 'male' ? '男声' : voice.gender === 'female' ? '女声' : '我的录音', voice.mode === 'design' ? voice.reference ? '精选定声' : '人物声音' : voice.native || '中文'])].forEach(t => tags.append(el('span', '', t)));
  const scenes = el('div', 'scene-tags');
  if (voice.scenes?.length) scenes.append(el('span', 'scene-label', '适合'));
  for (const id of voice.scenes || []) {
    const tag = el('button'); tag.append(icon(sceneIcons[id] || 'audio-lines'), document.createTextNode(sceneName(id))); tag.title = `看看其他适合${sceneName(id)}的声音`;
    tag.addEventListener('click', () => { if (actionsOverride.onScene) return actionsOverride.onScene(id); sceneFilter = id; renderSceneFilters(); renderLibrary(); }); scenes.append(tag);
  }
  const actions = el('div', 'voice-card-actions'), preview = el('button', 'sample-preview'), use = el('button', 'use-voice', chosen ? '已选用' : '用这个声音');
  preview.dataset.previewKey = voice.key;
  preview.disabled = !voice.preview && voice.mode !== 'clone';
  preview.addEventListener('click', () => previewVoice(voice.key));
  use.append(icon(chosen ? 'check' : 'arrow-right'));
  use.addEventListener('click', () => { if (actionsOverride.onSelect) return actionsOverride.onSelect(); selectVoice(voice.key); renderLibrary(); });
  actions.append(preview, use); if (extraActions) extraActions(actions, card);
  card.append(top);
  if (target.id === 'voice-grid') detail.append(tags); else card.append(tags);
  card.append(scenes, actions); target.append(card);
  syncPreviewButtons();
}
function renderSceneFilters() {
  $('#scene-filters').replaceChildren();
  for (const scene of [{ id: 'all', name: '不限用途' }, ...catalog.scenes]) {
    const button = el('button', scene.id === sceneFilter ? 'selected' : ''); button.append(icon(sceneIcons[scene.id] || 'audio-lines'), document.createTextNode(scene.name));
    button.dataset.sceneFilter = scene.id; button.setAttribute('aria-pressed', String(scene.id === sceneFilter));
    button.addEventListener('click', () => { sceneFilter = scene.id; renderSceneFilters(); renderLibrary(); });
    $('#scene-filters').append(button);
  }
}
function renderLibrary() {
  const query = $('#voice-search').value.trim().toLowerCase();
  const language = $('#voice-language').value;
  const found = voices().filter(v => v.mode !== 'clone' && (filter === 'all' || v.gender === filter)
    && (!language || v.language === language)
    && (sceneFilter === 'all' || v.scenes?.includes(sceneFilter))
    && matchesVoice(v, query)).sort((a, b) => compareVoices(a, b, sceneFilter));
  $('#voice-grid').replaceChildren(); $('#voice-total').textContent = `${found.length} 个声音`;
  for (const voice of found) voiceCard(voice, $('#voice-grid'));
  if (!found.length) {
    const node = empty('暂时没找到合适的声音', '试试换个用途，或者搜索“温柔”“故事”等关键词。');
    const reset = el('button', 'text-button', '看看全部声音');
    reset.addEventListener('click', () => { filter = 'all'; sceneFilter = 'all'; $('#voice-search').value = ''; $('#voice-language').value = ''; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b.dataset.filter === 'all')); renderSceneFilters(); renderLibrary(); window.CustomSelects?.sync(); });
    node.append(reset); $('#voice-grid').append(node);
  }
}

function voiceTags(voice) {
  return [({ female: '女声', male: '男声', child: '童声', elder: '长辈', cartoon: '卡通', reference: '我的录音' })[voice.gender], voice.native, ...(voice.scenes || []).map(sceneName)].filter(Boolean);
}
function matchesVoice(voice, query) {
  const text = `${voice.name} ${voice.description} ${voice.note || ''} ${voiceTags(voice).join(' ')} ${(voice.keywords || []).join(' ')}`.normalize('NFKC').toLowerCase();
  return query.normalize('NFKC').split(/\s+/).filter(Boolean).every(word => text.includes(word));
}
function selectDetails(select, item) {
  const value = item?.value || '', id = select.id;
  if (select.dataset.selectKind === 'project-role') {
    if (item?.dataset.voiceKey) { const voice = currentVoice(item.dataset.voiceKey); return { avatar: voiceAvatar(voice), title: item.textContent, description: voice.name }; }
    return { avatar: icon(value === '__new' ? 'plus' : 'users') };
  }
  let voice, role;
  if (select.dataset.selectKind === 'voice') {
    if (!value) return { description: '先选择一个声音，这个角色的台词会一起使用' };
    role = value.startsWith('role:') ? roles.find(r => `role:${r.id}` === value) : null;
    voice = currentVoice(role?.voiceKey || value);
  } else if (id === 'saved-role-select' && value) {
    role = roles.find(r => r.id === value); if (role) voice = currentVoice(role.voiceKey);
  } else if (id === 'reference-select' && value) voice = currentVoice(`clone:${value}`);
  else if (id === 'history-voice' && value) voice = voices().find(v => v.name === value || v.id === value);
  if (voice) return {
    avatar: voiceAvatar(voice), title: role?.name || voice.name,
    description: role ? `${voice.name} · ${catalog.emotions.find(e => e.id === role.options.emotion)?.name || '自然'}语气` : voice.mode === 'clone' ? `原始录音 · ${Number(voice.duration || 0).toFixed(1)} 秒` : voice.description,
    tags: role ? ['已保存', sceneName(role.options.scene || 'dialogue'), ...voiceTags(voice).slice(0, 1)] : voiceTags(voice)
  };
  if (['scene', 'history-scene', 'voice-picker-scene'].includes(id) && sceneIcons[value]) {
    const descriptions = { dialogue: '一人一句，让交流更自然', game: '为角色台词赋予个性', story: '让故事中的人物鲜活起来', video: '为视频画面配上旁白', course: '清楚讲解，方便听懂', ad: '传递产品亮点与情绪', service: '亲切清晰的服务引导', bedtime: '轻柔舒缓，陪伴入睡' };
    return { avatar: icon(sceneIcons[value]), description: descriptions[value] };
  }
  if (id === 'saved-role-select' && !value) return { description: roles.length ? '选用已保存的声线、语气和用途' : '先保存声音配置，下次一选即用' };
  const descriptions = {
    engine: { standard: '适合视频、故事与对话，支持调整情绪', light: '适合自然朗读，占用电脑资源更少' },
    pace: { slow: '舒缓从容，适合故事和细致讲解', normal: '自然流畅，适合日常表达', fast: '明快紧凑，适合节奏鲜明的文案' },
    'sample-rate': { '48000': '方便与视频剪辑工程匹配', '44100': '方便与常用音频工程匹配', '24000': '保留原始采样率，文件更小' },
    'zip-format': { mp3: '文件更小，方便分享和发布', wav: '无损音频，方便后期剪辑' },
    'history-export-format': { mp3: '文件更小，方便分享和发布', wav: '无损音频，方便后期剪辑' },
    'history-period': { '': '查看所有时间的作品', today: '查看今天创作的作品', week: '查看最近 7 天的作品', month: '查看最近 30 天的作品' },
    'history-duration': { '': '查看所有长度的音频', short: '适合短句、对白和简短旁白', medium: '适合短视频、广告和课程片段', long: '适合故事和较长内容' },
    'history-sort': { newest: '先看刚刚完成的作品', oldest: '从早期作品开始回顾', shortest: '先查看短音频', longest: '先查看长音频' }
  };
  if (descriptions[id]) return { description: descriptions[id][value] };
  if (id === 'history-project' && value) return { avatar: icon('folder'), description: `${workHistory().filter(entry => WorkHistory.project(entry) === value).length} 条作品` };
  if (id === 'language') return { avatar: icon('message-circle'), description: value === 'Auto' ? '根据文案自动判断语言' : `使用${item?.textContent || ''}朗读文案` };
  if (select.dataset.selectKind === 'emotion') return { avatar: icon('audio-lines'), description: `让这句台词带上${item?.textContent || ''}的语气` };
  return {};
}
function openVoicePicker() {
  pickerFilter = 'all'; $('#voice-picker-search').value = ''; $('#voice-picker-scene').value = 'all';
  window.CustomSelects?.close(false);
  $('#voice-picker').insertBefore($('#sample-player'), $('.voice-picker-footer'));
  renderVoicePicker(); $('#voice-picker').showModal();
  $('#voice-picker-search').focus();
}
function closeVoicePicker() { window.CustomSelects?.close(false); stopPreview(); $('#voice-picker').close(); document.body.insertBefore($('#sample-player'), $('body > footer')); }
function renderVoicePicker() {
  const target = $('#voice-picker-grid'), query = $('#voice-picker-search').value.trim().toLowerCase(), scene = $('#voice-picker-scene').value;
  const candidates = pickerFilter === 'mine'
    ? [...roles.map(role => ({ voice: { ...currentVoice(role.voiceKey), name: role.name, description: `${currentVoice(role.voiceKey).name} · ${catalog.emotions.find(e => e.id === role.options.emotion)?.name || '自然'}语气`, scenes: [role.options.scene || 'dialogue'] }, role })), ...voices().filter(v => v.mode === 'clone').map(voice => ({ voice }))]
    : voices().filter(v => v.mode !== 'clone' && (pickerFilter === 'all' || v.gender === pickerFilter)).map(voice => ({ voice }));
  const found = candidates.filter(({ voice }) => (scene === 'all' || voice.scenes?.includes(scene)) && matchesVoice(voice, query)).sort((a, b) => compareVoices(a.voice, b.voice, scene));
  document.querySelectorAll('[data-picker-filter]').forEach(button => { const selected = button.dataset.pickerFilter === pickerFilter; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  target.replaceChildren(); $('#voice-picker-count').textContent = `${found.length} 个${pickerFilter === 'mine' ? '已保存的' : '可选'}声音`;
  found.forEach(({ voice, role }) => voiceCard(voice, target, null, {
    chosen: role ? false : voice.key === state.voiceKey,
    onScene(id) { $('#voice-picker-scene').value = id; renderVoicePicker(); },
    onSelect() { if (role) applyRole(role, false); else selectVoice(voice.key, false); closeVoicePicker(); toast(`已选用「${voice.name}」，继续写下想说的话吧。`); }
  }));
  if (!found.length) {
    const noSaved = pickerFilter === 'mine' && !candidates.length;
    const message = empty(noSaved ? '还没有保存的声音' : '暂时没有找到合适的声音', noSaved ? '在配音页点击“保存声音配置”，或去“我的声音”导入录音。' : '试试其他关键词，或放宽声音类型和用途。');
    const reset = el('button', 'text-button', '看看全部声音'); reset.onclick = () => { pickerFilter = 'all'; $('#voice-picker-search').value = ''; $('#voice-picker-scene').value = 'all'; renderVoicePicker(); };
    message.append(reset); target.append(message);
  }
  const voice = currentVoice(); $('#voice-picker-current').replaceChildren(voiceAvatar(voice), el('span', '', `当前选用：${voice.name}`));
  window.CustomSelects?.sync();
}

function openTemplates() {
  templateCategory = 'all'; $('#template-search').value = '';
  window.CustomSelects?.close(false);
  $('#template-dialog').insertBefore($('#sample-player'), $('.template-footer'));
  renderTemplates(); $('#template-dialog').showModal(); $('#template-search').focus();
}
function closeTemplates() {
  stopPreview(); $('#template-dialog').close();
  document.body.insertBefore($('#sample-player'), $('body > footer'));
}
function applyTemplate(template) {
  templateUndo = sessionSnapshot();
  restoreSession(window.CreationTemplates.project(template, catalog, $('#project-name').value));
  $('#template-applied-name').textContent = `已套用「${template.name}」`;
  $('#template-applied').classList.remove('hidden');
  closeTemplates(); navigate('editor'); update(); saveDraft(true);
  (state.script ? $('#script-rows textarea') : $('#text')).focus();
  toast('已套用模板。' + scenePreparation(template) + '。');
}
function renderHomeDraft() {
  const texts = state.script ? state.rows.map(row => row.text).filter(text => text.trim()) : [$('#text').value].filter(text => text.trim());
  $('#home-draft').hidden = !texts.length;
  $('#home-draft-name').textContent = $('#project-name').value.trim() || '未命名草稿';
  $('#home-draft-excerpt').textContent = '快速配音草稿 · ' + texts.join(' · ').slice(0, 160);
  $('#home-continue-draft').title = $('#home-draft-name').textContent + ' · 继续编辑';
  $('#home-recent').hidden = !texts.length && !$('#home-recent-list').children.length;
}
async function renderHomeRecent() {
  const request = ++recentRequest;
  await Promise.allSettled([projectWorkspace?.save(), laboratory?.flush()]);
  const results = await Promise.allSettled([api('projects-list'), api('lab-list')]);
  if (request !== recentRequest) return;
  const records = results.flatMap((result, index) => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value.map(item => ({ ...item, kind: index ? '实验室作品' : '配音项目', lab: !!index })) : [])
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  $('#home-recent').hidden = !records.length && $('#home-draft').hidden; $('#home-recent-list').replaceChildren();
  for (const item of records) {
    const card = el('button', 'home-recent-item home-resume-item'); card.type = 'button';
    const mark = el('span', 'home-resume-icon'); mark.append(icon(item.lab ? 'sparkles' : 'folder'));
    const copy = el('span', 'home-resume-copy');
    copy.append(el('strong', '', item.name), el('small', '', item.kind + ' · ' + new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
    const arrow = icon('arrow-right'); arrow.classList.add('home-resume-arrow');
    card.title = item.name + ' · 继续创作';
    card.append(mark, copy, el('span', 'sr-only', '继续创作'), arrow);
    card.onclick = async () => { card.disabled = true; try { if (item.lab) { navigate('laboratory', true); await laboratory.open(item.id); } else await projectWorkspace.open(item.id); } catch (error) { toast(error.message, true); } finally { card.disabled = false; } };
    $('#home-recent-list').append(card);
  }
}
function scenePreparation(template) {
  const keys = [...new Set((template.rows || [{ voiceKey: template.voiceKey }]).map(row => row.voiceKey || template.voiceKey))];
  const ids = [...new Set(keys.flatMap(key => requiredPackages({ mode: currentVoice(key).mode, engine: 'standard' })))];
  const missing = ids.filter(id => !packageReady(id));
  return (missing.length ? '需准备：' + missing.map(id => packages.find(pack => pack.id === id).name).join('、') : '所需声音包已安装') + (keys.some(key => currentVoice(key).mode === 'design') ? ' · 首次使用需试听定声' : '');
}
async function startHomeScenario(id) {
  if (homeStarting || !projectWorkspace) return;
  if (state.busy) return toast('正在准备声音或保存文件，完成后就能开始新场景。');
  homeStarting = true; stopPreview(); stopClip();
  document.querySelectorAll('[data-start-scenario], [data-scenario-art]').forEach(button => { button.disabled = true; });
  const button = document.querySelector(`[data-start-scenario="${id}"]`);
  if (button) { button.textContent = '正在准备…'; button.setAttribute('aria-busy', 'true'); }
  try {
    await saveDraft(true);
    const template = window.HomeScenarios.template(catalog, id);
    await projectWorkspace.startScene(template, catalog);
    toast(`已创建「${template.name}」。${scenePreparation(template)}。`);
  } catch (error) { toast(activationError(error), true); }
  finally { homeStarting = false; renderHome(); }
}
function homeStartButton(scene) {
  const button = el('button', 'home-start', '开始创作'); button.type = 'button';
  button.dataset.startScenario = scene.id; button.setAttribute('aria-label', `开始创作：${scene.name}`);
  button.disabled = homeStarting; button.append(icon('arrow-right'));
  button.onclick = () => startHomeScenario(scene.id); return button;
}
function homeScenarioArt(scene) {
  const art = el('button', scene.featured ? 'home-card-art' : 'home-compact-art');
  art.type = 'button'; art.dataset.scenarioArt = scene.id;
  art.setAttribute('aria-label', `使用${scene.name}场景`); art.disabled = homeStarting;
  art.onclick = () => startHomeScenario(scene.id);
  const img = el('img'); img.src = `assets/home/${scene.image}.webp`; img.alt = '';
  img.width = scene.featured ? 800 : 640; img.height = scene.featured ? 533 : 427;
  img.decoding = 'async'; if (!scene.featured) img.loading = 'lazy';
  art.append(img); return art;
}
function renderHome() {
  const categories = [{ id: 'all', name: '全部场景' }, { id: 'content', name: '视频与播客' }, { id: 'dialogue', name: '角色对白' }, { id: 'story', name: '故事与阅读' }, { id: 'course', name: '教学与培训' }, { id: 'business', name: '商业与推广' }];
  $('#home-categories').replaceChildren(...categories.map(category => {
    const button = el('button', category.id === homeCategory ? 'selected' : '', category.name);
    button.type = 'button'; button.dataset.homeCategory = category.id; button.setAttribute('aria-pressed', String(category.id === homeCategory));
    button.onclick = () => { homeCategory = category.id; renderHome(); document.querySelector(`[data-home-category="${category.id}"]`).focus({ preventScroll: true }); }; return button;
  }));
  const found = window.HomeScenarios.filter(catalog, homeCategory, $('#home-search').value);
  const featured = $('#home-featured-grid'), more = $('#home-more-grid'); featured.replaceChildren(); more.replaceChildren();
  for (const scene of found) {
    const template = window.HomeScenarios.template(catalog, scene.id), voice = currentVoice(template.voiceKey);
    const card = el('article', scene.featured ? 'home-featured-card' : 'home-compact-card');
    card.dataset.scenario = scene.id; card.dataset.category = template.category;
    if (scene.featured) {
      const art = homeScenarioArt(scene);
      const tag = el('span', 'home-card-tag'); tag.append(icon(scene.icon), document.createTextNode(scene.tag)); art.append(tag);
      const content = el('div', 'home-card-content'); content.append(el('h3', '', scene.name), el('p', '', scene.description));
      const settings = el('div', 'home-card-settings');
      const voiceKeys = [...new Set((template.rows || [{ voiceKey: template.voiceKey }]).map(row => row.voiceKey))];
      const voicesLabel = voiceKeys.length > 1 ? `${voiceKeys.length} 个角色声音` : voice.name;
      const pace = { slow: '舒缓语速', normal: '自然语速', fast: '轻快语速' }[template.pace] || '自然语速';
      settings.append(el('span', '', voicesLabel), el('span', '', pace));
      const actions = el('div', 'home-card-actions'), preview = el('button', 'sample-preview'); preview.type = 'button';
      preview.dataset.previewKey = voice.key; preview.setAttribute('aria-label', `试听${scene.name}推荐音色`);
      preview.onclick = () => previewVoice(voice.key);
      actions.append(preview, homeStartButton(scene)); content.append(settings, actions); card.append(art, content); featured.append(card);
    } else {
      const body = el('div', 'home-compact-body'); body.append(el('h3', '', scene.name), el('p', '', scene.description), homeStartButton(scene));
      card.append(homeScenarioArt(scene), body); more.append(card);
    }
  }
  $('#home-featured-section').hidden = !featured.childElementCount;
  $('#home-more-section').hidden = !more.childElementCount;
  $('#home-empty').hidden = !!found.length;
  $('#home-suggestions').replaceChildren();
  if (!found.length) for (const scene of window.HomeScenarios.suggestions(catalog, homeCategory, $('#home-search').value)) {
    const suggestion = el('button', 'button', '试试：' + scene.name); suggestion.onclick = () => startHomeScenario(scene.id); $('#home-suggestions').append(suggestion);
  }
  $('#home-scene-count').textContent = `${found.length} 个场景，找到适合你的那一个`;
  renderHomeDraft(); syncPreviewButtons();
}
function initializeHome() {
  renderHome(); renderHomeRecent();
  $('#home-search').addEventListener('input', renderHome);
  $('#home-reset-search').onclick = () => { homeCategory = 'all'; $('#home-search').value = ''; renderHome(); $('#home-search').focus(); };
  $('#home-all-templates').onclick = openTemplates;
  for (const id of ['home-quick-editor', 'home-continue-draft']) $('#' + id).onclick = () => { navigate('editor'); update(); (state.script ? $('#script-rows textarea') : $('#text'))?.focus(); };
  $('#home-explore').onclick = () => { $('#home-library').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); $('#home-search').focus({ preventScroll: true }); };
}
function renderTemplates() {
  const categories = [{ id: 'all', name: '全部模板' }, ...catalog.templateCategories];
  $('#template-categories').replaceChildren();
  for (const category of categories) {
    const count = catalog.templates.filter(template => category.id === 'all' || template.category === category.id).length;
    const button = el('button', category.id === templateCategory ? 'selected' : '', `${category.name} ${count}`);
    button.setAttribute('aria-pressed', String(category.id === templateCategory));
    button.onclick = () => { templateCategory = category.id; renderTemplates(); };
    $('#template-categories').append(button);
  }
  const found = window.CreationTemplates.filter(catalog.templates, catalog, templateCategory, $('#template-search').value);
  $('#template-count').textContent = `${found.length} 套模板 · 文稿、声音和表达一起准备好`;
  const grid = $('#template-grid'); grid.replaceChildren();
  for (const template of found) {
    const voice = currentVoice(template.voiceKey), card = el('article', 'template-card'); card.dataset.template = template.id;
    const heading = el('div', 'template-card-heading'), title = el('div');
    title.append(el('h3', '', template.name), el('p', '', template.description));
    heading.append(voiceAvatar(voice), title);
    const text = el('p', 'template-excerpt', template.text);
    const tags = el('div', 'voice-tags');
    const count = template.rows?.length || template.text.split('\n').filter(Boolean).length;
    tags.append(el('span', '', voice.name), el('span', '', template.rows ? '多角色对白' : count > 1 ? `${count} 段批量配音` : '单段配音'), el('span', '', voice.mode === 'design' ? '人物与童声' : '日常配音'));
    const actions = el('div', 'template-actions'), preview = el('button', 'sample-preview'), use = el('button', 'button', '套用模板');
    preview.dataset.previewKey = voice.key; preview.onclick = () => previewVoice(voice.key);
    use.onclick = () => applyTemplate(template); use.append(icon('arrow-right'));
    actions.append(preview, use); card.append(heading, text, tags, actions); grid.append(card);
  }
  if (!found.length) {
    const node = empty('没有找到这个模板', '试试搜索“课程”“播客”或声音名称，也可以切换分类。');
    const reset = el('button', 'text-button', '查看全部模板'); reset.onclick = () => { templateCategory = 'all'; $('#template-search').value = ''; renderTemplates(); };
    node.append(reset); grid.append(node);
  }
  syncPreviewButtons();
}

function renderRoles() {
  $('#role-grid').replaceChildren(); $('#reference-grid').replaceChildren(); $('#saved-role-select').replaceChildren(); option($('#saved-role-select'), '', '声音配置');
  $('#saved-role-control').hidden = roles.length === 0;
  if (!roles.length) $('#role-grid').append(empty('把常用的声音配置留在这里', '在配音页点击“保存声音配置”，下次就能一选即用。'));
  roles.forEach(role => { option($('#saved-role-select'), role.id, role.name); const voice = { name: role.name, key: role.voiceKey, mode: role.options.mode, description: role.options.voiceName, native: '角色设置', gender: currentVoice(role.voiceKey).gender };
    const card = el('div', 'voice-card'), title = el('h3', '', role.name), desc = el('p', '', role.options.voiceName + ' · ' + (catalog.emotions.find(e => e.id === role.options.emotion)?.name || '自然')); card.dataset.roleId = role.id;
    const top = el('div', 'voice-card-top'), detail = el('div'), meta = el('div', 'voice-card-meta'); meta.append(desc); detail.append(title, meta); top.append(voiceAvatar(currentVoice(role.voiceKey)), detail);
    const actions = el('div', 'voice-card-actions'), use = el('button', 'use-voice', '用这个声音'); use.append(icon('arrow-right'));
    use.addEventListener('click', () => applyRole(role)); const preview = el('button', 'sample-preview'); preview.dataset.previewKey = role.voiceKey; preview.addEventListener('click', () => previewVoice(role.voiceKey)); actions.append(preview, editVoiceButton('role', role), deleteButton('role', role), use); const scenes = el('div', 'scene-tags'); if (role.options.scene) scenes.append(el('span', '', sceneName(role.options.scene))); meta.append(scenes); if (role.note) meta.append(el('p', '', role.note)); card.append(top, actions); $('#role-grid').append(card);
  });
  $('#reference-select').replaceChildren(); state.references.forEach(ref => { option($('#reference-select'), ref.id, ref.name); voiceCard({ ...ref, key: `clone:${ref.id}`, mode: 'clone', description: '我的录音 · ' + ref.duration.toFixed(1) + ' 秒' + (ref.note ? ' · ' + ref.note : ''), gender: 'reference', native: '我的录音' }, $('#reference-grid'), actions => { actions.insertBefore(editVoiceButton('reference', ref), actions.lastElementChild); actions.insertBefore(deleteButton('reference', ref), actions.lastElementChild); }); });
  syncPreviewButtons();
}
function editVoiceButton(type, item) {
  const button = el('button', '', '编辑资料'); button.setAttribute('aria-label', '编辑声音资料：' + item.name);
  button.onclick = () => { voiceDetails = { type, id: item.id }; $('#voice-details-name').value = item.name; $('#voice-details-note').value = item.note || ''; $('#voice-details-error').textContent = ''; $('#voice-details-dialog').showModal(); $('#voice-details-name').focus(); };
  return button;
}
$('#voice-details-cancel').onclick = () => $('#voice-details-dialog').close();
$('#voice-details-form').onsubmit = async event => {
  event.preventDefault(); const { type, id } = voiceDetails, name = $('#voice-details-name').value.trim(), note = $('#voice-details-note').value.trim();
  if (!name) { $('#voice-details-error').textContent = '请填写声音名称'; return; }
  const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    if (type === 'reference') { const updated = await api('update-reference', { id, name, note }); state.references = state.references.map(ref => ref.id === id ? updated : ref); }
    else { const role = roles.find(role => role.id === id); if (!role) throw Error('这个声音已不存在'); Object.assign(role, { name, note }); persistRoles(); }
    renderRoles(); renderSelection(); renderScript(); projectWorkspace?.refreshMedia(); $('#voice-details-dialog').close(); toast('声音资料已保存');
  } catch (error) { $('#voice-details-error').textContent = error.message; } finally { submit.disabled = false; }
};
function applyRole(role, goBack = true) {
  const retained = !role.id && quickVoiceBindings[role.voiceKey];
  selectVoice(role.voiceKey, false); const o = role.options;
  if (!role.id) quickVoiceScopeId = o.voiceScopeId || quickVoiceScopeId;
  if (retained) quickVoiceBindings[state.voiceKey] = retained;
  else if (currentVoice().mode === 'design' && (role.id || o.voiceId || o.voiceRevision)) {
    quickVoiceBindings[state.voiceKey] = { voiceScopeId: o.voiceScopeId || (role.id ? 'saved-roles' : quickVoiceScopeId),
      voiceId: o.voiceId || (role.id ? 'role:' + role.id : state.voiceKey), voiceRevision: o.voiceRevision || '' };
  }
  $('#lock-voice').checked = o.lockVoice !== false;
  $('#reference-style').value = o.referenceStyle || 'original';
  for (const [id, key] of [['language','language'],['scene','scene'],['pace','pace'],['engine','engine'],['voice-description','voiceDescription'],['reference-text','referenceText'],['instruction','instruction'],['intensity','intensity']]) if (o[key] !== undefined) $('#' + id).value = key === 'referenceText' && o.mode === 'clone' ? referenceTextFor(o.referenceId, o[key]) : o[key];
  state.emotion = o.emotion || 'natural'; renderSelection(); renderEmotions(); update(); saveDraft(); if (goBack) { navigate('editor'); update(); }
}
function persistRoles() { localStorage.setItem('shengyue-roles-1', JSON.stringify(roles)); renderRoles(); renderScript(); }
function clearRecordingPreview() {
  const audio = $('#recording-preview'); audio.pause(); audio.removeAttribute('src'); audio.load();
  if (recordingURL) URL.revokeObjectURL(recordingURL);
  recordingURL = null;
}
function renderRecording(snapshot = voiceRecorder?.state || { status: 'idle', seconds: 0, level: 0 }) {
  const stage = $('#recording-stage'), active = ['requesting', 'recording', 'processing'].includes(snapshot.status), ready = snapshot.status === 'ready';
  const recording = snapshot.status === 'recording', rawLevel = Math.max(0, Number(snapshot.level) || 0), now = performance.now();
  if (!recording) { recordingSoundUntil = 0; recordingVisualLevel = 0; }
  else if (rawLevel >= (stage.dataset.signal === 'sound' ? .003 : .006)) recordingSoundUntil = now + 300;
  const hearingSound = recording && now < recordingSoundUntil;
  const targetLevel = hearingSound ? Math.min(1, Math.sqrt(Math.max(0, rawLevel - .002) / .08)) : 0;
  recordingVisualLevel += (targetLevel - recordingVisualLevel) * (targetLevel > recordingVisualLevel ? .6 : .3);
  stage.dataset.state = snapshot.status;
  stage.dataset.signal = hearingSound ? 'sound' : 'quiet';
  $('#recording-time').textContent = clock(snapshot.seconds);
  const message = recordingSaving ? '正在保存声音，请稍候…' : hearingSound && snapshot.seconds < 27 ? '听到你的声音了，请继续自然朗读。' : snapshot.message || '录制 3–30 秒，30 秒时自动停止';
  if ($('#recording-status').textContent !== message) $('#recording-status').textContent = message;
  const prompt = $('#recording-prompt'), canStart = !active && !ready && !recordingStarting;
  prompt.textContent = recordingSaving ? '正在保存声音' : recordingStarting && !active ? '正在连接麦克风' : ({ requesting: '正在连接麦克风', recording: '点击停止录音', processing: '正在整理录音', ready: '录好了，听听你的声音', error: '点击重新录音' })[snapshot.status] || '点击开始录音，朗读上方文案';
  prompt.disabled = !canStart && (snapshot.status !== 'recording' || snapshot.seconds < 3.2);
  prompt.toggleAttribute('data-action', !prompt.disabled);
  prompt.setAttribute('aria-controls', snapshot.status === 'recording' ? 'recording-stop' : 'recording-start');
  $('.recording-time').classList.toggle('hidden', !['recording', 'processing', 'ready'].includes(snapshot.status));
  $('#recording-start').classList.toggle('hidden', active || ready);
  $('#recording-stop').classList.toggle('hidden', snapshot.status !== 'recording');
  $('#recording-stop').disabled = snapshot.seconds < 3.2;
  $('#recording-preview').classList.toggle('hidden', !ready);
  $('#recording-redo').classList.toggle('hidden', !ready);
  $('#recording-save-fields').classList.toggle('hidden', !ready);
  $('#recording-save').disabled = recordingSaving || state.busy || !ready || !$('#recording-name').value.trim() || !$('#recording-text').value.trim();
  for (const id of ['recording-close', 'recording-discard', 'recording-redo', 'recording-text', 'recording-name']) $('#' + id).disabled = recordingSaving;
  $('#recording-start').disabled = recordingStarting;
  $('#recording-redo').disabled = recordingSaving || recordingStarting;
  $('#recording-example').disabled = active || recordingSaving;
  $('#recording-level').style.setProperty('--record-level', String(recordingVisualLevel));
  if (ready && !recordingURL) {
    recordingURL = URL.createObjectURL(new Blob([snapshot.audio], { type: 'audio/wav' })); $('#recording-preview').src = recordingURL;
  }
}
function openRecording(onSaved) {
  if (state.busy) return;
  if (!requireVoiceConsent($('#reference-consent'))) return;
  recordingOnSaved = typeof onSaved === 'function' ? onSaved : null;
  stopPreview(); stopClip(); window.SoundFeedback?.stop();
  recordingTransport ||= window.SoundFeedback?.enhance($('#recording-preview'), { label: '试听刚录好的声音', onError: () => toast('录音暂时无法播放，请重试。', true) });
  recordingSession++; clearRecordingPreview();
  voiceRecorder?.cancel(); voiceRecorder = new VoiceRecording.Recorder(snapshot => {
    renderRecording(snapshot);
    if (snapshot.status !== 'requesting') api('recording-release').catch(() => {});
  });
  $('#recording-text').value = randomRecordingScript($('#recording-text').value); $('#recording-name').value = '我的声音';
  renderRecording(); $('#recording-dialog').showModal();
}
async function startRecording() {
  if (!voiceRecorder || recordingStarting || recordingSaving || state.busy || ['requesting', 'recording', 'processing'].includes(voiceRecorder.state.status)) return;
  clearRecordingPreview();
  const session = recordingSession;
  recordingStarting = true; renderRecording();
  try {
    await api('recording-permission', { consent: $('#reference-consent').checked });
    if (session !== recordingSession) return;
    await voiceRecorder.start();
  } catch (error) {
    if (session === recordingSession) voiceRecorder.notify({ status: 'error', seconds: 0, level: 0, message: error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
  } finally { if (session === recordingSession) { recordingStarting = false; renderRecording(); } }
}
function closeRecording() {
  if (recordingSaving) return;
  recordingSession++; recordingStarting = false; voiceRecorder?.cancel(); clearRecordingPreview();
  $('#recording-dialog').close(); api('recording-release').catch(() => {});
  recordingOnSaved = null;
}
async function saveRecording() {
  if (recordingSaving || state.busy || voiceRecorder?.state.status !== 'ready') return;
  const name = $('#recording-name').value.trim(), text = $('#recording-text').value.trim();
  if (!name || !text) return toast('请填写声音名称和录音中的原话。');
  recordingSaving = true; renderRecording();
  const result = await operate('recording-save', { consent: $('#reference-consent').checked, name, text, audio: voiceRecorder.state.audio });
  recordingSaving = false; renderRecording();
  if (result) { const onSaved = recordingOnSaved; closeRecording(); if (onSaved) onSaved(result.id); else selectVoice('clone:' + result.id); toast('声音已保存，写下新文案就能开始配音。'); }
}
function saveRole() { $('#role-name').value = ''; $('#name-dialog').showModal(); }
$('#name-dialog').addEventListener('close', () => { if ($('#name-dialog').returnValue !== 'save') return; const name = $('#role-name').value.trim(); if (!name) return toast('请输入配置名称'); if (roles.length >= 100) return toast('最多保存 100 个声音配置'); roles.push({ id: crypto.randomUUID(), name, voiceKey: state.voiceKey, options: settings() }); persistRoles(); toast('声音配置已保存'); });
function empty(title = '你的第一段配音，即将在这里出现', description = '写下文字，选好声音，点击“生成配音”。满意后就能保存到电脑。') {
  const node = el('div', 'empty'); node.append(icon('headphones'), el('strong', '', title), el('p', '', description)); return node;
}
function syncPreviewButtons() {
  document.querySelectorAll('.sample-preview').forEach(button => {
    const phase = samplePlaying && samplePlaying.key === button.dataset.previewKey ? samplePlaying.phase : samplePendingKey && samplePendingKey === button.dataset.previewKey ? 'loading' : 'idle';
    const active = phase === 'playing';
    button.classList.toggle('playing', !!active);
    const signature = `${active}|${button.id === 'preview-voice'}`;
    if (button.dataset.previewRender !== signature) {
      button.dataset.previewRender = signature; button.replaceChildren(icon(active ? 'pause' : 'play'));
      if (button.id !== 'preview-voice') button.append(document.createTextNode(active ? '暂停试听' : '试听'));
    }
    const label = `${button.disabled ? '生成后可试听' : active ? '暂停试听' : '试听'} ${currentVoice(button.dataset.previewKey).name}`;
    button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(!!active)); button.title = label;
    window.SoundFeedback?.set(button, phase);
  });
  const rolePreview = $('#project-role-preview');
  if (rolePreview) {
    const phase = samplePlaying && samplePlaying.key === rolePreview.dataset.previewKey ? samplePlaying.phase : samplePendingKey && samplePendingKey === rolePreview.dataset.previewKey ? 'loading' : 'idle';
    const active = phase === 'playing';
    rolePreview.classList.toggle('playing', active); rolePreview.setAttribute('aria-pressed', String(active));
    const mark = rolePreview.querySelector('.ui-icon'); if (mark) mark.className = 'ui-icon icon-' + (active ? 'pause' : 'play');
    $('#project-role-preview-label').textContent = active ? '暂停声音示例' : '试听声音示例';
    window.SoundFeedback?.set(rolePreview, phase);
  }
}
function stopPreview() {
  sampleSequence++;
  sampleFeedback?.(); sampleFeedback = null; samplePendingKey = '';
  if (samplePlaying) { samplePlaying.audio?.pause(); if (samplePlaying.url) URL.revokeObjectURL(samplePlaying.url); }
  samplePlaying = null; $('#sample-player').classList.add('hidden'); syncPreviewButtons(); window.SoundFeedback?.set($('#sample-toggle'));
}
function syncSampleTimeline() {
  const audio = samplePlaying?.audio; if (!audio) return;
  $('#sample-time').textContent = clock(audio.currentTime);
  $('#sample-duration').textContent = clock(Number.isFinite(audio.duration) ? audio.duration : 0);
  $('#sample-seek').value = audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
  const symbol = audio.paused ? 'play' : 'pause';
  if ($('#sample-toggle').dataset.soundIcon !== symbol) { $('#sample-toggle').dataset.soundIcon = symbol; $('#sample-toggle').replaceChildren(icon(symbol)); }
  $('#sample-toggle').setAttribute('aria-label', audio.paused ? '继续试听' : '暂停试听');
  window.SoundFeedback?.set($('#sample-toggle'), samplePlaying.phase);
  syncPreviewButtons();
}
async function previewVoice(key = state.voiceKey, { inline = false } = {}) {
  laboratory?.stopAudio();
  if (samplePlaying?.key === key) {
    const audio = samplePlaying.audio; if (!audio) return;
    $('#sample-player').classList.toggle('hidden', inline);
    if (audio.paused) { if (audio.ended) audio.currentTime = 0; try { await audio.play(); if (samplePlaying?.audio === audio) samplePlaying.phase = 'playing'; } catch { if (samplePlaying?.audio === audio) samplePlaying.phase = 'idle'; toast('试听暂时无法播放，请重试。'); } } else { audio.pause(); samplePlaying.phase = 'paused'; }
    syncSampleTimeline(); return;
  }
  stopPreview();
  window.SoundFeedback?.stop();
  const voice = currentVoice(key), serial = sampleSequence;
  stopClip();
  if (!voice.preview && voice.mode !== 'clone') return toast('先生成一段配音，满意后存为声音，就能随时试听。');
  samplePendingKey = key; syncPreviewButtons();
  let url = null;
  try {
    let source;
    if (voice.mode === 'clone') {
      const data = await api('reference-audio', { id: voice.id });
      if (serial !== sampleSequence) return;
      url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' })); source = url;
    } else source = new URL(voice.preview.file, window.location.href).href;
    const audio = new Audio(source); samplePlaying = { key, audio, url, phase: 'loading' }; samplePendingKey = '';
    $('#sample-portrait').replaceChildren(voiceAvatar(voice));
    $('#sample-name').textContent = `${voice.name} · ${voice.mode === 'clone' ? '我的原始录音' : '声音示例'}`;
    $('#sample-text').textContent = voice.preview?.text || voice.text || '试听你保存的参考录音';
    $('#sample-player').classList.toggle('hidden', inline);
    $('#sample-time').textContent = '0:00'; $('#sample-duration').textContent = clock(voice.preview?.duration || voice.duration); $('#sample-seek').value = 0;
    audio.ontimeupdate = syncSampleTimeline; audio.onloadedmetadata = syncSampleTimeline; audio.onplay = syncSampleTimeline; audio.onpause = syncSampleTimeline; audio.onended = syncSampleTimeline;
    audio.onerror = () => { if (serial === sampleSequence) { stopPreview(); toast('这个声音的示例暂时无法播放，请重新打开软件后再试。', true); } };
    sampleFeedback = window.SoundFeedback?.bind(audio, [], { initial: 'loading', stop: stopPreview, onState: phase => { if (serial === sampleSequence && samplePlaying?.audio === audio) { samplePlaying.phase = phase; syncSampleTimeline(); } } });
    await audio.play();
    if (serial !== sampleSequence) { audio.pause(); return; }
    samplePlaying.phase = 'playing'; syncSampleTimeline();
  } catch (error) { if (serial === sampleSequence) { if (url) URL.revokeObjectURL(url); stopPreview(); toast('声音暂时无法播放，请稍后再试。', true); } }
}

function setClipButtonState(button, status = 'idle') {
  const active = status === 'playing', loading = status === 'loading';
  const symbol = el('span', 'clip-play-symbol', active ? 'Ⅱ' : loading ? '…' : '▶');
  symbol.setAttribute('aria-hidden', 'true'); button.replaceChildren(symbol);
  button.classList.toggle('playing', active);
  button.setAttribute('aria-pressed', String(active || loading));
  button.setAttribute('aria-busy', String(loading));
  button.setAttribute('aria-label', `${active ? '停止播放' : loading ? '取消试听' : '试听'} ${button.dataset.clipText}`);
  button.title = active ? '正在播放，点击停止' : loading ? '正在加载，点击取消' : '播放配音';
  window.SoundFeedback?.set(button, loading ? 'loading' : active ? 'playing' : 'idle');
}
function stopClip() {
  clipSequence++;
  clipFeedback?.(); clipFeedback = null;
  if (pendingClip) setClipButtonState(pendingClip.button);
  pendingClip = null;
  if (playing) { playing.audio.pause(); setClipButtonState(playing.button); URL.revokeObjectURL(playing.url); playing = null; }
}
async function playClip(item, button, target) {
  laboratory?.stopAudio();
  stopPreview();
  const same = playing?.id === item.id || pendingClip?.id === item.id;
  stopClip(); if (same) return;
  window.SoundFeedback?.stop();
  const serial = clipSequence; pendingClip = { id: item.id, button, target };
  setClipButtonState(button, 'loading');
  try { const data = await api('audio', { id: item.id }); if (serial !== clipSequence) return;
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' })), audio = new Audio(url);
    pendingClip = null; playing = { id: item.id, audio, button, url, target };
    audio.onended = () => { if (serial === clipSequence) stopClip(); };
    audio.onerror = () => { if (serial === clipSequence) { stopClip(); toast('音频播放失败'); } };
    clipFeedback = window.SoundFeedback?.bind(audio, button, { initial: 'loading', stop: stopClip });
    await audio.play(); if (serial !== clipSequence) { audio.pause(); return; } setClipButtonState(button, 'playing');
  } catch(error) { if (serial === clipSequence) { stopClip(); toast(error.message, true); } }
}
function renderOutputJobs() {
  const container = $('#results');
  const candidates = [...backgroundJobs].reverse().filter(job => outputJobIds.has(job.id) || ['running', 'queued', 'scheduled', 'paused'].includes(job.status));
  const recent = candidates.flatMap(job => [...job.items].reverse()
    .map(item => ({ jobId: job.id, itemId: item.id, createdAt: WorkHistory.timestamp(item) || WorkHistory.timestamp(job) })))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const recentJobIds = new Set(recent.map(entry => entry.jobId)), recentClipIds = new Set(recent.map(entry => entry.itemId));
  let jobs = candidates.filter((job, index) => recentJobIds.has(job.id) || ['running', 'queued', 'scheduled', 'paused'].includes(job.status) || !job.items.length && index < 10)
    .map(job => ({ ...job, items: job.items.filter(item => recentClipIds.has(item.id)) }));
  const assignedClips = new Set();
  jobs = jobs.map(job => ({ ...job, items: job.items.map(selectedClip).filter(item => {
    if (assignedClips.has(item.id)) return false; assignedClips.add(item.id); return true;
  }) })).filter(job => job.items.length || job.status !== 'complete');
  state.results = jobs.flatMap(job => job.items);
  const pending = jobs.filter(job => ['running', 'queued', 'scheduled', 'paused'].includes(job.status));
  $('#result-count').textContent = `${state.results.length}${pending.length ? ` · ${pending.length} 项处理中` : ''}`;
  $('#export-zip').disabled = state.busy || !!activeGenerationJobs().length || !state.results.length;
  if (!jobs.length) { if (!container.querySelector('.empty')) container.replaceChildren(empty()); return; }
  container.querySelector(':scope > .empty')?.remove();
  const ids = new Set(jobs.map(job => job.id));
  for (const node of [...container.children]) if (!ids.has(node.dataset.outputJobId)) { if (node.contains(playing?.button) || node.contains(pendingClip?.button)) stopClip(); node.remove(); }
  const labels = { queued: '排队中', scheduled: '已预约', paused: '已暂停', running: '处理中', complete: '已完成', partial: '有段落待补做', cancelled: '已停止', failed: '生成失败', interrupted: '已中断' };
  jobs.forEach((job, index) => {
    let card = [...container.children].find(node => node.dataset.outputJobId === job.id);
    if (!card) {
      card = el('article', 'output-job'); card.dataset.outputJobId = job.id;
      const summary = el('div', 'output-job-summary'), mark = el('span', 'output-job-mark');
      const status = el('span', 'output-job-status'); status.setAttribute('role', 'status');
      summary.append(mark, el('p', 'output-job-text'), status, el('span', 'output-job-count'), el('div', 'output-job-actions'));
      card.append(summary, el('p', 'output-job-note'), el('div', 'output-job-clips'));
    }
    if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null);
    const info = GenerationProgress.view(jobTask(job));
    const active = ['running', 'queued', 'scheduled', 'paused'].includes(job.status);
    card.dataset.status = job.status;
    const text = job.rows.map(row => row.text).join(' ');
    card.setAttribute('aria-label', `${text} · ${labels[job.status] || job.status}`);
    card.querySelector('.output-job-summary').classList.toggle('hidden', job.status === 'complete' && job.items.length > 0);
    const status = job.stopping ? '正在停止' : job.status === 'running' ? info.title : labels[job.status];
    const statusNode = card.querySelector('.output-job-status'); if (statusNode.textContent !== status) statusNode.textContent = status;
    statusNode.title = `${job.voiceName} · ${job.characters} 字 · ${active ? '已等待' : '用时'} ${info.elapsed}`;
    const excerpt = card.querySelector('.output-job-text'); excerpt.textContent = text; excerpt.title = text;
    card.querySelector('.output-job-count').textContent = job.deletedCount ? `${info.count} · 已删除 ${job.deletedCount} 段` : info.count;
    card.querySelector('.output-job-count').classList.toggle('hidden', job.total <= 1 && !job.deletedCount);
    const note = card.querySelector('.output-job-note');
    note.textContent = job.error || '';
    note.classList.toggle('hidden', !note.textContent);
    const actionKey = [job.status, job.stopping, job.completed, pendingJobs().length >= 10, state.busy].join(':');
    if (card.dataset.actionKey !== actionKey) {
      card.dataset.actionKey = actionKey;
      card.querySelector('.output-job-mark').replaceChildren(icon(job.status === 'complete' ? 'check' : active ? 'audio-lines' : 'pause'));
      const actions = card.querySelector('.output-job-actions'); actions.replaceChildren();
      if (active && job.managed) {
        const manage = el('button', 'text-button', '查看托管任务'); manage.onclick = showGeneration; actions.append(manage);
      } else if (active) {
        const stop = el('button', 'text-button', job.stopping ? '正在停止…' : job.status === 'queued' ? '取消排队' : '停止生成');
        stop.disabled = !!job.stopping; stop.onclick = () => cancelJob(job.id); actions.append(stop);
      } else if (['failed', 'partial', 'interrupted', 'cancelled'].includes(job.status) && job.completed < job.total) {
        const retry = el('button', 'text-button', '继续未完成段落'); retry.disabled = pendingJobs().length >= 10 || state.busy;
        retry.onclick = async () => { retry.disabled = true; try { const result = await api('jobs-retry', { id: job.id, requestId: window.crypto?.randomUUID?.() }); applyJobs(result, result.id); } catch (error) { toast(error.message, true); card.dataset.actionKey = ''; renderOutputJobs(); } };
        actions.append(retry);
      }
      if (!active) actions.append(jobDeleteButton(job));
    }
    const clips = card.querySelector('.output-job-clips'), clipIds = job.items.map(item => item.id).join(',');
    const versions = job.items.map(item => JSON.stringify([item.id, item.editedWav, (item.editedQuality || item.quality)?.flags]));
    const clipVersions = JSON.stringify(versions);
    if (card.dataset.clipIds !== clipIds || card.dataset.clipVersions !== clipVersions) {
      const previousIds = card.dataset.clipIds ? card.dataset.clipIds.split(',') : [];
      const previousVersions = JSON.parse(card.dataset.clipVersions || '[]');
      const append = previousIds.length > 0 && previousIds.length < job.items.length && previousIds.every((id, index) => job.items[index]?.id === id && previousVersions[index] === versions[index]);
      card.dataset.clipIds = clipIds;
      card.dataset.clipVersions = clipVersions;
      if (job.items.length) renderClips(clips, append ? job.items.slice(previousIds.length) : job.items, append); else clips.replaceChildren();
    }
  });
}
function renderClips(target, items, append = false) {
  if (!append && (playing?.target === target || pendingClip?.target === target)) stopClip();
  const container = typeof target === 'string' ? $(target) : target; if (!append) container.replaceChildren(); if (!items.length) { if (!append) container.append(empty()); return; }
  items.forEach((item, index) => { item = selectedClip(item); const row = el('div','clip'), play = el('button','play'); row.dataset.clipId = item.id; play.dataset.clipText = item.text; setClipButtonState(play); const info = el('div','clip-info'); info.style.minWidth='0'; const title=el('div','clip-title',item.text);title.title=item.text; const name = WorkHistory.voice(item, historyVoiceNames());
    if (target === '#history') {
      const key = historyKey(item), label = el('label', 'history-check history-row-check'), check = el('input', 'history-select'), mark = el('span', 'history-check-mark');
      check.type = 'checkbox'; check.dataset.historyKey = key; check.checked = historySelection.has(key);
      check.setAttribute('aria-label', `选择作品：${WorkHistory.project(item)} · ${item.text}`);
      mark.setAttribute('aria-hidden', 'true'); mark.append(icon('check')); label.append(check, mark); row.append(label);
      row.dataset.historyKey = key; row.style.animationDelay = `${Math.min(index, 7) * 24}ms`;
      row.classList.toggle('is-selected', check.checked);
      check.addEventListener('change', () => { if (historyOperation) return; if (check.checked) historySelection.add(key); else historySelection.delete(key); updateHistorySelection(); });
      const heading = el('div', 'history-clip-heading'); heading.append(el('strong', '', WorkHistory.project(item)), el('time', '', historyDate(item))); info.append(heading);
    }
    const meta = `${name} · ${(Number(item.editedDuration ?? item.duration) || 0).toFixed(1)} 秒${target === '#history' ? ' · ' + (WorkHistory.scene(item) === '__unknown__' ? '未标注用途' : sceneName(WorkHistory.scene(item))) + ' · ' + item.wav : ''}`;
    const metadata = el('div','clip-meta',meta); metadata.title = target === '#history' ? meta : `${meta} · ${item.wav}`;
    info.append(title,metadata); play.addEventListener('click',()=>playClip(item,play,target));
    const actions=el('div','clip-actions'); for(const format of ['wav','mp3']) {const b=el('button','',format.toUpperCase()+' ↓'); b.addEventListener('click',async()=>{try {if((await api('save',{id:item.id,format})).saved)toast('音频已导出');}catch(e){toast(e.message,true);}});actions.append(b);}
    const redo=el('button','','重做');redo.addEventListener('click',async()=>{
      if (item.options?.projectId) { await projectWorkspace.open(item.options.projectId); navigate('projects'); toast('请在项目台词中重做，以保留完整版本记录。'); return; }
      if (item.options?.labId) { await laboratory.open(item.options.labId); navigate('laboratory'); toast('请在实验作品中重做，以保留候选版本。'); return; }
      return generate({ ...item.options, text:item.text, generationGroupId:item.options?.generationGroupId || item.id, batch:false, filename:item.wav.replace(/\.wav$/,''), speaker:item.speaker, prefix:'voice' });
    });actions.append(redo);
    const edit = el('button', '', '版本 / 波形'); edit.onclick = () => openClipEditor(item); actions.append(edit);
    if ((item.editedQuality || item.quality)?.review) metadata.append(el('span', 'clip-quality-badge', '建议核对：' + (item.editedQuality || item.quality).messages.join('；')));
    if(item.duration>=3&&item.duration<=30){const capture=el('button','','存为声音');capture.addEventListener('click',async()=>{const result=await operate('capture',{id:item.id,name:name});if(result)toast('已保存到我的声音 · 参考声音');});actions.append(capture);}
    actions.append(deleteButton('work', item));
    row.append(play,info,actions);container.append(row);
  });
}
function selectedClip(item) {
  const group = item.options?.generationGroupId || item.id;
  const selected = !item.options?.projectId && !item.options?.labId && state.audioSelections?.[group];
  return state.history.find(other => other.id === (selected || item.id)) || item;
}
async function openClipEditor(item) {
  if (item.options?.projectId) {
    await projectWorkspace.open(item.options.projectId); navigate('projects'); return projectWorkspace.openLineEditor(item.options.lineId);
  }
  if (item.options?.labId) {
    await laboratory.open(item.options.labId); navigate('laboratory'); return laboratory.editAudio(item.options.labKey);
  }
  const groupId = item.options?.generationGroupId || item.id;
  const family = state.history.filter(other => other.id === groupId || other.options?.generationGroupId === groupId).sort((a, b) => a.createdAt - b.createdAt);
  const versions = (family.length ? family : [item]).map(other => ({ id: other.id, createdAt: other.createdAt, clips: [other], complete: true }));
  return audioStudio.open({ versions, selectedId: state.audioSelections?.[groupId] || item.id,
    onSelect: async version => { state.audioSelections = await api('audio-select', { groupId, id: version.id }); await refresh(); renderOutputJobs(); } });
}
function historyVoiceNames() { return Object.fromEntries(catalog.voices.map(voice => [voice.id, voice.name])); }
function historyDate(item) { const time = WorkHistory.timestamp(item); return time ? new Date(time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '创作时间未记录'; }
function historyFilters() { return Object.fromEntries(['search', 'project', 'voice', 'scene', 'period', 'duration', 'sort'].map(key => [key, $('#history-' + key).value])); }
function workHistory() {
  const seen = new Set(), items = WorkHistory.standalone(state.history);
  return items.flatMap(item => { const group = item.options?.generationGroupId || item.id; if (seen.has(group)) return []; seen.add(group);
    return [items.find(other => other.id === state.audioSelections?.[group]) || item]; });
}
function filteredHistory() { return WorkHistory.filter(workHistory(), historyFilters(), historyVoiceNames()); }
function historyKey(item) { return item.options?.generationGroupId || item.id; }
function selectedHistory(items = filteredHistory()) { return items.filter(item => historySelection.has(historyKey(item))); }
function updateHistorySelection(items = filteredHistory()) {
  const selected = selectedHistory(items), page = WorkHistory.paginate(items, historyPage, $('#history-page-size').value);
  const selectedOnPage = selectedHistory(page.items).length, locked = !!historyOperation;
  const pageCheck = $('#history-select-page');
  pageCheck.checked = !!page.items.length && selectedOnPage === page.items.length;
  pageCheck.indeterminate = selectedOnPage > 0 && selectedOnPage < page.items.length; pageCheck.disabled = locked || !items.length;
  const summary = selected.length ? `已选 ${selected.length} 条作品${page.total > page.size ? ' · 支持跨页选择' : ''}` : '勾选作品，批量下载或删除';
  if ($('#history-selection-summary').textContent !== summary) $('#history-selection-summary').textContent = summary;
  $('#history-select-all').disabled = locked || !items.length || selected.length === items.length;
  $('#history-select-all').textContent = `全选筛选结果${items.length ? ' · ' + items.length + ' 条' : ''}`;
  $('#history-clear-selection').classList.toggle('hidden', !selected.length); $('#history-clear-selection').disabled = locked;
  $('#history-bulk').classList.toggle('has-selection', !!selected.length);
  $('#history-bulk').classList.toggle('is-processing', locked);
  $('#history-bulk-panel').inert = !selected.length;
  $('#history-bulk-download').disabled = state.busy || locked || !!activeGenerationJobs().length || !selected.length;
  $('#history-bulk-delete').disabled = state.busy || locked || !!pendingJobs().length || !selected.length;
  $('#history-bulk-delete').title = pendingJobs().length ? '请先完成或取消配音任务，再删除作品' : '删除所选作品及其全部版本';
  $('#history-bulk-download').classList.toggle('is-loading', historyOperation === 'download');
  $('#history-bulk-delete').classList.toggle('is-loading', historyOperation === 'delete');
  $('#history-bulk-download').setAttribute('aria-busy', String(historyOperation === 'download'));
  $('#history-bulk-delete').setAttribute('aria-busy', String(historyOperation === 'delete'));
  $('#history-bulk-download-label').textContent = historyOperation === 'download' ? '正在打包…' : '下载所选';
  $('#history-bulk-delete-label').textContent = historyOperation === 'delete' ? '正在删除…' : '删除所选';
  $('#history-bulk-hint').textContent = `按 ${($('#history-export-format').value || 'mp3').toUpperCase()} 格式打包为 ZIP`;
  document.querySelectorAll('.history-select').forEach(check => {
    check.checked = historySelection.has(check.dataset.historyKey); check.disabled = locked;
    check.closest?.('.clip')?.classList.toggle('is-selected', check.checked);
  });
}
function selectHistory(scope, checked = true) {
  if (historyOperation) return;
  const items = filteredHistory(), candidates = scope === 'page' ? WorkHistory.paginate(items, historyPage, $('#history-page-size').value).items : items;
  if (scope === 'clear') historySelection.clear();
  else candidates.forEach(item => { if (checked) historySelection.add(historyKey(item)); else historySelection.delete(historyKey(item)); });
  updateHistorySelection(items);
}
function renderHistoryFilters() {
  const items = workHistory(), names = historyVoiceNames();
  for (const [key, label, getValue, getLabel] of [
    ['project', '全部作品', WorkHistory.project, value => value],
    ['voice', '全部声音', item => WorkHistory.voice(item, names), value => value],
    ['scene', '全部用途', WorkHistory.scene, value => value === '__unknown__' ? '未标注用途' : sceneName(value)]
  ]) {
    const select = $('#history-' + key), previous = select.value;
    const values = [...new Set(items.map(getValue))].sort((a, b) => getLabel(a).localeCompare(getLabel(b), 'zh-CN'));
    select.replaceChildren(); option(select, '', label); values.forEach(value => option(select, value, getLabel(value)));
    select.value = values.includes(previous) ? previous : '';
    if (select.value !== previous) historyPage = 1;
  }
}
function updateHistoryExport(items = filteredHistory()) {
  const active = ['search', 'project', 'voice', 'scene', 'period', 'duration'].some(key => $('#history-' + key).value.trim());
  $('#history-export').disabled = state.busy || !!activeGenerationJobs().length || !items.length;
  $('#history-export-format').disabled = state.busy || !!activeGenerationJobs().length || !items.length;
  $('#history-export-label').textContent = `打包${active ? '筛选结果' : '全部作品'}${items.length ? ' · ' + items.length + ' 条' : ''}`;
  $('#history-export').title = '保存全部匹配作品，包含其他分页中的作品';
  updateHistorySelection(items);
}
function changeHistoryPage(page, focusNavigation = true) {
  historyPage = page; renderHistory();
  $('.history-heading').scrollIntoView({ block: 'start', behavior: 'instant' });
  if (focusNavigation) $('#history-pages [aria-current="page"]')?.focus({ preventScroll: true });
}
function resetHistory() {
  for (const key of ['search', 'project', 'voice', 'scene', 'period', 'duration']) $('#history-' + key).value = '';
  $('#history-sort').value = 'newest'; historyPage = 1; renderHistory();
}
function changeHistoryFilters() { historyPage = 1; renderHistory(); }
function renderHistory() {
  const total = workHistory().length, items = filteredHistory(), page = WorkHistory.paginate(items, historyPage, $('#history-page-size').value);
  const available = new Set(items.map(historyKey));
  for (const key of historySelection) if (!available.has(key)) historySelection.delete(key);
  historyPage = page.page; $('#history-total').textContent = total;
  $('#history-summary').textContent = items.length ? `共找到 ${page.total} 条作品，当前显示第 ${page.start}–${page.end} 条` : total ? '没有找到符合条件的作品，试试换个关键词或清空筛选。' : '第一段快捷配音完成后，会自动保存在这里。';
  renderClips('#history', page.items);
  if (!items.length) {
    const node = total ? empty('暂时没找到这段好声音', '换个关键词，或者放宽筛选条件再看看。') : empty('你的作品，从第一句开始', '写下想说的话，选个喜欢的声音，完成后就会出现在这里。');
    const action = el('button', 'button', total ? '清空筛选，看看全部作品' : '去创作第一段配音');
    action.addEventListener('click', () => { if (total) resetHistory(); else { navigate('editor'); update(); } });
    node.append(action); $('#history').replaceChildren(node);
  }
  $('#history-pagination').classList.toggle('hidden', !items.length);
  $('#history-page-info').textContent = `第 ${page.page} / ${page.pages} 页`;
  $('#history-quick-pages').classList.toggle('hidden', page.pages <= 1);
  $('#history-quick-info').textContent = `${page.page} / ${page.pages} 页`;
  $('#history-previous').disabled = page.page === 1; $('#history-next').disabled = page.page === page.pages;
  const navigation = $('#history-pages'); navigation.replaceChildren();
  const add = (text, destination, disabled = false, current = false) => {
    const button = el('button', current ? 'selected' : '', text); button.disabled = disabled;
    if (current) button.setAttribute('aria-current', 'page');
    button.setAttribute('aria-label', /^\d+$/.test(text) ? `第 ${text} 页` : text);
    button.addEventListener('click', () => changeHistoryPage(destination)); navigation.append(button);
  };
  add('上一页', page.page - 1, page.page === 1);
  page.numbers.forEach((number, index) => { if (index && number > page.numbers[index - 1] + 1) { const dots = el('span', '', '…'); dots.setAttribute('aria-hidden', 'true'); navigation.append(dots); } add(String(number), number, false, number === page.page); });
  add('下一页', page.page + 1, page.page === page.pages);
  updateHistoryExport(items);
  window.CustomSelects?.sync();
}
async function exportHistory() {
  const items = filteredHistory(); if (state.busy || !items.length) return;
  const result = await operate('zip', { ids: items.map(item => item.id), format: $('#history-export-format').value });
  if (result?.saved) toast(`已打包保存 ${result.count} 条作品`);
}
async function downloadSelectedHistory() {
  const items = selectedHistory();
  if (state.busy || historyOperation || activeGenerationJobs().length || !items.length) return;
  historyOperation = 'download'; updateHistorySelection();
  try {
    const result = await operate('zip', { ids: items.map(item => item.id), format: $('#history-export-format').value });
    if (result?.saved) toast(`已下载 ${result.count} 条作品，请在保存位置查看 ZIP 音频包`);
  } finally { historyOperation = null; updateHistorySelection(); }
}
function openHistoryDelete() {
  const items = selectedHistory();
  if (state.busy || historyOperation || pendingJobs().length || !items.length) return;
  pendingDeletion = { kind: 'works', items };
  const groups = new Set(items.map(historyKey)), versions = state.history.filter(item => !item.options?.projectId && groups.has(historyKey(item))).length;
  $('#delete-heading').textContent = `删除这 ${items.length} 条作品？`;
  $('#delete-description').textContent = `将永久删除所选作品的全部 ${versions} 个音频版本及编辑记录，无法撤销。已经导出到其他位置的文件会保留。`;
  $('#delete-item-name').textContent = items.slice(0, 4).map(item => `${WorkHistory.project(item)} · ${item.text}`).join('\n') + (items.length > 4 ? `\n另有 ${items.length - 4} 条作品` : '');
  $('#delete-error').classList.add('hidden'); $('#delete-confirm').textContent = `删除 ${items.length} 条作品`;
  $('#delete-dialog').showModal(); $('#delete-cancel').focus();
}
async function animateHistoryDeletion(ids) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const removed = new Set(ids);
  await Promise.all([...document.querySelectorAll('.history-row-check')].flatMap((check, index) => {
    const row = check.closest('.clip'); if (!removed.has(row.dataset.clipId) || !row.animate) return [];
    return [row.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(24px)' }],
      { duration: 180, delay: Math.min(index, 5) * 24, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})];
  }));
}
async function confirmHistoryDelete() {
  const items = pendingDeletion.items;
  historyOperation = 'delete'; state.busy = true; state.action = 'delete'; update();
  $('#delete-confirm').disabled = true; $('#delete-cancel').disabled = true; $('#delete-confirm').textContent = '正在删除…';
  let deleted = false;
  try {
    const result = await api('delete-works', { ids: items.map(item => item.id) });
    deleted = true;
    if (result.deletedIds.includes(playing?.id) || result.deletedIds.includes(pendingClip?.id)) stopClip();
    $('#delete-dialog').close(); pendingDeletion = null;
    await animateHistoryDeletion(result.deletedIds);
    const removed = new Set(result.deletedIds);
    state.history = state.history.filter(item => !removed.has(item.id)); historySelection.clear();
    if (result.jobs) applyJobs(result.jobs);
    renderHistoryFilters(); renderHistory(); renderOutputJobs();
    await refresh().catch(error => toast(`作品已删除，刷新失败：${error.message}`, true));
    toast(`已删除 ${items.length} 条作品`);
  } catch (error) {
    if (deleted) { historySelection.clear(); await refresh().catch(() => {}); toast('作品已删除，请重新打开作品页查看', true); }
    else { $('#delete-error').textContent = error.message; $('#delete-error').classList.remove('hidden'); }
  } finally {
    historyOperation = null; state.busy = false; state.action = null;
    $('#delete-confirm').disabled = false; $('#delete-cancel').disabled = false; $('#delete-confirm').textContent = `删除 ${items.length} 条作品`; update();
    if (deleted) {
      const focus = $('#history .empty .button') || ($('#history-select-page').disabled ? $('#history-reset') : $('#history-select-page'));
      focus.focus({ preventScroll: true });
    }
  }
}
function downloadBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(1)} KB`;
}
const packageDescriptions = { standard: '视频解说、讲故事、做课程等', light: '自然地读出你的文字', character: '多种角色，适合故事创作', reference: '用熟悉的声音，说新的文案', expressive: '可选 · 保留录音音色，调整情绪、强度与节奏' };
function confirmExpressiveDownload() {
  if (state.busy || pendingJobs().length) return toast('请等待当前任务结束后再下载。');
  const pack = packages.find(pack => pack.id === 'expressive');
  const size = state.hardware?.platform === 'darwin' && state.hardware?.arch === 'arm64' ? pack.mac : pack.win;
  $('#expressive-download-size').textContent = `本机新增声音模型${size}，运行组件另计。下载支持暂停与继续。`;
  $('#expressive-download-error').textContent = '';
  $('#expressive-download-dialog').showModal();
  $('#expressive-download-cancel').focus();
}
function openTaskPackages(options = [], resume, name = '当前创作', projectLocation = {}) {
  const view = $('.view:not(.hidden)')?.id.replace('view-', '') || 'editor';
  const origin = { view, scroll: window.scrollY || 0, focus: document.activeElement?.id,
    project: view === 'projects' ? { ...projectWorkspace?.resourceLocation(), ...projectLocation } : null,
    lab: view === 'laboratory' ? laboratory?.resourceLocation() : null };
  flushSession();
  packageTask = { ids: [...new Set(options.flatMap(requiredPackages))], resume, name, origin };
  localStorage.setItem('shengyue-resource-return-1', JSON.stringify(packageTask));
  navigate('downloads'); renderPackages(); update(); $('#package-task').scrollIntoView({ block: 'center' });
  if (packageTask.ids.includes('expressive')) $('#optional-resources').open = true;
}
async function returnToCreation() {
  if (!packageTask) return;
  const task = packageTask, origin = task.origin || { view: 'editor' };
  try {
    if (task.resume) await task.resume();
    else if (origin.view === 'projects' && origin.project) await projectWorkspace.restoreResourceLocation(origin.project);
    else if (origin.view === 'laboratory' && origin.lab) { await laboratory.restoreResourceLocation(origin.lab); navigate('laboratory', true); }
    else navigate(origin.view, true);
    window.scrollTo(0, origin.scroll || 0);
    if (origin.focus) document.getElementById(origin.focus)?.focus({ preventScroll: true });
    if (task.ids.every(packageReady)) {
      packageTask = null; localStorage.removeItem('shengyue-resource-return-1');
    }
    renderPackageTask(); update();
  } catch (error) { toast('返回创作失败，已保留原位置，可重试：' + error.message, true); }
}
async function prepareAllResources() {
  if (state.busy || pendingJobs().length) return;
  flushSession(); projectWorkspace?.flush(); await laboratory?.flush();
  const defaults = packages.filter(pack => !pack.optional);
  const allReady = defaults.every(pack => packageReady(pack.id));
  const result = await operate('setup', { packages: defaults.map(pack => pack.id), checkUpdates: allReady });
  if (result && packageTask && packageTask.ids.every(packageReady) && !$('#view-account').classList.contains('hidden')) await returnToCreation();
}
function renderResourceSummary() {
  const ready = packageReady;
  const defaults = packages.filter(pack => !pack.optional);
  const missing = defaults.filter(pack => !ready(pack.id));
  const batch = packageDownload?.batch ? packageDownload : null, active = state.action === 'setup' && state.busy;
  const plan = state.resources?.plan;
  const remainingBytes = plan?.packages.filter(pack => !ready(pack.id)).reduce((sum, pack) => sum + pack.downloadBytes, 0);
  $('#resources-state').textContent = !missing.length ? '完整配音功能已就绪' : `已准备 ${defaults.length - missing.length} / ${defaults.length} 项声音资源`;
  $('#resources-size').textContent = !missing.length ? '已安装资源会继续使用，准备完成后可离线配音。'
    : plan ? remainingBytes > 0 ? `预计还需下载 ${downloadBytes(remainingBytes)} 声音文件，运行组件另计。已有文件自动复用，完成后可离线使用。`
      : '已有声音文件待校验，通常无需重复下载；发现缺失或损坏时会自动补齐。运行组件另计。'
      : '自动检查并补齐缺失资源，已有文件会继续使用。';
  const button = $('#resources-prepare');
  button.disabled = state.busy || !!pendingJobs().length;
  button.textContent = active ? packageDownload?.stopping ? '正在暂停…' : '正在准备…' : batch?.status === 'cancelled' ? '继续下载'
    : batch?.status === 'failed' ? '重试准备' : !missing.length ? '检查资源更新' : missing.length === defaults.length ? '一键下载并安装' : '补齐剩余资源';
  button.setAttribute('aria-busy', String(active)); button.onclick = () => prepareAllResources().catch(error => toast(error.message, true));
  const pause = $('#resources-pause'); pause.hidden = !active; pause.disabled = !!packageDownload?.stopping;
  pause.textContent = packageDownload?.stopping ? '正在暂停…' : '暂停下载'; pause.onclick = cancelOperation;
  const panel = $('#resources-progress'); panel.hidden = !batch; panel.dataset.status = batch?.status || '';
  if (!batch) return;
  const packName = packages.find(pack => pack.id === batch.id)?.name;
  $('#resources-progress-title').textContent = batch.stopping ? '正在暂停，已下载内容会保留'
    : batch.status === 'complete' ? '全部资源已下载并校验完成' : batch.status === 'cancelled' ? '准备已暂停，可随时继续'
      : batch.status === 'failed' ? '本次准备未完成，已下载内容会保留'
        : batch.stage === 'runtime' ? '正在准备运行环境' : batch.stage === 'dependencies' ? '正在安装共用配音组件'
          : `${batch.phase === 'verifying' ? '正在校验' : batch.stage === 'download' ? '正在下载' : '正在检查'}${packName || '声音资源'}${batch.packageIndex ? ` · 第 ${batch.packageIndex} / ${batch.packageCount} 项` : ''}`;
  const fraction = batch.status === 'complete' ? 1 : batch.total > 0 && !['runtime', 'dependencies', 'preparing'].includes(batch.stage) ? Math.min(.99, batch.current / batch.total) : null;
  const progress = $('#resources-progress-bar');
  if (fraction === null) progress.removeAttribute('value'); else progress.value = fraction;
  $('#resources-percent').textContent = fraction === null ? '准备中' : `${Math.floor(fraction * 100)}%`;
  $('#resources-progress-detail').textContent = ['failed', 'cancelled'].includes(batch.status) ? batch.message || '已下载的文件会保留，继续时自动补齐。'
    : fraction !== null ? `${downloadBytes(batch.current)} / ${downloadBytes(batch.total)} 声音资源 · 完成全部校验后即可使用`
      : '共用组件只需准备一次，随后自动准备全部缺失的声音资源。';
}
function renderPackageTask() {
  $('#package-task').hidden = !packageTask;
  if (!packageTask) return;
  const missing = packageTask.ids.filter(id => !packageReady(id));
  $('#package-task-title').textContent = '为「' + packageTask.name + '」准备声音';
  $('#package-task-detail').textContent = missing.length ? '本次创作还需：' + missing.map(id => packages.find(pack => pack.id === id)?.name).join('、') + (missing.includes('expressive') ? '。情绪表达是独立可选资源，点击下方按钮查看大小，确认后才下载。上方一键安装仅准备四个基础包。' : '。点击上方按钮一次备齐全部资源，完成后自动返回，文稿和角色设置已保留。') : '所需声音包已准备好，可以返回原来的创作位置。';
  $('#package-task-optional').hidden = !missing.includes('expressive');
  $('#package-task-optional').disabled = state.busy || !!pendingJobs().length;
  $('#package-task-optional').onclick = confirmExpressiveDownload;
  $('#package-task-return').textContent = missing.length ? '先返回创作' : '已准备好，继续创作';
  $('#package-task-return').onclick = returnToCreation;
  for (const card of document.querySelectorAll('.package-card')) {
    const needed = packageTask.ids.includes(card.dataset.package); card.classList.toggle('package-needed', needed);
    const badge = card.querySelector('.package-needed-label'); if (badge) badge.hidden = !needed;
  }
}
function renderPackageDownload() {
  renderResourceSummary();
  for (const card of document.querySelectorAll('.package-card')) {
    const download = !packageDownload?.batch && packageDownload?.id === card.dataset.package ? packageDownload : null;
    const active = download?.status === 'running';
    card.classList.toggle('downloading', active);
    card.classList.toggle('resource-complete', download?.status === 'complete');
    card.classList.toggle('resource-failed', download?.status === 'failed');
    const button = card.querySelector('.package-download');
    button.setAttribute('aria-busy', String(!!active));
    const installed = packageReady(card.dataset.package), present = state.packages.some(pack => pack.id === card.dataset.package && pack.ready);
    button.classList.toggle('package-update', installed || !!download?.updating);
    button.textContent = active ? download.stopping ? '暂停中' : download.stage === 'download' ? download.updating ? '更新中' : '下载中' : download.updating ? '检查中' : '准备中'
      : download?.status === 'cancelled' ? download.updating ? '继续更新' : '继续下载' : download?.status === 'failed' ? download.updating ? '重试更新' : '重试下载' : installed ? '检查更新' : present ? '校验并准备' : '安装';
    button.setAttribute('aria-label', `${button.textContent} · ${packages.find(pack => pack.id === card.dataset.package)?.name || ''}`);
    const ready = card.querySelector('.package-state');
    ready.hidden = !present && !download;
    ready.classList.toggle('package-ready', installed && !active);
    if (!download) ready.replaceChildren(...(installed ? [icon('check')] : []), document.createTextNode(installed ? '已安装' : '待校验'));
    const cancel = card.querySelector('.package-cancel'); cancel.hidden = !active; cancel.disabled = !!download?.stopping;
    cancel.title = download?.updating ? '暂停更新' : '暂停下载';
    cancel.setAttribute('aria-label', `${cancel.title} · ${packages.find(pack => pack.id === card.dataset.package)?.name || ''}`);
    const description = card.querySelector('.package-description');
    description.textContent = packageDescriptions[card.dataset.package];
    description.title = '';
    const panel = card.querySelector('.package-progress'); panel.hidden = !download;
    if (!download) continue;
    panel.dataset.status = download.status;
    const title = download.stopping ? '正在暂停，已下载内容会保留'
      : download.status === 'complete' ? download.updating ? '已是最新版本' : '声音包已就绪' : download.status === 'cancelled' ? download.updating ? '更新已暂停，可继续' : '下载已暂停，可继续'
      : download.status === 'failed' ? '本次下载未完成'
      : download.stage === 'runtime' ? '第 1 步 · 准备声悦定制资源'
      : download.stage === 'dependencies' ? '第 1 步 · 安装声悦定制资源'
      : download.stage === 'download' ? download.phase === 'verifying' ? '第 2 步 · 校验声音文件' : '第 2 步 · 下载所选声音包'
      : download.updating ? '正在检查资源更新' : '正在准备所选声音包';
    card.querySelector('.package-progress-title').textContent = title;
    const progress = card.querySelector('.package-progress-bar');
    const fraction = download.status === 'complete' ? 1 : download.total > 0 ? Math.min(1, Math.max(0, download.current / download.total)) : null;
    if (fraction === null) progress.removeAttribute('value'); else progress.value = fraction;
    card.querySelector('.package-progress-percent').textContent = fraction === null ? '准备中' : `${Math.floor(fraction * 100)}%`;
    card.querySelector('.package-progress-detail').textContent = download.message;
    card.querySelector('.package-progress-meta').textContent = download.total > 0
      ? `${downloadBytes(download.current)} / ${downloadBytes(download.total)}${download.fileCount ? ` · 文件 ${download.fileIndex} / ${download.fileCount}` : ''}`
      : active ? '声悦定制资源准备好后，继续下载当前选择的声音包。' : '';
    const label = active ? download.phase === 'verifying' ? '校验中' : fraction === null ? download.updating ? '检查中' : '准备中' : `${Math.floor(fraction * 100)}%`
      : download.status === 'complete' ? download.updating ? '已是最新' : '已安装' : download.status === 'cancelled' ? '已暂停' : '未完成';
    ready.replaceChildren(...(download.status === 'complete' ? [icon('check')] : []), document.createTextNode(label));
    ready.title = title;
    if (download.status !== 'complete') {
      description.textContent = active && download.total > 0 && download.phase !== 'verifying'
        ? `${downloadBytes(download.current)} / ${downloadBytes(download.total)}` : active ? download.message || title : download.status === 'cancelled' ? `已下载内容会保留，可继续${download.updating ? '更新' : '下载'}` : download.message;
      description.title = download.message || title;
    }
  }
}
function renderPackages() {
  $('#package-grid').replaceChildren();
  $('#optional-package-grid').replaceChildren();
  for (const pack of packages) {
    const installed = packageReady(pack.id);
    const card = el('div', 'card package-card'); card.dataset.package = pack.id;
    const title = el('div', 'package-title'), mark = el('span', 'resource-icon');
    mark.append(icon(({ standard: 'mic', light: 'book-open', character: 'gamepad-2', reference: 'headset', expressive: 'sparkles' })[pack.id]));
    const copy = el('div'); copy.append(el('h3', '', pack.name), el('p', 'package-description', packageDescriptions[pack.id]));
    const needed = el('span', 'package-needed-label', '本次创作需要'); needed.hidden = !packageTask?.ids.includes(pack.id);
    title.append(mark, copy); card.append(needed, title);
    const footer = el('div', 'package-footer');
    footer.append(el('span', 'package-size', state.hardware?.platform === 'darwin' && state.hardware?.arch === 'arm64' ? pack.mac : pack.win));
    const ready = el('span', installed ? 'package-state package-ready' : 'package-state'); ready.hidden = !installed;
    if (installed) ready.append(icon('check'), document.createTextNode('已安装'));
    footer.append(ready);
    const button = el('button', installed ? 'package-download' : 'primary package-download');
    button.disabled = state.busy || !!pendingJobs().length;
    button.setAttribute('aria-label', `${installed ? '检查更新' : '安装'}${pack.name}`);
    button.onclick = () => pack.optional ? confirmExpressiveDownload() : operate('setup', { package: pack.id });
    const cancel = el('button', 'text-button package-cancel'); cancel.hidden = true;
    cancel.setAttribute('aria-label', `暂停下载 · ${pack.name}`); cancel.title = '暂停下载'; cancel.append(icon('pause')); cancel.onclick = cancelOperation;
    footer.append(button, cancel);
    card.append(footer);
    const panel = el('div', 'package-progress'); panel.hidden = true;
    const summary = el('div', 'package-progress-summary sr-only'); summary.setAttribute('role', 'status');
    summary.append(el('strong', 'package-progress-title'), el('span', 'package-progress-percent'));
    const progress = el('progress', 'package-progress-bar'); progress.max = 1; progress.setAttribute('aria-label', `${pack.name}准备进度`);
    panel.append(summary, progress, el('p', 'package-progress-detail sr-only'), el('div', 'package-progress-meta sr-only'));
    card.append(panel); $(pack.optional ? '#optional-package-grid' : '#package-grid').append(card);
  }
  renderPackageDownload(); renderPackageTask();
  const target = $('#device-card'); target.replaceChildren();
  const h = state.hardware, image = el('img', 'device-art'); image.src = 'assets/settings/device.png'; image.alt = ''; image.width = 108; image.height = 78;
  const detail = el('div', 'device-copy'), heading = el('div', 'device-title-row');
  heading.append(el('h2', '', !h ? '当前电脑' : h.platform === 'darwin' ? h.arch === 'arm64' ? 'M 系列 Mac' : 'Intel Mac' : h.platform === 'win32' ? 'Windows x64' : '当前电脑'), el('span', 'device-pill', '当前设备'));
  detail.append(heading, el('p', '', !h ? '暂时无法读取配置，可在“更多帮助”中刷新。' : h.memoryGB < 16 ? '建议使用轻松朗读，先用短句测试本机速度。' : '一键准备完整资源后，即可按创作需要切换声音功能。'));
  target.append(image, detail);
  const metrics = el('div', 'device-metrics');
  for (const [value, label] of [[h?.memoryGB != null ? h.memoryGB + ' GB' : '—', '系统内存'], [h?.freeDiskGB != null ? h.freeDiskGB + ' GB' : '—', '可用磁盘']]) {
    const metric = el('div'); metric.append(el('strong', '', value), el('small', '', label)); metrics.append(metric);
  }
  target.append(metrics);
}
function renderLicense() {
  const license = state.license; if (!license) return;
  const unlocked = workspaceReady;
  $('#workspace').hidden = !unlocked; $('#workspace').inert = !unlocked;
  $('#activation-gate').hidden = unlocked;
  document.body.classList.toggle('activation-view', !unlocked);
  $('#account-plan').textContent = '免费版';
  $('#account-description').textContent = '无需购买或激活，准备好模型即可创作。';
}
async function startWorkspace() {
  if (!workspaceReady) {
    workspaceStarting ||= (async () => {
      if (!workspaceBuilt) await initializeWorkspace();
      await refresh(); await openSession(); renderHomeDraft(); update(); workspaceReady = true;
    })();
    try { await workspaceStarting; } finally { workspaceStarting = null; }
  } else if (!sessionReady) {
    await refresh(); await openSession();
  }
  renderLicense();
}
const activationError = error => error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Error invoking remote method '[^']+': /, '');
async function checkActivation() {
  $('#activation-gate').setAttribute('aria-busy', 'true');
  $('#gate-retry').classList.add('hidden');
  try {
    state.license = await api('license'); renderLicense();
    await startWorkspace();
    firstRunGuide ||= window.createFirstRunGuide({ api, prepare: data => operate('setup', data), cancel: () => api('cancel'), refresh,
      useInstalled: engine => { $('#engine').value = engine; selectVoice('preset:Serena'); update(); saveDraft(); } });
    if (!state.packages.some(pack => pack.ready)) await firstRunGuide.open(state.hardware);
  } catch (error) {
    $('#gate-status').textContent = '暂时无法打开软件：' + activationError(error);
    $('#gate-retry').classList.remove('hidden');
  } finally {
    $('#activation-gate').setAttribute('aria-busy', 'false');
  }
}
async function refresh(){const result=await api('status');Object.assign(state,{history:result.history||[],packages:result.packages||[],references:result.references||[],backgrounds:result.backgrounds||[],audioSelections:result.audioSelections||{},license:result.license,hardware:result.hardware,resources:result.resources});if(!packageDownload&&result.resources?.preparation){const saved=result.resources.preparation;packageDownload={...saved,batch:true,id:saved.package,status:saved.status==='paused'?'cancelled':saved.status};}renderPackages();renderHome();renderRoles();renderHistoryFilters();renderHistory();renderLicense();renderSelection();update();status(readyFor()?'声音已就绪，开始创作吧':'可以先试听，配音前一键准备完整资源');if(result.jobs)applyJobs(result.jobs);}
async function operate(action, data) {
  if (state.busy) return null;
  if (action === 'setup') {
    packageDownload = {id: data.package, batch: Array.isArray(data.packages), updating: state.packages.some(pack => pack.id === data.package && pack.ready), status: 'running', stage: 'preparing', message: '正在检查声音资源…', current: 0, total: null};
  }
  stopPreview(); state.busy = true; state.action = action; update();
  if (action !== 'generate') status('正在准备…');
  try {
    const result = await api(action, data);
    if (action === 'setup') Object.assign(packageDownload, {status: 'complete', stopping: false, current: packageDownload.total || 0, message: '已准备完成，可以开始配音。'});
    return result;
  } catch (error) {
    const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    const cancelled = /取消|已停止/.test(message);
    if (action === 'setup') Object.assign(packageDownload, {status: cancelled ? 'cancelled' : 'failed', stopping: false, message: cancelled ? `已下载的内容会保留，点击“继续${packageDownload.updating ? '更新' : '下载'}”即可接着准备。` : message});
    toast(cancelled ? action === 'generate' ? '已停止生成，已完成的作品会保留。' : '已停止处理，已下载的内容会保留。' : message, !cancelled);
    return null;
  } finally {
    await refresh().catch(error => status(error.message));
    state.busy = false; state.action = null; update();
  }
}
async function generate(data) {
  if (state.busy || submitting || inlineJob()) return null;
  submitting = true; saveDraft(true); update(); stopPreview();
  try {
    validateReferenceTexts(data);
    const result = await api('jobs-submit', { options: data, requestId: window.crypto?.randomUUID?.() });
    inlineJobId = result.id; inlineJobIds.add(result.id); saveInlineJobs();
    applyJobs(result, result.id);
    navigate('editor');
    return result;
  } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); return null; }
  finally { submitting = false; update(); }
}

function rowOptions(row) {
  const base = settings();
  if (row.voiceKey?.startsWith('role:')) {
    const role = roles.find(r => 'role:' + r.id === row.voiceKey), options = role?.options || {};
    const locked = options.mode === 'design' && options.lockVoice !== false;
    return { ...base, ...options, ...(locked ? { lockVoice: true, voiceScopeId: options.voiceScopeId || 'saved-roles',
      voiceId: options.voiceId || row.voiceKey, voiceRevision: options.voiceRevision || '' } : {}),
      ...(options.mode === 'clone' ? { referenceStyle: options.referenceStyle || 'original', referenceText: referenceTextFor(options.referenceId, base.referenceId === options.referenceId ? base.referenceText : options.referenceText || '') } : {}),
      emotion: !canPerform(options) ? 'natural' : locked ? options.emotion || 'natural' : row.emotion || options.emotion || 'natural',
      pace: canPerform(options) && !locked ? row.pace || options.pace || base.pace : options.pace || base.pace,
      instruction: canPerform(options) ? (!locked && row.instruction) || options.instruction || '' : '', text: row.text, filename: row.filename || undefined };
  }
  const voice = currentVoice(row.voiceKey), locked = voice.mode === 'design' && $('#lock-voice').checked;
  return { ...base, mode: voice.mode, speaker: voice.mode === 'preset' ? voice.id : 'Vivian', character: voice.mode === 'design' ? voice.id : undefined,
    ...(voice.mode === 'design' ? { lockVoice: locked, ...quickVoiceIdentity(row.voiceKey || state.voiceKey) } : {}),
    voiceName: voice.name, voiceDescription: voice.mode === 'design' ? (!row.voiceKey || row.voiceKey === state.voiceKey ? base.voiceDescription : voice.prompt || $('#voice-description').value) : '',
    referenceId: voice.mode === 'clone' ? voice.id : undefined, referenceText: voice.mode === 'clone' ? referenceTextFor(voice.id, base.referenceId === voice.id ? base.referenceText : voice.text || '') : '',
    ...(voice.mode === 'clone' ? { referenceStyle: base.referenceStyle || $('#reference-style').value || 'original' } : {}),
    emotion: !canPerform({ ...voice, engine: $('#engine').value, referenceStyle: base.referenceStyle || $('#reference-style').value }) ? 'natural' : locked ? base.emotion : row.emotion || 'natural',
    pace: !locked && canPerform({ ...voice, engine: $('#engine').value, referenceStyle: base.referenceStyle || $('#reference-style').value }) ? row.pace || base.pace : base.pace,
    instruction: !canPerform({ ...voice, engine: $('#engine').value, referenceStyle: base.referenceStyle || $('#reference-style').value }) ? '' : (!locked && row.instruction) || $('#instruction').value,
    text: row.text, filename: row.filename || undefined };
}
function renderScript(){const target=$('#script-rows');target.replaceChildren();state.rows.forEach((row,index)=>{const node=el('div','script-row'),text=el('textarea');text.value=row.text;text.setAttribute('aria-label',`第 ${index+1} 条台词`);text.addEventListener('input',()=>{row.text=text.value;update();saveDraft();});const selects=el('div','row-options'),voice=el('select');voice.id=`script-voice-${index}`;voice.dataset.selectKind='voice';voice.setAttribute('aria-label',`第 ${index+1} 条声音`);voices().forEach(v=>option(voice,v.key,v.name));roles.forEach(r=>option(voice,'role:'+r.id,r.name));voice.value=row.voiceKey||state.voiceKey;voice.addEventListener('change',()=>{row.voiceKey=voice.value;renderScript();update();saveDraft();});const emotion=el('select');emotion.id=`script-emotion-${index}`;emotion.dataset.selectKind='emotion';emotion.setAttribute('aria-label',`第 ${index+1} 条情绪`);catalog.emotions.forEach(e=>option(emotion,e.id,e.name));emotion.value=row.emotion||'natural';emotion.disabled=!canPerform(rowOptions(row))||rowOptions(row).mode==='design'&&rowOptions(row).lockVoice!==false||(currentVoice(row.voiceKey).mode==='preset'&&$('#engine').value==='light');if(rowOptions(row).mode==='design'&&rowOptions(row).lockVoice!==false){emotion.value=rowOptions(row).emotion;emotion.title='跟随人物定声；如需更换表达，请重新定声。';}emotion.addEventListener('change',()=>{row.emotion=emotion.value;saveDraft();});selects.append(voice,emotion);const direction=el('input');direction.value=row.instruction||'';direction.maxLength=500;direction.placeholder='本句表演要求（选填）';direction.setAttribute('aria-label',`第 ${index+1} 条表演要求`);direction.disabled=emotion.disabled;direction.addEventListener('input',()=>{row.instruction=direction.value;saveDraft();});const content=el('div');content.append(text,direction);const filenameArea=el('div'),name=el('input');name.value=row.filename||'';name.placeholder=`voice-${String(index+1).padStart(3,'0')}`;name.setAttribute('aria-label',`第 ${index+1} 条文件名`);name.addEventListener('input',()=>{row.filename=name.value;saveDraft();});const buttons=el('div','row-buttons'),redo=el('button','','生成这句'),remove=el('button','','移除');redo.addEventListener('click',()=>generate({...rowOptions(row),batch:false}));remove.addEventListener('click',()=>{state.rows.splice(index,1);renderScript();update();saveDraft();});buttons.append(redo,remove);filenameArea.append(name,buttons);node.append(content,selects,filenameArea);target.append(node);});window.CustomSelects?.sync();}
function setScript(value,initialize=true){state.script=value;if(value&&initialize&&!state.rows.length)state.rows=$('#text').value.split('\n').filter(t=>t.trim()).map((text,index)=>({text,voiceKey:state.voiceKey,emotion:state.emotion,filename:`${$('#prefix').value}-${String(index+1).padStart(3,'0')}`}));$('#text-panel').classList.toggle('hidden',value);$('#script-panel').classList.toggle('hidden',!value);$('#mode-script').classList.toggle('selected',value);$('#mode-text').classList.toggle('selected',!value);renderScript();update();saveDraft();}
function sessionSnapshot() {
  // Capture editor values too: generation normalizes some fields for the selected engine.
  return { schema: 'shengyue-project-1', text: $('#text').value, rows: state.rows, script: state.script,
    voiceRevisions: { ...quickVoiceRevisions },
    voiceBindings: Object.fromEntries(Object.entries(quickVoiceBindings).map(([key, value]) => [key, { ...value }])),
    voiceKey: state.voiceKey, emotion: state.emotion, batch: $('#batch').checked,
    options: { ...settings(), voiceScopeId: quickVoiceScopeId, project: $('#project-name').value, voiceDescription: $('#voice-description').value, instruction: $('#instruction').value } };
}
function saveDraft(immediate = false) {
  if (!sessionReady) return;
  clearTimeout(draftTimer);
  const revision = ++draftRevision;
  $('#draft-status').textContent = '正在保存…';
  const persist = async () => {
    try {
      const result = await api('session-save', sessionSnapshot());
      if (!result?.saved) throw new Error('自动保存失败');
      if (revision === draftRevision) $('#draft-status').textContent = '已自动保存';
    } catch {
      if (revision === draftRevision) $('#draft-status').textContent = '自动保存失败';
    }
  };
  if (immediate) return persist();
  draftTimer = setTimeout(persist, 250);
}
function restoreSession(project) {
  if (!project || !Array.isArray(project.rows)) return;
  if (project.retiredMarkupNotice) toast('段内拼接功能已撤回；旧标记已转回普通文案，完整原稿已备份。');
  quickVoiceRevisions = project.voiceRevisions && typeof project.voiceRevisions === 'object' && !Array.isArray(project.voiceRevisions) ? { ...project.voiceRevisions } : {};
  quickVoiceBindings = project.voiceBindings && typeof project.voiceBindings === 'object' && !Array.isArray(project.voiceBindings) ? { ...project.voiceBindings } : {};
  state.rows = project.rows.slice(0, 100).map(row => ({ text: String(row.text || ''), voiceKey: String(row.voiceKey || DEFAULT_VOICE_KEY), emotion: String(row.emotion || 'natural'), filename: String(row.filename || ''),
    roleName: String(row.roleName || '').slice(0, 32), pace: String(row.pace || ''), instruction: String(row.instruction || '').slice(0, 500) }));
  $('#text').value = String(project.text || ''); $('#batch').checked = project.batch !== false;
  const options = project.options || {};
  applyRole({ voiceKey: project.voiceKey || DEFAULT_VOICE_KEY, options }, false);
  for (const [id, key] of [['project-name', 'project'], ['prefix', 'prefix'], ['sample-rate', 'sampleRate']]) if (options[key] !== undefined) $('#' + id).value = options[key];
  $('#intensity-label').textContent = Number($('#intensity').value) < 35 ? '克制' : Number($('#intensity').value) < 70 ? '自然' : '鲜明';
  state.emotion = project.emotion || 'natural'; setScript(!!project.script, false); renderEmotions();
}
async function openSession() {
  const saved = await api('session-load');
  let legacy;
  if (!saved) { try { legacy = JSON.parse(localStorage.getItem('shengyue-draft-1')); } catch {} }
  if (saved || legacy) restoreSession(saved || legacy);
  else {
    selectVoice(DEFAULT_VOICE_KEY, false);
    $('#text').value = QUICK_EXAMPLES['warm-female'].text;
    if (state.packages.some(p => p.id === 'light' && p.ready) && !state.packages.some(p => p.id === 'standard' && p.ready)) {
      $('#engine').value = 'light'; renderSelection();
    }
  }
  sessionReady = true;
  const voice = currentVoice();
  if (voice.mode === 'clone' && $('#reference-text').value && !state.references.find(reference => reference.id === voice.id)?.text && !state.references.find(reference => reference.id === voice.id)?.textUpdatedAt) rememberReferenceText();
  if (Object.keys(referenceTextDrafts).length) flushReferenceTexts().catch(error => toast('参考原话保存失败，已保留在本机：' + error.message, true));
  if (saved) $('#draft-status').textContent = '已自动保存';
  if (legacy) await saveDraft(true);
  // Keep a legacy copy until a database write is confirmed.
  if (saved || (legacy && $('#draft-status').textContent === '已自动保存')) localStorage.removeItem('shengyue-draft-1');
}
function flushSession() {
  clearTimeout(draftTimer);
  if (sessionReady) {
    try { window.studio.saveSessionSync(sessionSnapshot()); } catch {}
  }
}
window.studio.onProgress(data => {
  if (!state.license?.activated || !catalog) return;
  if (data.stage === 'delivery') { projectWorkspace?.deliveryProgress(data); return; }
  if (data.type === 'jobs') { applyJobs(data); return; }
  if (data.type === 'open-job') { showJob(data.id); return; }
  if (data.type === 'jobs-note') { toast(data.message); return; }
  firstRunGuide?.progress(data);
  status(data.message);
  if (state.action === 'setup' && packageDownload?.status === 'running' && ['preparing', 'runtime', 'dependencies', 'download'].includes(data.stage)) {
    if (packageDownload.batch && Array.isArray(data.resourcePackages)) state.packages = data.resourcePackages;
    Object.assign(packageDownload, {stage: data.stage, message: data.message, phase: data.downloadPhase});
    if (packageDownload.batch && data.resourcesTotal > 0) {
      Object.assign(packageDownload, {id: data.package, current: data.resourcesCurrent, total: data.resourcesTotal, packageIndex: data.packageIndex, packageCount: data.packageCount});
    } else if (Number.isFinite(data.aggregateTotal) && data.aggregateTotal > 0) {
      Object.assign(packageDownload, {current: data.aggregateCurrent, total: data.aggregateTotal, fileIndex: data.fileIndex, fileCount: data.fileCount});
    }
    renderPackageDownload();
  }
  if (data.resourcesTotal > 0) $('#status-detail').textContent = `${Math.min(99, Math.floor(data.resourcesCurrent / data.resourcesTotal * 100))}% · ${downloadBytes(data.resourcesCurrent)} / ${downloadBytes(data.resourcesTotal)}`;
  else if (data.stage === 'download' && data.aggregateTotal > 0) $('#status-detail').textContent = `${Math.floor(data.aggregateCurrent / data.aggregateTotal * 100)}% · ${downloadBytes(data.aggregateCurrent)} / ${downloadBytes(data.aggregateTotal)}`;
  else if (data.stage === 'download' && data.unit === 'B' && data.total) $('#status-detail').textContent = `${(data.current / 1e9).toFixed(2)} / ${(data.total / 1e9).toFixed(2)} GB`;
  else if (data.current && data.total) $('#status-detail').textContent = `${data.current} / ${data.total}`;
});
async function initializeWorkspace(){catalog=await api('catalog');const builtinVoiceCount=catalog.voices.length+catalog.characters.length;$('#builtin-voice-count').textContent=builtinVoiceCount;$('#voice-library-description').textContent=`${builtinVoiceCount} 种声音，${catalog.templates.length} 套场景模板。按用途、语言和声线挑选，先听再用。`;try{roles=JSON.parse(localStorage.getItem('shengyue-roles-1')||'[]').filter(r=>r&&typeof r.name==='string'&&r.options).slice(0,100);}catch{}catalog.languages.forEach(v=>option($('#language'),v.id,v.name));catalog.scenes.forEach(v=>option($('#scene'),v.id,v.name));renderEmotions();renderSelection();renderSceneFilters();renderLibrary();renderRoles();renderClips('#results',[]);catalog.scenes.forEach(scene=>option($('#voice-picker-scene'),scene.id,scene.name));window.CustomSelects?.init(selectDetails);
  const stopStudioAudio = () => { stopPreview(); stopClip(); projectWorkspace?.stopAudio(); laboratory?.stopAudio(); };
  audioStudio = window.createAudioStudio({ api, toast, refresh: async () => { await refresh(); projectWorkspace?.refreshMedia(); }, stopOtherAudio: stopStudioAudio });
  referenceImporter = window.createReferenceImporter({ api, toast, refresh, stopOtherAudio: stopStudioAudio });
  projectWorkspace = window.createProjectWorkspace({
    api, toast, audioEditor: options => audioStudio.open(options), refresh, showTasks: showGeneration, emotions: catalog.emotions, defaultVoice: () => state.voiceKey,
    navigate: () => { navigate('projects'); update(); }, downloads: openTaskPackages,
    installedVoice: () => state.packages.some(pack => pack.id === 'standard' && pack.ready) ? { key: 'preset:Serena', engine: 'standard' } : state.packages.some(pack => pack.id === 'light' && pack.ready) ? { key: 'preset:Serena', engine: 'light' } : null,
    media: () => ({ history: state.history, jobs: backgroundJobs, backgrounds: state.backgrounds || [] }),
    avatar: key => voiceAvatar(currentVoice(key)), syncPreview: syncPreviewButtons,
    voices: () => [...voices(), ...roles.map(role => ({ key: 'role:' + role.id, name: role.name })), { key: 'design:custom', name: '自定义人物声音' }],
    resolveVoice: key => {
      const saved = key?.startsWith('role:') ? roles.find(role => 'role:' + role.id === key) : null;
      const resolved = saved?.voiceKey || key, voice = voices().find(voice => voice.key === resolved);
      if (!voice && resolved !== 'design:custom') return null;
      const chosen = voice || { mode: 'design', name: '自定义人物', language: 'Chinese', prompt: '' };
      return { mode: chosen.mode, speaker: chosen.mode === 'preset' ? chosen.id : 'Vivian', character: chosen.mode === 'design' ? chosen.id : undefined,
        voiceName: chosen.name, voiceDescription: chosen.prompt || '', referenceId: chosen.mode === 'clone' ? chosen.id : undefined,
        referenceText: chosen.text || '', language: chosen.language || 'Chinese', emotion: 'natural', pace: 'normal', engine: 'standard',
        instruction: '', intensity: 50, scene: 'story', ...(saved?.options || {}),
        ...(chosen.mode === 'clone' ? { referenceText: referenceTextFor(chosen.id, saved?.options?.referenceText || chosen.text || '') } : {}) };
    },
    ready: readyFor, preview: key => previewVoice(key, { inline: true }), canPreview: key => { const voice = currentVoice(key); return !!voice.preview || voice.mode === 'clone'; }, stopOtherAudio: () => { stopPreview(); stopClip(); laboratory?.stopAudio(); },
    submit: async options => {
      if (state.busy) throw new Error('正在准备声音或保存文件，请完成后再生成。');
      validateReferenceTexts(options);
      const result = await api('jobs-submit', { options, requestId: crypto.randomUUID() });
      dockDismissed = false; applyJobs(result, result.id); return result;
    },
    export: async (items, format) => {
      if (activeGenerationJobs().length) { toast('配音正在处理中，完成后即可打包音频。'); return null; }
      return operate('zip', { ids: items.map(item => item.id), items, format });
    }
  });
  $('#convert-project').onclick = () => projectWorkspace.convert({ name: $('#project-name').value, rows: state.rows.map(row => ({ ...row, options: rowOptions(row) })) }).catch(error => toast(error.message, true));
  document.querySelector('[data-view="projects"]').addEventListener('click', () => projectWorkspace.library().catch(error => toast(error.message, true)));
  option($('#voice-language'), '', '不限原生语言');
  initializeHome();
  laboratory = window.createLaboratory({
    audioEditor: options => audioStudio.open(options),
    api, toast, requireVoiceConsent, emotions: catalog.emotions, voices,
    resolveVoice: key => {
      const voice = voices().find(voice => voice.key === key); if (!voice) return null;
      return { mode: voice.mode, speaker: voice.mode === 'preset' ? voice.id : 'Vivian', character: voice.mode === 'design' ? voice.id : undefined,
        voiceName: voice.name, voiceDescription: voice.prompt || '', referenceId: voice.mode === 'clone' ? voice.id : undefined,
        referenceText: voice.text || '', language: voice.language || 'Chinese', engine: 'standard' };
    },
    media: () => ({ history: state.history, jobs: backgroundJobs, backgrounds: state.backgrounds || [] }), ready: readyFor,
    stopOtherAudio: () => { stopPreview(); stopClip(); projectWorkspace?.stopAudio(); }, showTasks: showGeneration,
    downloads: openTaskPackages,
    recordVoice: onSaved => { $('#reference-consent').checked = true; openRecording(onSaved); },
    importVoice: data => referenceImporter.open(data),
    submit: async options => {
      if (state.busy) throw new Error('正在准备声音或保存文件，请完成后再生成。');
      validateReferenceTexts(options);
      const result = await api('jobs-submit', { options, requestId: crypto.randomUUID() });
      dockDismissed = false; applyJobs(result, result.id); return result;
    },
    zip: async ids => { const result = await operate('zip', { ids, format: 'mp3' }); if (result?.saved) toast(`已导出 ${result.count} 段配音`); return result; }
  });
  catalog.languages.filter(language => voices().some(voice => voice.language === language.id)).forEach(language => option($('#voice-language'), language.id, language.name));
  $('#voice-language').onchange = renderLibrary;
  $('#open-templates').onclick = openTemplates;
  $('#template-close').onclick = closeTemplates;
  $('#template-search').addEventListener('input', renderTemplates);
  $('#template-dialog').addEventListener('cancel', event => { event.preventDefault(); closeTemplates(); });
  $('#template-dialog').addEventListener('click', event => { if (event.target === $('#template-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeTemplates(); } });
  $('#undo-template').onclick = () => { if (!templateUndo) return; restoreSession(templateUndo); templateUndo = null; $('#template-applied').classList.add('hidden'); update(); saveDraft(true); toast('已恢复套用前的文稿和设置。'); };
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{navigate(b.dataset.view);if(b.dataset.view==='voices')renderLibrary();if(b.dataset.view==='account')renderPackages();if(b.dataset.view==='history')renderHistory();update();}));document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderLibrary();}));$('#voice-search').addEventListener('input',renderLibrary);
  $('#history-search').addEventListener('input', changeHistoryFilters);
  for (const key of ['project', 'voice', 'scene', 'period', 'duration', 'sort', 'page-size']) $('#history-' + key).addEventListener('change', changeHistoryFilters);
  $('#history-reset').onclick = resetHistory;
  $('#history-select-page').onchange = event => selectHistory('page', event.target.checked);
  $('#history-select-all').onclick = () => selectHistory('all');
  $('#history-clear-selection').onclick = () => selectHistory('clear');
  $('#history-bulk-download').onclick = downloadSelectedHistory;
  $('#history-bulk-delete').onclick = openHistoryDelete;
  $('#history-export-format').addEventListener('change', () => updateHistorySelection());
  $('#delete-confirm').onclick = confirmDelete;
  $('#delete-cancel').onclick = () => $('#delete-dialog').close();
  $('#delete-dialog').addEventListener('cancel', event => { if (state.action === 'delete') event.preventDefault(); });
  $('#delete-dialog').addEventListener('close', () => { pendingDeletion = null; });
  $('#history-previous').onclick = () => changeHistoryPage(historyPage - 1, false); $('#history-next').onclick = () => changeHistoryPage(historyPage + 1, false);
  $('#browse-voices').onclick=openVoicePicker;$('#custom-character').onclick=()=>selectVoice('design:custom');$('#preview-voice').onclick=()=>previewVoice(state.voiceKey, { inline: true });
  $('#reset-parameters').onclick = resetVoiceParameters;
  $('#voice-picker-close').onclick=closeVoicePicker;
  $('#voice-picker-search').addEventListener('input',renderVoicePicker);
  $('#voice-picker-scene').addEventListener('change',renderVoicePicker);
  document.querySelectorAll('[data-picker-filter]').forEach(button=>button.onclick=()=>{pickerFilter=button.dataset.pickerFilter;renderVoicePicker();});
  $('#voice-picker').addEventListener('cancel',event=>{event.preventDefault();closeVoicePicker();});
  $('#voice-picker').addEventListener('click',event=>{if(event.target===$('#voice-picker')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeVoicePicker();}});
  $('#sample-close').onclick=stopPreview; $('#sample-toggle').onclick=()=>{if(samplePlaying)previewVoice(samplePlaying.key);};
  $('#sample-seek').oninput=()=>{if(samplePlaying?.audio.duration)samplePlaying.audio.currentTime=Number($('#sample-seek').value)/1000*samplePlaying.audio.duration;};
  document.querySelectorAll('[data-example]').forEach(button => button.onclick = () => {
    const example = QUICK_EXAMPLES[button.dataset.example];
    applyRole({ voiceKey: example.voiceKey, options: { language: 'Chinese', scene: example.scene, lockVoice: true } }, false);
    $('#text').value = example.text; $('#batch').checked = !!example.batch;
    setScript(false); $('#text').focus();
  });
  $('#goto-downloads').onclick=()=>openTaskPackages(state.script?state.rows.filter(row=>row.text.trim()).map(rowOptions):[settings()],()=>navigate('editor'),$('#project-name').value.trim()||'快速配音');$('#save-role').onclick=saveRole;
  $('#lock-voice').onchange = () => { renderSelection(); renderScript(); update(); saveDraft(); };
  $('#reset-voice').onclick = () => {
    quickVoiceBindings[state.voiceKey] = { ...quickVoiceIdentity(), voiceRevision: crypto.randomUUID() };
    saveDraft(true); toast('下次生成会重新确定这个人物的声音，已有作品会保留。');
  };
  $('#saved-role-select').onchange=()=>{const role=roles.find(r=>r.id===$('#saved-role-select').value);if(role)applyRole(role);};$('#reference-select').onchange=()=>selectVoice('clone:'+$('#reference-select').value);
  $('#mode-text').onclick=()=>setScript(false);$('#mode-script').onclick=()=>setScript(true);$('#add-row').onclick=()=>{if(state.rows.length>=100)return toast('每个项目最多 100 条台词');state.rows.push({text:'',voiceKey:state.voiceKey,emotion:state.emotion,filename:''});renderScript();update();saveDraft();};
  $('#example').onclick=()=>{state.rows=[{text:'救救我们！',voiceKey:'preset:Uncle_Fu',emotion:'afraid',filename:'help-male-1'},{text:'我们在这里！',voiceKey:'preset:Serena',emotion:'urgent',filename:'help-female-2'},{text:'谢谢你！',voiceKey:'preset:Uncle_Fu',emotion:'relief',filename:'rescued-male-1'},{text:'我跟着你！',voiceKey:'preset:Serena',emotion:'relief',filename:'rescued-female-2'}];setScript(true);};
  $('#generate').onclick=()=>{const missing=state.script?state.rows.filter(r=>r.text.trim()).some(row=>!readyFor(rowOptions(row))):!readyFor();if(missing){$('#goto-downloads').onclick();return toast('先准备本次需要的声音包，再返回继续配音。');}stopPreview();return generate(state.script?{...settings(),rows:state.rows.filter(r=>r.text.trim()).map(rowOptions)}:{...settings(),text:$('#text').value,batch:$('#batch').checked});};
  $('#cancel').onclick = cancelOperation; $('#show-generation').onclick = showGeneration;
  $('#background-generation').onclick = moveGenerationToBackground;
  $('#stop-generation').onclick = () => { const job = inlineJob(); if (job) cancelJob(job.id); };
  $('#jobs-close').onclick=()=>$('#jobs-dialog').close();
  $('#jobs-dialog').addEventListener('click',event=>{if(event.target===$('#jobs-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
  $('#generation-results').onclick = async () => {
    const job = backgroundJobs.find(job => job.id === generationTask?.id); if (!job) return;
    if (job.projectId && projectWorkspace) {
      try { await projectWorkspace.listen(job.projectId); } catch (error) { toast(error.message, true); }
    } else showJob(job.id);
  };
  $('#generation-dismiss').onclick = () => { dockDismissed=true;renderGeneration(); };
  $('#export-zip').onclick=async()=>{const result=await operate('zip',{ids:state.results.map(i=>i.id),format:$('#zip-format').value});if(result?.saved)toast(`已导出 ${result.count} 条配音`);};$('#history-export').onclick=exportHistory;
  $('#output-history').onclick = () => { resetHistory(); navigate('history'); };
  $('#logs').onclick=()=>api('logs');$('#refresh-device').onclick=refresh;
  $('#more-help').onclick = () => { const panel = $('#settings-more-help'); panel.hidden = !panel.hidden; $('#more-help').setAttribute('aria-expanded', String(!panel.hidden)); };
  $('#cli-retry').onclick = loadCliConfiguration;
  document.querySelectorAll('[data-cli-copy]').forEach(button => { button.onclick = () => cliAction(button, 'cli-copy', { kind: button.dataset.cliCopy }); });
  $('#cli-save-script').onclick = event => cliAction(event.currentTarget, 'cli-save-script');
  $('#cli-docs').onclick = event => cliAction(event.currentTarget, 'cli-docs');
  $('#license-overview').onclick = () => { $('#license-settings').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('#license-settings').focus({ preventScroll: true }); };
  $('#import-reference').onclick=async()=>{if(!$('#reference-consent').checked)return toast('请先确认你拥有这段录音的使用授权');const result=await referenceImporter.open();if(result)selectVoice('clone:'+result.id);};
  $('#record-reference').onclick = openRecording; $('#recording-start').onclick = startRecording; $('#recording-redo').onclick = startRecording;
  $('#recording-stop').onclick = () => voiceRecorder?.stop(); $('#recording-save').onclick = saveRecording;
  $('#recording-prompt').onclick = () => voiceRecorder?.state.status === 'recording' ? voiceRecorder.stop() : startRecording();
  $('#recording-close').onclick = closeRecording; $('#recording-discard').onclick = closeRecording;
  $('#recording-dialog').addEventListener('cancel', event => { event.preventDefault(); closeRecording(); });
  $('#recording-text').addEventListener('input', () => renderRecording()); $('#recording-name').addEventListener('input', () => renderRecording());
  $('#reference-style').onchange = () => { renderSelection(); renderScript(); update(); saveDraft(); };
  $('#expressive-download-cancel').onclick = () => $('#expressive-download-dialog').close();
  $('#expressive-download-confirm').onclick = async () => {
    $('#expressive-download-dialog').close();
    await operate('setup', { package: 'expressive' });
    if (packageTask && packageTask.ids.every(packageReady)) await returnToCreation();
  };
  $('#recording-example').onclick = () => { $('#recording-text').value = randomRecordingScript($('#recording-text').value); renderRecording(); };
  window.addEventListener('beforeunload', () => { flushSession(); voiceRecorder?.cancel(); if (recordingURL) URL.revokeObjectURL(recordingURL); });
  $('#import-script').onclick=async()=>{try{const file=await api('import-script');if(!file)return;const imported=file.office?ScriptProjects.parse(file.text,file.name,catalog.emotions,parseScript,{scriptMode:'narration'}).chapters.flatMap(chapter=>chapter.lines.map(line=>({text:line.text}))):parseScript(file.text,file.name);if(!imported.length||imported.length>100)throw new Error('脚本需要 1–100 条台词');state.rows=imported.map(row=>{const voice=voices().find(v=>v.name===row.role||v.id===row.role||v.key===row.role);const role=roles.find(r=>r.name===row.role);const emotion=catalog.emotions.find(e=>e.id===row.emotion||e.name===row.emotion);if(row.role&&!voice&&!role)throw new Error('找不到脚本角色：'+row.role);if(row.emotion&&!emotion)throw new Error('找不到脚本情绪：'+row.emotion);return{text:row.text,voiceKey:role?'role:'+role.id:voice?.key||state.voiceKey,emotion:emotion?.id||'natural',filename:row.filename||''};});setScript(true);toast('脚本已导入');}catch(e){toast(e.message,true);}};
  for(const id of ['text','project-name','batch','language','scene','intensity','pace','instruction','engine','prefix','sample-rate','voice-description','reference-text'])$('#'+id).addEventListener(id==='batch'||id==='engine'?'change':'input',()=>{if(id==='reference-text')rememberReferenceText();if(id==='engine'){renderSelection();renderScript();}if(id==='intensity')$('#intensity-label').textContent=Number($('#intensity').value)<35?'克制':Number($('#intensity').value)<70?'自然':'鲜明';update();saveDraft();});
  workspaceBuilt = true;
}
function openContactSupport() {
  $('#gate-contact-dialog').showModal();
  const image = $('#gate-contact-qr'), source = image.dataset.src.trim();
  if (source && image.getAttribute('src') !== source) {
    $('#gate-contact-state').textContent = '正在加载二维码…';
    $('#gate-contact-state').hidden = false;
    $('#gate-contact-qr-frame').hidden = true; $('#gate-contact-caption').hidden = true;
    image.src = source;
  }
}
for (const button of [$('#gate-support'), ...document.querySelectorAll('[data-contact-support]')]) button.onclick = openContactSupport;
$('#gate-contact-qr').addEventListener('load', () => {
  $('#gate-contact-qr-frame').hidden = false; $('#gate-contact-caption').hidden = false;
  $('#gate-contact-state').hidden = true;
});
$('#gate-contact-qr').addEventListener('error', () => {
  $('#gate-contact-qr-frame').hidden = true; $('#gate-contact-caption').hidden = true;
  $('#gate-contact-state').textContent = '二维码未能加载，请关闭后重试。';
  $('#gate-contact-state').hidden = false;
  $('#gate-contact-qr').removeAttribute('src');
});
$('#gate-contact-close').onclick = () => $('#gate-contact-dialog').close();
$('#gate-contact-dialog').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const box = event.currentTarget.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close();
});
for (const [id, action] of [['gate-logs', 'logs'], ['gate-notices', 'notices']]) $('#' + id).onclick = () => api(action).catch(error => { $('#gate-status').textContent = activationError(error); });
$('#gate-retry').onclick = checkActivation;
checkActivation();
