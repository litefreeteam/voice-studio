(function (root) {
  const { splitText } = typeof module !== 'undefined' ? require('./text.js') : root.StudioText;
  const kinds = {
    variants: { name: '一稿多配', icon: 'audio-lines', description: '同一份文案，听听不同声音与语气。', color: 'lilac' },
    comic: { name: '聊天短剧 / 有声漫画', icon: 'message-circle', description: '把对白和图片，演成一段有声小剧场。', color: 'peach' },
    family: { name: '家人声音专属故事', icon: 'heart', description: '让熟悉的声音，讲一个属于你的故事。', color: 'mint' },
    buttons: { name: '语音按钮 / 祝福卡', icon: 'sparkles', description: '收藏有趣的短句，送出有声音的祝福。', color: 'rose' }
  };
  // Original stories ship with the app; no remote writing service is involved.
  const stories = [
    { id: 'stars', name: '把星星送回家', text: '{{name}}喜欢{{interest}}。这天晚上，一颗小星星落在窗台上，轻轻地说：“我找不到回家的路了。”\n{{name}}找来一张纸，画了一条通往天空的小路。路旁有弯弯的月亮，还有亮晶晶的银河。\n小星星沿着画里的路，慢慢飞起来。它回过头说：“谢谢你，{{name}}。明天晚上，我还会在窗外和你打招呼。”\n{{name}}盖好被子，望着窗外眨眼睛的星星，带着一个温暖的梦睡着了。' },
    { id: 'forest', name: '森林里的小小邮差', text: '清晨，{{name}}收到一个小包裹。里面是一顶绿色帽子，还有一封写着“请送给森林朋友”的信。\n{{name}}最喜欢{{interest}}，于是带着自己的好奇心出发了。小兔子指了指树洞，小松鼠送来一颗松果当路标。\n走到大树下，{{name}}发现收信人是一只正在等朋友的小刺猬。信里写着：“今天我们一起玩吧！”\n原来，送到朋友手里的不只是一封信，还有一天的好心情。{{name}}也加入了这场快乐的聚会。' },
    { id: 'boat', name: '勇敢的小纸船', text: '{{name}}把喜欢的{{interest}}画在一张纸上，小心地折成一只纸船。\n雨停了，小纸船沿着浅浅的水流出发。遇见小石头，它轻轻转个弯；遇见落叶，它停下来打个招呼。\n{{name}}沿着岸边慢慢走，发现每一个小小的转弯，都能带来不一样的风景。\n太阳出来了。{{name}}把纸船收起来，笑着说：“今天我们走了好远。下次，还要一起出发！”' }
  ];
  const uid = () => root.crypto.randomUUID();
  function create(type) {
    if (!Object.hasOwn(kinds, type)) throw new Error('实验类型不存在');
    return { schema: 'shengyue-lab-1', id: uid(), type, name: kinds[type].name, updatedAt: Date.now(),
      text: '忙碌的一天，也别忘了给自己一点温暖。', voiceKeys: ['preset:Vivian', 'preset:Dylan'], emotions: ['natural', 'happy'],
      voiceKey: 'preset:Serena', child: '朵朵', interest: '画画', storyId: 'stars', story: stories[0].text,
      roles: [{ id: 'a', name: '小鹿', voiceKey: 'preset:Vivian' }, { id: 'b', name: '小熊', voiceKey: 'preset:Dylan' }],
      lines: type === 'buttons' ? [
        { id: uid(), roleId: 'a', title: '欢迎回来', text: '欢迎回来，今天也辛苦啦！', emotion: 'happy', image: '' },
        { id: uid(), roleId: 'a', title: '生日快乐', text: '生日快乐！愿你每一个小小的愿望，都能慢慢实现。', emotion: 'gentle', image: '' },
        { id: uid(), roleId: 'b', title: '给你加油', text: '别着急，一步一步来。你已经做得很好了！', emotion: 'natural', image: '' }
      ] : [
        { id: uid(), roleId: 'a', title: '', text: '你听见了吗？树洞里好像有声音。', emotion: 'natural', image: '' },
        { id: uid(), roleId: 'b', title: '', text: '别担心，原来是小松鼠在准备欢迎会！', emotion: 'happy', image: '' }
      ], favorites: [], pause: 350, theme: 'lavender', cover: '', caption: '把心意，说给你听。' };
  }
  function validate(doc) {
    if (!doc || doc.schema !== 'shengyue-lab-1' || !/^[\da-f-]{36}$/.test(doc.id || '') || !Object.hasOwn(kinds, doc.type)) throw new Error('实验作品格式不正确');
    if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 80) throw new Error('请填写 1–80 字的作品名称');
    for (const key of ['text', 'story', 'child', 'interest', 'caption', 'voiceKey', 'theme']) if (typeof doc[key] !== 'string') throw new Error('实验内容格式不正确');
    if (doc.text.length > 5000 || doc.story.length > 5000 || doc.child.length > 40 || doc.interest.length > 80 || doc.caption.length > 60) throw new Error('文稿过长，请缩短后再保存');
    if (!Array.isArray(doc.roles) || doc.roles.length < 1 || doc.roles.length > 12 || doc.roles.some(role => !role || typeof role.id !== 'string' || !role.id || role.id.length > 80 || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 40 || typeof role.voiceKey !== 'string') || new Set(doc.roles.map(role => role.id)).size !== doc.roles.length) throw new Error('请保留 1–12 个有效角色，并填写角色名');
    if (!Array.isArray(doc.lines) || doc.lines.length > 80 || doc.lines.some(line => !line || typeof line.id !== 'string' || !line.id || line.id.length > 80 || typeof line.roleId !== 'string' || typeof line.text !== 'string' || line.text.length > 600 || typeof line.title !== 'string' || line.title.length > 40 || typeof line.emotion !== 'string') || new Set(doc.lines.map(line => line.id)).size !== doc.lines.length) throw new Error('每个作品最多 80 句，每句最多 600 字');
    if (!Array.isArray(doc.voiceKeys) || doc.voiceKeys.length > 6 || doc.voiceKeys.some(key => typeof key !== 'string') || !Array.isArray(doc.emotions) || doc.emotions.length > 4 || doc.emotions.some(key => typeof key !== 'string')) throw new Error('最多选择 6 个声音和 4 种语气');
    if (!Array.isArray(doc.favorites) || doc.favorites.length > 100 || doc.favorites.some(key => typeof key !== 'string')) throw new Error('收藏内容格式不正确');
    if (!Number.isInteger(doc.pause) || doc.pause < 0 || doc.pause > 3000) throw new Error('句间停顿需在 0–3000 毫秒之间');
    if (doc.selectedTakes !== undefined && (!doc.selectedTakes || typeof doc.selectedTakes !== 'object' || Array.isArray(doc.selectedTakes) || Object.keys(doc.selectedTakes).length > 100 || Object.values(doc.selectedTakes).some(id => !/^[a-f0-9]{32}$/.test(id)))) throw new Error('实验作品的成品版本无效');
    if ([doc.voiceRevision, ...doc.roles.map(role => role.voiceRevision)].some(value => value !== undefined && (typeof value !== 'string' || value.length > 64))) throw new Error('人物定声版本无效');
    if ([doc.referenceStyle, ...doc.roles.map(role => role.referenceStyle)].some(value => value !== undefined && !['original', 'expressive'].includes(value))) throw new Error('录音表达方式无效');
    for (const value of [doc.cover, ...doc.lines.map(line => line.image)]) if (typeof value !== 'string' || value && (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 1600000)) throw new Error('配图格式不正确或过大');
    if (JSON.stringify(doc).length > 12 * 1024 * 1024) throw new Error('配图较多，请减少图片后再保存');
    return doc;
  }
  function storyText(doc) {
    return doc.story.replace(/\{\{(name|interest)\}\}/g, (_, key) => (key === 'name' ? doc.child.trim() || '小朋友' : doc.interest.trim() || '探索新事物'));
  }
  function paragraphs(text) {
    return text.split(/\r?\n/).filter(part => part.trim()).flatMap(part => splitText(part));
  }
  // A fingerprint covers the actual speech request, not presentation-only edits.
  function compile(doc, resolveVoice, fingerprint, emotionIds) {
    validate(doc); const rows = [];
    const add = (key, text, emotion, label, sourceId, voiceId = key, voiceRevision = doc.voiceRevision || '', referenceStyle = doc.referenceStyle || 'original') => {
      if (!text.trim()) return;
      const voice = resolveVoice(key); if (!voice) throw new Error('有一个声音已被移除，请重新选择');
      if (voice.mode === 'clone' && (!voice.referenceId || !voice.referenceText?.trim())) throw new Error('家人声音需要参考录音和对应文字，请在声音库补充后再生成');
      const performance = (voice.mode !== 'clone' || referenceStyle === 'expressive') && !(voice.mode === 'preset' && voice.engine === 'light');
      const options = { ...voice, engine: voice.engine || 'standard', scene: doc.type === 'family' ? 'bedtime' : doc.type === 'variants' ? 'ad' : 'dialogue',
        ...(voice.mode === 'design' ? { lockVoice: true, voiceScopeId: 'lab:' + doc.id, voiceId, voiceRevision } : {}),
        ...(voice.mode === 'clone' ? { referenceStyle } : {}),
        text, sampleRate: 24000, emotion: performance && emotionIds.includes(emotion) ? emotion : 'natural',
        pace: 'normal', intensity: 50, instruction: '', project: doc.name };
      if (text.length > 600) throw new Error('每句最多 600 字，请按换行拆分文案');
      const version = fingerprint({ ...options, project: undefined });
      const labKey = fingerprint({ text: JSON.stringify([sourceId, version, options.scene]) });
      rows.push({ ...options, filename: `lab-${rows.length + 1}-${labKey.slice(0, 8)}`, labId: doc.id, labKey, labLabel: label, labSourceId: sourceId });
    };
    if (doc.type === 'variants') {
      if (!doc.voiceKeys.length || !doc.emotions.length) throw new Error('至少选择一个声音和一种语气');
      const seen = new Set();
      for (const key of doc.voiceKeys) for (const emotion of doc.emotions) {
        const voice = resolveVoice(key); if (!voice) throw new Error('所选声音已被移除');
        const actual = voice.mode === 'clone' && doc.referenceStyle !== 'expressive' || voice.mode === 'preset' && voice.engine === 'light' ? 'natural' : emotion;
        if (seen.has(`${key}:${actual}`)) continue; seen.add(`${key}:${actual}`);
        add(key, doc.text, actual, voice.voiceName, `${key}:${actual}`, `${key}:${actual}`);
      }
    } else if (doc.type === 'family') paragraphs(storyText(doc)).forEach((text, index) => add(doc.voiceKey, text, doc.emotion || 'natural', `第 ${index + 1} 段`, `story-${index}`));
    else for (const line of doc.lines) {
      const role = doc.roles.find(role => role.id === line.roleId); if (!role) throw new Error('请为每句台词选择角色');
      const voice = resolveVoice(role.voiceKey);
      add(role.voiceKey, line.text, voice?.mode === 'design' ? role.emotion || 'natural' : line.emotion,
        line.title || role.name, line.id, role.id, role.voiceRevision || '', role.referenceStyle || 'original');
    }
    if (!rows.length) throw new Error('请先写下需要配音的文案');
    if (rows.length > 100 || rows.reduce((sum, row) => sum + row.text.length, 0) > 5000) throw new Error('一次最多 100 段、5000 字（多配版本合计），请减少版本或文案');
    return rows;
  }
  function match(rows, history, id, selected = {}) {
    const items = new Map();
    for (const item of history) if (item.options?.labId === id && item.options.labKey) {
      const current = items.get(item.options.labKey);
      if (!current || current.id !== selected[item.options.labKey] && (item.id === selected[item.options.labKey] || (item.createdAt || 0) > (current.createdAt || 0))) items.set(item.options.labKey, item);
    }
    return rows.map(row => { const item = items.get(row.labKey); return { row, item: item ? { ...item, duration: item.editedDuration ?? item.duration } : null }; });
  }
  function importDialogue(text, existingRoles) {
    const roles = structuredClone(existingRoles), lines = [];
    for (const part of text.split(/\r?\n/).filter(part => part.trim())) {
      const found = part.match(/^\s*([^：:]{1,40})[：:]\s*(.+)$/);
      if (!found || !found[1].trim()) throw new Error('每行请写成“角色：台词”');
      let role = roles.find(role => role.name === found[1].trim());
      if (!role) { role = { id: uid(), name: found[1].trim(), voiceKey: roles.length % 2 ? 'preset:Dylan' : 'preset:Vivian' }; roles.push(role); }
      lines.push({ id: uid(), roleId: role.id, title: '', text: found[2], emotion: 'natural', image: '' });
    }
    if (!lines.length || lines.length > 80 || roles.length > 12 || lines.some(line => line.text.length > 600)) throw new Error('最多 12 个角色、80 句台词，每句最多 600 字');
    return { roles, lines };
  }
  const api = { kinds, stories, create, validate, storyText, paragraphs, compile, match, importDialogue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VoiceLab = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
