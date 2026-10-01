/* Popup kontrol extension Request Lagu. */
'use strict';

const $ = (id) => document.getElementById(id);

async function api(path, method = 'GET', body) {
  const r = await chrome.runtime.sendMessage({ type: 'api', path, method, body });
  if (!r) throw new Error('Extension tidak terhubung.');
  if (r.status === 0 || r.status >= 400) {
    throw new Error((r.data && r.data.error) || `HTTP ${r.status}`);
  }
  return r.data;
}

function loadConfig() {
  return chrome.runtime.sendMessage({ type: 'config' }).then((c) => {
    $('code').value = c.djCode || '';
    if (!c.hasCode) {
      $('saveNote').className = 'note err';
      $('saveNote').textContent = 'Isi kode DJ dulu agar lagu bisa lanjut otomatis.';
    }
    return c;
  });
}

async function refresh() {
  try {
    const st = await api('/api/state');
    const playing = st.tracks.find((t) => t.status === 'playing') || null;
    const queued = st.tracks.filter((t) => t.status === 'queued').length;

    $('nowTitle').textContent = playing
      ? playing.title + (playing.artist ? ` — ${playing.artist}` : '')
      : 'Tidak ada';
    $('queueInfo').textContent = queued ? `${queued} lagu menunggu di antrean` : 'Antrean kosong';

    // player kosong ({} dari server) = belum ada pemutar yang melapor
    const p = st.player && st.player.status ? st.player : null;
    $('playerInfo').innerHTML = p
      ? `<b>Player: ${escapeHtml(p.status)}</b>${p.detail ? ` — ${escapeHtml(p.detail)}` : ''}`
      : '<b>Player: nonaktif</b> (buka tab YouTube Music)';

    $('autoBtn').disabled = false;
    $('autoBtn').textContent = st.autoNext ? 'Auto-play: NYALA' : 'Auto-play: MATI';
    $('autoBtn').style.color = st.autoNext ? '#7bd39a' : '#e0453c';
    $('conn').textContent = 'tersambung';
  } catch (err) {
    $('conn').textContent = 'terputus';
    $('playerInfo').textContent = err.message;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function toggleAuto() {
  try {
    const st = await api('/api/state');
    await api('/api/dj/auto', 'POST', { enabled: !st.autoNext });
    await refresh();
  } catch (err) {
    $('conn').textContent = err.message;
  }
}

async function save() {
  const djCode = $('code').value.trim();
  await chrome.runtime.sendMessage({ type: 'save', values: { djCode } });
  const note = $('saveNote');
  try {
    if (djCode) await api('/api/login', 'POST', { code: djCode }); // verifikasi kode
    note.className = 'note ok';
    note.textContent = 'Tersimpan — kode DJ valid.';
  } catch (err) {
    note.className = 'note err';
    note.textContent = err.message;
    return;
  }
  await refresh();
}

$('saveBtn').addEventListener('click', save);
$('autoBtn').addEventListener('click', toggleAuto);
$('openBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://music.youtube.com' });
});

loadConfig().then(refresh);
setInterval(refresh, 4000);
