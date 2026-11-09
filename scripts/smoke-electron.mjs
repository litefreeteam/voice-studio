import {_electron as electron,chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,symlink,access} from 'node:fs/promises';
import path from 'node:path';
import {verifyCode} from '../desktop/license.cjs';
const root=path.resolve('.'),artifacts=path.join(root,'.test-data','commercial'),data=path.join(artifacts,'data');
await mkdir(data,{recursive:true});
try{await access(path.join(data,'models'));}catch{await symlink(path.join(process.env.HOME,'Library/Application Support/Voice Studio/models'),path.join(data,'models'),'dir');}
const catalog=JSON.parse(await readFile(path.join(root,'shared/catalog.json'),'utf8'));
const report={started:new Date().toISOString(),errors:[],checks:[]};
const app=await electron.launch({executablePath:process.env.VOICE_STUDIO_EXECUTABLE||path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:process.env.VOICE_STUDIO_EXECUTABLE?[]:[root],env:{...process.env,VOICE_STUDIO_DATA:data,VOICE_STUDIO_PYTHON:path.join(root,'.venv/bin/python')},timeout:60000});
try{
 const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(120000);
 let lastGeneratedId;
 const currentOutput=()=>page.locator(`[data-output-job-id="${lastGeneratedId}"]`);
 const waitUntil=async check=>{const end=Date.now()+120000;while(!await check()){if(Date.now()>end)throw new Error('后台任务等待超时');await new Promise(resolve=>setTimeout(resolve,500));}};
 const submitGeneration=async()=>{const ids=await page.evaluate(async()=>(await studio.invoke('jobs-list')).jobs.map(job=>job.id));await page.locator('#generate').click();await waitUntil(()=>page.evaluate(async ids=>(await studio.invoke('jobs-list')).jobs.some(job=>!ids.includes(job.id)),ids));return page.evaluate(async ids=>(await studio.invoke('jobs-list')).jobs.find(job=>!ids.includes(job.id)).id,ids);};
 const runGeneration=async()=>{const id=await submitGeneration();lastGeneratedId=id;await waitUntil(()=>page.evaluate(async id=>{const job=(await studio.invoke('jobs-list')).jobs.find(job=>job.id===id);return job&&!['queued','running'].includes(job.status);},id));const job=await page.evaluate(async id=>(await studio.invoke('jobs-list')).jobs.find(job=>job.id===id),id);assert.equal(job.status,'complete',job.error);await page.waitForFunction(()=>document.querySelector('#generate').getAttribute('aria-busy')==='false');};
 await page.waitForFunction(()=>document.querySelector('#activation-gate').getAttribute('aria-busy')==='false');
 if(await page.locator('#activation-gate').isVisible()){
 const machine=await page.locator('#gate-machine').inputValue();
 const browser=await chromium.launch({channel:'chrome',headless:true});try{const issuer=await browser.newPage();await issuer.goto('file://'+path.join(root,'seller-tools/声悦激活码签发.html'));await issuer.locator('#key').setInputFiles(path.join(root,'.seller/signing-key.pem'));await issuer.locator('#machine').fill(machine);await issuer.locator('#issue').click();await issuer.waitForFunction(()=>document.getElementById('output').value.startsWith('SY2.'));const code=await issuer.locator('#output').inputValue();assert.equal(code.length,90);assert.equal(verifyCode(code,machine,await readFile(path.join(root,'shared/license-public.pem'),'utf8')).edition,'pro');await page.locator('#gate-code').fill(code);await page.locator('#gate-activate').click();await page.waitForFunction(()=>!document.querySelector('#workspace').hidden);await page.screenshot({path:path.join(artifacts,'activated.png')});report.checks.push('Offline HTML seller issuer → native client device-bound activation');}finally{await browser.close();}
 }
 await page.waitForFunction(()=>document.querySelector('#status-text').textContent.includes('声音已就绪'));
 await page.locator('[data-view="editor"]').click();
 assert.equal(await page.locator('[data-emotion]').count(),18);assert.equal(await page.locator('#language option').count(),10);
 await page.screenshot({path:path.join(artifacts,'editor.png')});
 await page.locator('[data-view="voices"]').click();assert.equal(await page.locator('#voice-grid .voice-card').count(),catalog.voices.length+catalog.characters.length);
 await page.locator('[data-filter="child"]').click();assert.equal(await page.locator('#voice-grid .voice-card').count(),4);await page.screenshot({path:path.join(artifacts,'children.png')});
 report.checks.push(`${catalog.voices.length+catalog.characters.length} voice / character entries, 4 child presets, 18 emotions, 10 languages`);
 await page.locator('[data-view="editor"]').click();await page.locator('#example').click();
 while(await page.locator('.script-row').count()>2)await page.locator('.script-row').last().getByRole('button',{name:'移除'}).click();
 await runGeneration();
 assert.equal(await currentOutput().locator('.clip').count(),2);report.checks.push('Real mixed male / female script generation with per-line emotion and filenames');
 await page.screenshot({path:path.join(artifacts,'script-results.png')});
 await currentOutput().locator('.play').first().click();await page.waitForFunction(()=>document.querySelector('#results .play').textContent==='Ⅱ');await currentOutput().locator('.play').first().click();
 await app.evaluate(({dialog},folder)=>{dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:folder+'/'+options.defaultPath});},artifacts);
 for(const name of ['WAV ↓','MP3 ↓']){await currentOutput().locator('.clip').first().getByRole('button',{name}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='音频已导出');}
 await page.locator('#export-zip').click();await page.waitForFunction(()=>document.querySelector('#cancel').classList.contains('hidden'));
 assert.equal((await readFile(path.join(artifacts,'help-male-1.wav'))).toString('ascii',0,4),'RIFF');assert.ok((await readFile(path.join(artifacts,'help-male-1.mp3'))).length>1000);assert.equal((await readFile(path.join(artifacts,'voice-pack.zip'))).toString('ascii',0,2),'PK');
 report.checks.push('Actual WAV playback, WAV / MP3 save and ZIP export');
 await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='已自动保存');
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.script-row').length===2);await page.locator('[data-view="editor"]').click();assert.equal(await page.locator('#script-panel').isVisible(),true);report.checks.push('Automatic SQLite session save / restore');
 await page.locator('#save-role').click();await page.locator('#role-name').fill('测试旁白');await page.locator('#name-dialog button[value="save"]').click();await page.locator('[data-view="roles"]').click();assert.ok(await page.locator('#role-grid .voice-card').count()>0);report.checks.push('Persistent role settings');
 await page.locator('[data-view="voices"]').click();await page.locator('[data-filter="child"]').click();await page.locator('[data-voice="design:girl-clear"] .use-voice').click();await page.locator('#mode-text').click();await page.locator('#text').fill('你好呀，我叫小雨。今天我们一起去公园，好不好？');await page.locator('[data-emotion="happy"]').click();await page.locator('.advanced-settings summary').click();await page.locator('#prefix').fill('child');await runGeneration();assert.equal(await currentOutput().locator('.clip').count(),1);
 const child=await page.evaluate(async()=>{const s=await studio.invoke('status');return s.history.find(i=>i.wav==='child.wav');});assert.ok(child.duration>=3);report.checks.push('Real girl voice design generation');
 await currentOutput().locator('.clip').getByRole('button',{name:'存为声音'}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已保存到我的声音'));
 const reference=await page.evaluate(async()=>{const s=await studio.invoke('status');return s.references.find(r=>r.name==='小雨');});assert.ok(reference);
 await page.locator('[data-view="roles"]').click();await page.locator(`[data-voice="clone:${reference.id}"] .use-voice`).click();await page.locator('#text').fill('太好了，我们现在就出发吧！');await page.locator('#prefix').fill('reuse');await runGeneration();assert.equal(await currentOutput().locator('.clip').count(),1);report.checks.push('Capture a generated voice and real reference voice reuse');
 await page.locator('[data-view="voices"]').click();await page.locator('[data-filter="female"]').click();await page.locator('[data-voice="preset:Vivian"] .use-voice').click();await page.locator('#engine-trigger').click();await page.getByRole('option',{name:'轻松朗读 · 更省资源',exact:false}).click();assert.equal(await page.locator('#performance-fields').isVisible(),false);await page.locator('#text').fill('这是一段轻量模式的自然配音。');await page.locator('#prefix').fill('light');await runGeneration();assert.equal(await currentOutput().locator('.clip').count(),1);report.checks.push('Real light voice generation; unavailable emotion controls hidden');
 await page.locator('#engine-trigger').click();await page.getByRole('option',{name:'生动表达 · 可调语气',exact:false}).click();await page.locator('#text').fill(Array.from({length:15},()=> '快走，大家跟上！').join('\n'));const cancelledId=await submitGeneration();await page.locator('#stop-generation').click();await waitUntil(()=>page.evaluate(async id=>(await studio.invoke('jobs-list')).jobs.find(job=>job.id===id).status==='cancelled',cancelledId));await page.locator('#text').fill('谢谢你！');await runGeneration();assert.equal(await currentOutput().locator('.clip').count(),1);report.checks.push('Cancel and recover in next inference');
 for(const view of ['history','downloads','account']){await page.locator(`[data-view="${view}"]`).click();await page.screenshot({path:path.join(artifacts,view+'.png')});assert.doesNotMatch(await page.locator('body').innerText(),/Qwen|API Key|不需要.?key|demo/i);}
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;const page=app.windows()[0];if(page)await page.screenshot({path:path.join(artifacts,'failure.png')});throw error;}finally{await writeFile(path.join(artifacts,'desktop-report.json'),JSON.stringify(report,null,2));await app.close();}
console.log(JSON.stringify(report,null,2));
