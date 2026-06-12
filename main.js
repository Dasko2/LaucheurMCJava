const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { Client, Authenticator } = require('minecraft-launcher-core');
const axios = require('axios');

const GAME_ROOT = path.join(app.getPath('userData'), 'minecraft');
const MODS_DIR = path.join(GAME_ROOT, 'mods');
const LAUNCHER_MODS = path.join(__dirname, 'mods');

const FABRIC_API = 'https://meta.fabricmc.net/v2';

const FABRIC = {
  '1.20.1': '0.15.11',
  '1.19.4': '0.15.11',
  '1.18.2': '0.14.25'
};

// MODS MAP (IMPORTANT FIX CASE)
const MODS = {
  fullbright: 'lambdadynamiclights',
  nofog: 'fabricskyboxes',
  clearlava: 'cleardespawn',
  hudfps: 'sodium',
  hudcps: 'clickrmod',
  playerhealth: 'appleskin'
};

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 950,
    height: 580,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  await fs.ensureDir(GAME_ROOT);
  await fs.ensureDir(MODS_DIR);
  await fs.ensureDir(LAUNCHER_MODS);
  createWindow();
});

// ───── LOGS ─────
function log(msg, type = 'info') {
  win?.webContents.send('log', {
    message: msg,
    type,
    time: new Date().toLocaleTimeString()
  });
}

function progress(p, label) {
  win?.webContents.send('progress', { percent: p, label });
}

// ───── MODS SYNC ─────
async function syncMods(enabled) {
  await fs.emptyDir(MODS_DIR);

  for (const key of enabled) {
    const prefix = MODS[key];
    if (!prefix) continue;

    const files = await fs.readdir(LAUNCHER_MODS).catch(() => []);

    const match = files.find(f =>
      f.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (match) {
      await fs.copy(
        path.join(LAUNCHER_MODS, match),
        path.join(MODS_DIR, match)
      );
      log(`Mod copié: ${match}`, 'success');
    }
  }
}

// ───── FABRIC FIX PRO ─────
async function installFabric(version) {
  const loader = FABRIC[version];
  if (!loader) return null;

  const id = `fabric-loader-${loader}-${version}`;
  const dir = path.join(GAME_ROOT, 'versions', id);
  const file = path.join(dir, `${id}.json`);

  if (await fs.pathExists(file)) return id;

  await fs.ensureDir(dir);

  const url = `${FABRIC_API}/versions/loader/${version}/${loader}/profile/json`;

  const res = await axios.get(url);

  await fs.writeJson(file, res.data, { spaces: 2 });

  return id;
}

// ───── LAUNCH ─────
ipcMain.handle('launch:game', async (_, data) => {
  try {
    const { username, version, enabledMods, ram } = data;

    log('Lancement...');

    await syncMods(enabledMods);
    const fabric = await installFabric(version);

    const auth = Authenticator.getAuth(username);

    const launcher = new Client();

    const opts = {
      authorization: auth,
      root: GAME_ROOT,
      version: {
        number: version,
        type: 'release',
        ...(fabric ? { custom: fabric } : {})
      },
      memory: {
        max: `${ram}G`,
        min: `${Math.max(1, ram / 2)}G`
      }
    };

    launcher.on('data', d => log(d));

    await launcher.launch(opts);

    return { success: true };

  } catch (e) {
    log(e.message, 'error');
    return { success: false, error: e.message };
  }
});

// ───── MOD LIST ─────
ipcMain.handle('mods:list', async () => {
  return (await fs.readdir(LAUNCHER_MODS).catch(() => []))
    .filter(f => f.endsWith('.jar'));
});

// ───── OPEN MODS ─────
ipcMain.handle('mods:open-folder', async () => {
  shell.openPath(LAUNCHER_MODS);
});

// ───── INFO ─────
ipcMain.handle('app:info', () => ({
  gameRoot: GAME_ROOT,
  modsDir: MODS_DIR,
  version: app.getVersion()
}));
