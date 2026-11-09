const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../shared/model-manifest.json').repositories;

const RESOURCE_PACKAGES = ['standard', 'light', 'character', 'reference'];
const OPTIONAL_PACKAGES = ['expressive'];
const models = {
  standard: ['qwen3-custom', '1.7B-CustomVoice'], light: ['voice-light', '0.6B-CustomVoice'],
  character: ['voice-character', '1.7B-VoiceDesign'], reference: ['voice-reference', '1.7B-Base'],
  expressive: ['voice-expressive', 'VoxCPM2']
};
function resourceSelection(data = {}) {
  const ids = data.packages ?? RESOURCE_PACKAGES;
  if (!Array.isArray(ids) || !ids.length || ids.length > 5 || ids.some(id => ![...RESOURCE_PACKAGES, ...OPTIONAL_PACKAGES].includes(id))) {
    throw Object.assign(new Error('请选择有效的声音资源'), { code: 'INVALID_ARGUMENT' });
  }
  return [...new Set(ids)];
}
function fileSize(file) {
  try { const stat = fs.statSync(file); return stat.isFile() ? stat.size : 0; } catch { return 0; }
}
// Planning uses sizes/installation markers only. The downloader checks SHA-256
// before reusing files and only publishes a completion marker after verification.
function resourcePlan(assetDir, ids = RESOURCE_PACKAGES, platform = process.platform, arch = process.arch) {
  const mlx = platform === 'darwin' && arch === 'arm64';
  const packages = ids.map(id => {
    const [directory, suffix] = models[id];
    const repo = id === 'expressive' ? mlx ? 'mlx-community/VoxCPM2-4bit' : 'openbmb/VoxCPM2'
      : mlx ? `mlx-community/Qwen3-TTS-12Hz-${suffix}-4bit` : `Qwen/Qwen3-TTS-12Hz-${suffix}`;
    const spec = manifest[repo], folder = path.join(assetDir, 'models', directory);
    let marker;
    try { marker = JSON.parse(fs.readFileSync(path.join(folder, '.complete.json'), 'utf8')); } catch {}
    const ready = marker?.repo === repo && marker?.revision === spec.revision
      && Object.entries(spec.weights).every(([name, hash]) => marker.weights?.[name] === hash)
      && Object.entries(spec.files).every(([name, file]) => marker.files?.[name] === file.size && fileSize(path.join(folder, name)) === file.size);
    const total = Object.values(spec.files).reduce((sum, file) => sum + file.size, 0);
    const available = Object.entries(spec.files).reduce((sum, [name, file]) => {
      if (fileSize(path.join(folder, name)) === file.size) return sum + file.size;
      const partial = fileSize(path.join(folder, '.cache/downloads', `${name}.${file.sha256}.incomplete`));
      return sum + (partial <= file.size ? partial : 0);
    }, 0);
    return { id, total, available, ready, downloadBytes: ready ? 0 : total - available };
  });
  return { packages, total: packages.reduce((sum, pack) => sum + pack.total, 0),
    downloadBytes: packages.reduce((sum, pack) => sum + pack.downloadBytes, 0),
    ready: packages.every(pack => pack.ready) };
}
module.exports = { RESOURCE_PACKAGES, OPTIONAL_PACKAGES, resourceSelection, resourcePlan };
