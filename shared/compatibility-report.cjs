// Local sales workflow validation, not remote attestation or anti-tamper security.
function validatePurchaseReport(report, machine, version, now = Date.now()) {
  const names = ['light', 'standard', 'character', 'reference'];
  if (!report || report.schema !== 'shengyue-compatibility-1' || report.machineCode !== machine) throw new Error('检测报告与客户设备码不匹配');
  if (report.version !== version || !Number.isFinite(report.testedAt) || now < report.testedAt || now - report.testedAt >= 7 * 86400000) throw new Error('检测报告版本不符或超过 7 天，请让客户重新检测');
  if (report.ready !== true || report.heard !== true || report.blocked !== false || !Array.isArray(report.checks) || report.checks.some(c => c.state === 'fail')) throw new Error('检测或试听确认尚未通过，请先处理，不要签发新购授权');
  if (report.microphoneRequired === true && report.microphone?.passed !== true) throw new Error('客户需要直接录音，请先通过麦克风检测');
  if (!Array.isArray(report.packages) || !report.packages.length || report.packages.some(p => !names.includes(p)) || !Array.isArray(report.results) ||
      !report.packages.every(p => report.results.some(r => r.package === p && r.passed === true && r.duration > 0 && r.elapsed >= 0))) throw new Error('报告缺少所选功能的真实试音记录');
  return report.packages;
}
module.exports = { validatePurchaseReport };
