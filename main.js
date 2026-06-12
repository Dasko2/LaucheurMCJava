const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { Client, Authenticator } = require('minecraft-launcher-core');
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

// ───────────────── LOG SYSTEM ─────────────────

function log(message, type = 'info') {
  win?.webContents.send('log', {
    message,
    type,
    time: new Date().toLocaleTimeString()
  });
}

function progress(percent, label) {
  win?.webContents.send('progress', { percent, label });
}

// ───────────────── MODRINTH API (AUTO DOWNLOAD MODS) ─────────────────

async function downloadModrinth(modSlug) {
  try {
    const url = `https://api.modrinth.com/v2/project/${modSlug}/version`;

    const res = await axios.get(url);

    const fileUrl = res.data[0].files[0].url;
    const fileName = res.data[0].files[0].filename;

    const filePath = path.join(LAUNCHER_MODS, fileName);

    const writer = require('fs').createWriteStream(filePath);

    const stream = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream'
    });

    stream.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(fileName));
      writer.on('error', reject);
    });

  } catch (e) {
    log(`Mod download error: ${modSlug}`, 'error');
  }
}

// ───────────────── MOD SYNC (CURSEFORGE STYLE) ─────────────────

async function syncMods(enabled) {
  await fs.ensureDir(MODS_DIR);
  await fs.ensureDir(LAUNCHER_MODS);

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

// ───────────────── FABRIC INSTALL ─────────────────

async function installFabric(version) {
  const loader = FABRIC[version];
  if (!loader) return null;

  const id = `fabric-loader-${loader}-${version}`;
  const dir = path.join(GAME_DIR, 'versions', id);
  const file = path.join(dir, `${id}.json`);

  if (await fs.pathExists(file)) return id;

  await fs.ensureDir(dir);

  const url = `${FABRIC_API}/versions/loader/${version}/${loader}/profile/json`;

  const res = await axios.get(url);

  await fs.writeJson(file, res.data, { spaces: 2 });

  return id;
}

// ───────────────── MICROSOFT LOGIN (ULTIMATE) ─────────────────

async function microsoftLogin() {
  const auth = new Auth("select_account");
  const xbox = await auth.launch("electron");
  return await xbox.getMinecraft();
}

// ───────────────── LAUNCH GAME ─────────────────

ipcMain.handle('launch:game', async (_, data) => {
  try {
    const { username, version, enabledMods, ram, online } = data;

    log('ULTIMATE LAUNCH START');

    await syncMods(enabledMods);

    const fabric = await installFabric(version);

    let auth;

    if (online) {
      log('Microsoft login...');
      auth = await microsoftLogin();
    } else {
      log('Offline mode');
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
        min: `${Math.max(2, ram / 2)}G`
      }
    };

    launcher.on('data', d => log(d));
    launcher.on('progress', e =>
      progress(Math.floor((e.task / e.total) * 100), e.type)
    );

    await launcher.launch(opts);

    return { success: true };

  } catch (e) {
    log(e.message, 'error');
    return { success: false, error: e.message };
  }
});

// ───────────────── MOD LIST ─────────────────

ipcMain.handle('mods:list', async () => {
  return (await fs.readdir(LAUNCHER_MODS).catch(() => []))
    .filter(f => f.endsWith('.jar'));
});

// ───────────────── OPEN MODS ─────────────────

ipcMain.handle('mods:open-folder', () => {
  shell.openPath(LAUNCHER_MODS);
});

// ───────────────── INFO ─────────────────

ipcMain.handle('app:info', () => ({
  gameRoot: GAME_DIR,
  modsDir: MODS_DIR
}));
