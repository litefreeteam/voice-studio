const fs = require('node:fs/promises');
const path = require('node:path');

function requireMicrophoneAccess(systemPreferences, platform = process.platform) {
  if (platform !== 'win32') return;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (!['denied', 'restricted'].includes(status)) return;
  const message = status === 'restricted' ? '麦克风访问受系统策略限制，请联系管理员检查 Windows 麦克风权限。'
    : 'Windows 未允许使用麦克风。请在 Windows 设置的“麦克风”页面开启“麦克风访问权限”和“允许桌面应用访问麦克风”，再重新录制。';
  throw Object.assign(new Error(message), { code: 'MICROPHONE_PERMISSION_DENIED' });
}

function audioPermission(webContents, expected, permission, details, armed) {
  return !!armed && webContents === expected && permission === 'media' && details.isMainFrame === true
    && details.requestingUrl === expected.getURL()
    && (details.mediaType === 'audio' || Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio');
}
function validateRecording(data) {
  if (data.consent !== true) throw new Error('请先确认你拥有这段声音的使用授权');
  const name = String(data.name || '').trim(), text = String(data.text || '').trim();
  if (!name || name.length > 48) throw new Error('请填写 1–48 字的声音名称');
  if (!text || text.length > 1000) throw new Error('请填写录音中的原话，最多 1000 字');
  if (!(data.audio instanceof Uint8Array) || data.audio.byteLength < 44 || data.audio.byteLength > 6 * 1024 * 1024) throw new Error('录音文件无效，请重新录制');
  const audio = Buffer.from(data.audio);
  const rate = audio.readUInt32LE(24), size = audio.readUInt32LE(40);
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 16) !== 'WAVEfmt '
    || audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16
    || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 || audio.readUInt16LE(34) !== 16
    || rate < 8000 || rate > 96000 || audio.readUInt32LE(28) !== rate * 2 || audio.readUInt16LE(32) !== 2
    || audio.toString('ascii', 36, 40) !== 'data' || size !== audio.length - 44 || size % 2 !== 0) throw new Error('录音格式无效，请重新录制');
  const duration = size / 2 / rate;
  if (duration < 3 || duration > 30) throw new Error('请录制 3–30 秒清晰人声');
  return { audio, name, text };
}
async function saveRecording(studio, root, data) {
  const { audio, name, text } = validateRecording(data);
  const temporary = await fs.mkdtemp(path.join(root, '.recording-'));
  try {
    const file = path.join(temporary, '录音.wav');
    await fs.writeFile(file, audio, { mode: 0o600 });
    return await studio.invoke('reference', { path: file, name, text, consent: true });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
module.exports = { requireMicrophoneAccess, audioPermission, validateRecording, saveRecording };
