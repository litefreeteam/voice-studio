// Read only the bounded XML parts used by the renderer's native XML parser.
// Office archives are never extracted to disk, and require no model installation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function officeParts(buffer, extension) {
  if (!['.docx', '.pptx'].includes(extension) || buffer.length > 32 * 1024 * 1024) throw Error('Office 文件最多 32 MB，仅支持 DOCX 和 PPTX');
  const invalid = () => Error('文档损坏、已加密或格式不受支持，请另存为 DOCX / PPTX 后重试');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalid();
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (!count || count > 10000 || count !== buffer.readUInt16LE(end + 8) || start + size !== end) throw invalid();
  const selected = extension === '.docx' ? /^word\/document\.xml$/ : /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/;
  const parts = Object.create(null), seen = new Set(); let offset = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10), crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20), uncompressed = buffer.readUInt32LE(offset + 24);
    const names = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + names + extra + comment > end || buffer.readUInt16LE(offset + 34)) throw invalid();
    const name = buffer.subarray(offset + 46, offset + 46 + names).toString('utf8'); offset += 46 + names + extra + comment;
    if (!selected.test(name)) continue;
    if (seen.has(name) || flags & 1 || ![0, 8].includes(method) || local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50) throw invalid();
    seen.add(name); total += uncompressed;
    if (!uncompressed || total > 8 * 1024 * 1024) throw Error('文档中的文字过多，请拆分后导入（XML 内容最多 8 MB）');
    const localNames = buffer.readUInt16LE(local + 26), dataStart = local + 30 + localNames + buffer.readUInt16LE(local + 28);
    if (dataStart + compressed > start || buffer.subarray(local + 30, local + 30 + localNames).toString('utf8') !== name || buffer.readUInt16LE(local + 8) !== method) throw invalid();
    let bytes;
    try { bytes = method === 0 ? buffer.subarray(dataStart, dataStart + compressed) : inflateRawSync(buffer.subarray(dataStart, dataStart + compressed), { maxOutputLength: uncompressed }); }
    catch { throw invalid(); }
    if (bytes.length !== uncompressed || crc32(bytes) !== crc) throw invalid();
    parts[name] = bytes.toString('utf8');
  }
  if (offset !== end || !Object.keys(parts).length) throw invalid();
  return { extension, parts };
}
async function readScript(file) {
  const extension = path.extname(file).toLowerCase(), office = ['.docx', '.pptx'].includes(extension);
  if (!office && !['.txt', '.csv', '.tsv'].includes(extension)) throw Error('请选择 TXT、CSV、TSV、DOCX 或 PPTX 文件');
  if ((await fs.stat(file)).size > (office ? 32 : 2) * 1024 * 1024) throw Error(office ? 'Office 文件最多 32 MB' : '脚本文件最多 2 MB');
  const bytes = await fs.readFile(file);
  return { name: path.basename(file), ...(office ? { office: officeParts(bytes, extension) } : { text: bytes.toString('utf8') }) };
}
module.exports = { readScript, officeParts };
