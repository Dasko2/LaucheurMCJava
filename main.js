/**
 * main.js — Processus principal Electron (LaucheurJava)
 *
 * Responsabilités :
 *  - Créer la fenêtre principale de l'application
 *  - Gérer les appels IPC depuis le renderer (lancement, téléchargement, mods)
 *  - Télécharger et installer Fabric si nécessaire
 *  - Lancer Minecraft via minecraft-launcher-core
 *  - Copier uniquement les mods actifs avant le lancement
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { Client, Authenticator } = require('minecraft-launcher-core');
const https = require('https');
const { execFile } = require('child_process');

// ─── Chemins principaux ──────────────────────────────────────────────────────

// Dossier racine du jeu (dans le dossier utilisateur pour éviter les conflits)
const GAME_ROOT = path.join(app.getPath('userData'), 'minecraft');

// Dossier des mods du launcher (mods disponibles à activer)
const LAUNCHER_MODS_DIR = path.join(__dirname, 'mods');

// Dossier mods qui sera lu par Minecraft / Fabric
const MC_MODS_DIR = path.join(GAME_ROOT, 'mods');

// URL de base de l'API Fabric pour télécharger le loader
const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';

// Versions de Fabric Loader stables connues pour chaque version MC
const FABRIC_LOADER_VERSIONS = {
  '1.20.1': '0.15.11',
  '1.19.4': '0.15.11',
  '1.18.2': '0.14.25',
};

// Mapping des options aux noms de fichiers mod (sans extension .jar)
// Le fichier doit être présent dans le dossier mods/ du launcher
const MOD_MAP = {
  fullbright:     { file: 'LambdaDynamicLights', label: 'FullBright (LambDynamicLights)' },
  nofog:          { file: 'FabricSkyboxes',      label: 'NoFog (FabricSkyboxes)'         },
  clearlava:      { file: 'ClearDespawn',         label: 'ClearLava (ClearDespawn)'       },
  hudFPS:         { file: 'Sodium',               label: 'HUD FPS (Sodium)'               },
  hudCPS:         { file: 'ClickrMod',            label: 'HUD CPS (ClickrMod)'            },
  playerHealth:   { file: 'AppleSkin',            label: 'Player Health (AppleSkin)'      },
};

// ─── Fenêtre principale ──────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 580,
    minWidth: 800,
    minHeight: 500,
    frame: false,          // Frame personnalisé (barre de titre custom)
    resizable: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // Sécurité : isoler le contexte
      nodeIntegration: false,   // Sécurité : pas d'accès Node direct depuis renderer
    },
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
  });

  mainWindow.loadFile('index.html');

  // Ouvrir les DevTools uniquement en mode développement
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Empêcher la navigation vers des URLs externes (sécurité)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  // Créer les dossiers nécessaires au démarrage
  await fs.ensureDir(GAME_ROOT);
  await fs.ensureDir(MC_MODS_DIR);
  await fs.ensureDir(LAUNCHER_MODS_DIR);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Contrôles de la fenêtre (barre de titre custom) ────────────────────────

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Envoie un message de log au renderer (affiché dans la console du launcher).
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} type
 */
function sendLog(message, type = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', { message, type, time: new Date().toLocaleTimeString() });
  }
}

/**
 * Envoie la progression du téléchargement au renderer.
 * @param {number} percent  0-100
 * @param {string} label
 */
function sendProgress(percent, label = '') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('progress', { percent, label });
  }
}

/**
 * Télécharge un fichier via HTTPS avec suivi de progression.
 * @param {string} url
 * @param {string} dest  Chemin de destination
 * @returns {Promise<void>}
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Gérer les redirections
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`Téléchargement échoué : HTTP ${response.statusCode} — ${url}`));
      }

      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const percent = Math.round((downloaded / total) * 100);
          sendProgress(percent, `Téléchargement... ${percent}%`);
        }
      });

      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.remove(dest).catch(() => {});
      reject(err);
    });
  });
}

/**
 * Récupère du JSON depuis une URL HTTPS.
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LaucheurJava/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON invalide : ' + url)); }
      });
    }).on('error', reject);
  });
}

// ─── Gestion des mods ────────────────────────────────────────────────────────

/**
 * Copie uniquement les mods activés depuis le dossier launcher vers minecraft/mods.
 * Supprime d'abord tous les mods existants pour repartir d'une base propre.
 * @param {string[]} enabledOptions  Liste des clés activées (ex: ['fullbright', 'hudFPS'])
 * @param {string} mcVersion         Version Minecraft (ex: '1.20.1')
 */
async function syncMods(enabledOptions, mcVersion) {
  // Vider le dossier mods Minecraft avant de copier
  await fs.emptyDir(MC_MODS_DIR);
  sendLog('Dossier mods vidé.', 'info');

  let copiedCount = 0;

  for (const option of enabledOptions) {
    const modInfo = MOD_MAP[option];
    if (!modInfo) continue;

    // Chercher le .jar correspondant dans le dossier mods/ du launcher
    // Convention de nommage : NomMod-version.jar  (ex: Sodium-mc1.20.1-0.5.8.jar)
    const modsDir = LAUNCHER_MODS_DIR;
    let found = false;

    try {
      const files = await fs.readdir(modsDir);
      for (const file of files) {
        if (
          file.toLowerCase().startsWith(modInfo.file.toLowerCase()) &&
          file.endsWith('.jar')
        ) {
          const src = path.join(modsDir, file);
          const dest = path.join(MC_MODS_DIR, file);
          await fs.copy(src, dest);
          sendLog(`Mod copié : ${file}`, 'success');
          copiedCount++;
          found = true;
          break;
        }
      }
    } catch {
      // Le dossier mods peut être vide à la première utilisation
    }

    if (!found) {
      sendLog(
        `Mod non trouvé pour "${modInfo.label}". Placez le .jar dans le dossier mods/.`,
        'warn'
      );
    }
  }

  sendLog(`${copiedCount} mod(s) activé(s) copié(s).`, copiedCount > 0 ? 'success' : 'warn');
}

// ─── Installation de Fabric ───────────────────────────────────────────────────

/**
 * Vérifie si Fabric est déjà installé pour cette version.
 * @param {string} mcVersion
 * @returns {Promise<boolean>}
 */
async function isFabricInstalled(mcVersion) {
  const loaderVersion = FABRIC_LOADER_VERSIONS[mcVersion];
  if (!loaderVersion) return false;
  const versionId = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const versionDir = path.join(GAME_ROOT, 'versions', versionId);
  const jsonFile = path.join(versionDir, `${versionId}.json`);
  return fs.pathExists(jsonFile);
}

/**
 * Télécharge et installe Fabric pour la version donnée via le profile JSON de FabricMC.
 * @param {string} mcVersion
 * @returns {Promise<string>} L'ID de version Fabric (ex: fabric-loader-0.15.11-1.20.1)
 */
async function installFabric(mcVersion) {
  const loaderVersion = FABRIC_LOADER_VERSIONS[mcVersion];
  if (!loaderVersion) throw new Error(`Pas de version Fabric connue pour ${mcVersion}`);

  const versionId = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const versionDir = path.join(GAME_ROOT, 'versions', versionId);
  const profileJson = path.join(versionDir, `${versionId}.json`);

  if (await fs.pathExists(profileJson)) {
    sendLog(`Fabric déjà installé (${versionId}).`, 'info');
    return versionId;
  }

  sendLog(`Installation de Fabric ${loaderVersion} pour MC ${mcVersion}...`, 'info');
  await fs.ensureDir(versionDir);

  // URL du profile JSON Fabric (contient les librairies à télécharger)
  const profileUrl = `${FABRIC_META_URL}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;

  sendLog(`Téléchargement du profil Fabric...`, 'info');
  const profileData = await fetchJson(profileUrl);

  // Écrire le profile JSON dans le dossier versions
  await fs.writeJson(profileJson, profileData, { spaces: 2 });
  sendLog(`Profil Fabric écrit : ${versionId}.json`, 'success');

  return versionId;
}

// ─── Handler IPC principal : PLAY ────────────────────────────────────────────

/**
 * Handler déclenché par le bouton PLAY du renderer.
 * Paramètres attendus : { username, version, enabledMods, ram }
 */
ipcMain.handle('launch:game', async (event, { username, version, enabledMods, ram }) => {
  try {
    // Validation des entrées
    if (!username || username.trim().length < 2) {
      throw new Error('Le pseudo doit contenir au moins 2 caractères.');
    }
    if (!version) {
      throw new Error('Aucune version sélectionnée.');
    }

    sendLog(`─── Démarrage du launcher ───`, 'info');
    sendLog(`Pseudo : ${username.trim()}`, 'info');
    sendLog(`Version : ${version}`, 'info');
    sendLog(`RAM allouée : ${ram}G`, 'info');
    sendLog(`Mods actifs : ${enabledMods.length > 0 ? enabledMods.join(', ') : 'aucun'}`, 'info');

    // 1. S'assurer que les dossiers existent
    await fs.ensureDir(GAME_ROOT);
    await fs.ensureDir(MC_MODS_DIR);
    sendLog('Dossiers minecraft/ et mods/ vérifiés.', 'success');

    // 2. Synchroniser les mods (copier les .jar des options activées)
    sendProgress(5, 'Synchronisation des mods...');
    await syncMods(enabledMods, version);

    // 3. Installer Fabric si nécessaire
    sendProgress(15, 'Vérification de Fabric...');
    let fabricVersionId;
    try {
      fabricVersionId = await installFabric(version);
    } catch (fabricErr) {
      sendLog(`Impossible d'installer Fabric : ${fabricErr.message}. Lancement en vanilla.`, 'warn');
      fabricVersionId = null;
    }

    // 4. Configurer et lancer via minecraft-launcher-core
    sendProgress(20, 'Configuration du lancement...');
    const launcher = new Client();

    // Authentification hors-ligne (Offline Mode)
    // La structure est prête pour ajouter Microsoft Login (remplacer Authenticator.getAuth)
    const auth = Authenticator.getAuth(username.trim());

    const launchOptions = {
      // Authentification (offline)
      authorization: auth,

      // Racine du jeu (dossier .minecraft)
      root: GAME_ROOT,

      // Version : Fabric si disponible, sinon vanilla
      version: {
        number: version,
        type: 'release',
        ...(fabricVersionId ? { custom: fabricVersionId } : {}),
      },

      // Mémoire RAM allouée
      memory: {
        max: `${ram}G`,
        min: `${Math.max(1, Math.floor(ram / 2))}G`,
      },

      // Répertoire des logs
      overrides: {
        gameDirectory: GAME_ROOT,
        detached: false,
      },
    };

    // ── Événements de progression du launcher-core ──

    launcher.on('debug', (msg) => {
      sendLog(`[DEBUG] ${msg}`, 'info');
    });

    launcher.on('data', (msg) => {
      sendLog(msg, 'info');
    });

    // Progression du téléchargement des assets/librairies
    launcher.on('download-status', (status) => {
      const percent = Math.round((status.current / status.total) * 70) + 20;
      sendProgress(percent, `Téléchargement : ${status.name}`);
      sendLog(`Téléchargement (${status.current}/${status.total}) : ${status.name}`, 'info');
    });

    launcher.on('download', (e) => {
      sendLog(`Fichier téléchargé : ${e}`, 'info');
    });

    launcher.on('progress', (e) => {
      sendProgress(
        Math.round((e.task / e.total) * 70) + 20,
        `${e.type} : ${e.task}/${e.total}`
      );
    });

    // Lancement effectif
    sendLog('Lancement de Minecraft...', 'info');
    sendProgress(95, 'Lancement...');

    await launcher.launch(launchOptions);

    sendProgress(100, 'Minecraft lancé !');
    sendLog('Minecraft a démarré avec succès !', 'success');

    // Retourner le succès au renderer
    return { success: true };

  } catch (err) {
    sendLog(`Erreur : ${err.message}`, 'error');
    sendProgress(0, '');
    return { success: false, error: err.message };
  }
});

// ─── Handler : Récupérer la liste des mods disponibles ────────────────────────

/**
 * Retourne la liste des fichiers .jar présents dans le dossier mods/ du launcher.
 * Utile pour afficher dans l'UI quels mods sont prêts.
 */
ipcMain.handle('mods:list', async () => {
  try {
    await fs.ensureDir(LAUNCHER_MODS_DIR);
    const files = await fs.readdir(LAUNCHER_MODS_DIR);
    return files.filter((f) => f.endsWith('.jar'));
  } catch {
    return [];
  }
});

// ─── Handler : Ouvrir le dossier mods dans l'explorateur ─────────────────────

ipcMain.handle('mods:open-folder', async () => {
  await fs.ensureDir(LAUNCHER_MODS_DIR);
  shell.openPath(LAUNCHER_MODS_DIR);
  return true;
});

// ─── Handler : Obtenir les infos système (chemin du jeu, etc.) ───────────────

ipcMain.handle('app:info', () => ({
  gameRoot: GAME_ROOT,
  modsDir: LAUNCHER_MODS_DIR,
  version: app.getVersion(),
  platform: process.platform,
}));
