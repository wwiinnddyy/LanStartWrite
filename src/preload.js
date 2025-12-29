const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (msg) => ipcRenderer.send('fromRenderer', msg),
  onReply: (cb) => ipcRenderer.on('fromMain', (event, ...args) => cb(...args))
});
