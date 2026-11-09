const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sources: downloadSources, pythonArchive, modelURL } = require('./downloads.cjs');
const modelManifest = require('../shared/model-manifest.json').repositories;

const PACKAGES = ['light', 'standard', 'character', 'reference', 'expressive'];
function profileFor(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return { id: 'mac-arm64', label: 'M 系列 Mac', requirements: 'requirements-mac.lock', python: 'cpython-3.12-macos-aarch64-none', uv: 'mac-arm64/uv', mlx: true };
  if (platform === 'darwin' && arch === 'x64') return { id: 'mac-x64', label: 'Intel Mac · CPU', requirements: 'requirements-intel.lock', python: 'cpython-3.12-macos-x86_64-none', uv: 'mac-x64/uv', mlx: false };
  if (platform === 'win32' && arch === 'x64') return { id: 'win-x64', label: 'Windows x64 · CPU', requirements: 'requirements-win.lock', python: 'cpython-3.12-windows-x86_64-none', uv: 'win-x64/uv.exe', mlx: false };
  return null;
}
function packageSelection(data = {}) {
  const selected = data.packages ?? [data.package ?? 'light'];
  if (!Array.isArray(selected) || !selected.length || selected.length > 5 || selected.some(p => !PACKAGES.includes(p))) throw new Error('请选择有效的声音功能');
  return [...new Set(selected)];
}
function machineFacts() {
  let translated = false, nativeArm = false, cpuFeatures = '';
  if (process.platform === 'darwin') {
    const sysctl = name => { try { return execFileSync('/usr/sbin/sysctl', ['-n', name], { encoding: 'utf8', timeout: 2000 }).trim(); } catch { return ''; } };
    translated = sysctl('sysctl.proc_translated') === '1';
    nativeArm = sysctl('hw.optional.arm64') === '1';
    if (process.arch === 'x64') cpuFeatures = sysctl('machdep.cpu.features') + ' ' + sysctl('machdep.cpu.leaf7_features');
  }
  if (process.platform === 'win32') nativeArm = /ARM64/i.test(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || '');
  return { platform: process.platform, arch: process.arch, release: os.release(), memoryGB: os.totalmem() / 2 ** 30,
    availableMemoryGB: os.freemem() / 2 ** 30, cpu: os.cpus()[0]?.model || '未知', cores: os.cpus().length,
    translated, nativeArm, cpuFeatures };
}
// This classification never claims that hardware inspection proves inference works.
function assess(facts, { freeDiskGB = null, writable = true, packages = ['light'], installed = [] } = {}) {
  const profile = profileFor(facts.platform, facts.arch), checks = [];
  const add = (id, state, message) => checks.push({ id, state, message });
  add('platform', profile ? 'pass' : 'fail', profile?.label || '当前系统或处理器架构不支持，请勿购买');
  if (facts.platform === 'darwin') add('os', Number(facts.release.split('.')[0]) >= 23 ? 'pass' : 'fail', 'Mac 需要 macOS 14 或以上');
  if (facts.platform === 'win32') {
    const [major, , build] = facts.release.split('.').map(Number);
    add('os', major >= 10 && build >= 19041 ? 'pass' : 'fail', 'Windows 需要 10 版本 2004（19041）或以上，推荐 Windows 11');
  }
  if (facts.translated || facts.nativeArm && facts.arch === 'x64') add('architecture', 'fail', facts.platform === 'darwin' ? '当前通过 Rosetta 运行，请下载安装 M 系列 Mac 版本' : '检测到 Windows ARM 模拟运行，当前不作为支持平台，请勿购买');
  const minMemory = packages.some(p => p !== 'light') ? 16 : 8;
  add('memory', facts.memoryGB < minMemory - 0.5 ? 'fail' : facts.memoryGB < 16 - 0.5 ? 'warn' : 'pass', `系统内存 ${facts.memoryGB.toFixed(1)} GB；所选功能至少需要 ${minMemory} GB`);
  if (facts.availableMemoryGB < 3) add('available-memory', 'warn', '当前可用内存不足 3 GB，请关闭其他程序再测试');
  if (facts.platform === 'darwin' && facts.arch === 'x64') add('cpu', 'warn', 'Intel Mac 使用 CPU，长文可能较慢');
  if (facts.platform === 'win32' && facts.arch === 'x64') add('cpu', 'warn', '当前 Windows 自动安装版使用 CPU，不包含 CUDA 加速；长文可能较慢');
  if (/virtual|vmware|parallels|qemu/i.test(facts.cpu)) add('virtual-machine', 'warn', '疑似虚拟机；仅测试当前分配的资源，调整配置后需要重测');
  add('write', writable ? 'pass' : 'fail', writable ? '数据目录可写入、读取和原子替换' : '数据目录无法正常读写，请检查磁盘权限、受控文件夹或安全软件');
  const sizes = profile?.mlx ? { light: 2, standard: 3, character: 3, reference: 3, expressive: 3 } : { light: 4, standard: 6, character: 6, reference: 6, expressive: 5 };
  const requiredDiskGB = 8 + packages.filter(p => !installed.includes(p)).reduce((n, p) => n + sizes[p] * 1.5, 0);
  add('disk', freeDiskGB === null ? 'fail' : freeDiskGB < requiredDiskGB ? 'fail' : 'pass', freeDiskGB === null ? '无法读取数据磁盘剩余空间，请先排查' : `数据磁盘剩余 ${freeDiskGB.toFixed(1)} GB，本次建议预留 ${Math.ceil(requiredDiskGB)} GB（含组件和临时缓存）`);
  return { profile, checks, requiredDiskGB: Math.ceil(requiredDiskGB), blocked: checks.some(c => c.state === 'fail') };
}
function storageProbe(dataDir) {
  let writable = false, freeDiskGB = null;
  const original = path.join(dataDir, `.probe-${crypto.randomUUID()}`), renamed = original + '.renamed';
  try {
    fs.writeFileSync(original, 'voice-studio-probe', { flag: 'wx', mode: 0o600 });
    fs.renameSync(original, renamed);
    writable = fs.readFileSync(renamed, 'utf8') === 'voice-studio-probe';
  } catch {} finally { for (const file of [original, renamed]) { try { fs.unlinkSync(file); } catch {} } }
  try { const d = fs.statfsSync(dataDir); freeDiskGB = d.bavail * d.bsize / 1e9; } catch {}
  return { writable, freeDiskGB };
}
async function probeNetwork(profile, signal) {
  const repo = profile?.mlx ? 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit' : 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
  const groups = [ ['python', '运行资源', source => `${source.url}/${pythonArchive(profile)}`],
    ['packages', '配音资源', source => `${source.url}/soundfile/`],
    ['models', '声音资源', source => modelURL(source, repo, modelManifest[repo], 'config.json')] ];
  return Promise.all(groups.map(async ([id, label, urlFor]) => {
    for (const [index, source] of downloadSources[id].entries()) {
      if (signal?.aborted) break;
      try {
        const response = await fetch(urlFor(source), { method: 'GET', headers: { Range: 'bytes=0-1023' }, redirect: 'follow',
          signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
        await response.body?.cancel();
        if (response.ok) return { id: `network-${id}`, state: 'pass', source: source.id,
          message: `声悦定制资源 · ${label}：${index ? '重新连接成功' : '连接正常'}，本次仅检查连接` };
      } catch {}
    }
    return { id: `network-${id}`, state: 'warn', message: `声悦定制资源 · ${label}：连接失败或超时；请检查网络，使用时可在资源页重试下载` };
  }));
}
module.exports = { PACKAGES, profileFor, packageSelection, machineFacts, assess, storageProbe, probeNetwork };
