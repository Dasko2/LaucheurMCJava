const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { Client, Authenticator } = require('minecraft-launcher-core');
const https = require('https');

// ─── CHEMINS ─────────────────────────────────────────────
const GAME_ROOT = path.join(app.getPath('userData'), 'minecraft');
const LAUNCHER_MODS_DIR = path.join(__dirname, 'mods');
const MC_MODS_DIR = path.join(GAME_ROOT, 'mods');

const FABRIC_META_URL = 'https://meta.fabricmc.net/v2';

const FABRIC_LOADER_VERSIONS = {
  '1.20.1': '0.15.11',
  '1.19.4': '0.15.11',
  '1.18.2': '0.14.25',
};

// ─── MODS ───────────────────────────────────────────────
const MOD_MAP = {
  fullbright: { file: 'LambdaDynamicLights', label: 'FullBright' },
  nofog: { file: 'FabricSkyboxes', label: 'NoFog' },
  clearlava: { file: 'ClearDespawn', label: 'ClearLava' },
  hudFPS: { file: 'Sodium', label: 'HUD FPS' },
  hudCPS: { file: 'ClickrMod', label: 'HUD CPS' },
  playerHealth: { file: 'AppleSkin', label: 'Player Health' }
};

// ─── WINDOW ─────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 580,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// ─── APP INIT ───────────────────────────────────────────
app.whenReady().then(async () => {
  await fs.ensureDir(GAME_ROOT);
  await fs.ensureDir(MC_MODS_DIR);
  await fs.ensureDir(LAUNCHER_MODS_DIR);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── LOGS ───────────────────────────────────────────────
function sendLog(msg, type = 'info') {
  if (!mainWindow) return;
  mainWindow.webContents.send('log', {
    message: msg,
    type,
    time: new Date().toLocaleTimeString()
  });
}

function sendProgress(percent, label = '') {
  if (!mainWindow) return;
  mainWindow.webContents.send('progress', { percent, label });
}

// ─── MOD SYNC ───────────────────────────────────────────
async function syncMods(enabled) {
  await fs.emptyDir(MC_MODS_DIR);

  for (const opt of enabled) {
    const mod = MOD_MAP[opt];
    if (!mod) continue;

    const files = await fs.readdir(LAUNCHER_MODS_DIR).catch(() => []);
    const match = files.find(f =>
      f.toLowerCase().startsWith(mod.file.toLowerCase()) && f.endsWith('.jar')
    );

    if (match) {
      await fs.copy(
        path.join(LAUNCHER_MODS_DIR, match),
        path.join(MC_MODS_DIR, match)
      );
      sendLog(`Mod copié : ${match}`, 'success');
    } else {
      sendLog(`Mod manquant : ${mod.label}`, 'warn');
    }
  }
}

// ─── FABRIC ─────────────────────────────────────────────
async function installFabric(version) {
  const loader = FABRIC_LOADER_VERSIONS[version];
  if (!loader) return null;

  const id = `fabric-loader-${loader}-${version}`;
  const file = path.join(GAME_ROOT, 'versions', id, `${id}.json`);

  if (await fs.pathExists(file)) return id;

  await fs.ensureDir(path.dirname(file));

  const url = `${FABRIC_META_URL}/versions/loader/${version}/${loader}/profile/json`;
  const data = await fetch(url).then(r => r.json());

  await fs.writeJson(file, data, { spaces: 2 });

  return id;
}

// ─── LAUNCH ─────────────────────────────────────────────
ipcMain.handle('launch:game', async (e, { username, version, enabledMods, ram }) => {
  try {
    sendLog('Démarrage...', 'info');

    await syncMods(enabledMods);
    const fabric = await installFabric(version);

    const launcher = new Client();

    const auth = Authenticator.getAuth(username);

    const options = {
      authorization: auth,
      root: GAME_ROOT,
      version: {
        number: version,
        type: 'release',
        ...(fabric ? { custom: fabric } : {})
      },
      memory: {
        max: `${ram}G`,
        min: `${Math.max(1, Math.floor(ram / 2))}G`
      }
    };

    launcher.on('debug', d => sendLog(d));
    launcher.on('data', d => sendLog(d));

    sendProgress(30, 'Lancement...');
    await launcher.launch(options);

    sendProgress(100, 'OK');
    return { success: true };

  } catch (err) {
    sendLog(err.message, 'error');
    return { success: false, error: err.message };
  }
});

// ─── MODS LIST ──────────────────────────────────────────
ipcMain.handle('mods:list', async () => {
  return (await fs.readdir(LAUNCHER_MODS_DIR).catch(() => []))
    .filter(f => f.endsWith('.jar'));
});

// ─── OPEN MOD FOLDER ────────────────────────────────────
ipcMain.handle('mods:open', async () => {
  shell.openPath(LAUNCHER_MODS_DIR);
});

// ─── INFO APP ───────────────────────────────────────────
ipcMain.handle('app:info', () => ({
  gameRoot: GAME_ROOT,
  modsDir: LAUNCHER_MODS_DIR,
  platform: process.platform,
  version: app.getVersion()
}));
