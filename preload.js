/**
 * preload.js — Pont sécurisé entre le processus principal (main.js) et le renderer
 *
 * Utilise contextBridge pour exposer uniquement les fonctions nécessaires au renderer,
 * sans jamais exposer les APIs Node.js complètes (sécurité Electron).
 *
 * Toutes les communications passent par ipcRenderer.invoke (bidirectionnel)
 * ou ipcRenderer.on (écoute des événements du main).
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── API exposée au renderer via window.launcher ──────────────────────────────

contextBridge.exposeInMainWorld('launcher', {

  // ── Contrôles de la fenêtre (barre de titre personnalisée) ──────────────────

  /** Réduire la fenêtre dans la barre des tâches */
  minimize: () => ipcRenderer.send('window:minimize'),

  /** Agrandir / restaurer la fenêtre */
  maximize: () => ipcRenderer.send('window:maximize'),

  /** Fermer l'application */
  close: () => ipcRenderer.send('window:close'),

  // ── Actions de jeu ──────────────────────────────────────────────────────────

  /**
   * Lancer Minecraft avec les paramètres fournis.
   * @param {Object} params
   * @param {string}   params.username     Pseudo (mode Offline)
   * @param {string}   params.version      Version Minecraft ('1.20.1', etc.)
   * @param {string[]} params.enabledMods  Clés des options activées
   * @param {number}   params.ram          RAM allouée en Go
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  launch: (params) => ipcRenderer.invoke('launch:game', params),

  // ── Gestion des mods ────────────────────────────────────────────────────────

  /**
   * Récupère la liste des fichiers .jar dans le dossier mods/ du launcher.
   * @returns {Promise<string[]>}
   */
  listMods: () => ipcRenderer.invoke('mods:list'),

  /**
   * Ouvre le dossier mods/ dans l'explorateur de fichiers du système.
   * @returns {Promise<boolean>}
   */
  openModsFolder: () => ipcRenderer.invoke('mods:open-folder'),

  // ── Informations de l'application ───────────────────────────────────────────

  /**
   * Récupère les informations de l'app (chemins, version, plateforme).
   * @returns {Promise<{gameRoot: string, modsDir: string, version: string, platform: string}>}
   */
  getInfo: () => ipcRenderer.invoke('app:info'),

  // ── Écouteurs d'événements venant du processus principal ────────────────────

  /**
   * S'abonner aux messages de log du launcher.
   * @param {function({message: string, type: string, time: string}): void} callback
   * @returns {function} Fonction de désinscription (appeler pour nettoyer)
   */
  onLog: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('log', handler);
    // Retourner une fonction de nettoyage
    return () => ipcRenderer.removeListener('log', handler);
  },

  /**
   * S'abonner aux mises à jour de progression.
   * @param {function({percent: number, label: string}): void} callback
   * @returns {function} Fonction de désinscription
   */
  onProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
});

// ─── Log de confirmation (visible dans les DevTools du renderer) ──────────────
console.log('[LaucheurJava] Preload chargé — API window.launcher disponible.');
