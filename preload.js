const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  savePNG: (buf, name) => ipcRenderer.invoke('save-png', buf, name),
  saveWorld: (text, name) => ipcRenderer.invoke('save-world', text, name),
  saveJSON: (text, name) => ipcRenderer.invoke('save-json', text, name),
  openWorld: () => ipcRenderer.invoke('open-world')
});
