const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateBridge', {
  onUpdateAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update:downloaded', listener);
    return () => ipcRenderer.removeListener('update:downloaded', listener);
  },
  respond: (choice) => ipcRenderer.send('update:respond', choice)
});
