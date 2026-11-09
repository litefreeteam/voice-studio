const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SCHEMA = 'shengyue-export-v1';
const NAME = /^voice-export-([a-f0-9]{32})$/;
const WORK_SCHEMA = 'shengyue-delivery-work-v1';
const WORK_FILES = new Set(['owner.json', 'merged.wav', 'merged.mp3', 'segment.wav', 'subtitles.srt', 'report.json', 'manifest.json']);

function ownedExport(dataDir, file) {
  if (typeof file !== 'string') return null;
  let directory = path.dirname(path.resolve(file));
  const match = NAME.exec(path.basename(directory));
  if (!match || path.basename(path.dirname(directory)) !== '.export-tmp' || path.basename(file) !== 'archive.zip') return null;
  try {
    // Python resolves the data root. Canonicalize only that ancestor so aliases
    // such as macOS /var work without following symlinks in owned scratch files.
    const dataRoot = fs.realpathSync(dataDir);
    if (fs.realpathSync(path.dirname(path.dirname(directory))) !== dataRoot) return null;
    const root = path.join(dataRoot, '.export-tmp');
    directory = path.join(root, path.basename(directory));
    if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()
      || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) return null;
    const marker = path.join(directory, 'owner.json');
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (owner.schema !== SCHEMA || owner.token !== match[1] || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
    // Never recursively remove a directory: unexpected files belong to the user.
    if (fs.readdirSync(directory).some(name => !['owner.json', 'archive.zip'].includes(name))) return null;
    const archiveFile = path.join(directory, 'archive.zip');
    if (fs.existsSync(archiveFile)) {
      const archive = fs.lstatSync(archiveFile);
      if (!archive.isFile() || archive.isSymbolicLink()) return null;
    }
    return { directory, marker, file: path.join(directory, 'archive.zip'), owner };
  } catch { return null; }
}

function cleanupTemporaryExport(dataDir, result) {
  const entry = ownedExport(dataDir, result?.path);
  if (!entry) return false;
  fs.rmSync(entry.file, { force: true });
  fs.unlinkSync(entry.marker);
  fs.rmdirSync(entry.directory);
  return true;
}

function validateTemporaryExport(dataDir, result, token) {
  const entry = ownedExport(dataDir, result?.path);
  if (!entry || entry.owner.pid !== process.pid || (token && entry.owner.token !== token)) {
    throw Object.assign(new Error('导出临时文件归属无效，请重试'), { code: 'INVALID_EXPORT' });
  }
  return entry;
}

function ownedDeliveryWork(dataDir, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
  try {
    const root = path.join(fs.realpathSync(dataDir), '.export-work');
    const directory = path.join(root, `voice-export-${token}`);
    for (const folder of [root, directory]) {
      const stat = fs.lstatSync(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    }
    const names = fs.readdirSync(directory);
    if (!names.includes('owner.json') || names.some(name => !WORK_FILES.has(name))) return null;
    for (const name of names) {
      const stat = fs.lstatSync(path.join(directory, name));
      if (!stat.isFile() || stat.isSymbolicLink() || (name === 'owner.json' && stat.size > 4096)) return null;
    }
    const owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json'), 'utf8'));
    if (owner.schema !== WORK_SCHEMA || owner.token !== token || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
    return { directory, names, owner };
  } catch { return null; }
}

function cleanupDeliveryWork(dataDir, token, expectedPid = process.pid) {
  const entry = ownedDeliveryWork(dataDir, token);
  if (!entry || entry.owner.pid !== expectedPid) return false;
  // A terminated worker cannot run Python's finally block. Reclaim just this
  // call's identified files after its close event, never recursively or broadly.
  for (const name of entry.names) if (name !== 'owner.json') fs.unlinkSync(path.join(entry.directory, name));
  fs.unlinkSync(path.join(entry.directory, 'owner.json'));
  fs.rmdirSync(entry.directory);
  return true;
}

function cleanupDeliveryExport(dataDir, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return false;
  const result = { path: path.join(path.resolve(dataDir), '.export-tmp', `voice-export-${token}`, 'archive.zip') };
  const entry = ownedExport(dataDir, result.path);
  return !!entry && entry.owner.pid === process.pid && cleanupTemporaryExport(dataDir, result);
}

async function copyTemporaryExport(dataDir, result, destination, flags = 0, shouldCancel = () => false) {
  validateTemporaryExport(dataDir, result);
  const stage = path.join(path.dirname(destination), `.voice-export-${randomUUID()}.tmp`);
  let copyError, created = false;
  try {
    if (shouldCancel()) throw Object.assign(new Error('导出已取消'), { code: 'CANCELLED' });
    // Copy completely beside the selected destination, preserving an existing
    // user's file if the copy fails. The stage is exclusively owned by this call.
    const handle = await fs.promises.open(stage, 'wx');
    created = true;
    await handle.close();
    await fs.promises.copyFile(result.path, stage);
    if (shouldCancel()) throw Object.assign(new Error('导出已取消'), { code: 'CANCELLED' });
    if (flags & fs.constants.COPYFILE_EXCL) {
      try { await fs.promises.link(stage, destination); }
      catch (error) {
        // FAT/exFAT and some network shares cannot hard-link. Node's exclusive
        // copy still refuses existing files and removes an incomplete copy.
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(error.code)) throw error;
        await fs.promises.copyFile(stage, destination, fs.constants.COPYFILE_EXCL);
      }
    } else {
      await fs.promises.rename(stage, destination);
      created = false;
    }
  } catch (error) { copyError = error; throw error; }
  finally {
    let cleanupError;
    if (created) {
      try { await fs.promises.unlink(stage); }
      catch (error) { if (error.code !== 'ENOENT') cleanupError = error; }
    }
    try { cleanupTemporaryExport(dataDir, result); }
    catch (error) { cleanupError ||= error; }
    // Preserve the actionable save error when both the copy and cleanup failed.
    if (!copyError && cleanupError) throw cleanupError;
  }
}

function cleanupStaleExports(dataDir) {
  const root = path.join(path.resolve(dataDir), '.export-tmp');
  let count = 0, directory;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return 0;
    directory = fs.opendirSync(root);
    // Bounded startup work. Active owners (including another app copying a ZIP)
    // are left alone; only identified artifacts from exited owners are removed.
    for (let index = 0; index < 128; index++) {
      const child = directory.readSync();
      if (!child) break;
      if (!child.isDirectory() || !NAME.test(child.name)) continue;
      const file = path.join(root, child.name, 'archive.zip');
      const entry = ownedExport(dataDir, file);
      if (!entry) continue;
      try { process.kill(entry.owner.pid, 0); continue; }
      catch (error) { if (error.code !== 'ESRCH') continue; }
      try { if (cleanupTemporaryExport(dataDir, { path: file })) count++; } catch {}
    }
  } catch { /* A cleanup problem must not prevent opening existing works. */ }
  finally { try { directory?.closeSync(); } catch {} }
  return count;
}

function cleanupStaleDeliveryWork(dataDir) {
  const root = path.join(path.resolve(dataDir), '.export-work');
  let count = 0, directory;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return 0;
    directory = fs.opendirSync(root);
    for (let index = 0; index < 128; index++) {
      const child = directory.readSync();
      if (!child) break;
      const match = NAME.exec(child.name);
      if (!child.isDirectory() || !match) continue;
      const entry = ownedDeliveryWork(dataDir, match[1]);
      if (!entry) continue;
      try { process.kill(entry.owner.pid, 0); continue; }
      catch (error) { if (error.code !== 'ESRCH') continue; }
      try { if (cleanupDeliveryWork(dataDir, match[1], entry.owner.pid)) count++; } catch {}
    }
  } catch { /* Recovery must not stop the user from opening existing projects. */ }
  finally { try { directory?.closeSync(); } catch {} }
  return count;
}

// Keep the save dialog, queued worker and final publication in one request's
// lifetime. A cancellation for an old project cannot cancel a newer generation.
function createDeliveryController({ dataDir, allow, choose, invoke, cancelWorker, progress = () => {}, copy = copyTemporaryExport }) {
  let active;
  const cancelledResult = state => ({ saved: false, cancelled: true, requestId: state.requestId });
  function cancel(requestId) {
    if (!active || active.requestId !== requestId) return { cancelled: false };
    active.cancelled = true;
    if (active.phase === 'running') cancelWorker(requestId);
    if (active.phase === 'queued') active.cancelQueued();
    return { cancelled: true, requestId };
  }
  async function run(data) {
    allow();
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId)) {
      throw Object.assign(new Error('导出请求标识无效'), { code: 'INVALID_ARGUMENT' });
    }
    if (active) throw Object.assign(new Error('当前成品导出尚未结束，请稍后重试'), { code: 'BUSY' });
    const state = { requestId: data.requestId, cancelled: false, phase: 'dialog' };
    active = state;
    let result;
    try {
      // The IPC payload is snapshotted before asynchronous dialogs or queueing.
      const payload = JSON.parse(JSON.stringify(data));
      const projectName = typeof payload.projectName === 'string' ? payload.projectName : '项目';
      let filename = '';
      for (const char of projectName.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')) {
        if (Buffer.byteLength(filename + char, 'utf8') > 230) break;
        filename += char;
      }
      filename = filename.replace(/[. ]+$/g, '') || '项目';
      const choice = await choose({ defaultPath: `${filename}-${payload.partial === true ? '节选成品' : '成品'}.zip`, filters: [{ name: '成品音频与字幕包', extensions: ['zip'] }] });
      if (state.cancelled || choice.canceled || !choice.filePath) return cancelledResult(state);
      const report = phase => progress({ type: 'progress', stage: 'delivery', phase, requestId: state.requestId,
        projectId: payload.projectId, message: phase === 'queued' ? '正在等待当前操作完成，可以取消导出' : '正在保存成品包…' });
      state.phase = 'queued';
      const cancelled = new Promise(resolve => { state.cancelQueued = () => resolve(null); });
      report('queued');
      const task = invoke('project-export', payload, () => state.cancelled, () => { state.phase = 'running'; });
      // Queued cancellations return promptly while the existing generation runs;
      // its queued callback still checks this request's cancellation token.
      result = await Promise.race([task, cancelled]);
      if (!result || state.cancelled) return cancelledResult(state);
      allow();
      state.phase = 'saving';
      report('save');
      const summary = { count: result.count, durationSeconds: result.durationSeconds, warnings: result.warnings || [] };
      await copy(dataDir, result, choice.filePath, 0, () => state.cancelled);
      result = null; // The copy function owns intermediate cleanup on all paths.
      return { saved: true, requestId: state.requestId, ...summary };
    } catch (error) {
      if (state.cancelled || error.code === 'CANCELLED') return cancelledResult(state);
      throw error;
    } finally {
      try { if (result) cleanupTemporaryExport(dataDir, result); }
      finally { if (active === state) active = null; }
    }
  }
  return { run, cancel, cancelActive: () => active ? cancel(active.requestId) : { cancelled: false }, busy: () => !!active };
}

module.exports = { copyTemporaryExport, cleanupTemporaryExport, cleanupStaleExports, validateTemporaryExport,
  cleanupDeliveryWork, cleanupDeliveryExport, cleanupStaleDeliveryWork, createDeliveryController };
