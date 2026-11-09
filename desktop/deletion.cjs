const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Called under the service's shared data-directory lock.
function deleteStoredItem(dataDir, kind, id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new Error('删除记录无效');
  const root = fs.realpathSync(dataDir);
  const folder = path.join(root, kind === 'work' ? 'outputs' : 'references');
  if (!['work', 'reference'].includes(kind) || fs.realpathSync(folder) !== folder) throw new Error('删除目录无效');
  const stage = path.join(folder, `.deleting-${randomUUID()}`);
  if (kind === 'work') {
    const historyFile = path.join(root, 'history.json');
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    if (!Array.isArray(history) || !history.some(item => item.id === id)) throw new Error('作品不存在或已删除');
    const source = path.join(folder, id), exists = fs.existsSync(source);
    if (exists) fs.renameSync(source, stage);
    const temporary = `${historyFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(history.filter(item => item.id !== id)));
      fs.renameSync(temporary, historyFile);
    } catch (error) {
      if (exists) fs.renameSync(stage, source);
      fs.rmSync(temporary, { force: true }); throw error;
    }
    if (exists) fs.rmSync(stage, { recursive: true, force: true });
  } else {
    const metadata = path.join(folder, `${id}.json`);
    const item = JSON.parse(fs.readFileSync(metadata, 'utf8'));
    if (item.id !== id) throw new Error('参考声音记录无效');
    fs.mkdirSync(stage);
    const moved = [];
    try {
      for (const name of [`${id}.wav`, `${id}.json`]) if (fs.existsSync(path.join(folder, name))) {
        fs.renameSync(path.join(folder, name), path.join(stage, name)); moved.push(name);
      }
    } catch (error) {
      for (const name of moved) fs.renameSync(path.join(stage, name), path.join(folder, name));
      fs.rmSync(stage, { recursive: true, force: true }); throw error;
    }
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return { deleted: true, id };
}
// Delete every take and edit of this project's generated audio in one history
// commit. Renaming first lets a failed write restore all original directories.
function deleteProjectAudio(dataDir, projectId) {
  if (typeof projectId !== 'string' || !/^[\w-]{1,64}$/.test(projectId)) throw new Error('项目编号无效');
  return deleteAudioRecords(dataDir, history => history.filter(item => item?.options?.projectId === projectId));
}

// A work is a version group. Resolve its full family under the same directory
// lock as the history commit, so old takes cannot reappear after bulk deletion.
function deleteStoredWorks(dataDir, requestedIds) {
  if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length > 20000
      || requestedIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('请选择需要删除的作品');
  const requested = new Set(requestedIds);
  return deleteAudioRecords(dataDir, history => {
    const selected = history.filter(item => requested.has(item?.id));
    if (selected.length !== requested.size || selected.some(item => item.options?.projectId)) throw new Error('所选作品不存在或已删除，请刷新后重试');
    const groups = new Set(selected.map(item => item.options?.generationGroupId || item.id));
    return history.filter(item => !item?.options?.projectId && groups.has(item?.options?.generationGroupId || item?.id));
  });
}

function deleteAudioRecords(dataDir, select) {
  const root = fs.realpathSync(dataDir), folder = path.join(root, 'outputs');
  if (fs.realpathSync(folder) !== folder) throw new Error('删除目录无效');
  const historyFile = path.join(root, 'history.json');
  let history;
  try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; history = []; }
  if (!Array.isArray(history)) throw new Error('音频历史记录格式无效');
  const selected = select(history);
  if (selected.some(item => typeof item.id !== 'string' || !/^[a-f0-9]{32}$/.test(item.id))) throw new Error('音频记录无效');
  const ids = new Set(selected.map(item => item.id));
  if (!ids.size) return { deletedIds: [] };
  const sources = [];
  for (const id of ids) {
    const source = path.join(folder, id);
    let stat;
    try { stat = fs.lstatSync(source); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('音频目录无效');
    sources.push({ id, source });
  }
  const stage = path.join(folder, `.deleting-${randomUUID()}`), temporary = `${historyFile}.${randomUUID()}.tmp`, moved = [];
  fs.mkdirSync(stage);
  try {
    for (const entry of sources) {
      fs.renameSync(entry.source, path.join(stage, entry.id)); moved.push(entry);
    }
    fs.writeFileSync(temporary, JSON.stringify(history.filter(item => !ids.has(item?.id))), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, historyFile);
  } catch (error) {
    for (const entry of moved.reverse()) {
      try { fs.renameSync(path.join(stage, entry.id), entry.source); } catch (restore) { error.cleanupError ||= restore; }
    }
    try { fs.rmSync(temporary, { force: true }); fs.rmdirSync(stage); } catch (cleanup) { error.cleanupError ||= cleanup; }
    throw error;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return { deletedIds: [...ids] };
}
module.exports = { deleteStoredItem, deleteStoredWorks, deleteProjectAudio };
