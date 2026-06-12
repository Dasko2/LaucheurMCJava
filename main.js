const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const MODS_DIR = path.join(GAME_DIR, 'mods');
const LAUNCHER_MODS = path.join(__dirname, 'mods');

const FABRIC_API = 'https://meta.fabricmc.net/v2';

const FABRIC = {
  '1.20.1': '0.15.11',
  '1.19.4': '0.15.11',
  '1.18.2': '0.14.25'
};

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 650,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  await fs.ensureDir(GAME_DIR);
  await fs.ensureDir(MODS_DIR);
  await fs.ensureDir(LAUNCHER_MODS);
  createWindow();
});

// ───────────────────────── LOG SYSTEM ─────────────────────────

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

// ───────────────────────── MOD LOADER (CURSEFORGE STYLE) ─────────────────────────

async function syncMods(enabled) {
  await fs.emptyDir(MODS_DIR);

  const files = await fs.readdir(LAUNCHER_MODS).catch(() => []);

  for (const mod of enabled) {
    const match = files.find(f =>
      f.toLowerCase().includes(mod.toLowerCase())
    );

    if (match) {
      await fs.copy(
        path.join(LAUNCHER_MODS, match),
        path.join(MODS_DIR, match)
      );
      log(`Mod activé: ${match}`, 'success');
    }
  }
}

// ───────────────────────── FABRIC AUTO INSTALL ─────────────────────────

async function installFabric(version) {
  const loader = FABRIC[version];
  if (!loader) return null;

  const id = `fabric-loader-${loader}-${version}`;
  const dir = path.join(GAME_DIR, 'versions', id);
  const file = path.join(dir, `${id}.json`);

  if (await fs.pathExists(file)) return id;

  await fs.ensureDir(dir);

  const url =
    `${FABRIC_API}/versions/loader/${version}/${loader}/profile/json`;

  const res = await axios.get(url);

  await fs.writeJson(file, res.data, { spaces: 2 });

  return id;
}

// ───────────────────────── MICROSOFT LOGIN (ULTRA FIX) ─────────────────────────

async function microsoftLogin() {
  const authManager = new Auth("select_account");
  const xbox = await authManager.launch("electron");
  return await xbox.getMinecraft();
}

// ───────────────────────── LAUNCH GAME ─────────────────────────

ipcMain.handle('launch:game', async (_, data) => {
  try {
    const { username, version, enabledMods, ram, online } = data;

    log('Lancement Ultra Launcher...');

    await syncMods(enabledMods);

    const fabric = await installFabric(version);

    // 🔥 MICROSOFT OR OFFLINE
    let auth;

    if (online) {
      auth = await microsoftLogin();
    } else {
      const { Authenticator } = require('minecraft-launcher-core');
      auth = Authenticator.getAuth(username);
    }

    const launcher = new Client();

    const opts = {
      authorization: auth,
      root: GAME_DIR,
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

    launcher.on('progress', e => {
      progress(
        Math.floor((e.task / e.total) * 100),
        `${e.type}`
      );
    });

    await launcher.launch(opts);

    return { success: true };

  } catch (e) {
    log(e.message, 'error');
    return { success: false, error: e.message };
  }
});

// ───────────────────────── MODS LIST ─────────────────────────

ipcMain.handle('mods:list', async () => {
  return (await fs.readdir(LAUNCHER_MODS).catch(() => []))
    .filter(f => f.endsWith('.jar'));
});

// ───────────────────────── OPEN MODS ─────────────────────────

ipcMain.handle('mods:open-folder', () => {
  shell.openPath(LAUNCHER_MODS);
});

// ───────────────────────── INFO ─────────────────────────

ipcMain.handle('app:info', () => ({
  gameRoot: GAME_DIR,
  modsDir: MODS_DIR
}));
