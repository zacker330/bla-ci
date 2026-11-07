const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quote', {
  calculate: (input) => ipcRenderer.invoke('quote:calculate', input)
});
