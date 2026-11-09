// Compatibility with annotations produced by the withdrawn editor.
// Never synthesize fragments: restore ordinary prose and retain the exact source.
const { createHash } = require('node:crypto');
const cues = { um: '嗯，', ah: '啊，', oh: '哦，', sigh: '唉，', hey: '哎呀，', laugh: '哈哈，', cough: '咳咳，' };
function restoreText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\[\[emotion:(?:natural|happy|excited|gentle|calm|sad|melancholy|angry|afraid|nervous|urgent|surprised|relief|hopeful|doubtful|firm|tired|whisper)\]\]|\[\[\/emotion\]\]/g, '')
    .replace(/<#(?:0|[1-3])(?:\.\d{1,3})?#>/g, '')
    .replace(/\[\[cue:(um|ah|oh|sigh|hey|laugh|cough)\]\]/g, (_, id) => cues[id]);
}
function restoreDocument(value, scope) {
  const result = structuredClone(value); let changed = false;
  function restore(owner) {
    if (!owner || typeof owner.text !== 'string') return;
    const text = restoreText(owner.text); if (text !== owner.text) { changed = true; owner.text = text; }
  }
  if (scope === 'session') { restore(result); (result.rows || []).forEach(restore); }
  else if (scope === 'project') for (const chapter of result.chapters || []) (chapter.lines || []).forEach(restore);
  return { value: result, changed };
}
function restoreSaved(db, scope, id, content, write) {
  const result = restoreDocument(JSON.parse(content), scope);
  if (!result.changed) return result.value;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS retired_inline_backups (scope TEXT NOT NULL, record_id TEXT NOT NULL, digest TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(scope, record_id, digest))');
    db.prepare('INSERT OR IGNORE INTO retired_inline_backups VALUES (?, ?, ?, ?, ?)').run(scope, String(id), createHash('sha256').update(content).digest('hex'), content, Date.now());
    write(JSON.stringify(result.value));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { ...result.value, retiredMarkupNotice: true };
}
module.exports = { restoreText, restoreDocument, restoreSaved };
