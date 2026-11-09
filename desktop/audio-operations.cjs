// Cancellation belongs to one resource preparation, including while it is queued.
function createTranscriptionPreparation({ invoke, cancelWorker }) {
  let active = null;
  async function run(data) {
    if (active) throw new Error('识别资源正在准备中');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(data?.requestId || '')) throw new Error('识别资源准备标识无效');
    const state = { requestId: data.requestId, cancelled: false, running: false }; active = state;
    const result = () => ({ ready: false, cancelled: true });
    const cancelled = new Promise(resolve => state.cancelQueued = () => resolve(result()));
    try {
      const operation = invoke('transcription-setup', structuredClone(data), () => state.cancelled, () => state.running = true);
      return await Promise.race([operation, cancelled]);
    } catch (error) { if (state.cancelled) return result(); throw error; }
    finally { if (active === state) active = null; }
  }
  function cancel(requestId) {
    const state = active;
    if (!state || state.requestId !== requestId) return { cancelled: false };
    if (!state.cancelled) {
      state.cancelled = true;
      if (state.running) cancelWorker(); else state.cancelQueued();
    }
    return { cancelled: true };
  }
  return { run, cancel };
}
function selectAudioVersion(dataDir, data) {
  const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
  if (!/^[a-f0-9]{32}$/.test(data?.groupId || '') || !/^[a-f0-9]{32}$/.test(data?.id || '')) throw new Error('音频版本标识无效');
  const directory = path.join(dataDir, 'outputs', data.id), metadata = path.join(directory, 'metadata.json');
  for (const file of [path.join(dataDir, 'outputs'), directory, metadata]) if (fs.lstatSync(file).isSymbolicLink()) throw new Error('音频版本路径无效');
  const item = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  if (item.id !== data.id || item.id !== data.groupId && item.options?.generationGroupId !== data.groupId) throw new Error('此音频不属于所选版本组');
  const file = path.join(dataDir, 'audio-selections.json');
  let selections = {};
  try { selections = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('版本选择记录无法读取，请检查数据目录'); }
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) throw new Error('版本选择记录格式无效');
  selections[data.groupId] = data.id;
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(selections), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
  return selections;
}
module.exports = { createTranscriptionPreparation, selectAudioVersion };
