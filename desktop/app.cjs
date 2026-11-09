const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, powerSaveBlocker, screen, systemPreferences } = require('electron');
const { windowBounds } = require('./window-layout.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createStudio } = require('./service.cjs');
const { studioReply } = require('./ipc.cjs');
const { cliConfiguration, cliDocumentPath } = require('./cli-integration.cjs');
const { copyTemporaryExport, createDeliveryController } = require('./exports.cjs');
const { requireMicrophoneAccess, audioPermission, saveRecording } = require('./recording.cjs');
const { createJobQueue } = require('./jobs.cjs');
const { createSessionStore } = require('./session.cjs');
const { createProjectStore } = require('./projects.cjs');
const { createLabStore, exportBytes } = require('./laboratory.cjs');
const { createSleepGuard } = require('./unattended.cjs');
const { createTranscriptionPreparation, selectAudioVersion } = require('./audio-operations.cjs');
const sleepGuard = createSleepGuard(powerSaveBlocker);

app.setName('声悦');
app.setPath('userData', path.join(app.getPath('appData'), 'Voice Studio'));
if (process.env.VOICE_STUDIO_DATA) app.setPath('userData', path.resolve(process.env.VOICE_STUDIO_DATA));
// Only one desktop may own the in-memory queues and editor stores for this profile.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let window, studio, licensing, jobs, sessions, projects, laboratory, statusCache, quitting = false;
app.on('second-instance', () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
});
let operations = Promise.resolve(), generationExecuting = false;
let microphoneUntil = 0;
let preflightMicrophone = false;
let deleting = false;
let delivery;
const transcriptionPreparation = createTranscriptionPreparation({ invoke: invokeStudio, cancelWorker: () => studio.cancel() });
const root = () => app.getPath('userData');
const shared = () => path.join(__dirname, '..', 'shared');
const progress = data => { if (window && !window.isDestroyed()) window.webContents.send('progress', data); };
function invokeStudio(action, data, shouldCancel = () => false, onStart = () => {}) {
  const result = operations.then(async () => {
    if (quitting || shouldCancel()) throw new Error('操作已取消');
    onStart();
    generationExecuting = action === 'generate';
    try {
      const result = await studio.invoke(action, data);
      // Resource imports can finish while another task is queued. Publish their
      // committed metadata immediately, without waiting for a worker status poll.
      const collection = ['reference', 'reference-commit', 'capture', 'update-reference'].includes(action) ? 'references'
        : action === 'background-import' ? 'backgrounds' : null;
      if (collection && result?.id) statusCache = { ...statusCache,
        [collection]: [...(statusCache?.[collection] || []).filter(item => item.id !== result.id), result] };
      if (action === 'transcription-setup' && result?.ready !== undefined) statusCache = { ...statusCache, transcription: result };
      return result;
    }
    finally { generationExecuting = false; }
  });
  operations = result.catch(() => {});
  return result;
}

function deliveryController() {
  if (!delivery) delivery = createDeliveryController({ dataDir: root(), allow: () => licensing.allow(),
    choose: options => dialog.showSaveDialog(window, options), invoke: invokeStudio,
    cancelWorker: requestId => studio.cancelExport(requestId), progress });
  return delivery;
}

async function getItem(id, format, original = false) {
  if (!/^[0-9a-f]{32}$/.test(id) || !['wav', 'mp3'].includes(format)) throw new Error('音频参数无效');
  const file = path.join(root(), 'outputs', id, 'metadata.json');
  const item = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  const filename = !original && item.edit && item.editedWav ? item[format === 'wav' ? 'editedWav' : 'editedMp3'] : item[format];
  if (item.id !== id || typeof filename !== 'string' || path.basename(filename) !== filename) throw new Error('音频记录无效');
  return { item, file: path.join(root(), 'outputs', id, filename), filename };
}

// A final synchronous write lets closing the window preserve even an unfinished debounce.
ipcMain.on('session-save-sync', (event, data) => {
  try {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('file:')) throw new Error('请求来源无效');
    licensing.allow();
    event.returnValue = sessions.save(data);
  } catch (error) { event.returnValue = { saved: false, error: error.message }; }
});
ipcMain.on('project-save-sync', (event, data) => {
  try {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('file:')) throw new Error('请求来源无效');
    licensing.allow(); event.returnValue = projects.save(data);
  } catch (error) { event.returnValue = { saved: false, error: error.message }; }
});
ipcMain.on('lab-save-sync', (event, data) => {
  try {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('file:')) throw new Error('请求来源无效');
    licensing.allow(); event.returnValue = laboratory.save(data);
  } catch (error) { event.returnValue = { saved: false, error: error.message }; }
});
ipcMain.handle('studio', studioReply(async (event, action, data = {}) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('file:')) throw new Error('请求来源无效');
  if (action === 'license') return licensing.status();
  if (action === 'activate') {
    const result = await invokeStudio('activate', data);
    statusCache = null;
    sleepGuard.update(jobs.snapshot());
    jobs.start();
    return result;
  }
  if (action === 'status' && !licensing.status().activated) return studio.invoke('status');
  if (action === 'preflight') return studio.invoke(action, data);
  if (action === 'preflight-microphone-permission') {
    preflightMicrophone = false; microphoneUntil = 0;
    requireMicrophoneAccess(systemPreferences);
    preflightMicrophone = true; microphoneUntil = Date.now() + 30000; return {};
  }
  if (action === 'preflight-microphone-result') {
    preflightMicrophone = false; microphoneUntil = 0;
    return studio.invoke(action, data);
  }
  if (action === 'preflight-cancel') return studio.invoke(action, data);
  if (action === 'preflight-copy') {
    const report = await studio.invoke('preflight', data);
    require('electron').clipboard.writeText(JSON.stringify(report, null, 2));
    return { copied: true };
  }
  if (action === 'preflight-location') {
    const choice = await dialog.showOpenDialog(window, { title: '选择声音与运行组件保存位置', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled) return null;
    return invokeStudio(action, { ...data, path: choice.filePaths[0] });
  }
  if (action === 'preflight-prepare') return invokeStudio(action, data);
  if (!['copy-machine', 'logs', 'notices'].includes(action)) licensing.allow();
  if (action === 'cli-config' || action === 'cli-copy') {
    const config = cliConfiguration({ appPath: app.getAppPath(), packaged: app.isPackaged, dataDir: root() });
    if (action === 'cli-config') return config;
    if (!['status', 'generate', 'guide'].includes(data.kind)) throw new Error('复制内容无效');
    require('electron').clipboard.writeText(config[data.kind]);
    return { copied: true };
  }
  if (action === 'cli-save-script') {
    const choice = await dialog.showSaveDialog(window, { defaultPath: 'script.json', filters: [{ name: 'JSON 配音脚本', extensions: ['json'] }] });
    if (choice.canceled) return { saved: false };
    await fs.promises.copyFile(path.join(app.getAppPath(), 'cli', 'example-script.json'), choice.filePath);
    return { saved: true };
  }
  if (action === 'cli-docs') {
    const error = await shell.openPath(cliDocumentPath({ packaged: app.isPackaged, resourceDir: process.resourcesPath, appPath: app.getAppPath() }));
    if (error) throw new Error(`无法打开 CLI 文档：${error}`);
    return { opened: true };
  }
  if (action === 'session-load') return sessions.load();
  if (action === 'session-save') return sessions.save(data);
  if (action === 'projects-list') return projects.list();
  if (action === 'project-load') return projects.load(data.id);
  if (action === 'project-save') return projects.save(data);
  if (action === 'project-delete') {
    if (jobs.hasPending()) throw new Error('请先完成或取消配音任务，再删除项目');
    if (deleting) throw new Error('正在删除，请稍后重试');
    projects.load(data.id);
    deleting = true;
    try {
      await invokeStudio('delete-project-audio', data);
      jobs.forgetProject(data.id);
      return projects.delete(data.id);
    } finally { deleting = false; }
  }
  if (action === 'project-export') return deliveryController().run(data);
  if (action === 'project-export-cancel') return deliveryController().cancel(data.requestId);
  if (action === 'lab-list') return laboratory.list();
  if (action === 'audio-select') {
    const selections = selectAudioVersion(root(), data);
    statusCache = { ...statusCache, audioSelections: selections };
    return selections;
  }
  if (action === 'lab-load') return laboratory.load(data.id);
  if (action === 'lab-save') return laboratory.save(data);
  if (action === 'lab-export') {
    const output = exportBytes(data);
    const choice = await dialog.showSaveDialog(window, { defaultPath: output.name, filters: [{ name: data.format.toUpperCase(), extensions: [data.format] }] });
    if (choice.canceled) return { saved: false };
    licensing.allow(); await fs.promises.writeFile(choice.filePath, output.bytes);
    return { saved: true };
  }
  if (action === 'jobs-list') return jobs.snapshot();
  if (action === 'jobs-delete') return jobs.forgetJob(data.id);
  if (action === 'jobs-submit') { if (deleting) throw new Error('正在删除，请稍后生成'); return jobs.submit(data.options, data.requestId); }
  if (action === 'jobs-cancel') return jobs.cancel(data.id);
  if (action === 'jobs-pause') return jobs.pause(data.id);
  if (action === 'jobs-resume') return jobs.resume(data.id);
  if (action === 'jobs-retry') { if (deleting) throw new Error('正在删除，请稍后重试'); return jobs.retry(data.id, data.requestId); }
  if (['delete-work', 'delete-works', 'delete-reference'].includes(action)) {
    if (jobs.hasPending()) throw new Error('请等配音完成后再删除');
    if (deleting) throw new Error('正在删除，请稍后重试');
    deleting = true;
    try {
      const result = await invokeStudio(action, data);
      return { ...result, jobs: action === 'delete-works' ? jobs.forgetItems(result.deletedIds) : action === 'delete-work' ? jobs.forgetItem(data.id) : jobs.snapshot() };
    }
    finally { deleting = false; }
  }
  if (action === 'status') {
    // Paused and scheduled jobs do not own the worker. They must not freeze
    // resource lists until the user resumes or cancels the task.
    if (!jobs.hasRunnable()) statusCache = await invokeStudio('status');
    let history = statusCache?.history || [];
    try { history = JSON.parse(await fs.promises.readFile(path.join(root(), 'history.json'), 'utf8')); } catch {}
    return { ...statusCache, history, license: licensing.status(), jobs: jobs.snapshot() };
  }
  if (action === 'update-reference') return invokeStudio(action, data);
  if (action === 'recording-permission') {
    if (event.senderFrame !== window.webContents.mainFrame || data.consent !== true) throw new Error('请先确认你拥有这段声音的使用授权');
    preflightMicrophone = false; microphoneUntil = 0;
    requireMicrophoneAccess(systemPreferences);
    microphoneUntil = Date.now() + 60000;
    return {};
  }
  if (action === 'recording-release') { microphoneUntil = 0; return {}; }
  if (action === 'recording-save') return saveRecording({ invoke: invokeStudio }, root(), data);
  if (action === 'cancel') {
    if (delivery?.busy()) return delivery.cancelActive();
    studio.cancel(); return { cancelled: true };
  }
  if (action === 'audio') { const { file } = await getItem(data.id, 'wav', data.original === true); return fs.promises.readFile(file); }
  if (action === 'reference-import-audio') {
    if (!/^[a-f0-9]{32}$/.test(data.token || '')) throw new Error('录音导入标识无效');
    const base = path.join(root(), '.reference-imports'), folder = path.join(base, data.token), file = path.join(folder, 'audio.wav');
    for (const candidate of [base, folder, file]) if ((await fs.promises.lstat(candidate)).isSymbolicLink()) throw new Error('录音暂存路径无效');
    return fs.promises.readFile(file);
  }
  if (action === 'reference-audio') {
    if (!/^[0-9a-f]{32}$/.test(data.id)) throw new Error('声音不存在');
    return fs.promises.readFile(path.join(root(), 'references', data.id + '.wav'));
  }
  if (action === 'save') {
    const { item, file } = await getItem(data.id, data.format, data.original === true);
    const choice = await dialog.showSaveDialog(window, { defaultPath: item[data.format], filters: [{ name: data.format.toUpperCase(), extensions: [data.format] }] });
    if (!choice.canceled) await fs.promises.copyFile(file, choice.filePath);
    return { saved: !choice.canceled };
  }
  if (action === 'folder') { await shell.openPath(path.join(root(), 'outputs')); return {}; }
  if (action === 'logs') { shell.showItemInFolder(path.join(root(), 'studio.log')); return {}; }
  if (action === 'catalog') return JSON.parse(fs.readFileSync(path.join(shared(), 'catalog.json'), 'utf8'));
  if (action === 'copy-machine') { require('electron').clipboard.writeText(licensing.machine); return {}; }
  if (action === 'notices') { await shell.openPath(path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'THIRD_PARTY_NOTICES.md')); return {}; }
  if (action === 'import-script') {
    const choice = await dialog.showOpenDialog(window, { filters: [{ name: '文稿与课件', extensions: ['csv', 'tsv', 'txt', 'docx', 'pptx'] }], properties: ['openFile'] });
    if (choice.canceled) return null;
    return require('./documents.cjs').readScript(choice.filePaths[0]);
  }
  if (action === 'reference-open' || action === 'background-import') {
    if (generationExecuting) throw new Error('正在配音，请先暂停托管或等当前配音完成，再导入音频。');
    if (action === 'reference-open' && data.consent !== true) throw new Error('请确认你拥有参考声音的使用授权');
    const choice = await dialog.showOpenDialog(window, { title: action === 'reference-open' ? '选择参考录音' : '选择背景音乐',
      filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'ogg'] }], properties: ['openFile'] });
    if (choice.canceled) return null;
    return invokeStudio(action, { ...data, path: choice.filePaths[0] });
  }
  if (action === 'transcription-cancel') {
    return transcriptionPreparation.cancel(data.requestId);
  }
  if (action === 'transcription-setup') {
    return transcriptionPreparation.run(data);
  }
  if (['audio-edit', 'audio-inspect', 'reference-transcribe', 'reference-commit', 'reference-cancel', 'project-preview'].includes(action)) {
    if (generationExecuting && action !== 'reference-cancel') throw new Error('正在配音，请先暂停托管或等当前配音完成，再保存编辑或试听混音。');
    return invokeStudio(action, data);
  }
  if (!['status', 'setup', 'generate', 'zip', 'reference', 'update-reference', 'capture', 'prepare-voice'].includes(action)) throw new Error('操作不存在');
  if (action === 'reference') {
    if (!data.consent) throw new Error('请确认你拥有参考声音的使用授权');
    const choice = await dialog.showOpenDialog(window, { filters: [{ name: '参考人声', extensions: ['wav', 'mp3', 'flac'] }], properties: ['openFile'] });
    if (choice.canceled) return null;
    return invokeStudio('reference', { ...data, path: choice.filePaths[0] });
  }
  if (action === 'zip') {
    const choice = await dialog.showSaveDialog(window, { defaultPath: 'voice-pack.zip', filters: [{ name: 'ZIP 音频包', extensions: ['zip'] }] });
    if (choice.canceled) return { saved: false };
    const result = await invokeStudio('zip', data);
    await copyTemporaryExport(root(), result, choice.filePath);
    return { saved: true, count: result.count };
  }
  return invokeStudio(action, data);
}));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  const appIcon = path.join(__dirname, '../ui/icon.png');
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  app.setAboutPanelOptions({ applicationName: '声悦', applicationVersion: app.getVersion(), iconPath: appIcon });
  fs.mkdirSync(root(), { recursive: true });
  fs.mkdirSync(path.join(root(), 'outputs'), { recursive: true });
  sessions = createSessionStore(root());
  projects = createProjectStore(root());
  laboratory = createLabStore(root());
  studio = createStudio({ dataDir: root(), resourceDir: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), onProgress: data => { if (!generationExecuting || !jobs?.acceptProgress(data)) progress(data); } });
  licensing = studio.licensing;
  statusCache = await invokeStudio('status').catch(() => ({ history: [], packages: [], references: [] }));
  const notified = new Set();
  jobs = createJobQueue({ dataDir: root(), execute: (data, job) => invokeStudio('generate', data, () => job.stopping), cancel: () => { if (generationExecuting) studio.cancel(); }, allow: () => licensing.allow(), onChange: snapshot => {
    if (!licensing.status().activated) return;
    if (!quitting) sleepGuard.update(snapshot);
    progress({ type: 'jobs', ...snapshot });
    for (const job of snapshot.jobs) if (['complete', 'partial', 'failed'].includes(job.status) && !notified.has(job.id)) {
      notified.add(job.id);
      if (window && (window.isMinimized() || !window.isVisible()) && Notification.isSupported()) {
        const notification = new Notification({ title: job.status === 'complete' ? '配音完成了' : '配音任务需要处理', body: `${job.name} · ${job.status === 'complete' ? `已保存 ${job.completed} 段配音` : job.error}` });
        notification.on('click', () => { window.restore(); window.show(); progress({ type: 'open-job', id: job.id }); }); notification.show();
      }
    }
  } });
  jobs.snapshot().jobs.filter(job => ['complete', 'partial', 'failed'].includes(job.status)).forEach(job => notified.add(job.id));
  if (licensing.status().activated) sleepGuard.update(jobs.snapshot());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: '声悦', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
  const createWindow = () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window = new BrowserWindow({ ...windowBounds(display.workArea),
      title: '声悦', backgroundColor: '#f6f7fb', icon: path.join(__dirname, '../ui/icon.png'),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => audioPermission(wc, window.webContents, permission, details, (licensing.status().activated || preflightMicrophone) && Date.now() < microphoneUntil));
    window.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => callback(audioPermission(wc, window.webContents, permission, details, (licensing.status().activated || preflightMicrophone) && Date.now() < microphoneUntil)));
    window.on('close', event => {
      if (!quitting && licensing.status().activated && jobs.hasPending()) { event.preventDefault(); window.minimize(); progress({ type: 'jobs-note', message: '配音继续在后台处理，完成后会提醒你。' }); }
      else delivery?.cancelActive();
    });
    window.loadFile(path.join(__dirname, '../ui/index.html'));
  };
  createWindow();
  if (licensing.status().activated) jobs.start();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; delivery?.cancelActive(); sleepGuard.stop(); jobs?.shutdown(); studio?.cancel(); });
app.on('will-quit', () => { sessions?.close(); projects?.close(); laboratory?.close(); });
