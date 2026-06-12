'use strict';

const $username = document.getElementById('username');
const $ram = document.getElementById('ram-slider');
const $ramLabel = document.getElementById('ram-label');
const $btnPlay = document.getElementById('btn-play');

const $log = document.getElementById('console-body');
const $progress = document.getElementById('progress-fill');
const $progressLabel = document.getElementById('progress-label');

let mods = new Set();
let launching = false;

function log(msg, type = 'info') {
  const div = document.createElement('div');
  div.textContent = `[${type}] ${msg}`;
  $log.appendChild(div);
  $log.scrollTop = $log.scrollHeight;
}

window.launcher.onLog(d => log(d.message, d.type));
window.launcher.onProgress(d => {
  $progress.style.width = d.percent + '%';
  $progressLabel.textContent = d.label;
});

$ram.addEventListener('input', () => {
  $ramLabel.textContent = $ram.value + ' Go';
});

async function launch() {
  if (launching) return;
  launching = true;

  const username = $username.value;
  const ram = parseInt($ram.value);

  const version = document.querySelector('input[name="version"]:checked').value;

  const enabledMods = [...mods];

  const res = await window.launcher.launch({
    username,
    version,
    enabledMods,
    ram
  });

  if (!res.success) {
    log(res.error, 'error');
  }

  launching = false;
}

$btnPlay.onclick = launch;
