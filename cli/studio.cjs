#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { copyTemporaryExport } = require('../desktop/exports.cjs');
const { createStudio, studioError } = require('../desktop/service.cjs');
const generationSchema = require('./generate.schema.json');

const stringFlags = ['data-dir', 'input', 'text', 'text-file', 'speaker', 'engine', 'mode', 'language', 'emotion',
  'scene', 'pace', 'intensity', 'instruction', 'character', 'voice-description', 'reference-id', 'reference-text', 'reference-style',
  'sample-rate', 'prefix', 'project', 'output', 'output-dir', 'format', 'package', 'id', 'ids', 'file', 'name', 'code', 'timeout',
  'voice-scope-id', 'voice-id', 'voice-revision', 'voice-anchor-id'];
const booleanFlags = ['help', 'version', 'batch', 'consent', 'quiet', 'network', 'free-voice'];
const generateFlags = ['input', 'text', 'text-file', 'speaker', 'engine', 'mode', 'language', 'emotion', 'scene',
  'pace', 'intensity', 'instruction', 'character', 'voice-description', 'reference-id', 'reference-text', 'reference-style',
  'sample-rate', 'prefix', 'project', 'output', 'output-dir', 'format', 'batch',
  'voice-scope-id', 'voice-id', 'voice-revision', 'voice-anchor-id', 'free-voice'];
const commands = {
  help: [], describe: [], catalog: [], status: [], history: [],
  setup: ['package'], generate: generateFlags,
  preflight: ['package', 'network'], 'preflight prepare': ['package', 'network'],
  export: ['id', 'ids', 'format', 'output'],
  'references list': [], 'references import': ['file', 'text', 'name', 'consent'],
  'references capture': ['id', 'name'], 'license status': [], 'license activate': ['code', 'input']
};
const help = `声悦 CLI — shengyue <command> [options]

  describe                    Machine-readable command and request specification
  status | catalog | history  Inspect runtime, voices, and generated audio
  setup --package <name>      Explicitly install standard/light/character/reference/expressive (optional)
  preflight [--network]       Inspect configuration and environment; no model downloads or audio
  preflight prepare --package light|all   Recheck configuration and environment (no activation needed)
  generate --text <text>      Generate audio (or --text-file <file>, --input <JSON|->)
  export --ids <id,id> --output <zip> [--format wav|mp3]
  references list
  references import --file <audio> --text <transcript> --consent [--name <name>]
  references capture --id <clip-id> [--name <name>]
  license status | license activate --input <JSON|->

Generation: --speaker Vivian --engine standard|light --mode preset|design|clone
  --language Chinese --emotion natural --scene dialogue --pace normal
  --intensity 50 --instruction <text> --character <id> --voice-description <text>
  --reference-id <id> --reference-text <text> --reference-style original|expressive
  --sample-rate 24000|44100|48000
  --prefix voice --project <name> --batch
  --voice-scope-id <work-id> --voice-id <role-id> --voice-revision <new-version>
  Design voices are fixed by default (character + reference packages required).
  Subsequent lines and retries reuse the sample's voice and expression. --free-voice opts out.
  Expressive cloning requires explicit setup --package expressive; generation never downloads.
  --output <file> (one clip) or --output-dir <directory> [--format wav|mp3]

Global: --data-dir <directory> --timeout <seconds> --quiet --help --version
stdout: one JSON result; stderr: JSON-lines progress. No interactive prompts.
This is the free edition. No purchase, device code or activation is required.
Run preflight, then setup to download the packages needed for local generation.
Exit: 0 success, 2 arguments, 3 busy, 4 runtime, 5 license, 1 failure,
      124 timeout, 130 SIGINT, 143 SIGTERM. Existing export files are preserved.
`;

function invalid(message) { throw studioError('INVALID_ARGUMENT', message); }
function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      ...Object.fromEntries(stringFlags.map(k => [k, { type: 'string' }])),
      ...Object.fromEntries(booleanFlags.map(k => [k, { type: 'boolean' }]))
    } });
  } catch (error) { invalid(error.message); }
  const { values, positionals } = parsed;
  if (values.version) return { command: 'version', values };
  if (values.help || !positionals.length) return { command: 'help', values };
  if (['references', 'license'].includes(positionals[0]) && positionals.length === 1) positionals.push(positionals[0] === 'license' ? 'status' : 'list');
  const command = positionals.join(' ');
  if (!Object.hasOwn(commands, command)) invalid(`未知命令：${command}；执行 --help 查看用法`);
  const allowed = new Set([...commands[command], 'data-dir', 'timeout', 'quiet']);
  for (const key of Object.keys(values)) if (!allowed.has(key)) invalid(`${command} 不支持 --${key}`);
  if (values.timeout !== undefined && (!Number.isFinite(Number(values.timeout)) || Number(values.timeout) <= 0 || Number(values.timeout) > 2147483)) invalid('--timeout 需要有效的正数秒数（最多 2147483）');
  return { command, values };
}

const limit = 2 * 1024 * 1024;
async function readInput(file) {
  if (file !== '-') {
    if (fs.statSync(file).size > limit) invalid('输入文件最多 2 MB');
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit) invalid('标准输入最多 2 MB');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}
async function jsonInput(file) {
  const source = await readInput(file);
  let data;
  try { data = JSON.parse(source); } catch { invalid('输入必须是合法 JSON'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') invalid('输入必须是 JSON 对象');
  return data;
}
function required(value, flag) { if (typeof value !== 'string' || !value.trim()) invalid(`缺少 --${flag}`); return value; }
function destination(file) {
  const target = path.resolve(file);
  if (fs.existsSync(target)) throw studioError('OUTPUT_EXISTS', `输出文件已存在：${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}
function withPaths(item, dataDir) {
  if (item.edit && item.editedWav) item = { ...item, wav: item.editedWav, mp3: item.editedMp3, duration: item.editedDuration };
  if (!/^[0-9a-f]{32}$/.test(item.id) || ['wav', 'mp3'].some(k => typeof item[k] !== 'string' || path.basename(item[k]) !== item[k])) throw studioError('INVALID_RECORD', '音频记录无效');
  return { ...item, paths: Object.fromEntries(['wav', 'mp3'].map(k => [k, path.join(dataDir, 'outputs', item.id, item[k])])) };
}

function validateGeneration(data, row = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('每条台词必须是 JSON 对象');
  for (const [key, value] of Object.entries(data)) {
    const spec = generationSchema.properties[key];
    if (!spec || (row && ['rows', 'batch'].includes(key))) invalid(`未知配音参数：${key}`);
    if (key === 'rows') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 100) invalid('rows 需要 1–100 条台词');
      for (const entry of value) validateGeneration(entry, true);
      continue;
    }
    if ((spec.type === 'integer' ? !Number.isInteger(value) : typeof value !== spec.type)
      || (typeof value === 'number' && !Number.isFinite(value))) invalid(`${key} 类型需要 ${spec.type}`);
    if (spec.enum && !spec.enum.includes(value)) invalid(`${key} 需要 ${spec.enum.join('/')}`);
    if (typeof value === 'string' && (Array.from(value).length < (spec.minLength || 0) || Array.from(value).length > (row && key === 'text' ? 600 : spec.maxLength || Infinity))) invalid(`${key} 长度不符合要求`);
    if (spec.pattern && !new RegExp(spec.pattern, 'u').test(value)) invalid(`${key} 只能包含文字、数字、下划线或短横线`);
    if (typeof value === 'number' && (value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity))) invalid(`${key} 超出有效范围`);
  }
  if (row ? !data.text?.trim() : !data.rows && !data.text?.trim()) invalid('请提供非空 text 或 rows');
}

async function execute(command, v, studio) {
  if (['preflight', 'preflight prepare'].includes(command)) {
    const name = v.package || 'light';
    if (!['light', 'standard', 'character', 'reference', 'expressive', 'all'].includes(name)) invalid('检测功能需要 light/standard/character/reference/expressive/all');
    return studio.invoke(command === 'preflight' ? 'preflight' : 'preflight-prepare', { packages: name === 'all' ? ['light', 'standard', 'character', 'reference'] : [name], network: v.network === true });
  }
  if (['status', 'catalog'].includes(command)) return studio.invoke(command);
  if (command === 'history') { studio.licensing.allow(); return { items: (await studio.invoke('status')).history.map(i => withPaths(i, studio.dataDir)) }; }
  if (command === 'setup') {
    const name = v.package || 'standard';
    if (!['standard', 'light', 'character', 'reference', 'expressive'].includes(name)) invalid('音色包需要 standard/light/character/reference/expressive');
    return studio.invoke('setup', { package: name });
  }
  if (command === 'license status') return studio.invoke('license');
  if (command === 'license activate') {
    if (v.code && v.input) invalid('--code 与 --input 只能选择一个');
    const code = v.input ? (await jsonInput(v.input)).code : v.code;
    return studio.invoke('activate', { code: required(code, 'code 或 --input') });
  }
  if (command === 'references list') { studio.licensing.allow(); return { items: (await studio.invoke('status')).references }; }
  if (command === 'references import') return studio.invoke('reference', {
    path: path.resolve(required(v.file, 'file')), text: required(v.text, 'text'), name: v.name, consent: v.consent === true
  });
  if (command === 'references capture') return studio.invoke('capture', { id: required(v.id, 'id'), name: v.name });
  const format = v.format || 'wav';
  if (!['wav', 'mp3'].includes(format)) invalid('--format 需要 wav 或 mp3');
  if (command === 'export') {
    if (v.id && v.ids) invalid('--id 与 --ids 只能选择一个');
    const ids = required(v.ids || v.id, 'ids').split(',');
    const output = destination(required(v.output, 'output'));
    const result = await studio.invoke('zip', { ids, format });
    await copyTemporaryExport(studio.dataDir, result, output, fs.constants.COPYFILE_EXCL, studio.isCancelled);
    return { count: result.count, path: output, format };
  }
  if (command === 'generate') {
    if ([v.input, v.text, v['text-file']].filter(x => x !== undefined).length !== 1) invalid('请选择一种输入：--text、--text-file 或 --input');
    if (v.output && v['output-dir']) invalid('--output 与 --output-dir 只能选择一个');
    const data = v.input ? await jsonInput(v.input) : { text: v['text-file'] ? await readInput(v['text-file']) : v.text };
    if (data.schema) invalid('请提供 CLI 请求对象；桌面项目文件需转换为台词 rows 和配音参数');
    for (const key of generateFlags.filter(k => !['input', 'text', 'text-file', 'output', 'output-dir', 'format', 'free-voice'].includes(k))) {
      if (v[key] !== undefined) data[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v[key];
    }
    if (v['free-voice']) data.lockVoice = false;
    for (const key of ['intensity', 'sampleRate']) if (v[key === 'intensity' ? 'intensity' : 'sample-rate'] !== undefined) {
      const number = Number(data[key]);
      if (!Number.isFinite(number)) invalid(`${key} 需要有效数值`);
      data[key] = number;
    }
    validateGeneration(data);
    const count = Array.isArray(data.rows) ? data.rows.length : data.batch ? String(data.text || '').split(/\r?\n/).filter(x => x.trim()).length : 1;
    if (v.output && count !== 1) invalid('--output 只用于单条音频；批量请用 --output-dir');
    const output = v.output ? destination(v.output) : null;
    const result = await studio.invoke('generate', data);
    const items = result.items.map(i => withPaths(i, studio.dataDir));
    const targets = items.map(item => output || (v['output-dir'] ? path.join(path.resolve(v['output-dir']), `${item.id}-${item[format]}`) : null));
    for (const target of targets.filter(Boolean)) destination(target);
    for (let i = 0; i < items.length; i++) if (targets[i]) {
      fs.copyFileSync(items[i].paths[format], targets[i], fs.constants.COPYFILE_EXCL);
      items[i].exportPath = targets[i];
    }
    return { ...result, items };
  }
}

async function run(argv, options = {}) {
  let studio, timer, interrupted = null, currentCommand = null;
  const stop = (code, message) => {
    if (interrupted) return;
    interrupted = { code, message };
    studio?.cancel();
    if (!process.stdin.isTTY) process.stdin.destroy();
  };
  const sigint = () => stop('CANCELLED', '操作已取消；已完成音频可通过 history 找回');
  const sigterm = () => stop('TERMINATED', '进程已终止；已完成音频可通过 history 找回');
  try {
    const { command, values } = parse(argv);
    currentCommand = command;
    if (command === 'help') { process.stdout.write(help); return 0; }
    if (command === 'version') { process.stdout.write(JSON.stringify({ version: require('../package.json').version }) + '\n'); return 0; }
    if (command === 'describe') {
      process.stdout.write(JSON.stringify({ schema: 'shengyue-cli-1', commands,
        requestSchema: generationSchema,
        globalOptions: ['data-dir', 'timeout', 'quiet', 'help', 'version'],
        generation: { input: 'JSON object with text or rows; --input - reads stdin', rows: [{ text: '你好', speaker: 'Vivian', emotion: 'happy', filename: 'greeting' }],
          options: { mode: ['preset', 'design', 'clone'], engine: ['standard', 'light'], sampleRate: [24000, 44100, 48000], batch: 'boolean', intensity: '0–100',
            lockVoice: 'design defaults to true; false explicitly opts into independent voice design',
            voiceScopeId: 'stable work ID; default shares a local voice by character/description', voiceId: 'stable role ID', voiceRevision: 'change to choose a new voice' },
          catalog: 'Use catalog to discover speaker, character, emotion, scene and language IDs; rows override top-level defaults.' },
        output: { success: { ok: true, command: '<command>', result: {} }, failure: { ok: false, command: '<command>', error: { code: '<code>', message: '<message>' } }, progress: 'stderr JSON lines; --quiet suppresses progress', paths: 'generate/history result.items[].paths.wav/mp3 are absolute paths' },
        licensing: { required: false, edition: 'free', offline: true },
        exitCodes: { success: 0, error: 1, invalidArgument: 2, busy: 3, runtimeNotReady: 4, licenseRequired: 5, timeout: 124, cancelled: 130, terminated: 143 }
      }, null, 2) + '\n');
      return 0;
    }
    process.on('SIGINT', sigint);
    process.on('SIGTERM', sigterm);
    studio = createStudio({ ...options, dataDir: values['data-dir'], onProgress: event => {
      if (!values.quiet) process.stderr.write(JSON.stringify(event) + '\n');
    } });
    if (values.timeout) timer = setTimeout(() => stop('TIMEOUT', '操作超时；已完成音频可通过 history 找回'), Number(values.timeout) * 1000);
    const result = await execute(command, values, { ...studio, isCancelled: () => !!interrupted, invoke: (...args) => {
      if (interrupted) throw studioError(interrupted.code, interrupted.message);
      return studio.invoke(...args);
    } });
    if (interrupted) throw studioError(interrupted.code, interrupted.message);
    await studio.close();
    process.stdout.write(JSON.stringify({ ok: true, command, result }) + '\n');
    return 0;
  } catch (error) {
    const code = interrupted?.code || error.code || 'INTERNAL_ERROR';
    process.stdout.write(JSON.stringify({ ok: false, command: currentCommand,
      error: { code, message: interrupted?.message || error.message } }) + '\n');
    return ({ INVALID_ARGUMENT: 2, BUSY: 3, RUNTIME_NOT_READY: 4, LICENSE_REQUIRED: 5, TIMEOUT: 124, CANCELLED: 130, TERMINATED: 143 })[code] || 1;
  } finally {
    clearTimeout(timer);
    await studio?.close();
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
  }
}
if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
module.exports = { run, parse };
