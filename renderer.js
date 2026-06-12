/**
 * renderer.js — Script du processus renderer (interface utilisateur)
 *
 * Tourne dans le contexte web de la fenêtre Electron.
 * Communique avec le processus principal via window.launcher (exposé par preload.js).
 *
 * Responsabilités :
 *  - Gérer les interactions utilisateur (pseudo, version, RAM, mods, PLAY)
 *  - Afficher les logs dans la console
 *  - Mettre à jour la barre de progression
 *  - Persister les préférences en localStorage
 *  - Rafraîchir l'état des mods disponibles
 */

'use strict';

// ─── Sélecteurs DOM ──────────────────────────────────────────────────────────

const $username       = document.getElementById('username');
const $ramSlider      = document.getElementById('ram-slider');
const $ramLabel       = document.getElementById('ram-label');
const $btnPlay        = document.getElementById('btn-play');
const $btnMinimize    = document.getElementById('btn-minimize');
const $btnMaximize    = document.getElementById('btn-maximize');
const $btnClose       = document.getElementById('btn-close');
const $btnOpenMods    = document.getElementById('btn-open-mods');
const $btnClearLog    = document.getElementById('btn-clear-log');
const $consoleBody    = document.getElementById('console-body');
const $progressFill   = document.getElementById('progress-fill');
const $progressLabel  = document.getElementById('progress-label');
const $infoText       = document.getElementById('info-text');
const $launchOverlay  = document.getElementById('launch-overlay');
const $overlayText    = document.getElementById('launch-overlay-text');
const $activeModsCount = document.getElementById('active-mods-count');
const $optionCards    = document.querySelectorAll('.option-card');
const $modToggles     = document.querySelectorAll('.mod-toggle');

// ─── État local ──────────────────────────────────────────────────────────────

/** Mods activés par l'utilisateur — clés correspondant à MOD_MAP dans main.js */
let enabledMods = new Set();

/** Noms des fichiers JAR présents dans le dossier mods/ */
let availableJars = [];

/** Indique si un lancement est en cours (pour éviter les doubles clics) */
let isLaunching = false;

// ─── Clés localStorage pour persister les préférences ───────────────────────

const LS_USERNAME = 'lj_username';
const LS_RAM      = 'lj_ram';
const LS_VERSION  = 'lj_version';
const LS_MODS     = 'lj_mods';

// ─── Mapping des options vers les noms de fichiers mod (même mapping que main.js) ──

const MOD_FILE_MAP = {
  fullbright:   'lambdadynamiclights',
  nofog:        'fabricskyboxes',
  clearlava:    'cleardespawn',
  hudFPS:       'sodium',
  hudCPS:       'clickrmod',
  playerHealth: 'appleskin',
};

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Point d'entrée — appelé au chargement de la page.
 */
async function init() {
  // Charger les préférences sauvegardées
  loadPreferences();

  // Récupérer et afficher les infos de l'app (chemin du jeu)
  try {
    const info = await window.launcher.getInfo();
    $infoText.textContent = info.gameRoot;
    $infoText.title = `Dossier du jeu : ${info.gameRoot}`;
  } catch {
    $infoText.textContent = 'Impossible de récupérer le chemin du jeu';
  }

  // Rafraîchir la liste des JARs disponibles
  await refreshModStatus();

  // Brancher les listeners IPC (logs + progression)
  window.launcher.onLog((data) => appendLog(data.message, data.type, data.time));
  window.launcher.onProgress((data) => updateProgress(data.percent, data.label));

  // Mettre à jour le compteur de mods actifs
  updateActiveModsCount();

  log('Launcher prêt. Entrez votre pseudo et appuyez sur PLAY.', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRÉFÉRENCES (localStorage)
// ═══════════════════════════════════════════════════════════════════════════════

/** Charge les préférences depuis localStorage et applique les valeurs aux inputs. */
function loadPreferences() {
  // Pseudo
  const savedUsername = localStorage.getItem(LS_USERNAME) || '';
  $username.value = savedUsername;

  // RAM
  const savedRam = parseInt(localStorage.getItem(LS_RAM) || '4', 10);
  $ramSlider.value = savedRam;
  $ramLabel.textContent = `${savedRam} Go`;

  // Version Minecraft
  const savedVersion = localStorage.getItem(LS_VERSION) || '1.20.1';
  const versionRadio = document.querySelector(`input[name="version"][value="${savedVersion}"]`);
  if (versionRadio) versionRadio.checked = true;

  // Mods activés
  const savedMods = JSON.parse(localStorage.getItem(LS_MODS) || '[]');
  savedMods.forEach((key) => {
    enabledMods.add(key);
    const toggle = document.querySelector(`.mod-toggle[data-key="${key}"]`);
    if (toggle) {
      toggle.checked = true;
      toggle.closest('.option-card')?.classList.add('active');
    }
  });
}

/** Sauvegarde toutes les préférences dans localStorage. */
function savePreferences() {
  localStorage.setItem(LS_USERNAME, $username.value.trim());
  localStorage.setItem(LS_RAM, $ramSlider.value);

  const versionRadio = document.querySelector('input[name="version"]:checked');
  if (versionRadio) localStorage.setItem(LS_VERSION, versionRadio.value);

  localStorage.setItem(LS_MODS, JSON.stringify([...enabledMods]));
}

// ═══════════════════════════════════════════════════════════════════════════════
// GESTION DES MODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Récupère la liste des JARs dans le dossier mods/ et met à jour l'affichage
 * du statut (disponible / non trouvé) pour chaque option.
 */
async function refreshModStatus() {
  try {
    availableJars = await window.launcher.listMods();
  } catch {
    availableJars = [];
  }

  // Mettre à jour le statut de chaque carte d'option
  $optionCards.forEach((card) => {
    const modKey = card.dataset.mod;
    const filePrefix = MOD_FILE_MAP[modKey] || '';
    const statusDot  = card.querySelector('.status-dot');
    const statusText = card.querySelector('.status-text');

    // Vérifier si un JAR correspondant est présent (comparaison insensible à la casse)
    const found = availableJars.some((jar) =>
      jar.toLowerCase().startsWith(filePrefix.toLowerCase())
    );

    if (statusDot && statusText) {
      if (found) {
        statusDot.className = 'status-dot available';
        // Trouver le nom exact du fichier pour l'afficher
        const jar = availableJars.find((j) => j.toLowerCase().startsWith(filePrefix.toLowerCase()));
        statusText.textContent = jar || 'Disponible';
      } else {
        statusDot.className = 'status-dot unavailable';
        statusText.textContent = 'JAR non trouvé dans mods/';
      }
    }
  });
}

/** Met à jour le compteur de mods actifs dans le panneau droit. */
function updateActiveModsCount() {
  const count = enabledMods.size;
  $activeModsCount.textContent = `${count} mod(s) activé(s)`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLE DE LOGS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ajoute une ligne dans la console du launcher.
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} type
 * @param {string} [time]
 */
function appendLog(message, type = 'info', time) {
  const timeStr = time || new Date().toLocaleTimeString();

  const line = document.createElement('div');
  line.className = `log-line log-${type}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = timeStr;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);
  $consoleBody.appendChild(line);

  // Garder un maximum de 200 lignes pour les performances
  while ($consoleBody.children.length > 200) {
    $consoleBody.removeChild($consoleBody.firstChild);
  }

  // Scroller automatiquement vers le bas
  $consoleBody.scrollTop = $consoleBody.scrollHeight;
}

/** Alias court pour appendLog. */
function log(message, type = 'info') {
  appendLog(message, type);
}

/** Vide la console. */
function clearLog() {
  $consoleBody.innerHTML = '';
  log('Console vidée.', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Met à jour la barre de progression.
 * @param {number} percent  0-100
 * @param {string} label
 */
function updateProgress(percent, label) {
  $progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  $progressLabel.textContent = label || '';
}

/** Réinitialise la barre de progression. */
function resetProgress() {
  updateProgress(0, '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANCEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Valide les entrées utilisateur avant le lancement.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateInputs() {
  const username = $username.value.trim();

  if (!username) {
    return { valid: false, error: 'Veuillez entrer un pseudo.' };
  }
  if (username.length < 2) {
    return { valid: false, error: 'Le pseudo doit contenir au moins 2 caractères.' };
  }
  if (username.length > 16) {
    return { valid: false, error: 'Le pseudo ne peut pas dépasser 16 caractères.' };
  }
  // Caractères autorisés : lettres, chiffres, tirets bas
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Le pseudo ne peut contenir que des lettres, chiffres et _.' };
  }

  const version = document.querySelector('input[name="version"]:checked')?.value;
  if (!version) {
    return { valid: false, error: 'Veuillez sélectionner une version.' };
  }

  return { valid: true };
}

/**
 * Lance Minecraft avec les paramètres de l'interface.
 */
async function launchGame() {
  if (isLaunching) return;

  // Validation
  const { valid, error } = validateInputs();
  if (!valid) {
    log(error, 'error');
    shakeElement($btnPlay);
    return;
  }

  const username = $username.value.trim();
  const version  = document.querySelector('input[name="version"]:checked').value;
  const ram      = parseInt($ramSlider.value, 10);
  const mods     = [...enabledMods];

  // Sauvegarder les préférences
  savePreferences();

  // Passer en état "en cours de lancement"
  isLaunching = true;
  $btnPlay.disabled = true;
  showOverlay('Préparation du lancement...');
  resetProgress();

  log('═══════════════════════════════', 'info');
  log(`Lancement de Minecraft ${version}`, 'info');
  log(`Pseudo : ${username}  |  RAM : ${ram}G`, 'info');
  if (mods.length > 0) {
    log(`Mods actifs : ${mods.join(', ')}`, 'info');
  }

  try {
    const result = await window.launcher.launch({ username, version, enabledMods: mods, ram });

    if (result.success) {
      hideOverlay();
      log('Minecraft a démarré !', 'success');
      updateProgress(100, 'Minecraft lancé !');

      // Remettre à zéro après 3 secondes
      setTimeout(() => {
        resetProgress();
        isLaunching = false;
        $btnPlay.disabled = false;
      }, 3000);

    } else {
      throw new Error(result.error || 'Erreur inconnue lors du lancement.');
    }

  } catch (err) {
    hideOverlay();
    log(`Erreur : ${err.message}`, 'error');
    resetProgress();
    isLaunching = false;
    $btnPlay.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERLAY
// ═══════════════════════════════════════════════════════════════════════════════

function showOverlay(text = 'Lancement en cours...') {
  $overlayText.textContent = text;
  $launchOverlay.classList.add('visible');
}

function hideOverlay() {
  $launchOverlay.classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION DE SECOUSSE (feedback d'erreur)
// ═══════════════════════════════════════════════════════════════════════════════

function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // Reflow pour forcer le redémarrage
  el.style.animation = 'shake .4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

// Ajouter l'animation CSS shake dynamiquement (pour ne pas polluer style.css)
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%,60% { transform: translateX(-5px); }
    40%,80% { transform: translateX(5px); }
  }
`;
document.head.appendChild(shakeStyle);

// ═══════════════════════════════════════════════════════════════════════════════
// BINDING DES ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Barre de titre ──────────────────────────────────────────────────────────
$btnMinimize.addEventListener('click', () => window.launcher.minimize());
$btnMaximize.addEventListener('click', () => window.launcher.maximize());
$btnClose.addEventListener('click',    () => window.launcher.close());

// ── Bouton PLAY ─────────────────────────────────────────────────────────────
$btnPlay.addEventListener('click', launchGame);

// Permettre de lancer avec Entrée depuis le champ pseudo
$username.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') launchGame();
});

// ── RAM slider ───────────────────────────────────────────────────────────────
$ramSlider.addEventListener('input', () => {
  $ramLabel.textContent = `${$ramSlider.value} Go`;
});
$ramSlider.addEventListener('change', savePreferences);

// ── Pseudo ──────────────────────────────────────────────────────────────────
$username.addEventListener('input', savePreferences);

// ── Sélection de version ─────────────────────────────────────────────────────
document.querySelectorAll('input[name="version"]').forEach((radio) => {
  radio.addEventListener('change', savePreferences);
});

// ── Toggles mods ─────────────────────────────────────────────────────────────
$modToggles.forEach((toggle) => {
  toggle.addEventListener('change', () => {
    const key = toggle.dataset.key;
    const card = toggle.closest('.option-card');

    if (toggle.checked) {
      enabledMods.add(key);
      card?.classList.add('active');
    } else {
      enabledMods.delete(key);
      card?.classList.remove('active');
    }

    updateActiveModsCount();
    savePreferences();
  });
});

// ── Ouvrir dossier mods ──────────────────────────────────────────────────────
$btnOpenMods.addEventListener('click', async () => {
  await window.launcher.openModsFolder();
  // Rafraîchir le statut des mods après ouverture du dossier
  setTimeout(() => refreshModStatus(), 1500);
});

// ── Vider la console ─────────────────────────────────────────────────────────
$btnClearLog.addEventListener('click', clearLog);

// ── Rafraîchir le statut des mods toutes les 10 secondes ────────────────────
// (utile si l'utilisateur copie des fichiers dans mods/ pendant que le launcher est ouvert)
setInterval(refreshModStatus, 10_000);

// ─── Démarrage ───────────────────────────────────────────────────────────────
init();
