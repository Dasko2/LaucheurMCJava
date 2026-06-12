const $username = document.getElementById('username');
const $ram = document.getElementById('ram-slider');
const $btn = document.getElementById('btn-play');

let mods = new Set();

window.launcher.onLog(d => console.log(d.message));

window.launcher.onProgress(d => {
  document.getElementById('progress-fill').style.width = d.percent + '%';
  document.getElementById('progress-label').textContent = d.label;
});

$btn.onclick = async () => {
  const username = $username.value;
  const ram = parseInt($ram.value);
  const version =
    document.querySelector('input[name="version"]:checked').value;

  const res = await window.launcher.launch({
    username,
    version,
    enabledMods: [...mods],
    ram,
    online: true
  });

  if (!res.success) console.error(res.error);
};
