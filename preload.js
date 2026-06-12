/**
 * preload.js — Pont sécurisé Electron
 * Expose uniquement les fonctions nécessaires au renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── Helper pour éviter répétition ─────────────────────────
const onEvent = (channel) => (callback) => {
  const handler = (_, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// ─── API exposée ───────────────────────────────────────────
contextBridge.exposeInMainWorld('launcher', {

  // ── Window controls ──────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // ── Game launch ───────────────────────────────────────────
  launch: (params) => ipcRenderer.invoke('launch:game', params),

  // ── Mods ──────────────────────────────────────────────────
  listMods: () => ipcRenderer.invoke('mods:list'),
  open-Folder: () => ipcRenderer.invoke('mods:open-folder'),

  // ── App info ──────────────────────────────────────────────
  getInfo: () => ipcRenderer.invoke('app:info'),

  // ── Events ────────────────────────────────────────────────
  onLog: onEvent('log'),
  onProgress: onEvent('progress'),
});

console.log('[LaucheurJava] Preload chargé ✔');
