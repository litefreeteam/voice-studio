const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validate } = require('../ui/lab-core.js');

function createLabStore(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS lab_works (id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  return {
    list() { return db.prepare('SELECT content FROM lab_works ORDER BY updated_at DESC').all().map(row => { const work = JSON.parse(row.content); return { id: work.id, type: work.type, name: work.name, updatedAt: work.updatedAt }; }); },
    load(id) { const row = db.prepare('SELECT content FROM lab_works WHERE id = ?').get(id); if (!row) throw new Error('这份实验作品不存在'); return JSON.parse(row.content); },
    save(doc) { validate(doc); const updatedAt = Date.now(), content = JSON.stringify({ ...doc, updatedAt });
      if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error('实验作品过大，请减少图片');
      db.prepare('INSERT INTO lab_works VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at').run(doc.id, content, updatedAt);
      return { saved: true, updatedAt }; },
    close() { db.close(); }
  };
}

function exportBytes(data) {
  const formats = { wav: 'RIFF', webm: null, srt: null, html: null };
  if (!data || !Object.hasOwn(formats, data.format) || !(data.bytes instanceof Uint8Array) || !data.bytes.length || data.bytes.length > 256 * 1024 * 1024) throw new Error('导出内容格式不正确或超过 256 MB');
  const bytes = Buffer.from(data.bytes);
  if (data.format === 'wav' && (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')) throw new Error('音频数据不正确');
  if (data.format === 'webm' && bytes.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error('视频数据不正确');
  return { bytes, name: (String(data.name || '实验作品').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || '实验作品') + '.' + data.format };
}
module.exports = { createLabStore, exportBytes };
