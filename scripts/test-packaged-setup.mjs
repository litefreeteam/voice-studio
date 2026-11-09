import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

// Exercise real Electron ASAR reads and native uv, without downloading models or
// dependencies. The fixture replaces only the dependency list and model work.
const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const { profileFor } = require('../desktop/compatibility.cjs');
const profile = profileFor();
assert.ok(profile, 'A supported host is required');
const root = path.resolve(import.meta.dirname, '..');
// Point at the signed app's Resources to cover signing-induced binary changes.
const toolResources = process.env.VOICE_STUDIO_TEST_RESOURCES || path.join(root, 'resources');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shengyue-packaged-setup-'));
const run = promisify(execFile);
try {
  for (const mode of ['success', 'failure', 'cancel']) {
    const base = path.join(scratch, mode), source = path.join(base, 'source');
    fs.mkdirSync(source, { recursive: true });
    for (const part of ['desktop', 'shared']) fs.cpSync(path.join(root, part), path.join(source, part), { recursive: true });
    fs.mkdirSync(path.join(source, 'backend'));
    fs.copyFileSync(path.join(root, 'package.json'), path.join(source, 'package.json'));
    const lock = mode === 'failure' ? 'not a valid @ requirement ???\n' : '# Empty dependency fixture; no network needed.\n';
    fs.writeFileSync(path.join(source, 'backend', profile.requirements), lock);
    fs.writeFileSync(path.join(source, 'backend/worker.py'), `import json,sys
for line in sys.stdin:
 q=json.loads(line)
 result={'packages':[]} if q['op']=='status' else {'package':q['data']['package'],'passed':True,'duration':1,'elapsed':0}
 print(json.dumps({'type':'result','id':q['id'],'result':result}),flush=True)
`);
    const keys = crypto.generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(path.join(source, 'desktop/trust-anchor.cjs'), 'module.exports = ' + JSON.stringify(publicKey) + ';\n');
    fs.writeFileSync(path.join(source, 'shared/license-public.pem'), publicKey);
    const archive = path.join(base, 'app.asar');
    await createPackage(source, archive);
    const data = path.join(base, 'data'), runtime = path.join(data, 'runtime');
    const uv = path.join(toolResources, 'uv', profile.uv);
    const python = process.env.VOICE_STUDIO_TEST_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    await run(uv, ['venv', '--no-config', '--no-python-downloads', '--python', python, runtime]);
    fs.writeFileSync(path.join(runtime, 'interpreter.json'), JSON.stringify({ profile: profile.id,
      version: require('../shared/download-sources.json').pythonVersion, source: 'fixture' }));
    const { LicenseStore, licenseMessage } = require('../desktop/license.cjs');
    const licensing = new LicenseStore(data, keys.publicKey);
    licensing.activate('SY2.' + crypto.sign(null, licenseMessage(licensing.machine), keys.privateKey).toString('base64url'));
    const harness = path.join(base, 'harness.cjs');
    fs.writeFileSync(harness, `
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
Object.defineProperty(app,'isPackaged',{value:true});
const archive=${JSON.stringify(archive)}, data=${JSON.stringify(data)}, mode=${JSON.stringify(mode)};
const roots=[],make=fs.mkdtempSync;
fs.mkdtempSync=function(prefix,...args){const result=make.call(this,prefix,...args);if(prefix.includes('shengyue-engine-'))roots.push(result);return result;};
app.whenReady().then(async()=>{
 const {createStudio}=require(path.join(archive,'desktop/service.cjs'));
 let studio;
 studio=createStudio({dataDir:data,resourceDir:${JSON.stringify(toolResources)},onProgress:event=>{
  if(mode==='cancel'&&event.stage==='dependencies'&&event.source)studio.cancel();
 }});
 try {
  if(mode==='success'){
   const result=await studio.invoke('setup',{runtimeOnly:true});
   assert.ok(result);
   assert.ok(fs.existsSync(path.join(data,'runtime/ready.json')));
  }else{
   await assert.rejects(studio.invoke('setup',{runtimeOnly:true}),mode==='cancel'?/取消/:/声悦定制资源(?:准备|安装)失败/);
   assert.equal(fs.existsSync(path.join(data,'runtime/ready.json')),false);
   assert.ok(fs.existsSync(path.join(data,'runtime/interpreter.json')));
  }
  await studio.close();
  assert.ok(roots.length>0,'The sealed source must be materialized');
  assert.ok(roots.every(folder=>!fs.existsSync(folder)),'Every private payload must be removed');
  const log=fs.existsSync(path.join(data,'studio.log'))?fs.readFileSync(path.join(data,'studio.log'),'utf8'):'';
  assert.doesNotMatch(log,/File not found/);
  if(mode==='failure')assert.equal((log.match(/Resource preparation failed:/g)||[]).length,3);
  fs.writeFileSync(path.join(data,'result.json'),JSON.stringify({passed:true,mode,payloadsCleaned:roots.length}));
  app.exit(0);
 }catch(error){await studio.close();console.error(error);app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    await run(require('electron'), [harness], { env, timeout: 60000, maxBuffer: 1024 * 1024 });
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'result.json'))).passed, true);
    console.log(`PASS: sealed ASAR + native uv: ${mode}, private payload cleanup, interpreter preservation`);
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
