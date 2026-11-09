const { contextBridge, ipcRenderer } = require('electron');
// Present resource preparation by stage, without forwarding provider-specific copy.
function resourceProgress(data) {
  const message = data.stage === 'runtime' ? '正在准备声悦定制资源，请稍候…'
    : data.stage === 'dependencies' ? '正在安装声悦定制资源，请稍候…'
    : data.stage === 'download' ? data.downloadPhase === 'complete' ? '声悦定制资源已准备完成'
      : data.downloadPhase === 'verifying' ? '正在校验声悦定制资源…' : '正在下载声悦定制资源…'
    : null;
  return message ? { ...data, message } : data;
}
contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  invoke: async (action, data = {}) => {
    const reply = await ipcRenderer.invoke('studio', action, data);
    if (!reply.ok) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
    return reply.result;
  },
  saveSessionSync: data => ipcRenderer.sendSync('session-save-sync', data),
  saveProjectSync: data => ipcRenderer.sendSync('project-save-sync', data),
  saveLabSync: data => ipcRenderer.sendSync('lab-save-sync', data),
  onProgress: callback => {
    const listener = (_event, data) => callback(resourceProgress(data));
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  }
});
