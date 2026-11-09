const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validate, entries } = require('../ui/projects.js');
const { restoreSaved } = require('./retired-markup.cjs');

function createProjectStore(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS script_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const read = db.prepare('SELECT content FROM script_projects WHERE id = ?');
  const write = db.prepare('INSERT INTO script_projects VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, updated_at = excluded.updated_at');
  return {
    list() { return db.prepare('SELECT content FROM script_projects ORDER BY updated_at DESC').all().map(row => {
      const project = JSON.parse(row.content), lines = entries(project);
      return { id: project.id, name: project.name, updatedAt: project.updatedAt, chapterCount: project.chapters.length, roleCount: project.roles.length, lineCount: lines.length, characters: lines.reduce((sum, entry) => sum + entry.line.text.length, 0) };
    }); },
    load(id) { const row = read.get(id); if (!row) throw new Error('这个配音项目不存在'); return restoreSaved(db, 'project', id, row.content, content => db.prepare('UPDATE script_projects SET content = ? WHERE id = ?').run(content, id)); },
    save(project) {
      validate(project);
      const snapshot = { ...project, updatedAt: Date.now() }, content = JSON.stringify(snapshot);
      if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('项目内容过大，请拆成多个项目');
      write.run(snapshot.id, snapshot.name, content, snapshot.updatedAt);
      return { saved: true, updatedAt: snapshot.updatedAt };
    },
    delete(id) { const result = db.prepare('DELETE FROM script_projects WHERE id = ?').run(id); return { deleted: result.changes > 0 }; },
    close() { db.close(); }
  };
}
module.exports = { createProjectStore };
