const fs = require('node:fs');
const path = require('node:path');

function prepareMacDmgGuide(root = path.resolve(__dirname, '..')) {
  const folder = path.join(root, 'resources/macos');
  let html = fs.readFileSync(path.join(folder, '首次打开说明.template.html'), 'utf8');
  for (const [token, file] of [
    ['BLOCKED_SCREENSHOT', 'blocked-example.png'],
    ['SECURITY_SCREENSHOT', 'privacy-security-example.png']
  ]) {
    const marker = '{{' + token + '}}';
    if (!html.includes(marker)) throw new Error('Missing guide image placeholder: ' + token);
    const image = fs.readFileSync(path.join(folder, 'guide-images', file));
    if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid guide PNG: ' + file);
    html = html.replaceAll(marker, 'data:image/png;base64,' + image.toString('base64'));
  }
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('Unresolved guide image placeholder');
  fs.writeFileSync(path.join(folder, '首次打开说明.html'), html);
  console.log('离线首次打开说明已生成：含 3 张标注图（Apple 官方截图与按钮放大图）。');
}

if (require.main === module) prepareMacDmgGuide();
module.exports = { prepareMacDmgGuide };
