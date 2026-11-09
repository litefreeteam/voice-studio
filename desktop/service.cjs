const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { LicenseStore } = require('./license.cjs');
const { deleteStoredItem, deleteStoredWorks, deleteProjectAudio } = require('./deletion.cjs');
const { cleanupStaleExports, cleanupStaleDeliveryWork, cleanupDeliveryWork, cleanupDeliveryExport, validateTemporaryExport } = require('./exports.cjs');
const { profileFor, storageProbe } = require('./compatibility.cjs');
const { createPreflight } = require('./preflight.cjs');
const TRUSTED_PUBLIC_KEY = require('./trust-anchor.cjs');
const { packaged, childEnvironment, materializeEngine, verifyTool } = require('./integrity.cjs');
const { sources: downloadSources, withDownloadSources } = require('./downloads.cjs');
const { resourceSelection, resourcePlan } = require('./resources.cjs');

function studioError(code, message) { return Object.assign(new Error(message), { code }); }
function defaultDataDir() {
  if (process.env.VOICE_STUDIO_DATA) return path.resolve(process.env.VOICE_STUDIO_DATA);
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(base, 'Voice Studio');
}

// Shared by the desktop and CLI so licensing, installation and worker behavior agree.
function createStudio({ dataDir = defaultDataDir(), resourceDir = path.join(__dirname, '..'), trustedPublicKey = TRUSTED_PUBLIC_KEY, onProgress = () => {}, workerIdleMs = 60000 } = {}) {
  const release = packaged();
  const toolResources = resourceDir;
  // Release callers cannot redirect code, catalogs or trust anchors to loose files.
  if (release) { resourceDir = path.join(__dirname, '..'); trustedPublicKey = TRUSTED_PUBLIC_KEY; }
  dataDir = path.resolve(dataDir);
  fs.mkdirSync(path.join(dataDir, 'outputs'), { recursive: true });
  const root = () => dataDir;
  const storageFile = path.join(dataDir, 'storage.json');
  let storageDir = dataDir;
  try { storageDir = path.resolve(JSON.parse(fs.readFileSync(storageFile, 'utf8')).assetDir); } catch {}
  // A detached drive must fail explicitly instead of silently installing to a different disk.
  const assets = () => storageDir;
  const backend = () => path.join(resourceDir, 'backend');
  const runtime = () => path.join(assets(), 'runtime');
  const pythonOverride = !release && process.env.VOICE_STUDIO_PYTHON;
  const python = () => pythonOverride || path.join(runtime(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  function runtimeReady() {
    if (pythonOverride) return fs.existsSync(python());
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(runtime(), 'ready.json'), 'utf8'));
      const profile = profileFor();
      return fs.existsSync(python()) && !!profile && marker.profile === profile.id && marker.requirementsHash === requirementsHash(profile);
    } catch { return false; }
  }
  const requirementsHash = profile => require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(backend(), profile.requirements))).digest('hex');
  const log = message => fs.appendFileSync(path.join(root(), 'studio.log'), `${new Date().toISOString()} ${message}\n`);
  const preparationFile = path.join(dataDir, 'resource-preparation.json');
  let preparation = null, resourceBatch = null;
  try {
    const saved = JSON.parse(fs.readFileSync(preparationFile, 'utf8'));
    resourceSelection(saved);
    if (['running', 'paused', 'failed', 'complete'].includes(saved.status)) preparation = { ...saved, status: saved.status === 'running' ? 'paused' : saved.status };
  } catch {}
  function savePreparation(value) {
    preparation = value;
    fs.writeFileSync(preparationFile + '.tmp', JSON.stringify(value));
    fs.renameSync(preparationFile + '.tmp', preparationFile);
  }
  const progress = event => {
    if (resourceBatch) {
      const batch = resourceBatch, entry = batch.plan.packages.find(pack => pack.id === batch.id);
      if (event.stage === 'download' && entry && event.aggregateTotal > 0) {
        batch.bytes[batch.id] = Math.max(batch.bytes[batch.id] || 0,
          Math.min(entry.total, event.aggregateCurrent / event.aggregateTotal * entry.total));
      }
      event = { ...event, package: batch.id, packageIndex: batch.ids.indexOf(batch.id) + 1,
        packageCount: batch.ids.length, resourcesCurrent: Object.values(batch.bytes).reduce((sum, bytes) => sum + bytes, 0),
        resourcesTotal: batch.plan.total, resourcePackages: batch.packages };
      savePreparation({ ...preparation, stage: event.stage, current: event.resourcesCurrent, total: event.resourcesTotal,
        package: batch.id, packageIndex: event.packageIndex, packageCount: event.packageCount });
    }
    onProgress(event);
  };
  const licensing = new LicenseStore(root(), trustedPublicKey);
  let worker, activeChild, busy = false, cancelled = false, sequence = 0, exportsCleaned = false;
  let workerIdleTimer;
  const retiringWorkers = new Set();
  let activeDelivery;
  const pending = new Map();
  function scheduleWorkerRelease(delay = workerIdleMs) {
    if (!worker || workerIdleTimer) return;
    workerIdleTimer = setTimeout(() => {
      workerIdleTimer = null;
      if (!worker) return;
      // Status polling must not keep a loaded model alive indefinitely. An
      // in-flight operation, however, always gets to finish before retirement.
      if (busy || pending.size) { scheduleWorkerRelease(Math.min(workerIdleMs, 1000)); return; }
      const idle = worker;
      worker = null;
      retiringWorkers.add(idle);
      idle.closed.finally(() => retiringWorkers.delete(idle));
      kill(idle);
    }, delay);
    workerIdleTimer.unref();
  }
  const lockPath = path.join(root(), '.operation.lock');
  let ownedLocks;
  function registerChild(child) {
    if (!ownedLocks || !Number.isInteger(child?.pid)) return;
    const owner = `${child.pid}-${require('node:crypto').randomUUID()}`;
    // Include a partially created owner in rollback if creation fails after open().
    ownedLocks.add(owner);
    try { fs.writeFileSync(path.join(lockPath, owner), '', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') ownedLocks.delete(owner); throw error; }
  }

  function removeOwnedLocks(owners) {
    let failure;
    for (const owner of owners) {
      try { fs.unlinkSync(path.join(lockPath, owner)); }
      catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
    }
    // Never remove recursively: an owner created by a contender must survive.
    try { fs.rmdirSync(lockPath); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) failure ||= error; }
    if (failure) throw failure;
  }

  function acquire() {
    // Unique owner names keep concurrent stale-lock recovery from deleting a new owner.
    const ownerName = `${process.pid}-${require('node:crypto').randomUUID()}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let created = false;
      try { fs.mkdirSync(lockPath); created = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (created) {
        const owners = new Set([ownerName]);
        ownedLocks = owners;
        try {
          try { fs.writeFileSync(path.join(lockPath, ownerName), '', { flag: 'wx', mode: 0o600 }); }
          catch (error) { if (error.code === 'EEXIST') owners.delete(ownerName); throw error; }
          registerChild(worker);
          registerChild(activeChild);
          return () => {
            try { removeOwnedLocks(owners); }
            finally { if (ownedLocks === owners) ownedLocks = null; }
          };
        } catch (error) {
          try { removeOwnedLocks(owners); }
          catch (cleanupError) { error.cleanupError = cleanupError; }
          finally { if (ownedLocks === owners) ownedLocks = null; }
          if (error.code === 'ENOENT' && !error.cleanupError) continue;
          throw error;
        }
      }
      let owners;
      try { owners = fs.readdirSync(lockPath); } catch (read) { if (read.code === 'ENOENT') continue; throw read; }
      // A different process may be between mkdir and owner creation. Never age out
      // an empty lock: a suspended live process could otherwise lose its exclusion.
      if (!owners.length) throw studioError('BUSY', '数据目录正在建立任务锁，请稍后重试；若持续出现，请确认没有其他声悦进程后联系支持');
      for (const owner of owners) {
        const pid = Number(owner.split('-')[0]);
        if (!Number.isInteger(pid) || pid <= 0) throw studioError('BUSY', '任务锁无效，请检查数据目录');
        try { process.kill(pid, 0); }
        catch (probe) {
          if (probe.code === 'ESRCH') {
            try { fs.unlinkSync(path.join(lockPath, owner)); } catch (remove) { if (remove.code !== 'ENOENT') throw remove; }
            continue;
          }
        }
        throw studioError('BUSY', '桌面端或其他 CLI 正在操作此数据目录，请稍后重试');
      }
      try { fs.rmdirSync(lockPath); } catch (remove) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(remove.code)) throw remove; }
    }
    throw studioError('BUSY', '数据目录正忙，请稍后重试');
  }

  function uvPath() {
    const target = profileFor()?.uv || 'unsupported';
    const bundled = path.join(toolResources, 'uv', target);
    const file = fs.existsSync(bundled) ? bundled : path.join(toolResources, 'resources/uv', target);
    return release ? verifyTool(file, target) : file;
  }

  function run(executable, args, stage, source) {
    return new Promise((resolve, reject) => {
      if (cancelled) return reject(new Error('操作已取消'));
      log(`Resource preparation: stage=${stage} source=${source.id}`);
      const child = spawn(executable, args, { windowsHide: true, env: childEnvironment({
        PYTHONUNBUFFERED: '1', UV_PYTHON_INSTALL_DIR: path.join(assets(), 'python'),
        UV_CACHE_DIR: path.join(assets(), 'cache/uv'), UV_PYTHON_CACHE_DIR: path.join(assets(), 'cache/python-archives'),
        UV_HTTP_TIMEOUT: '20', UV_HTTP_CONNECT_TIMEOUT: '10', UV_HTTP_RETRIES: '1', UV_NO_CONFIG: '1',
        UV_PYTHON_INSTALL_MIRROR: stage === 'runtime' ? source.url : downloadSources.python[0].url,
        UV_PYTHON_CPYTHON_BUILD: downloadSources.pythonBuild, UV_EXTRA_INDEX_URL: '', UV_INDEX: '',
        ...(stage === 'dependencies' ? { UV_DEFAULT_INDEX: source.url, UV_INDEX_URL: source.url } : {})
      }) });
      activeChild = child;
      child.closed = new Promise(resolve => child.once('close', resolve));
      const timer = setTimeout(() => { kill(child); }, 20 * 60 * 1000);
      child.once('close', () => clearTimeout(timer));
      let detail = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', buffer => {
        timer.refresh();
        const value = buffer.toString();
        detail = (detail + value).slice(-8192);
        log(value);
        const lines = value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/[\r\n]/).filter(Boolean);
        if (lines.length) progress({ stage, source: source.id, message: stage === 'runtime' ? '正在准备声悦定制资源，请稍候…' : '正在安装声悦定制资源，请稍候…' });
      });
      child.on('error', reject);
      child.on('close', code => {
        if (activeChild === child) activeChild = null;
        if (cancelled) reject(studioError('CANCELLED', '操作已取消，已下载的文件会保留'));
        else if (code !== 0) {
          log(`Resource preparation failed: stage=${stage} source=${source.id} exit=${code}`);
          const missingFile = /file not found|no such file or directory|cannot find the (?:file|path)|system cannot find/i.test(detail);
          reject(Object.assign(new Error(missingFile
            ? '安装所需的资源文件无法读取，请重新安装最新版本；详细信息已写入诊断日志'
            : '声悦定制资源安装失败，详细原因已写入诊断日志；已下载的内容会保留'),
          { code: missingFile ? 'INSTALL_RESOURCE_MISSING' : 'RESOURCE_INSTALL_FAILED', detail }));
        }
        else resolve();
      });
      try { registerChild(child); }
      catch (error) { kill(child); reject(error); }
    });
  }

  async function setup(data = {}) {
    const profile = profileFor();
    if (!profile) throw new Error('当前版本面向 M 系列 Mac、Intel Mac 和 Windows x64，请先运行购前检测');
    if (!runtimeReady()) {
      if (!fs.existsSync(uvPath())) throw new Error('安装包缺少运行环境管理器，请重新下载完整安装包');
      if (process.platform === 'darwin') {
        try { fs.accessSync(uvPath(), fs.constants.X_OK); }
        catch { throw new Error('运行组件没有执行权限，请将应用完整安装到应用程序目录后重试'); }
      }
      progress({ stage: 'runtime', message: '正在准备声悦定制资源，首次安装请保持联网…' });
      await close();
      const interpreterMarker = path.join(runtime(), 'interpreter.json');
      let interpreter;
      try { interpreter = JSON.parse(fs.readFileSync(interpreterMarker, 'utf8')); } catch {}
      if (!fs.existsSync(python()) || interpreter?.profile !== profile.id || interpreter?.version !== downloadSources.pythonVersion) {
        const source = await withDownloadSources('python', source => run(uvPath(),
          ['venv', '--no-config', '--managed-python', '--python', profile.python.replace('3.12-', `${downloadSources.pythonVersion}-`), '--clear', runtime()], 'runtime', source), { progress, cancelled: () => cancelled });
        interpreter = { profile: profile.id, version: downloadSources.pythonVersion, source };
        fs.writeFileSync(interpreterMarker, JSON.stringify(interpreter));
      }
      progress({ stage: 'dependencies', message: '正在安装声悦定制资源…' });
      // uv is a native subprocess and cannot read Electron's virtual ASAR paths.
      // Read through Electron's integrity checks into the same private, fresh
      // payload used by workers; retain it for every index attempt and then remove it.
      const payload = release ? materializeEngine(resourceDir) : null;
      let packageSource;
      try {
        const requirements = path.join(payload ? path.join(payload.root, 'backend') : backend(), profile.requirements);
        packageSource = await withDownloadSources('packages', source => run(uvPath(),
          ['pip', 'install', '--no-config', '--default-index', source.url, '--only-binary', ':all:', '--python', python(), '-r', requirements], 'dependencies', source), { progress, cancelled: () => cancelled });
      } finally { payload?.cleanup(); }
      const ready = path.join(runtime(), 'ready.json');
      fs.writeFileSync(ready + '.tmp', JSON.stringify({ installedAt: Date.now(), profile: profile.id, requirementsHash: requirementsHash(profile), sources: { python: interpreter.source, packages: packageSource } }));
      fs.renameSync(ready + '.tmp', ready);
    }
    if (data.runtimeOnly) return request('status');
    return request('download', data);
  }

  async function prepareResources(data) {
    const ids = resourceSelection(data), plan = resourcePlan(assets(), ids);
    let current = runtimeReady() ? await request('status') : { packages: [] };
    const installed = id => current.packages?.some(pack => pack.id === id && pack.ready && pack.verified);
    resourceBatch = { ids, plan, id: null, packages: current.packages, bytes: Object.fromEntries(plan.packages.map(pack => [pack.id, installed(pack.id) ? pack.total : pack.available])) };
    try {
      savePreparation({ packages: ids, status: 'running', stage: 'preparing', current: Object.values(resourceBatch.bytes).reduce((sum, bytes) => sum + bytes, 0), total: plan.total });
      for (const id of ids) {
        if (cancelled) throw studioError('CANCELLED', '准备已暂停，已下载的文件会保留');
        const entry = plan.packages.find(pack => pack.id === id);
        if (installed(id) && !data.checkUpdates) { resourceBatch.bytes[id] = entry.total; continue; }
        resourceBatch.id = id;
        progress({ stage: 'preparing', message: '正在检查配音资源…' });
        current = await setup({ package: id });
        resourceBatch.packages = current.packages;
        if (cancelled) throw studioError('CANCELLED', '准备已暂停，已下载的文件会保留');
        if (!installed(id)) throw studioError('RESOURCE_INCOMPLETE', '声音资源尚未通过完整校验，请重试准备');
        resourceBatch.bytes[id] = entry.total;
      }
      if (!ids.every(installed)) throw studioError('RESOURCE_INCOMPLETE', '声音资源尚未全部准备完成，请继续准备');
      savePreparation({ ...preparation, status: 'complete', stage: 'complete', current: plan.total, total: plan.total });
      return { runtimeReady: true, ...current, resources: { plan: resourcePlan(assets()), preparation } };
    } catch (error) {
      savePreparation({ ...preparation, status: cancelled || error.code === 'CANCELLED' ? 'paused' : 'failed', message: error.message });
      throw error;
    } finally { resourceBatch = null; }
  }

  function startWorker() {
    if (worker) return;
    const payload = release ? materializeEngine(resourceDir) : null;
    let child;
    try {
      child = spawn(python(), ['-I', '-X', 'utf8', '-u', path.join(payload?.root || resourceDir, 'backend/worker.py'), '--data-dir', root(), '--asset-dir', assets()], {
        windowsHide: true, env: childEnvironment({ PYTHONUNBUFFERED: '1', TOKENIZERS_PARALLELISM: 'false', HF_HOME: path.join(assets(), 'cache/huggingface') })
      });
    } catch (error) { payload?.cleanup(); throw error; }
    child.once('close', () => payload?.cleanup());
    worker = child;
    child.closed = new Promise(resolve => child.once('close', resolve));
    // write() reports failures through its callback; also handle the stream event.
    child.stdin.on('error', () => {});
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      let data;
      try { data = JSON.parse(line); } catch { log(`Worker stdout: ${line}`); return; }
      try {
        if (data.type === 'progress') {
          for (const promise of pending.values()) promise.touch?.();
          progress(activeDelivery ? { ...data, requestId: activeDelivery.requestId, projectId: activeDelivery.projectId } : data);
        } else if (data.type === 'result' || data.type === 'error') {
          const promise = pending.get(data.id);
          if (promise) {
            pending.delete(data.id);
            if (data.type === 'error') promise.reject(studioError(data.code === 'LICENSE_REQUIRED' ? data.code : 'ENGINE_ERROR', data.message));
            else promise.resolve(data.result);
          }
        }
      } catch (error) {
        for (const promise of pending.values()) promise.reject(error);
        pending.clear();
        kill(child);
      }
    });
    child.stderr.on('data', buffer => log(buffer.toString()));
    let exited = false;
    const died = error => {
      if (exited) return;
      exited = true;
      if (worker !== child) return;
      worker = null;
      for (const promise of pending.values()) promise.reject(studioError(cancelled ? 'CANCELLED' : 'ENGINE_EXITED', cancelled ? '操作已取消；已完成的音频已保留' : `语音引擎退出，请重试。${error || ''}`));
      pending.clear();
    };
    child.on('error', died);
    child.on('close', code => died(code ? `退出码 ${code}` : ''));
    // Install exit handlers before owner creation, which can fail on a full disk.
    try { registerChild(child); }
    catch (error) { kill(child); throw error; }
  }

  function request(op, data = {}) {
    licensing.allow();
    if (!runtimeReady()) return Promise.reject(studioError('RUNTIME_NOT_READY', '请先执行 setup 安装本地引擎'));
    if (op !== 'status') { clearTimeout(workerIdleTimer); workerIdleTimer = null; }
    startWorker();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = op === 'generate' && data.managed === true ? 30 * 60 * 1000 : 0;
      const timer = timeoutMs ? setTimeout(() => {
        pending.delete(id); kill(worker);
        reject(new Error('当前段超过 30 分钟没有进展，已结束本次尝试，将按托管策略重试'));
      }, timeoutMs) : null;
      pending.set(id, { touch: () => timer?.refresh(), resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      worker.stdin.write(JSON.stringify({ id, op, data }) + '\n', error => {
        if (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    });
  }

  function kill(child) {
    if (!child) return;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else {
      child.kill('SIGTERM');
      if (!child.terminationTimer) {
        child.terminationTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.terminationTimer.unref();
        child.once('close', () => clearTimeout(child.terminationTimer));
      }
    }
  }


  async function close() {
    clearTimeout(workerIdleTimer); workerIdleTimer = null;
    const children = [...retiringWorkers, worker, activeChild].filter(Boolean);
    for (const child of children) kill(child);
    await Promise.all(children.map(child => child.closed));
  }
  const preflight = createPreflight({ dataDir, assetDir: assets, machine: licensing.machine, runtimeReady, progress });
  async function invoke(action, data = {}) {
    // License inspection and activation never start a worker or wait for a task.
    if (action === 'license') return licensing.status();
    if (action === 'activate') return licensing.activate(data.code);
    if (action === 'preflight') return preflight.inspect(data);
    if (action === 'preflight-cancel') { preflight.cancel(); return { cancelled: true }; }
    if (action === 'preflight-microphone-result') return preflight.microphoneResult(data);
    const license = licensing.status();
    if (!['status', 'preflight-prepare', 'preflight-location'].includes(action)) licensing.allow();
    if (action === 'status' && !license.activated) return {
      dataDir, runtimeReady: runtimeReady(), license, modelReady: false, history: [], packages: [], references: []
    };
    if (busy) throw studioError('BUSY', '当前操作尚未完成');
    busy = true;
    let release, deliveryToken, operationError, deliverySucceeded = false;
    cancelled = false;
    try {
      release = acquire();
      if (!exportsCleaned) { cleanupStaleExports(dataDir); cleanupStaleDeliveryWork(dataDir); exportsCleaned = true; }
      if (action === 'project-export' || action === 'project-preview') {
        if (!data || typeof data !== 'object' || typeof data.requestId !== 'string'
            || !/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId)) throw studioError('INVALID_ARGUMENT', '导出请求标识无效');
        deliveryToken = require('node:crypto').randomUUID().replaceAll('-', '');
        activeDelivery = { requestId: data.requestId, projectId: data.projectId };
        // Renderer paths/tokens never select a scratch location. Validate the
        // worker result against this exact call before allowing publication.
        const result = await request(action, { ...data, exportToken: deliveryToken });
        if (action === 'project-preview') return result;
        validateTemporaryExport(dataDir, result, deliveryToken);
        if (cancelled) throw studioError('CANCELLED', '导出已取消');
        deliverySucceeded = true;
        return result;
      }
      if (action === 'preflight-prepare') return await preflight.prepare(data);
      if (action === 'preflight-location') {
        if (fs.existsSync(path.join(assets(), 'runtime')) || fs.existsSync(path.join(assets(), 'models'))) throw new Error('请在首次准备前选择位置；已有模型时暂不自动搬迁');
        if (typeof data.path !== 'string' || !path.isAbsolute(data.path)) throw new Error('请选择本机磁盘上的文件夹');
        const target = path.join(data.path, 'Shengyue-Voice');
        fs.mkdirSync(target, { recursive: true });
        if (!storageProbe(target).writable) throw new Error('该文件夹无法正常读写');
        fs.writeFileSync(storageFile + '.tmp', JSON.stringify({ assetDir: target })); fs.renameSync(storageFile + '.tmp', storageFile);
        storageDir = target;
        return preflight.inspect(data);
      }
      if (action === 'catalog') return JSON.parse(fs.readFileSync(path.join(resourceDir, 'shared/catalog.json'), 'utf8'));
      if (['delete-work', 'delete-reference'].includes(action)) return deleteStoredItem(dataDir, action === 'delete-work' ? 'work' : 'reference', data.id);
      if (action === 'delete-works') return deleteStoredWorks(dataDir, data.ids);
      if (action === 'delete-project-audio') return deleteProjectAudio(dataDir, data.id);
      if (action === 'status') {
        const hardware = { memoryGB: Math.round(os.totalmem() / 2 ** 30), freeDiskGB: null, platform: process.platform, arch: process.arch };
        try { const disk = fs.statfsSync(root()); hardware.freeDiskGB = Math.floor(disk.bavail * disk.bsize / 1e9); } catch {}
        return { dataDir, assetDir: assets(), runtimeReady: runtimeReady(), hardware, license,
          resources: { plan: resourcePlan(assets()), preparation },
          ...(runtimeReady() ? await request('status') : { modelReady: false, history: [], packages: [], references: [] }) };
      }
      if (action === 'setup') return data.packages !== undefined ? await prepareResources(data) : { runtimeReady: true, ...await setup(data) };
      if (action === 'transcription-setup') { await setup({ runtimeOnly: true }); return await request('transcription-download'); }
      if (['audio-edit', 'audio-inspect', 'audio-select', 'background-import', 'reference-open', 'reference-transcribe', 'reference-commit', 'reference-cancel'].includes(action)) {
        if (action === 'reference-open' && data.consent !== true) throw studioError('CONSENT_REQUIRED', '请确认你拥有参考声音的使用授权');
        if (action === 'reference-open' && !runtimeReady()) await setup({ runtimeOnly: true });
        return await request(action, data);
      }
      if (action === 'reference') {
        if (data.consent !== true) throw studioError('CONSENT_REQUIRED', '请确认你拥有参考声音的使用授权');
      } else if (!['generate', 'zip', 'capture', 'prepare-voice', 'update-reference'].includes(action)) throw studioError('INVALID_ARGUMENT', '操作不存在');
      return await request(action, data);
    } catch (error) {
      operationError = error;
      // Keep the lock until a failed worker has stopped writing outputs/history.
      if (release) await close();
      throw error;
    } finally {
      try { if (cancelled) await close(); }
      finally {
        try {
          if (deliveryToken) {
            let cleanupError;
            try { cleanupDeliveryWork(dataDir, deliveryToken); }
            catch (error) { cleanupError = error; }
            // Always attempt both cleanups, even when the first filesystem
            // operation fails. Do not publish a result with failed cleanup.
            if (!deliverySucceeded || cancelled || cleanupError) {
              try { cleanupDeliveryExport(dataDir, deliveryToken); }
              catch (error) { cleanupError ||= error; }
            }
            if (cleanupError) {
              if (!operationError) throw cleanupError;
              operationError.cleanupError = cleanupError;
              try { log(`Delivery cleanup failed: ${cleanupError.message}`); } catch {}
            }
          }
        } finally {
          activeDelivery = null;
          try { if (release) release(); } finally { busy = false; scheduleWorkerRelease(); }
        }
      }
    }
  }
  return { invoke, close, cancel() { preflight.cancel(); cancelled = true; kill(activeChild); kill(worker); },
    cancelExport(requestId) {
      if (!activeDelivery || activeDelivery.requestId !== requestId) return false;
      cancelled = true;
      kill(worker);
      return true;
    }, licensing, dataDir };
}
module.exports = { createStudio, defaultDataDir, studioError };
