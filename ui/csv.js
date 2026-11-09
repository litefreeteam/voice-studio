/* RFC 4180 quoting, also used for tab-separated scripts. */
function parseScript(source, extension = '') {
  const text = source.replace(/^\uFEFF/, '');
  if (extension.toLowerCase().endsWith('.txt')) return text.split(/\r?\n/).filter(s => s.trim()).map(text => ({ text }));
  const delimiter = extension.toLowerCase().endsWith('.tsv') || text.split('\n')[0].includes('\t') ? '\t' : ',';
  const records = []; let record = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === delimiter) { record.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field); if (record.some(v => v.trim())) records.push(record); record = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('脚本文件中的引号没有闭合');
  record.push(field); if (record.some(v => v.trim())) records.push(record);
  if (!records.length) return [];
  const aliases = { text: 'text', 文本: 'text', 台词: 'text', role: 'role', voice: 'role', 角色: 'role', 人物: 'role', 音色: 'role', emotion: 'emotion', 情绪: 'emotion', 语气: 'emotion', filename: 'filename', 文件名: 'filename', chapter: 'chapter', 章节: 'chapter' };
  const header = records[0].map(v => aliases[v.trim().toLowerCase()]);
  const hasHeader = header.includes('text');
  return (hasHeader ? records.slice(1) : records).map(row => {
    const result = {}; row.forEach((v, index) => { const key = hasHeader ? header[index] : ['text', 'role', 'emotion', 'filename'][index]; if (key) result[key] = v.trim(); }); return result;
  }).filter(row => row.text);
}
if (typeof module !== 'undefined') module.exports = { parseScript };
