const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {

  launch: (d) => ipcRenderer.invoke('launch:game', d),

  listMods: () => ipcRenderer.invoke('mods:list'),
  openModsFolder: () => ipcRenderer.invoke('mods:open-folder'),
  getInfo: () => ipcRenderer.invoke('app:info'),

  onLog: (cb) => ipcRenderer.on('log', (_, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('progress', (_, d) => cb(d))
});
