const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  launch: (data) => ipcRenderer.invoke('launch:game', data),

  listMods: () => ipcRenderer.invoke('mods:list'),
  openModsFolder: () => ipcRenderer.invoke('mods:open-folder'),
  getInfo: () => ipcRenderer.invoke('app:info'),

  onLog: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('log', h);
    return () => ipcRenderer.removeListener('log', h);
  },

  onProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('progress', h);
    return () => ipcRenderer.removeListener('progress', h);
  }
});
