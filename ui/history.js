(function (root) {
  const standalone = items => items.filter(item => !item.options?.projectId);
  const project = item => item.project || item.options?.project || '未命名作品';
  const voice = (item, names = {}) => item.voiceName || item.options?.voiceName || names[item.speaker] || item.speaker || '未标注声音';
  const scene = item => item.options?.scene || item.scene || '__unknown__';
  const timestamp = item => Number.isFinite(Number(item.createdAt)) && Number(item.createdAt) > 0 ? Number(item.createdAt) : 0;
  function filter(items, filters = {}, names = {}, now = new Date()) {
    const words = String(filters.search || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    if (filters.period === 'week') start.setDate(start.getDate() - 6);
    if (filters.period === 'month') start.setDate(start.getDate() - 29);
    const matches = items.filter(item => {
      const duration = Number(item.duration), time = timestamp(item);
      const content = [item.text, project(item), voice(item, names), item.speaker, item.wav, item.mp3].join(' ').toLocaleLowerCase();
      return words.every(word => content.includes(word))
        && (!filters.project || project(item) === filters.project)
        && (!filters.voice || voice(item, names) === filters.voice)
        && (!filters.scene || scene(item) === filters.scene)
        && (!filters.period || time >= start.getTime() && time < end.getTime())
        && (!filters.duration || duration > 0 && (filters.duration === 'short' ? duration <= 30 : filters.duration === 'medium' ? duration > 30 && duration <= 120 : duration > 120));
    });
    return matches.sort((a, b) => {
      if (filters.sort === 'shortest' || filters.sort === 'longest') {
        const x = Number(a.duration) || 0, y = Number(b.duration) || 0;
        if (!x || !y) return !x === !y ? 0 : !x ? 1 : -1;
        if (x !== y) return filters.sort === 'shortest' ? x - y : y - x;
      }
      const x = timestamp(a), y = timestamp(b);
      if (!x || !y) return !x === !y ? 0 : !x ? 1 : -1;
      return filters.sort === 'oldest' ? x - y : y - x;
    });
  }
  function paginate(items, requestedPage = 1, requestedSize = 12) {
    const size = [12, 24, 48].includes(Number(requestedSize)) ? Number(requestedSize) : 12;
    const pages = Math.max(1, Math.ceil(items.length / size));
    const page = Math.max(1, Math.min(pages, Math.floor(Number(requestedPage)) || 1));
    const offset = (page - 1) * size;
    const numbers = [...new Set([1, pages, ...Array.from({ length: 5 }, (_, index) => page + index - 2)])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
    return { items: items.slice(offset, offset + size), total: items.length, page, size, pages, numbers, start: items.length ? offset + 1 : 0, end: Math.min(offset + size, items.length) };
  }
  const exports = { standalone, project, voice, scene, timestamp, filter, paginate };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.WorkHistory = exports;
})(typeof globalThis !== 'undefined' ? globalThis : this);
