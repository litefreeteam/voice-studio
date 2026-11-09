const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function packaged() {
  return !!process.versions.electron && require('electron').app.isPackaged;
}

// Keep interpreter and loader injection settings out of release subprocesses.
function childEnvironment(extra = {}, release = packaged()) {
  const env = { ...process.env };
  if (release) for (const key of Object.keys(env)) {
    if (/^(PYTHON|UV_|PIP_|CONDA|VIRTUAL_ENV|DYLD_|LD_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|VOICE_STUDIO_PYTHON$)/i.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

// Python cannot read ASAR directly. Give each worker a private, fresh copy of
// files read through Electron's ASAR integrity checks; never reuse loose files.
function materializeEngine(sourceDir) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-engine-'));
  fs.chmodSync(folder, 0o700);
  try {
    for (const part of ['backend', 'shared']) {
      fs.mkdirSync(path.join(folder, part));
      for (const name of fs.readdirSync(path.join(sourceDir, part))) {
        const source = path.join(sourceDir, part, name);
        if (!fs.statSync(source).isFile() || !/\.(py|json|pem|lock|txt|mp3)$/.test(name)) continue;
        fs.writeFileSync(path.join(folder, part, name), fs.readFileSync(source), { mode: 0o600, flag: 'wx' });
      }
    }
    // The optional CPU adapter is a small, pinned Python package. Read every
    // source through ASAR too; never import code from user model directories.
    function copyVendor(relative) {
      const source = path.join(sourceDir, relative);
      if (!fs.existsSync(source)) return;
      fs.mkdirSync(path.join(folder, relative), { recursive: true });
      for (const name of fs.readdirSync(source)) {
        if (name === '__pycache__') continue;
        const child = path.join(relative, name), file = path.join(sourceDir, child);
        if (fs.statSync(file).isDirectory()) copyVendor(child);
        else if (/\.(py|json|txt)$/.test(name) || name === 'LICENSE') {
          fs.writeFileSync(path.join(folder, child), fs.readFileSync(file), { mode: 0o600, flag: 'wx' });
        }
      }
    }
    copyVendor('backend/vendor/voxcpm');
    return { root: folder, cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

const TOOL_HASHES = {
  'mac-arm64/uv': '65910fd6aad18674516122e077a932248c672ff849dc2946045d69326480e3e6',
  'mac-x64/uv': '597464488a968dba4f4173ccf95728d000616b2730c8ee00657df5a58f7f3a68',
  'win-x64/uv.exe': '0548e585d7030d3be5e23cbf32da0d510a4225d15b72c28b15cc7ee7187dbb59'
};
function verifyTool(file, target) {
  if (!TOOL_HASHES[target] || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== TOOL_HASHES[target]) {
    throw Object.assign(new Error('运行组件完整性校验失败，请重新下载完整安装包'), { code: 'INTEGRITY_ERROR' });
  }
  return file;
}
module.exports = { packaged, childEnvironment, materializeEngine, verifyTool, TOOL_HASHES };
