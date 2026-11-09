const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { restoreSaved } = require('./retired-markup.cjs');

// One current editing session per installation, independent of the generation queue.
function createSessionStore(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS editor_session (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL)');
  const read = db.prepare('SELECT content FROM editor_session WHERE id = 1');
  const write = db.prepare('INSERT INTO editor_session (id, content) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content');
  return {
    load() { const row = read.get(); return row ? restoreSaved(db, 'session', 1, row.content, content => write.run(content)) : null; },
    save(session) {
      if (!session || session.schema !== 'shengyue-project-1' || typeof session.text !== 'string' || !Array.isArray(session.rows) || session.rows.length > 100 || !session.options || typeof session.options !== 'object' || Array.isArray(session.options)) throw new Error('编辑内容格式不正确');
      if (session.rows.some(row => !row || typeof row.text !== 'string')) throw new Error('台词格式不正确');
      const content = JSON.stringify(session);
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('编辑内容过大，未能自动保存');
      write.run(content);
      return { saved: true };
    },
    close() { db.close(); }
  };
}

module.exports = { createSessionStore };
