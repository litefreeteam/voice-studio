(function (root) {
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  function matches(query, value) {
    const text = normalize(value);
    return normalize(query).trim().split(/\s+/).filter(Boolean).every(word => text.includes(word));
  }
  function filter(templates, catalog, category = 'all', query = '') {
    const voices = [...catalog.voices.map(v => ({ ...v, key: `preset:${v.id}` })), ...catalog.characters.map(v => ({ ...v, key: `design:${v.id}` }))];
    return templates.filter(template => {
      const keys = [template.voiceKey, ...(template.rows || []).map(row => row.voiceKey)];
      const names = voices.filter(voice => keys.includes(voice.key)).map(voice => `${voice.name} ${voice.description}`).join(' ');
      const group = catalog.templateCategories.find(group => group.id === template.category)?.name;
      return (category === 'all' || category === template.category) && matches(query, `${template.name} ${template.description} ${group} ${names} ${template.language}`);
    });
  }
  function project(template, catalog, projectName = '') {
    const [mode, id] = template.voiceKey.split(':');
    const voice = (mode === 'preset' ? catalog.voices : catalog.characters).find(voice => voice.id === id);
    if (!voice) throw new Error('模板使用的声音不存在');
    return { schema: 'shengyue-project-1', text: template.text, rows: structuredClone(template.rows || []), script: !!template.rows?.length,
      voiceKey: template.voiceKey, emotion: template.emotion, batch: !!template.batch,
      options: { voiceScopeId: root.crypto.randomUUID(), lockVoice: true, project: projectName, language: template.language, scene: template.scene, emotion: template.emotion,
        pace: template.pace, intensity: template.intensity, instruction: template.instruction, prefix: template.prefix,
        engine: 'standard', sampleRate: 48000, voiceDescription: mode === 'design' ? voice.prompt : '', referenceText: '' } };
  }
  const api = { matches, filter, project };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreationTemplates = api;
})(typeof window === 'undefined' ? globalThis : window);
