const path = require('node:path');

// Quote paths as literal arguments, including spaces, apostrophes and shell metacharacters.
function quote(value, windows) {
  return `'${String(value).replaceAll("'", windows ? "''" : "'\"'\"'")}'`;
}

function cliConfiguration({ platform = process.platform, executable = process.execPath, appPath, packaged, dataDir }) {
  const windows = platform === 'win32';
  const args = [...(packaged ? [] : [appPath]), '--cli'];
  const command = (...tail) => `${windows ? '& ' : ''}${[executable, ...args, ...tail, '--data-dir', dataDir].map(value => quote(value, windows)).join(' ')}${windows ? ' | Out-String' : ''}`;
  const status = command('status');
  const generate = command('generate', '--input', 'script.json', '--output-dir', './audio', '--timeout', '1800');
  const guide = `需要本地配音时，调用本机安装的声悦 CLI。\n命令执行工具请使用以下程序和参数数组（后面追加子命令及参数）：\n${JSON.stringify({ executable, args: [...args, '--data-dir', dataDir] }, null, 2)}\n\n先执行 describe 获取协议、status 检查组件与模型、catalog 获取声音 ID。CLI 与当前桌面端共用声音包、参考声音和作品；本版本免费使用，无需激活。复杂文稿用 JSON 文件或 stdin 传入 generate --input，stdout 只解析 JSON，stderr 是进度，从 result.items[].paths.wav/mp3 或 exportPath 获取音频。每批最多 100 段、5000 字，每段最多 600 字，长文先拆段再分批。根据文稿长度和本机速度设置 --timeout。遇到 BUSY 等待后重试；失败或取消后先查询 history，避免重复整批生成。首次声音包安装需显式 setup；仅在用户授权后下载模型或导入参考人声。无需打开桌面窗口。\n\n检查命令：\n${status}\n\n批量配音示例（先将 script.json 放到终端当前目录）：\n${generate}`;
  return { platform: windows ? 'Windows · PowerShell' : platform === 'darwin' ? 'macOS · 终端' : 'Linux · 终端', status, generate, guide };
}

function cliDocumentPath({ packaged, resourceDir, appPath }) {
  return path.join(packaged ? resourceDir : appPath, 'docs', 'Agent-CLI.md');
}

module.exports = { cliConfiguration, cliDocumentPath };
