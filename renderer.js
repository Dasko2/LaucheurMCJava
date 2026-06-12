'use strict';

// ───────────────────────── DOM ─────────────────────────
const $username = document.getElementById('username');
const $ramSlider = document.getElementById('ram-slider');
const $ramLabel = document.getElementById('ram-label');

const $btnPlay = document.getElementById('btn-play');
const $btnMinimize = document.getElementById('btn-minimize');
const $btnMaximize = document.getElementById('btn-maximize');
const $btnClose = document.getElementById('btn-close');

const $btnOpenMods = document.getElementById('btn-open-mods');
const $btnClearLog = document.getElementById('btn-clear-log');

const $consoleBody = document.getElementById('console-body');

const $progressFill = document.getElementById('progress-fill');
const $progressLabel = document.getElementById('progress-label');

const $infoText = document.getElementById('info-text');

const $launchOverlay = document.getElementById('launch-overlay');
const $overlayText = document.getElementById('launch-overlay-text');

const $activeModsCount = document.getElementById('active-mods-count');

const $modToggles = document.querySelectorAll('.mod-toggle');
const $optionCards = document.querySelectorAll('.option-card');

// ───────────────────────── STATE ─────────────────────────
let enabledMods = new Set();
let isLaunching = false;

// ───────────────────────── STORAGE ─────────────────────────
const LS_USERNAME = 'lj_username';
const LS_RAM = 'lj_ram';
const LS_VERSION = 'lj_version';
const LS_MODS = 'lj_mods';

// ───────────────────────── MOD MAP (SYNC MAIN.JS) ─────────────────────────
const MOD_MAP = {
  fullbright: 'lambdadynamiclights',
  nofog: 'fabricskyboxes',
  clearlava: 'cleardespawn',
  hudFPS: 'sodium',
  hudCPS: 'clickrmod',
  playerHealth: 'appleskin'
};

// ───────────────────────── INIT ─────────────────────────
async function init() {
  loadPreferences();

  try {
    const info = await window.launcher.getInfo();
    $infoText.textContent = info.gameRoot;
  } catch {
    $infoText.textContent = 'Erreur info launcher';
  }

  await refreshMods();

  window.launcher.onLog((d) => addLog(d.message, d.type, d.time));
  window.launcher.onProgress((d) => updateProgress(d.percent, d.label));

  updateModCount();

  addLog("Launcher prêt ✔", "info");
}

// ───────────────────────── PREFS ─────────────────────────
function loadPreferences() {
  $username.value = localStorage.getItem(LS_USERNAME) || '';

  const ram = localStorage.getItem(LS_RAM) || '4';
  $ramSlider.value = ram;
  $ramLabel.textContent = `${ram} Go`;

  const version = localStorage.getItem(LS_VERSION) || '1.20.1';
  const radio = document.querySelector(`input[value="${version}"]`);
  if (radio) radio.checked = true;

  const mods = JSON.parse(localStorage.getItem(LS_MODS) || '[]');
  mods.forEach(m => {
    enabledMods.add(m);
    const t = document.querySelector(`[data-key="${m}"]`);
    if (t) {
      t.checked = true;
      t.closest('.option-card')?.classList.add('active');
    }
  });
}

function savePreferences() {
  localStorage.setItem(LS_USERNAME, $username.value);
  localStorage.setItem(LS_RAM, $ramSlider.value);

  const v = document.querySelector('input[name="version"]:checked')?.value;
  if (v) localStorage.setItem(LS_VERSION, v);

  localStorage.setItem(LS_MODS, JSON.stringify([...enabledMods]));
}

// ───────────────────────── MODS ─────────────────────────
async function refreshMods() {
  let jars = [];
  try {
    jars = await window.launcher.listMods();
  } catch {}

  $optionCards.forEach(card => {
    const key = card.dataset.mod;
    const prefix = MOD_MAP[key];

    const found = jars.some(j =>
      j.toLowerCase().startsWith(prefix.toLowerCase())
    );

    const dot = card.querySelector('.status-dot');
    const text = card.querySelector('.status-text');

    if (found) {
      dot.className = 'status-dot available';
      text.textContent = 'Disponible';
    } else {
      dot.className = 'status-dot unavailable';
      text.textContent = 'Manquant';
    }
  });
}

function updateModCount() {
  $activeModsCount.textContent = `${enabledMods.size} mod(s) activé(s)`;
}

// ───────────────────────── LOGS ─────────────────────────
function addLog(msg, type = 'info', time) {
  const t = time || new Date().toLocaleTimeString();

  const line = document.createElement('div');
  line.className = `log-line log-${type}`;

  line.innerHTML = `
    <span class="log-time">${t}</span>
    <span class="log-msg">${msg}</span>
  `;

  $consoleBody.appendChild(line);

  if ($consoleBody.children.length > 200) {
    $consoleBody.removeChild($consoleBody.firstChild);
  }

  $consoleBody.scrollTop = $consoleBody.scrollHeight;
}

// ───────────────────────── PROGRESS ─────────────────────────
function updateProgress(p, label) {
  $progressFill.style.width = `${p}%`;
  $progressLabel.textContent = label || '';
}

// ───────────────────────── LAUNCH ─────────────────────────
async function launchGame() {
  if (isLaunching) return;

  const username = $username.value.trim();
  const version = document.querySelector('input[name="version"]:checked')?.value;
  const ram = parseInt($ramSlider.value, 10);

  if (!username || username.length < 2) {
    addLog("Pseudo invalide", "error");
    return;
  }

  isLaunching = true;
  $btnPlay.disabled = true;

  $launchOverlay.classList.add('visible');
  $overlayText.textContent = "Lancement...";

  savePreferences();

  const mods = [...enabledMods];

  try {
    const res = await window.launcher.launch({
      username,
      version,
      enabledMods: mods,
      ram,
      microsoft: false // ⚠️ prêt pour upgrade Microsoft login
    });

    if (!res.success) throw new Error(res.error);

    addLog("Minecraft lancé ✔", "success");
    updateProgress(100, "OK");

  } catch (e) {
    addLog(e.message, "error");
  }

  setTimeout(() => {
    isLaunching = false;
    $btnPlay.disabled = false;
    $launchOverlay.classList.remove('visible');
  }, 2000);
}

// ───────────────────────── EVENTS ─────────────────────────

// window controls
$btnMinimize.onclick = () => window.launcher.minimize();
$btnMaximize.onclick = () => window.launcher.maximize();
$btnClose.onclick = () => window.launcher.close();

// play
$btnPlay.onclick = launchGame;

// enter key
$username.addEventListener('keydown', e => {
  if (e.key === 'Enter') launchGame();
});

// ram
$ramSlider.addEventListener('input', () => {
  $ramLabel.textContent = `${$ramSlider.value} Go`;
});
$ramSlider.addEventListener('change', savePreferences);

// username
$username.addEventListener('input', savePreferences);

// version
document.querySelectorAll('input[name="version"]').forEach(r => {
  r.addEventListener('change', savePreferences);
});

// mods toggle
$modToggles.forEach(t => {
  t.addEventListener('change', () => {
    const key = t.dataset.key;

    if (t.checked) enabledMods.add(key);
    else enabledMods.delete(key);

    t.closest('.option-card')?.classList.toggle('active', t.checked);

    updateModCount();
    savePreferences();
  });
});

// mods folder
$btnOpenMods.onclick = async () => {
  await window.launcher.openModsFolder();
  setTimeout(refreshMods, 1000);
};

// clear log
$btnClearLog.onclick = () => {
  $consoleBody.innerHTML = '';
  addLog("Console vidée", "info");
};

// auto refresh mods
setInterval(refreshMods, 10000);

// start
init();
