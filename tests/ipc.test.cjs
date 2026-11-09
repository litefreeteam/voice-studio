const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { studioReply } = require('../desktop/ipc.cjs');

function bridge(handler) {
  let studio;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), {
    process: { platform: process.platform },
    require: name => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'studio'); studio = value; } },
        ipcRenderer: { invoke(channel, ...args) {
          assert.equal(channel, 'studio');
          return handler(...args).then(reply => structuredClone(reply));
        } }
      };
    }
  });
  return studio;
}

test('studio IPC preserves success values, binary audio and error-shaped results', async () => {
  const calls = [];
  const client = bridge(studioReply((action, data) => { calls.push({ action, data }); return data.value; }));
  for (const value of [undefined, null, false, 0, '', { ok: false, error: { message: 'ordinary data' } }, new Uint8Array([0, 128, 255])]) {
    assert.deepEqual(await client.invoke('audio', { value }), value);
  }
  assert.equal(calls.length, 7);
  assert.equal(calls[0].action, 'audio');
});

test('cancellation and other application failures resolve across IPC and reject only in the renderer', async () => {
  for (const [code, message] of [['CANCELLED', '操作已取消，已下载的文件会保留'],
    ['LICENSE_REQUIRED', '请先激活软件后再使用'], ['ENGINE_ERROR', '下载连接中断，请重试']]) {
    for (const asynchronous of [false, true]) {
      const error = Object.assign(new Error(message), { code, detail: 'private engine details' });
      const reply = studioReply(() => { if (asynchronous) return Promise.reject(error); throw error; });
      assert.deepEqual(await reply(), { ok: false, error: { code, message } }, 'Electron must receive a fulfilled handler result');
      await assert.rejects(bridge(reply).invoke('setup'), failure => failure.code === code && failure.message === message && failure.detail === undefined);
    }
  }
});

test('plain errors have a stable code and transport failures still reject', async () => {
  const client = bridge(studioReply(() => { throw new Error('请求来源无效'); }));
  await assert.rejects(client.invoke('status'), { code: 'STUDIO_ERROR', message: '请求来源无效' });
  const error = new Error('IPC disconnected');
  await assert.rejects(bridge(() => Promise.reject(error)).invoke('status'), error);
});
