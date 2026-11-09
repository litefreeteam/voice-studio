const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assess, machineFacts, storageProbe, probeNetwork, packageSelection } = require('./compatibility.cjs');
const FOLDERS = { light: 'voice-light', standard: 'qwen3-custom', character: 'voice-character', reference: 'voice-reference', expressive: 'voice-expressive' };
const NAMES = { light: '轻量配音', standard: '生动配音', character: '人物与童声', reference: '声音克隆', expressive: '我的声音·情绪表达' };
const TTL = 7 * 24 * 3600 * 1000;

function workflowPackages(data) {
  const packages = packageSelection(data);
  if (packages.includes('character') && !packages.includes('reference')) packages.push('reference');
  return packages;
}

// Configuration inspection deliberately has no access to setup or the speech worker.
function createPreflight({ dataDir, assetDir, machine, runtimeReady, progress = () => {} }) {
  const reportPath = path.join(dataDir, 'compatibility-report.json');
  const microphonePath = path.join(dataDir, 'microphone-check.json');
  const version = require('../package.json').version;
  let activeCheck, lastNetwork;
  function installed(key) {
    try {
      const folder = path.join(assetDir(), 'models', FOLDERS[key]);
      const marker = JSON.parse(fs.readFileSync(path.join(folder, '.complete.json'), 'utf8'));
      return Object.keys(marker.files).length > 0 && Object.entries(marker.files).every(([name, size]) => {
        const file = path.resolve(folder, name);
        return file.startsWith(folder + path.sep) && fs.statSync(file).size === size;
      });
    } catch { return false; }
  }
  function save(report) {
    const tmp = reportPath + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(report, null, 2), { mode: 0o600 }); fs.renameSync(tmp, reportPath); }
    finally { fs.rmSync(tmp, { force: true }); }
    return report;
  }
  async function inspect(data = {}, signal) {
    const packages = workflowPackages(data), facts = machineFacts(), storage = storageProbe(assetDir());
    const localPackages = packages.filter(installed);
    const environment = assess(facts, { ...storage, packages, installed: localPackages });
    const checks = [...environment.checks];
    const hasRuntime = runtimeReady();
    checks.push({ id: 'runtime', state: hasRuntime ? 'pass' : 'warn', message: hasRuntime
      ? '已检测到本地运行组件；本次只检查安装状态'
      : '本地运行组件尚未准备，使用配音时可另行安装' });
    const results = packages.map(key => {
      const dependencies = key === 'character' ? ['character', 'reference'] : [key];
      const resourceReady = dependencies.every(dependency => localPackages.includes(dependency));
      const configured = assess(facts, { ...storage, packages: dependencies, installed: localPackages });
      checks.push({ id: 'resource-' + key, state: resourceReady ? 'pass' : 'warn', message: NAMES[key] + (resourceReady
        ? '：已检测到本地声音资源；本次不加载模型'
        : '：声音资源尚未准备或不完整，使用时可另行下载') });
      return { package: key, passed: !configured.blocked, resourceReady };
    });
    let microphone;
    try { microphone = JSON.parse(fs.readFileSync(microphonePath, 'utf8')); } catch {}
    if (microphone?.version !== version || microphone?.machineCode !== machine || !Number.isFinite(microphone?.testedAt) ||
        Date.now() < microphone.testedAt || Date.now() - microphone.testedAt >= TTL) microphone = null;
    const microphoneRequired = data.microphoneRequired === true;
    if (microphoneRequired) checks.push({ id: 'microphone', state: microphone?.passed ? 'pass' : 'pending', message: microphone?.passed
      ? '已取得麦克风权限并检测到声音信号' : '需要直接录音时，可单独检测麦克风权限和声音输入' });
    if (data.network === true && !environment.blocked) {
      const networkChecks = await probeNetwork(environment.profile, signal);
      if (signal?.aborted) throw new Error('检测已取消');
      lastNetwork = { profile: environment.profile.id, checks: networkChecks };
    }
    if (signal?.aborted) throw new Error('检测已取消');
    if (lastNetwork && lastNetwork.profile === environment.profile?.id) checks.push(...lastNetwork.checks);
    const ready = !environment.blocked && (!microphoneRequired || microphone?.passed === true);
    return { schema: 'shengyue-compatibility-2', scope: 'environment', version, machineCode: machine,
      facts, profile: environment.profile?.id, packages, checks, blocked: environment.blocked,
      requiredDiskGB: environment.requiredDiskGB, assetDir: assetDir(), results, ready,
      microphoneRequired, microphone, testedAt: Date.now(),
      summary: environment.blocked ? '请查看并处理未通过的配置项目' : ready
        ? '配置与环境检查完成，可复制报告留存' : '配置检查已完成，可继续补充麦克风检测结果',
      limitations: '仅检查当前电脑的配置、环境与资源安装状态，不下载模型、不生成配音，也不验证实际音质和生成速度。' };
  }
  async function prepare(data = {}) {
    if (activeCheck) throw new Error('正在检测，请稍后重试');
    const packages = workflowPackages(data);
    const controller = new AbortController();
    activeCheck = controller;
    try {
      progress({ stage: 'preflight', preflightPhase: 'check', completedPackages: 0, packageCount: packages.length, message: '正在检查本机配置与环境…' });
      const report = await inspect(data, controller.signal);
      for (const [index, key] of packages.entries()) {
        progress({ stage: 'preflight', preflightPhase: 'complete', package: key, completedPackages: index + 1,
          packageCount: packages.length, message: NAMES[key] + '配置检查完成' });
      }
      return save(report);
    } finally { if (activeCheck === controller) activeCheck = null; }
  }
  function microphoneResult(data = {}) {
    if (typeof data.passed !== 'boolean') throw new Error('麦克风检测结果无效');
    fs.writeFileSync(microphonePath, JSON.stringify({ version, machineCode: machine, passed: data.passed, testedAt: Date.now() }), { mode: 0o600 });
    return inspect(data);
  }
  return { inspect, prepare, microphoneResult, cancel: () => activeCheck?.abort() };
}
module.exports = { createPreflight };
