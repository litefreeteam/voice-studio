/* Shared project model and import rules; works in the desktop renderer and Node tests. */
(function (root) {
  const { splitText } = typeof module !== 'undefined' ? require('./text.js') : root.StudioText;
  const SCHEMA = 'shengyue-script-1', LEGACY_TAKE_ID = 'legacy';
  const MAX_LINES = 10000, MAX_CHARACTERS = 500000;
  const id = () => globalThis.crypto.randomUUID();
  const normalize = value => String(value || '').trim().toLocaleLowerCase();
  const copy = value => structuredClone(value);
  function create(name = '未命名配音项目', voiceKey = 'preset:Vivian') {
    const narrator = { id: id(), name: '旁白', aliases: ['叙述', 'Narrator'], voiceKey, emotion: 'natural', pace: 'normal', options: {} };
    return { schema: SCHEMA, id: id(), name, roles: [narrator], chapters: [{ id: id(), name: '第1章', lines: [] }], updatedAt: Date.now() };
  }
  function line(text = '', roleId = '') { return { id: id(), text, roleId, emotion: '', pace: '', filename: '', instruction: '' }; }
  function duplicate(source) {
    validate(source);
    const project = copy(source), roleIds = new Map(project.roles.map(role => [role.id, id()]));
    project.id = id(); project.name = source.name.slice(0, 74) + ' · 副本'; project.updatedAt = Date.now();
    for (const role of project.roles) role.id = roleIds.get(role.id);
    for (const chapter of project.chapters) {
      chapter.id = id();
      for (const line of chapter.lines) {
        line.id = id(); line.roleId = roleIds.get(line.roleId) || '';
        // Original takes cannot select audio generated later in the new project.
        delete line.generationAttempt; delete line.selectedTake;
      }
    }
    return validate(project);
  }
  function fromTemplate(template, catalog, name = template.name) {
    const project = create(name), roles = new Map();
    if (template.deliverySettings) project.deliverySettings = { ...DELIVERY_DEFAULTS, ...copy(template.deliverySettings) };
    project.roles = [];
    const roleForVoice = (voiceKey, name) => {
      if (roles.has(voiceKey)) return roles.get(voiceKey);
      const [mode, voiceId] = String(voiceKey || '').split(':');
      const voice = (mode === 'preset' ? catalog.voices : mode === 'design' ? catalog.characters : [])?.find(voice => voice.id === voiceId);
      if (!voice) throw new Error('场景使用的声音不存在');
      let roleName = (name || voice.name).slice(0, 32), suffix = 2;
      while (project.roles.some(role => normalize(role.name) === normalize(roleName))) roleName = voice.name.slice(0, 27) + ' ' + suffix++;
      const role = { id: id(), name: roleName, aliases: [], voiceKey,
        emotion: template.emotion || 'natural', pace: template.pace || 'normal',
        options: { mode, speaker: mode === 'preset' ? voiceId : 'Vivian', character: mode === 'design' ? voiceId : undefined,
          voiceName: voice.name, voiceDescription: mode === 'design' ? voice.prompt || '' : '',
          language: template.language || voice.language || 'Chinese', scene: template.scene || 'dialogue',
          emotion: template.emotion || 'natural', pace: template.pace || 'normal', intensity: template.intensity ?? 50,
          instruction: template.instruction || '', prefix: template.prefix || 'voice', engine: 'standard', sampleRate: 48000, referenceText: '' } };
      roles.set(voiceKey, role); project.roles.push(role); return role;
    };
    const rows = template.rows?.length ? template.rows : (template.batch ? String(template.text || '').split(/\r?\n/).filter(text => text.trim()) : [String(template.text || '')]).map(text => ({ text, voiceKey: template.voiceKey }));
    project.chapters[0].lines = rows.map(row => ({ ...line(row.text, roleForVoice(row.voiceKey || template.voiceKey, row.roleName).id),
      emotion: row.emotion || '', pace: row.pace || '', filename: row.filename || '', instruction: row.instruction || '' }));
    if (!project.roles.length) roleForVoice(template.voiceKey);
    return validate(project);
  }
  function entries(project) { return project.chapters.flatMap((chapter, ci) => chapter.lines.map((line, li) => ({ line, chapter, ci, li }))); }
  function roleFor(project, name) {
    const key = normalize(name);
    return project.roles.find(role => [role.name, ...(role.aliases || [])].some(value => normalize(value) === key));
  }
  function validate(project) {
    if (!project || project.schema !== SCHEMA || !/^[\w-]{1,64}$/.test(project.id || '') || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 80) throw new Error('请填写 1–80 字的项目名称');
    if (!Array.isArray(project.roles) || !project.roles.length || project.roles.length > 100 || !Array.isArray(project.chapters) || !project.chapters.length || project.chapters.length > 200) throw new Error('项目需要 1–100 个角色、1–200 个章节');
    if (project.targetSeconds !== undefined && (!Number.isFinite(project.targetSeconds) || project.targetSeconds < 0 || project.targetSeconds > 21600)) throw new Error('目标时长应为 0–21600 秒，0 表示不限定');
    if (project.mix !== undefined) validateMix(project.mix);
    if (project.deliverySettings !== undefined) validateDeliverySettings(project.deliverySettings);
    const identifiers = new Set([project.id]), names = new Set();
    const uniqueId = value => { if (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value) || identifiers.has(value)) throw new Error('项目中的编号无效或重复'); identifiers.add(value); };
    for (const role of project.roles) {
      if (!role || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 32 || typeof role.voiceKey !== 'string' || !Array.isArray(role.aliases) || role.aliases.some(alias => typeof alias !== 'string' || alias.length > 32)) throw new Error('角色名称、别名或声音设置不正确');
      uniqueId(role.id);
      for (const name of new Set([role.name, ...role.aliases].map(normalize).filter(Boolean))) {
        if (names.has(name)) throw new Error('角色名称和别名不能与其他角色重复'); names.add(name);
      }
    }
    let count = 0, characters = 0;
    for (const chapter of project.chapters) {
      if (!chapter || typeof chapter.name !== 'string' || !chapter.name.trim() || chapter.name.length > 80 || !Array.isArray(chapter.lines)) throw new Error('章节格式不正确');
      uniqueId(chapter.id);
      for (const item of chapter.lines) {
        if (!item || typeof item.text !== 'string' || item.text.length > 50000 || typeof item.roleId !== 'string' || item.roleId && !project.roles.some(role => role.id === item.roleId) || item.instruction !== undefined && (typeof item.instruction !== 'string' || item.instruction.length > 500)) throw new Error('台词或所属角色不正确');
        if (item.generationAttempt !== undefined && (!item.generationAttempt || typeof item.generationAttempt !== 'object' || Array.isArray(item.generationAttempt) || typeof item.generationAttempt.id !== 'string' || !/^[\w-]{1,64}$/.test(item.generationAttempt.id) || typeof item.generationAttempt.version !== 'string' || !/^[a-f0-9]{32}$/.test(item.generationAttempt.version))) throw new Error('台词生成版本不正确');
        if (item.selectedTake !== undefined && (!item.selectedTake || typeof item.selectedTake !== 'object' || !/^[\w-]{1,64}$/.test(item.selectedTake.id || '') || !/^[a-f0-9]{32}$/.test(item.selectedTake.version || ''))) throw new Error('选定的成品版本无效');
        uniqueId(item.id); count++; characters += item.text.length;
      }
    }
    if (count > MAX_LINES || characters > MAX_CHARACTERS) throw new Error('一个项目最多 1 万条台词、50 万字，请拆成多个项目');
    return project;
  }
  function parse(source, filename, emotions, parseTable, { splitSentences = false, scriptMode = 'dialogue' } = {}) {
    if (typeof source !== 'string' || source.length > MAX_CHARACTERS) throw new Error('一次导入最多 50 万字');
    const emotionByName = new Map(emotions.flatMap(emotion => [[normalize(emotion.name), emotion.id], [emotion.id, emotion.id]]));
    const chapters = [], roleNames = new Set(); let current, pending = 0, customCues = 0;
    const chapter = name => { current = { name: name.trim().slice(0, 80) || '导入章节', lines: [] }; chapters.push(current); };
    const add = (text, role = '', emotion = '', filename = '') => {
      // Markdown rules separate sections; sending them to TTS can return no audio.
      if (!text.trim() || /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text.trim())) return;
      if (!current) chapter('导入章节');
      // An unlabeled quote needs a human assignment; ordinary prose uses the narrator.
      if (scriptMode === 'narration') role = '旁白';
      else if (!role) role = /[“”「」『』]|^\s*["'‘]/.test(text) ? '' : '旁白';
      if (role) roleNames.add(role);
      const knownEmotion = emotionByName.get(normalize(emotion));
      if (emotion && !knownEmotion) customCues++;
      let sentences = [text];
      if (splitSentences) {
        sentences = []; let start = 0;
        for (const match of text.matchAll(/[。！？]+[”」』"']*/g)) {
          const end = match.index + match[0].length; sentences.push(text.slice(start, end)); start = end;
        }
        if (text.slice(start).trim()) sentences.push(text.slice(start));
      }
      const chunks = sentences.flatMap(sentence => splitText(sentence));
      for (const [index, chunk] of chunks.entries()) {
        if (!role) pending++;
        current.lines.push({ text: chunk, role, emotion: knownEmotion || '', instruction: emotion && !knownEmotion ? emotion.slice(0, 500) : '',
          filename: filename && chunks.length > 1 ? filename.slice(0, 75) + '-' + String(index + 1).padStart(3, '0') : filename });
      }
    };
    const isTable = /\.(csv|tsv)$/i.test(filename || '') || /^\s*(?:文本|台词|text)[,\t]/i.test(source);
    if (isTable) {
      for (const row of parseTable(source, filename || '.csv')) {
        if (row.chapter && current?.name !== row.chapter) chapter(row.chapter);
        add(row.text, row.role, row.emotion, row.filename);
      }
    } else {
      for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const text = raw.trim(); if (!text) continue;
        if (/^#{1,3}\s+\S/.test(text) || /^第[\d一二三四五六七八九十百零〇两]+[章幕节回卷](?:\s|[：:、.]|$)/.test(text)) { chapter(text.replace(/^#{1,3}\s+/, '')); continue; }
        if (scriptMode === 'narration') { add(text, '旁白'); continue; }
        const match = text.match(/^([^：:\n，,。！？!?；;“”「」]{1,32}?)\s*[：:]\s*(.+)$/);
        if (!match) { add(text); continue; }
        const label = match[1].trim();
        const explicit = /^(?:旁白|叙述|narrator)$/i.test(label) ||
          /^(?:角色|人物|speaker|character)\s*[\p{L}\p{N}_-]+$/iu.test(label) || /[（(\[][^）)\]]+[）)\]]$/.test(label);
        // A time, URL scheme or drive path is ordinary prose, not a speaker.
        // Ambiguous digit:digit text is kept intact rather than silently removed.
        if (!explicit && (/\d\s*$/.test(label) && /^\d/.test(match[2]) ||
            /(?:https?|ftp|file)$/i.test(label) && /^\/\//.test(match[2]) || /^[a-z]$/i.test(label) && /^[\\/]/.test(match[2]) ||
            /^(?:https?|ftp|file|mailto|tel|urn|data)$/i.test(label) || /[\\/@=]/.test(label))) { add(text); continue; }
        let speaker = match[1].trim(), content = match[2], emotion = '';
        const cue = speaker.match(/^(.*?)\s*[（(\[]([^）)\]]+)[）)\]]$/);
        if (cue) { speaker = cue[1].trim(); emotion = cue[2]; }
        const leading = content.match(/^[（(\[【]([^）)\]】]+)[）)\]】]\s*(.*)$/);
        if (leading) { emotion = leading[1]; content = leading[2]; }
        // A colon in a full narrative sentence isn't a reliable character label.
        if (!speaker || speaker.length > 24 || /(?:说|问|喊|答|说道|问道|回答|回答道|写道|提醒道)$/.test(speaker) ||
            !explicit && (/^(?:教学目标|知识点|注意事项|课程目标|温馨提示|活动时间|活动地点|地址|电话|价格|售价|卖点|提示|说明|总结|步骤\d*)$/.test(speaker) ||
              /(?:放下|拿起|走进|转身|抬头|看着|笑着|摇头|点头|推开|低声|大声|地说|了|着|过)/.test(speaker))) add(text);
        else add(content.replace(/^[“「『]([\s\S]*)[”」』]$/, '$1'), speaker, emotion);
      }
    }
    const count = chapters.reduce((sum, chapter) => sum + chapter.lines.length, 0);
    if (!count) throw new Error('没有找到可以导入的台词');
    if (count > MAX_LINES || chapters.length > 200) throw new Error('一次最多导入 1 万条台词、200 个章节');
    return { chapters: chapters.filter(chapter => chapter.lines.length), roleNames: [...roleNames], count, pending, customCues };
  }
  // An estimate for planning copy; complete recordings always take precedence.
  function durationEstimate(entries, pauseMs = 350) {
    const rows = entries.filter(entry => entry.line.text.trim());
    let seconds = 0, recorded = 0;
    for (const entry of rows) {
      if (entry.status === 'complete' && entry.clips?.length && entry.clips.every(clip => Number.isFinite(clip.duration) && clip.duration > 0)) {
        seconds += entry.clips.reduce((sum, clip) => sum + (clip.editedDuration ?? clip.duration), 0); recorded++; continue;
      }
      const text = entry.line.text, cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
      const words = (text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
      const pace = { slow: .8, normal: 1, fast: 1.2 }[entry.options?.pace] || 1;
      seconds += (cjk / 4 + words / 2.5 + (text.match(/[。！？!?；;]/g) || []).length * .25) / pace;
    }
    return { seconds: seconds + Math.max(0, rows.length - 1) * pauseMs / 1000, recorded, total: rows.length, estimated: recorded < rows.length };
  }
  function importInto(project, parsed, mappings, mode, chapterId) {
    const result = copy(project), roleMap = new Map();
    for (const name of parsed.roleNames) {
      const mapping = mappings[name] || {}, existing = result.roles.find(role => role.id === mapping.roleId) || roleFor(result, name);
      if (existing) {
        if (mapping.roleId && !roleFor(result, name) && name.length <= 32) existing.aliases.push(name);
        roleMap.set(name, existing.id); continue;
      }
      const role = { id: id(), name: name.slice(0, 32), aliases: [], voiceKey: mapping.voiceKey || '', emotion: 'natural', pace: 'normal', options: {} };
      result.roles.push(role); roleMap.set(name, role.id);
    }
    const imported = parsed.chapters.map(chapter => ({ id: id(), name: chapter.name, lines: chapter.lines.map(item => ({ ...line(item.text, roleMap.get(item.role) || ''), emotion: item.emotion, instruction: item.instruction || '', filename: item.filename || '' })) }));
    if (mode === 'append' || mode === 'replace') {
      const target = result.chapters.find(chapter => chapter.id === chapterId) || result.chapters[0];
      target.lines = [...(mode === 'append' ? target.lines : []), ...imported.flatMap(chapter => chapter.lines)];
    } else if (result.chapters.length === 1 && !result.chapters[0].lines.length) result.chapters = imported;
    else result.chapters.push(...imported);
    validate(result); return result;
  }
  function voiceOptions(role, resolveVoice) {
    const base = resolveVoice(role.voiceKey);
    if (!base) return null;
    const result = { ...base, ...role.options, emotion: role.emotion || 'natural', pace: role.pace || 'normal' };
    // Reference transcripts belong to the recording, not stale copies in project role settings.
    if (result.mode === 'clone' && result.referenceId === base.referenceId && base.referenceText !== undefined) result.referenceText = base.referenceText;
    if (result.mode === 'clone' && result.referenceStyle !== 'expressive' || result.mode === 'preset' && result.engine === 'light') { result.emotion = 'natural'; result.instruction = ''; }
    return result;
  }
  function optionsFor(project, entry, resolveVoice) {
    const role = project.roles.find(role => role.id === entry.line.roleId);
    if (!role?.voiceKey) return null;
    const base = voiceOptions(role, resolveVoice); if (!base) return null;
    const lockVoice = base.mode === 'design' && base.lockVoice !== false;
    const canPerform = (base.mode !== 'clone' || base.referenceStyle === 'expressive') && !(base.mode === 'preset' && base.engine === 'light');
    const options = { ...base, ...(base.mode === 'design' ? { lockVoice, voiceRevision: base.voiceRevision || '' } : {}),
      emotion: canPerform ? (!lockVoice && entry.line.emotion) || base.emotion : 'natural', pace: canPerform ? (!lockVoice && entry.line.pace) || base.pace : 'normal', intensity: canPerform ? base.intensity : 50, instruction: canPerform ? (!lockVoice && entry.line.instruction) || base.instruction : '',
      text: entry.line.text, prefix: 'voice', project: project.name, projectId: project.id, chapterId: entry.chapter.id, lineId: entry.line.id,
      roleId: role.id, roleName: role.name, chapterName: entry.chapter.name, sampleRate: 48000,
      filename: entry.line.filename || `${String(entry.ci + 1).padStart(3, '0')}-${String(entry.li + 1).padStart(5, '0')}-${role.name.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24) || 'voice'}` };
    if (lockVoice && base.voiceAnchorSignature !== voiceSettingsSignature(options)) delete options.voiceAnchorId;
    return options;
  }
  // A deterministic 128-bit content signature ignores display-only renames.
  function fingerprint(options, voiceSettings = false) {
    if (!options) return '';
    const keys = ['text', 'mode', 'speaker', 'character', 'voiceDescription', 'referenceId', 'referenceText', 'language', 'engine', 'emotion', 'pace', 'intensity', 'instruction', 'sampleRate'];
    // Leave legacy signatures intact; opting into a different model invalidates
    // only that voice's audio and captures its scene/performance settings.
    if (options.mode === 'clone' && options.referenceStyle === 'expressive') keys.push('referenceStyle', 'scene');
    // Voice setup signatures keep their original format so existing anchors remain valid.
    // Audio signatures include role identity; old incomplete signatures intentionally expire.
    if (options.mode === 'design' && options.roleId) keys.push('lockVoice', 'voiceRevision', 'scene', ...(voiceSettings ? [] : ['projectId', 'roleId', ...(options.lockVoice !== false ? ['voiceAnchorId'] : [])]));
    else if (options.mode === 'design') keys.push('lockVoice', 'voiceScopeId', 'voiceId', 'voiceRevision', 'scene');
    else if (!voiceSettings && options.mode === 'preset' && options.engine !== 'light') keys.push('scene');
    const source = JSON.stringify(keys.map(key => options[key] ?? null));
    let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762;
    for (let i = 0; i < source.length; i++) {
      const k = source.charCodeAt(i);
      a = b ^ Math.imul(a ^ k, 597399067); b = c ^ Math.imul(b ^ k, 2869860233);
      c = d ^ Math.imul(c ^ k, 951274213); d = a ^ Math.imul(d ^ k, 2716044179);
    }
    a = Math.imul(c ^ (a >>> 18), 597399067); b = Math.imul(d ^ (b >>> 22), 2869860233);
    c = Math.imul(a ^ (c >>> 17), 951274213); d = Math.imul(b ^ (d >>> 19), 2716044179);
    return [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a].map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function voiceSettingsSignature(options) { return JSON.stringify([options.projectId, options.roleId, fingerprint({ ...options, text: '' }, true)]); }
  function audioIndex(history, projectId) {
    const index = new Map(); index.lineIds = new Set();
    for (const item of history) {
      const o = item.options;
      if (o?.projectId !== projectId || !o.lineId || !o.lineVersion) continue;
      const key = o.lineId + '\n' + o.lineVersion;
      index.lineIds.add(o.lineId);
      if (!index.has(key)) index.set(key, new Map());
      const takes = index.get(key), takeId = o.lineTakeId || LEGACY_TAKE_ID;
      if (!takes.has(takeId)) takes.set(takeId, new Map());
      const parts = takes.get(takeId), previous = parts.get(o.partIndex || 0);
      if (!previous || (item.createdAt || 0) > (previous.createdAt || 0)) parts.set(o.partIndex || 0, item);
    }
    return index;
  }
  function lineState(entry, options, index, pending = new Set()) {
    const version = fingerprint(options), key = entry.line.id + '\n' + version, takes = index.get(key);
    const attempt = entry.line.generationAttempt;
    const selected = entry.line.selectedTake;
    const takeId = selected?.version === version ? selected.id : attempt?.version === version ? attempt.id : undefined;
    const latest = takes && [...takes.values()].sort((a, b) => Math.max(...[...b.values()].map(item => item.createdAt || 0)) - Math.max(...[...a.values()].map(item => item.createdAt || 0)))[0];
    const parts = takeId === undefined ? latest : takes?.get(takeId);
    const clips = parts ? [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item) : [];
    if (!options) return { status: 'unassigned', clips: [] };
    if (pending.has(key)) return { status: 'pending', clips };
    if (clips.length && clips.length === (clips[0].options.partCount || 1) && clips.every((clip, i) => (clip.options.partIndex || 0) === i && (clip.options.partCount || 1) === clips.length)) return { status: 'complete', clips };
    const outdated = index.lineIds?.has(entry.line.id);
    return { status: outdated ? 'changed' : 'new', clips };
  }
  function exportItems(entries) {
    return entries.flatMap(entry => entry.clips.map(clip => {
      const partIndex = clip.options.partIndex || 0, partCount = clip.options.partCount || 1;
      return { id: clip.id, editRevision: clip.editedWav || '', exportFilename: partCount > 1 ? entry.options.filename.slice(0, 75) + '-' + String(partIndex + 1).padStart(3, '0') : entry.options.filename,
        projectId: entry.options.projectId, chapterId: entry.chapter.id, lineId: entry.line.id, chapterOrder: entry.ci, lineOrder: entry.li, partIndex };
    }));
  }
  const DELIVERY_DEFAULTS = Object.freeze({ sampleRate: 48000, normalize: true, trimSilence: false, pauseMs: 350, includeSegments: true });
  function validateDeliverySettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key => !Object.hasOwn(DELIVERY_DEFAULTS, key)) ||
      ![24000, 44100, 48000].includes(settings.sampleRate) ||
      ['normalize', 'trimSilence', 'includeSegments'].some(key => typeof settings[key] !== 'boolean') ||
      !Number.isInteger(settings.pauseMs) || settings.pauseMs < 0 || settings.pauseMs > 3000) throw new Error('成品导出设置无效');
    return settings;
  }
  function validateMix(mix) {
    if (!mix || typeof mix !== 'object' || Array.isArray(mix) || Object.keys(mix).some(key => !['backgroundId', 'gainDb', 'loop', 'ducking', 'offsetMs'].includes(key)) ||
      typeof mix.backgroundId !== 'string' || mix.backgroundId && !/^[a-f0-9]{32}$/.test(mix.backgroundId) ||
      typeof mix.gainDb !== 'number' || !Number.isFinite(mix.gainDb) || mix.gainDb < -60 || mix.gainDb > 0 ||
      typeof mix.loop !== 'boolean' || typeof mix.ducking !== 'boolean' || !Number.isFinite(mix.offsetMs) || mix.offsetMs < 0 || mix.offsetMs > 3600000) throw new Error('背景音乐设置无效');
    return mix;
  }
  function takeVersions(entry, options, index) {
    const version = fingerprint(options), takes = index.get(entry.line.id + '\n' + version);
    return [...(takes || new Map())].map(([id, parts]) => {
      const clips = [...parts].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
      const complete = !!clips.length && clips.length === (clips[0].options.partCount || 1) && clips.every((clip, i) => (clip.options.partIndex || 0) === i && (clip.options.partCount || 1) === clips.length);
      return { id, version, clips, complete, createdAt: Math.max(...clips.map(item => item.createdAt || 0)) };
    }).sort((a, b) => a.createdAt - b.createdAt);
  }
  function deliveryReadiness(source) {
    const entries = source.filter(entry => entry.line.text.trim());
    const ready = entries.filter(entry => entry.status === 'complete' && entry.options && entry.clips.length &&
      entry.clips.length === (entry.clips[0].options.partCount || 1) && entry.clips.every((clip, index) =>
        (clip.options.partIndex || 0) === index && (clip.options.partCount || 1) === entry.clips.length));
    const complete = ready.length, pending = entries.filter(entry => entry.status === 'pending').length;
    const changed = entries.filter(entry => entry.status === 'changed').length;
    return { entries, ready, total: entries.length, complete, pending, changed, missing: entries.length - complete - pending - changed,
      skipped: entries.length - complete, canExport: entries.length > 0 && complete === entries.length };
  }
  function freezeDelivery(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freezeDelivery); }
    return value;
  }
  function deliverySnapshot({ project, entries, settings = {}, allowPartial = false, scopeLabel = '' }) {
    const readiness = deliveryReadiness(entries);
    if (!readiness.total) throw new Error('此范围没有台词，请调整导出范围。');
    if (!readiness.complete) throw new Error('此范围还没有完整可用的台词，请先完成配音。');
    if (!readiness.canExport && allowPartial !== true) throw new Error('此范围尚未完整。请补齐配音，或明确确认只导出已完成台词。');
    const configured = { ...DELIVERY_DEFAULTS, ...project.deliverySettings, ...settings };
    if (![24000, 44100, 48000].includes(configured.sampleRate) || !Number.isInteger(configured.pauseMs) || configured.pauseMs < 0 || configured.pauseMs > 3000 ||
      ['normalize', 'trimSilence', 'includeSegments'].some(key => typeof configured[key] !== 'boolean')) throw new Error('请检查导出设置，句间停顿须为 0–3000 毫秒。');
    const items = exportItems(readiness.ready);
    if (project.mix) validateMix(project.mix);
    return freezeDelivery(copy({ projectId: project.id, projectName: project.name, scopeLabel, items, settings: configured, ...(project.mix ? { mix: project.mix } : {}),
      partial: !readiness.canExport, totalLines: readiness.total, exportedLines: readiness.complete, skippedLines: readiness.skipped,
      summary: { total: readiness.total, complete: readiness.complete, pending: readiness.pending, changed: readiness.changed, missing: readiness.missing } }));
  }
  // A request-scoped controller keeps export cancellation separate from audio generation.
  function createDeliveryController({ api, onChange = () => {}, requestId = id }) {
    let state = { phase: 'idle', snapshot: null, requestId: '', progress: null, error: '', result: null }, token = 0, pending = null;
    const active = () => ['running', 'cancelling'].includes(state.phase);
    const update = patch => { state = { ...state, ...patch }; onChange(state); };
    function submit(snapshot) {
      if (active()) return pending;
      const current = ++token, frozen = freezeDelivery(copy(snapshot)), request = requestId();
      update({ phase: 'running', snapshot: frozen, requestId: request, progress: null, error: '', result: null });
      let operation;
      try { operation = api('project-export', { ...copy(frozen), requestId: request }); } catch (error) { operation = Promise.reject(error); }
      pending = Promise.resolve(operation).then(result => {
        if (current === token) update({ phase: result?.saved ? 'complete' : 'cancelled', result, error: '' });
        return result;
      }).catch(error => {
        if (current === token) update({ phase: state.phase === 'cancelling' ? 'cancelled' : 'failed', error: state.phase === 'cancelling' ? '' : String(error.message || error) });
        return null;
      }).finally(() => { if (current === token) pending = null; });
      return pending;
    }
    async function cancel() {
      if (!active() || state.phase === 'cancelling') return false;
      const current = token, request = state.requestId;
      update({ phase: 'cancelling', error: '' });
      try { return await api('project-export-cancel', { requestId: request }); }
      catch (error) { if (current === token && state.phase === 'cancelling') update({ phase: 'running', error: '未能停止导出：' + String(error.message || error) }); return false; }
    }
    function reset() {
      if (active()) Promise.resolve(api('project-export-cancel', { requestId: state.requestId })).catch(() => {});
      token++; pending = null; update({ phase: 'idle', snapshot: null, requestId: '', progress: null, error: '', result: null });
    }
    function progress(event) {
      if (event.stage !== 'delivery' || event.requestId !== state.requestId || !active() || event.projectId && event.projectId !== state.snapshot?.projectId) return false;
      update({ progress: copy(event) }); return true;
    }
    return { submit, cancel, reset, progress, active, getState: () => state };
  }
  const model = { SCHEMA, LEGACY_TAKE_ID, MAX_LINES, MAX_CHARACTERS, create, line, duplicate, fromTemplate, entries, roleFor, validate, parse, importInto, optionsFor, fingerprint, voiceSettingsSignature, audioIndex, lineState, takeVersions, validateMix, splitText, durationEstimate, exportItems, DELIVERY_DEFAULTS, deliveryReadiness, deliverySnapshot, createDeliveryController };
  if (typeof module !== 'undefined') module.exports = model; else root.ScriptProjects = model;
})(typeof window !== 'undefined' ? window : globalThis);
