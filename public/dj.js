/* Panel DJ: moderasi antrean, pengaturan acara, dan pemutar lagu. */
'use strict';

const TOKEN_KEY = 'requestlagu.dj';
const USER_KEY = 'requestlagu.user';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
/** @type {{username:string,nama:string,peran:string}|null} */
let user = null;
try {
  user = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
} catch { user = null; }

/** admin boleh kelola; user biasa hanya request via halaman tamu. */
function bisaKelola() {
  return Boolean(user && user.peran === 'admin');
}
let state = null;
let settingsSynced = false;

/* current source */
let currentSourceId = null;   // track yang sedang di-playback
let ytPlayer = null;
let ytPromise = null;
let advancing = false;

/* Hanya satu panel DJ yang boleh memutar. Id panel dibuat per tab dan disimpan
 * di sessionStorage agar tetap sama saat panel dimuat ulang. */
const PANEL_KEY = 'requestlagu.panel';
let panelId = sessionStorage.getItem(PANEL_KEY) || '';
if (!panelId) {
  panelId = `panel_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
  sessionStorage.setItem(PANEL_KEY, panelId);
}

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ utilitas */

/**
 * Urutan antrean = urutan vote dari server (state.order); cadangan: hitung
 * sendiri (vote terbanyak, lalu yang lebih dulu masuk). Sama dengan urutan
 * yang dipakai server, halaman tamu, dan extension.
 */
function urutAntrean(tracks) {
  const order = (state && state.order) || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  const votes = (t) => Object.keys(t.votes || {}).length;
  return tracks.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return votes(b) - votes(a) || a.createdAt - b.createdAt;
  });
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
function toast(message, tone = 'ok') {
  const node = $('toast');
  node.textContent = message;
  node.dataset.tone = tone;
  node.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.dataset.show = 'false'; }, 3400);
}

async function api(path, method = 'POST', body = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dj-token': token },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout(false);
    throw new Error('Sesi DJ berakhir. Masuk ulang.');
  }
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}

function trackAction(id, action, extra = {}) {
  return api(`/api/dj/track/${id}`, 'POST', { action, ...extra });
}

/* --------------------------------------------------------------- login */

function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('userMenu').hidden = false;
  $('userChip').textContent = user
    ? (user.peran === 'admin' ? `${user.nama} (admin)` : user.nama)
    : '';
  // pengaturan acara hanya untuk admin; ganti password untuk semua user
  $('settingsBox').hidden = !bisaKelola();
  syncSettings();
}

function logout(notify = true) {
  if (token) {
    api('/api/player/release', 'POST', { panel: panelId }).catch(() => {});
  }
  token = '';
  user = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('userMenu').hidden = true;
  $('userMenu').removeAttribute('open');
  $('userChip').textContent = '';
  stopPlayback();
  if (notify) toast('Kamu sudah keluar dari panel DJ.');
}

/** Menu akun tertutup saat klik di luar atau menekan Esc. */
function setupUserMenu() {
  const menu = $('userMenu');
  document.addEventListener('click', (e) => {
    if (menu.hasAttribute('open') && !menu.contains(e.target)) {
      menu.removeAttribute('open');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.hasAttribute('open')) {
      menu.removeAttribute('open');
      const trigger = menu.querySelector('summary');
      if (trigger) trigger.focus();
    }
  });
}

function setupLogin() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = $('loginNote');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: $('loginUser').value.trim(),
          password: $('loginPass').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal masuk.');
      if (data.peran !== 'admin') {
        // panel DJ sekarang admin-only: user biasa tidak boleh masuk ke sini
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        note.dataset.tone = 'error';
        note.textContent = `Kamu masuk sebagai ${data.nama}, tapi panel DJ hanya untuk admin. Request lagu lewat halaman tamu ya.`;
        $('toGuestBtn').hidden = false;
        $('loginPass').value = '';
        return;
      }
      token = data.token;
      user = { username: data.username, nama: data.nama, peran: data.peran };
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      note.textContent = '';
      $('toGuestBtn').hidden = true;
      $('loginUser').value = '';
      $('loginPass').value = '';
      showApp();
      muatAdzan();
      // tidak auto-klaim: DJ memilih sendiri device mana yang jadi pemutar
      // utama lewat tombol "Jadikan ini pemutar utama" (atau "Ambil kendali").
      toast(`Masuk sebagai ${user.nama}. Tekan "Jadikan ini pemutar utama" di device yang akan memutar lagu.`);
      if (state) render();
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    }
  });
  $('logoutBtn').addEventListener('click', () => logout());
}

/* -------------------------------------------------------------- player */

function loadYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('Player YouTube gagal dimuat (butuh internet).'));
      document.head.append(script);
      setTimeout(() => { if (window.YT && window.YT.Player) resolve(window.YT); }, 9000);
    });
  }
  return ytPromise;
}

function showHint(lines) {
  const hint = $('playerHint');
  hint.replaceChildren(...lines.map((line) => el('p', { text: line, style: 'margin:4px 0' })));
  hint.hidden = false;
}

function stopPlayback() {
  const audio = $('audioEl');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.hidden = true;
  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    try { ytPlayer.stopVideo(); } catch { /* abaikan */ }
  }
  currentSourceId = null;
  // sembunyikan kotak video supaya thumbnail video lama tidak nyangkut
  $('playerFrame').hidden = true;
  $('playerEmpty').hidden = false;
  // hapus iframe bekas video (thumbnail). destroy() mengganti node #ytHost
  // jadi iframe milik YouTube; setelah dihancurkan, wadahnya hilang dan harus
  // dibuat ulang supaya player berikutnya bisa diciptakan.
  const hostLama = $('ytHost');
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    try { ytPlayer.destroy(); } catch { /* abaikan */ }
    ytPlayer = null;
  }
  if (hostLama && hostLama.parentNode) hostLama.remove();
  if (!$('ytHost')) {
    const host = document.createElement('div');
    host.id = 'ytHost';
    $('playerFrame').insertBefore(host, $('playerHint'));
  }
}

/**
 * Panel DJ LAIN sedang memegang pemutar (detaknya masih segar). Panel ini
 * harus diam supaya tidak ada dua suara sekaligus — tekan "Ambil kendali"
 * kalau DJ ingin memutar dari panel ini.
 */
function playerManaged() {
  return Boolean(
    state && state.player && state.player.panel
    && state.player.panel !== panelId
    && Date.now() - state.player.updatedAt < 12000,
  );
}

/** Device/tab ini sedang memegang kendali sebagai pemutar utama. */
function kitaPegang() {
  return Boolean(state && state.player && state.player.panel === panelId);
}

/** Klaim kepemilikan pemutar. Mengembalikan true kalau panel ini pegang. */
async function klaimKendali(paksa = false) {
  try {
    const res = await api('/api/player/claim', 'POST', { panel: panelId, paksa });
    // langsung perbarui state lokal supaya UI (chip, renderNow) konsisten
    if (res && res.player) state.player = res.player;
    return true;
  } catch (err) {
    return false; // 409 = panel lain yang memegang
  }
}

/** Detak status pemutar ke server (hanya pemegang yang melapor). */
async function detakPemutar() {
  if (!token || !state) return;
  const pegang = Boolean(state.player && state.player.panel === panelId);
  if (!pegang) return; // hanya pemegang yang melapor
  const playing = state.tracks.find((t) => t.status === 'playing') || null;
  const audio = $('audioEl');
  let status = playing ? 'memutar' : (state.autoNext ? 'siap' : 'jeda');
  let detail = playing ? playing.title : '';
  if (playing && playing.audio && audio.paused) status = 'jeda';
  else if (playing && !playing.audio && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
    if (ytPlayer.getPlayerState() === 2 /* PAUSED */) status = 'jeda';
  }
  try {
    await api('/api/player/status', 'POST', {
      status, detail,
      trackId: playing ? playing.id : '',
      panel: panelId,
    });
  } catch { /* server sibuk — coba detak berikutnya */ }
}

/** Putar video YT — tangani browser yang memblokir autoplay suara. */
function mainkanVideo() {
  if (!ytPlayer) return;
  try {
    const pr = ytPlayer.playVideo();
    if (pr && typeof pr.catch === 'function') {
      pr.catch(() => showHint([
        'Browser memblokir autoplay suara.',
        'Tekan tombol play di pemutar, atau "Putar berikutnya".',
      ]));
    }
  } catch { /* abaikan */ }
}

function startPlayback(track) {
  const audio = $('audioEl');
  const frame = $('playerFrame');
  const hint = $('playerHint');
  currentSourceId = track.id;
  hint.hidden = true;
  // ada lagu yang diputar → sembunyikan placeholder kosong
  $('playerEmpty').hidden = true;

  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    try { ytPlayer.stopVideo(); } catch { /* abaikan */ }
  }
  audio.pause();
  audio.removeAttribute('src');

  if (track.audio) {
    frame.hidden = true;
    audio.hidden = false;
    audio.src = `/audio/${encodeURIComponent(track.audio)}`;
    audio.play().catch(() => {
      $('nowNote').textContent = 'Browser memblokir autoplay — tekan tombol play di pemutar.';
    });
    return;
  }

  frame.hidden = false;
  audio.hidden = true;

  if (!track.yt) {
    showHint(['Belum ada sumber audio.', 'Pakai "Cari otomatis" atau tempel link YouTube di kotak Sumber.']);
    return;
  }

  loadYTApi()
    .then((YT) => {
      if (currentSourceId !== track.id) return;
      if (!ytPlayer) {
        ytPlayer = new YT.Player('ytHost', {
          videoId: track.yt,
          // modestbranding+rel+iv_load_policy: kurangi logo & kartu promosi YouTube,
          // ads:0 & disablekb: mainkan video tanpa iklan yang bisa dilewati dari sini.
          playerVars: {
            autoplay: 1, rel: 0, playsinline: 1,
            modestbranding: 1, iv_load_policy: 3, showinfo: 0, disablekb: 1,
          },
          events: {
            onReady: () => mainkanVideo(),
            onStateChange: (event) => {
              if (event.data === 0 /* ENDED */ && currentSourceId) advance();
            },
            onError: () => {
              if (!currentSourceId) return;
              toast('Video tidak bisa diputar — dilompati ke lagu berikutnya.', 'error');
              advance();
            },
          },
        });
      } else {
        ytPlayer.loadVideoById(track.yt);
        mainkanVideo();
      }
    })
    .catch((err) => showHint([err.message]));
}

async function advance() {
  if (advancing) return;
  if (adzan.aktif) {
    toast('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
    return;
  }
  advancing = true;
  try {
    const result = await api('/api/dj/advance', 'POST', {});
    if (!result.playing) {
      stopPlayback();
      $('nowNote').textContent = 'Antrean selesai. Tidak ada lagu berikutnya.';
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    advancing = false;
  }
}

function setupPlayerControls() {
  $('nextBtn').addEventListener('click', advance);
  $('stopBtn').addEventListener('click', async () => {
    if (!state) return;
    const playing = state.tracks.find((t) => t.status === 'playing');
    try {
      await api('/api/dj/auto', 'POST', { enabled: false }); // matikan auto-play
    } catch (err) { toast(err.message, 'error'); return; }
    if (!playing) {
      stopPlayback();
      $('nowNote').textContent = 'Auto-play dijeda. Tekan "Putar berikutnya" untuk lanjut.';
      return;
    }
    try {
      await trackAction(playing.id, 'done');
      stopPlayback();
      $('nowNote').textContent = 'Dihentikan. Tekan "Putar berikutnya" untuk lanjut.';
    } catch (err) { toast(err.message, 'error'); }
  });
  $('audioEl').addEventListener('ended', () => { if (currentSourceId) advance(); });

  $('ambilKendali').addEventListener('click', async () => {
    const pegang = await klaimKendali(true);
    if (pegang) {
      toast('Kendali pemutar diambil device ini.');
      detakPemutar();
      if (state) render();
    } else {
      toast('Gagal mengambil kendali.', 'error');
    }
  });

  // Tombol utama: jadikan device (tab panel DJ) ini sebagai "server pemutar"
  // terpusat. Semua lagu diputar dari sini, device lain hanya mengikuti antrean.
  $('jadiPemutar').addEventListener('click', async () => {
    const pegang = await klaimKendali(false);
    if (pegang) {
      toast('Device ini sekarang pemutar utama. Lagu dipusatkan di sini.');
      detakPemutar();
      if (state) {
        render();
        // langsung bunyikan kalau ada lagu playing yang belum dibunyikan di sini
        const playing = state.tracks.find((t) => t.status === 'playing');
        if (playing && !currentSourceId && !playerManaged()) startPlayback(playing);
      }
    } else {
      toast('Device lain sedang memutar. Tekan "Ambil kendali" untuk memaksa.', 'error');
    }
  });
}

/* -------------------------------------------------------- sumber audio */

async function resolveAndAssign(track, query) {
  toast('Mencari di YouTube…');
  try {
    const found = await api(`/api/yt-search?q=${encodeURIComponent(query)}`, 'POST', {});
    const result = await trackAction(track.id, 'link', { yt: found.id });
    toast(`Sumber disetel: ${found.title || query}`);
    if (currentSourceId === track.id) startPlayback({ ...result.track, audio: '' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function sourceControls(track) {
  const select = el('select', {
    'aria-label': 'File audio lokal',
    style: 'background:rgba(0,0,0,.3);border:1px solid var(--line);color:var(--text);padding:8px;border-radius:3px',
  }, [el('option', { value: '', text: '— pilih file di audio/ —' })]);

  const applyBtn = el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button', text: 'Pakai file ini',
    onclick: async () => {
      try {
        await trackAction(track.id, 'audio', { file: select.value });
        toast(select.value ? `Memakai file ${select.value}` : 'Sumber file dilepas.');
        if (currentSourceId === track.id) startPlayback({ ...track, audio: select.value, yt: '' });
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  const details = el('details', { class: 'settings', style: 'grid-column:1/-1;padding:10px 12px;margin-top:6px' }, [
    el('summary', { style: 'font-size:0.8rem', text: 'Sumber audio' }),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center' }, [
      el('button', {
        class: 'btn btn--amber btn--sm', type: 'button',
        text: 'Cari otomatis di YouTube',
        onclick: () => resolveAndAssign(track, `${track.title} ${track.artist || ''}`.trim()),
      }),
      el('input', {
        type: 'url', placeholder: 'tempel link YouTube', 'aria-label': 'Link YouTube',
        style: 'flex:1 1 220px;min-width:180px;background:rgba(0,0,0,.3);border:1px solid var(--line);color:var(--text);padding:8px;border-radius:3px',
        onchange: async (e) => {
          try {
            await trackAction(track.id, 'link', { yt: e.target.value });
            toast('Link YouTube disimpan.');
            if (currentSourceId === track.id) startPlayback({ ...track, yt: e.target.value, audio: '' });
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      select,
      applyBtn,
    ]),
    el('p', {
      style: 'margin:8px 0 0;font-size:0.78rem;color:var(--text-dim)',
      text: 'Letakkan file mp3 di folder audio/ lalu muat ulang halaman ini.',
    }),
  ]);

  details.addEventListener('toggle', async () => {
    if (!details.open || select.dataset.loaded) return;
    select.dataset.loaded = '1';
    try {
      const data = await api('/api/audio-files', 'POST', {});
      for (const file of data.files) select.append(el('option', { value: file, text: file }));
    } catch { /* diamkan */ }
  });

  return details;
}

/* --------------------------------------------------------------- render */

function syncSettings() {
  if (!state || settingsSynced) return;
  $('evName').value = state.event.name;
  $('evTagline').value = state.event.tagline;
  settingsSynced = true;
}

function toggleSwitch({ key, label, hint }) {
  const on = Boolean(state.event[key]);
  const button = el('button', {
    class: 'switch', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
    'aria-label': label,
    onclick: async () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', next ? 'true' : 'false');
      try { await api('/api/event', 'PATCH', { [key]: next }); }
      catch (err) { toast(err.message, 'error'); }
    },
  });
  return el('div', { class: 'toggle-row' }, [
    el('span', {}, [label, el('small', { text: hint })]),
    button,
  ]);
}

function rowActions(track) {
  const actions = el('div', { class: 'row__actions' });
  const add = (label, cls, fn) => actions.append(el('button', { class: `btn ${cls} btn--sm`, type: 'button', text: label, onclick: fn }));

  const run = async (action, okMessage) => {
    if (action === 'play' && adzan.aktif) {
      toast('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
      return;
    }
    try {
      await trackAction(track.id, action);
      if (okMessage) toast(okMessage);
    } catch (err) { toast(err.message, 'error'); }
  };

  if (track.status === 'pending') {
    if (bisaKelola()) {
      add('Setujui', 'btn--amber', () => run('approve', `“${track.title}” disetujui.`));
      add('Tolak', 'btn--danger', () => run('reject', 'Request ditolak.'));
    }
  } else if (track.status === 'queued') {
    add('Putar', 'btn--amber', () => run('play', `Memutar “${track.title}”.`));
    if (bisaKelola()) {
      add('Naik', 'btn--ghost', () => run('up'));
      add('Turun', 'btn--ghost', () => run('down'));
      add('Tolak', 'btn--danger', () => run('reject', 'Request ditolak.'));
    }
  } else if (track.status === 'done') {
    add('Putar lagi', 'btn--ghost', () => run('play'));
  }
  return actions;
}

function queueRow(track, number) {
  const voteCount = Object.keys(track.votes || {}).length;
  const tagTone = track.status === 'playing' ? 'live' : track.status === 'pending' ? 'wait' : '';
  const tagLabel = track.status === 'pending' ? 'Menunggu' : track.status === 'playing' ? 'Diputar' : '';

  return el('article', { class: 'row', 'data-status': track.status }, [
    el('div', { class: 'row__no', text: number == null ? '—' : String(number) }),
    el('div', { class: 'row__body' }, [
      el('div', { class: 'row__title', text: track.title }),
      track.artist ? el('div', { class: 'row__artist', text: track.artist }) : null,
      el('div', { class: 'row__meta' }, [
        el('span', { text: track.requester || 'Tamu' }),
        voteCount ? el('span', { text: `${voteCount} vote` }) : null,
        track.audio ? el('span', { text: `file: ${track.audio}` }) : null,
        track.yt && !track.audio ? el('span', { text: 'sumber: YouTube' }) : null,
        !track.yt && !track.audio ? el('span', { text: 'belum ada sumber' }) : null,
        tagLabel ? el('span', { class: 'row__tag', 'data-tone': tagTone, text: tagLabel }) : null,
        track.message ? el('span', { class: 'msg', text: `“${track.message}”` }) : null,
      ]),
      track.status !== 'done' && track.status !== 'playing' && bisaKelola() ? sourceControls(track) : null,
    ]),
    rowActions(track),
  ]);
}

function renderNow() {
  const playing = state.tracks.find((t) => t.status === 'playing') || null;
  $('nowTitle').textContent = playing ? playing.title : 'Tidak ada';
  $('nowArtist').textContent = playing ? playing.artist || '' : '';
  $('nowFrom').textContent = playing ? `diminta oleh ${playing.requester || 'Tamu'}` : 'Tekan "Putar berikutnya" untuk mulai.';

  // strip konsol: lampu udara menyala selama ada lagu yang diputar
  const strip = $('deckStrip');
  strip.dataset.onair = playing ? 'true' : 'false';
  $('deckAirText').textContent = playing ? 'Mengudara' : 'Siaga';

  // lagu berikutnya menurut urutan vote — sama dengan antrean YouTube Music
  const nextUp = $('nextUp');
  const berikutnya = urutAntrean(state.tracks.filter((t) => t.status === 'queued'))[0] || null;
  if (berikutnya) {
    const v = Object.keys(berikutnya.votes || {}).length;
    nextUp.hidden = false;
    nextUp.textContent = `Berikutnya: ${berikutnya.title}${berikutnya.artist ? ` — ${berikutnya.artist}` : ''}${v ? ` (${v} vote)` : ''}`;
  } else {
    nextUp.hidden = true;
  }

  const sourceRow = $('sourceRow');
  if (playing && bisaKelola()) {
    sourceRow.hidden = false;
    $('sourceMeta').replaceChildren(
      el('span', {
        text: playing.audio ? `File lokal: ${playing.audio}` : playing.yt ? `YouTube: ${playing.yt}` : 'Belum ada sumber',
      }),
    );
    $('sourceActions').replaceChildren(
      el('button', {
        class: 'btn btn--amber btn--sm', type: 'button', text: 'Cari otomatis di YouTube',
        onclick: () => resolveAndAssign(playing, `${playing.title} ${playing.artist || ''}`.trim()),
      }),
      el('input', {
        type: 'url', placeholder: 'tempel link YouTube', 'aria-label': 'Link YouTube',
        style: 'flex:1 1 180px;background:rgba(0,0,0,.3);border:1px solid var(--line);color:var(--text);padding:7px;border-radius:3px',
        onchange: async (e) => {
          try {
            await trackAction(playing.id, 'link', { yt: e.target.value });
            toast('Link YouTube disimpan.');
            if (currentSourceId === playing.id) startPlayback({ ...playing, yt: e.target.value, audio: '' });
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
    );
  } else {
    sourceRow.hidden = true;
  }

  if (playerManaged()) {
    // device lain pegang kendali: berhenti walau lagunya sama (cuma 1 suara)
    if (currentSourceId) {
      stopPlayback();
    }
    $('nowNote').textContent = 'Diputar di device lain — tekan "Ambil kendali" untuk memutar di sini.';
  } else if (playing && playing.id !== currentSourceId) {
    $('nowNote').textContent = '';
    if (kitaPegang()) {
      startPlayback(playing);
    } else {
      // belum ada device pemutar utama → jangan bunyikan di sini dulu
      stopPlayback();
      $('nowNote').textContent = 'Tekan "Jadikan ini pemutar utama" untuk memusatkan pemutaran di device ini.';
    }
  } else if (!playing && currentSourceId) {
    stopPlayback();
  }
}

function render() {
  if (!state) return;
  const { event, tracks } = state;

  $('brand').textContent = event.name;
  document.title = `Panel DJ — ${event.name}`;
  $('liveBadge').dataset.open = event.open ? 'true' : 'false';
  $('liveText').textContent = event.open ? 'Request dibuka' : 'Request ditutup';

  syncSettings();

  const pending = tracks.filter((t) => t.status === 'pending');
  const queued = urutAntrean(tracks.filter((t) => t.status === 'queued'));
  const done = tracks.filter((t) => t.status === 'done');
  const playing = tracks.find((t) => t.status === 'playing');

  $('queueCount').textContent = `${pending.length + queued.length} menunggu`;

  const pendingList = $('pendingList');
  pendingList.replaceChildren(...[
    pending.length
      ? el('h3', { class: 'section-title', style: 'font-size:1rem', text: `Menunggu persetujuan (${pending.length})` })
      : null,
    ...pending.map((t) => queueRow(t, null)),
  ].filter(Boolean));

  const queuedList = $('queuedList');
  queuedList.replaceChildren(...[
    queued.length || playing
      ? el('h3', { class: 'section-title', style: 'font-size:1rem', text: 'Antrean diputar' })
      : null,
    ...(playing ? [queueRow(playing, null)] : []),
    ...queued.map((t, i) => queueRow(t, i + 1)),
  ].filter(Boolean));

  const doneWrap = $('doneWrap');
  doneWrap.hidden = done.length === 0;
  $('doneSummary').textContent = `Selesai (${done.length})`;
  if (done.length) {
    $('doneList').replaceChildren(...done.slice(-15).reverse().map((t) => queueRow(t, null)));
  }

  $('emptyQueue').hidden = pending.length + queued.length + (playing ? 1 : 0) > 0;

  // toggle pengaturan hanya dirender untuk admin (panel DJ admin-only)
  const toggles = $('toggles');
  if (bisaKelola()) {
    toggles.replaceChildren(
      toggleSwitch({ key: 'open', label: 'Buka request tamu', hint: 'Penonton bisa mengirim slip request' }),
      toggleSwitch({ key: 'autoApprove', label: 'Setujui otomatis', hint: 'Request langsung masuk antrean' }),
      toggleSwitch({ key: 'allowVotes', label: 'Voting antrean', hint: 'Tamu bisa vote lagu favorit' }),
      toggleSwitch({ key: 'allowMessages', label: 'Pesan/dedikasi', hint: 'Tamu bisa melampirkan pesan' }),
    );
  } else {
    toggles.replaceChildren();
  }

  renderPlayerChip();
  renderNow();
  mungkinPutarOtomatis();
}

/**
 * Pengganti extension: kalau tidak ada lagu yang sedang diputar, auto-play
 * aktif, dan panel ini yang memegang kendali → ambil lagu berikutnya dari
 * urutan vote. Hanya sekali per perubahan agar tidak dobel.
 */
let autoPlayTerakhir = 0;
async function mungkinPutarOtomatis() {
  if (!token || !state || advancing) return;
  if (adzan.aktif) return; // hormati jeda adzan, jangan auto-play sekarang
  if (Date.now() - autoPlayTerakhir < 3000) return;
  const playing = state.tracks.find((t) => t.status === 'playing');
  if (playing) return;
  if (!state.autoNext) return;
  if (!kitaPegang()) return; // hanya device pemegang yang boleh auto-play
  const antri = urutAntrean(state.tracks.filter((t) => t.status === 'queued'));
  if (!antri.length) return;
  autoPlayTerakhir = Date.now();
  await advance();
}

/** Chip status mesin pemutar di tab YouTube Music. */
function renderPlayerChip() {
  const chip = $('playerChip');
  if (!chip) return;
  const p = state.player;
  const fresh = Boolean(p && Date.now() - p.updatedAt < 12000);
  const tones = { memutar: 'play', siap: 'ok', jeda: 'pause', error: 'error' };
  chip.dataset.tone = p && fresh ? (tones[p.status] || 'ok') : p ? 'stale' : 'off';
  chip.textContent = p
    ? `Player: ${fresh ? p.status : 'terputus'}${p.detail ? ` — ${p.detail}` : ''}`
    : 'Player: nonaktif';
  renderKendaliChip();
}

/**
 * Chip kepemilikan pemutar: device mana yang jadi pemutar utama (server
 * pemutar). Kalau device lain, DJ bisa mengambil alih lewat tombol.
 */
function renderKendaliChip() {
  const chip = $('kendaliChip');
  if (!chip) return;
  const p = state.player || null;
  const ada = Boolean(p && p.panel);
  const fresh = Boolean(ada && Date.now() - p.updatedAt < 12000);
  const milikKita = ada && p.panel === panelId;
  const jadi = $('jadiPemutar');
  const ambil = $('ambilKendali');
  if (milikKita) {
    chip.dataset.tone = 'play';
    chip.textContent = 'Pemutar: device ini';
  } else if (fresh) {
    chip.dataset.tone = 'pause';
    chip.textContent = 'Pemutar: device lain';
  } else {
    chip.dataset.tone = 'off';
    chip.textContent = 'Pemutar: belum diatur';
  }
  // tombol "Jadikan ini pemutar utama" muncul hanya kalau belum ada device
  // lain yang sedang memutar (kalau ada, pakai "Ambil kendali" saja)
  if (jadi) jadi.hidden = milikKita || fresh;
  // "Ambil kendali" (paksa) hanya kalau device lain sedang pegang
  if (ambil) ambil.hidden = !fresh || milikKita;
}

/* ------------------------------------------------------- koneksi SSE */

/** Teks status koneksi + lampunya (warna tak pernah berdiri sendiri). */
function setConn(tersambung) {
  const node = $('connState');
  node.textContent = tersambung ? 'tersambung' : 'menyambung ulang…';
  node.dataset.state = tersambung ? 'ok' : 'error';
}

function applyState(raw) {
  try {
    state = JSON.parse(raw);
    if (state) setConn(true);
    if (token) render();
  } catch { /* abaikan */ }
}

let pollTimer = null;

/** Polling cadangan bila SSE tidak tersedia (mis. di Vercel). */
function startPolling() {
  if (pollTimer) return;
  const tick = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      applyState(await res.text());
    } catch {
      setConn(false);
    }
  };
  tick();
  pollTimer = setInterval(tick, 2500);
}

function connect() {
  const source = new EventSource('/api/events');
  source.onopen = () => setConn(true);
  source.onmessage = (event) => applyState(event.data);
  source.onerror = () => {
    // SSE tidak tersedia (mode daring) → tutup & beralih ke polling.
    source.close();
    setConn(false);
    startPolling();
  };
}

/* ------------------------------------------------------------- pengaturan */

function setupSettings() {
  $('saveSettings').addEventListener('click', async () => {
    if (!bisaKelola()) { toast('Akun kamu tidak bisa mengubah pengaturan.', 'error'); return; }
    try {
      await api('/api/event', 'PATCH', {
        name: $('evName').value.trim(),
        tagline: $('evTagline').value.trim(),
      });
      toast('Pengaturan disimpan.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('clearDone').addEventListener('click', async () => {
    try { await api('/api/dj/clear-done', 'POST', {}); toast('Riwayat dibersihkan.'); }
    catch (err) { toast(err.message, 'error'); }
  });

  $('clearAll').addEventListener('click', async () => {
    if (!confirm('Kosongkan semua request selain yang sedang diputar?')) return;
    try { await api('/api/dj/clear-all', 'POST', {}); toast('Antrean dikosongkan.'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

/* ----------------------------------------------------------- ganti password */

function setupPassword() {
  $('passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = $('passNote');
    const baru = $('passBaru').value;
    if (baru !== $('passBaru2').value) {
      note.dataset.tone = 'error';
      note.textContent = 'Password baru tidak sama di kedua kotak.';
      return;
    }
    try {
      const data = await api('/api/dj/password', 'POST', {
        passwordLama: $('passLama').value,
        passwordBaru: baru,
      });
      // password berubah → token lama hangus, simpan token pengganti
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      note.dataset.tone = 'ok';
      note.textContent = 'Password diganti. Sesi lain di device berbeda sudah dihapuskan.';
      $('passLama').value = '';
      $('passBaru').value = '';
      $('passBaru2').value = '';
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    }
  });
}

/* --------------------------------------------------- adzan otomatis */

const ADZAN_NAMA = { Fajr: 'Subuh', Dhuhr: 'Dzuhur', Asr: 'Ashar', Maghrib: 'Maghrib', Isha: 'Isya' };
let adzan = {
  jadwal: null,      // { Fajr: '04:35', ... } dalam waktu lokal lokasi
  durasi: 10,        // menit jeda otomatis
  enabled: true,
  aktif: false,      // sedang dalam jeda adzan sekarang
  diputarSebelum: null, // lagu sedang berjalan saat adzan masuk?
};

function tanggalLocal() {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

async function muatAdzan() {
  try {
    const res = await fetch(`/api/adzan?tanggal=${encodeURIComponent(tanggalLocal())}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal memuat jadwal adzan.');
    adzan.jadwal = data.jadwal || null;
    adzan.durasi = Number(data.durasi) || 10;
    adzan.enabled = data.enabled !== false;
    adzan.tanggal = tanggalLocal();
  } catch { /* belum disetel atau offline — diam saja */ }
  renderAdzanSetting();
  cekAdzan();
}

/** Apakah sekarang sedang dalam jeda adzan (menit-menit setelah jadwal masuk). */
function statusAdzan() {
  if (!adzan.enabled || !adzan.jadwal) return { aktif: false };
  const sekarang = new Date();
  const menit = sekarang.getHours() * 60 + sekarang.getMinutes();
  for (const [key, jam] of Object.entries(adzan.jadwal)) {
    const bagian = String(jam).split(':').map(Number);
    if (bagian.length < 2 || bagian.some((n) => !Number.isFinite(n))) continue;
    const mulai = bagian[0] * 60 + bagian[1];
    const selesai = mulai + adzan.durasi;
    if (menit >= mulai && menit < selesai) {
      return { aktif: true, nama: ADZAN_NAMA[key] || key, selesai };
    }
  }
  return { aktif: false };
}

function cekAdzan() {
  const s = statusAdzan();
  if (s.aktif && !adzan.aktif) mulaiAdzan(s);
  else if (!s.aktif && adzan.aktif) selesaiAdzan();
  renderAdzanBanner(s);
}

/** Detak adzan: cek ulang setiap 20 detik, dan ambil jadwal baru kalau tanggal sudah ganti. */
function detakAdzan() {
  if (adzan.tanggal && adzan.tanggal !== tanggalLocal()) {
    muatAdzan();
    return;
  }
  cekAdzan();
}

/** Adzan masuk: jeda semua pemutar di device ini (hanya pemutar utama yang bunyi). */
function mulaiAdzan(s) {
  adzan.aktif = true;
  const audio = $('audioEl');
  adzan.diputarSebelum = false;
  if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
    try { if (ytPlayer.getPlayerState() === 1 /* PLAYING */) adzan.diputarSebelum = true; } catch { /* abaikan */ }
  }
  if (audio && audio.src && !audio.paused) adzan.diputarSebelum = true;
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    try { ytPlayer.pauseVideo(); } catch { /* abaikan */ }
  }
  if (audio && !audio.paused) audio.pause();
  toast(`Adzan ${s.nama} — pemutaran dijeda, lanjut otomatis setelah selesai.`);
}

/** Adzan selesai: lanjutkan lagu yang tertahan tadi. */
function selesaiAdzan() {
  adzan.aktif = false;
  if (!adzan.diputarSebelum) return;
  adzan.diputarSebelum = false;
  if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
    try { ytPlayer.playVideo(); } catch { /* abaikan */ }
  }
  const audio = $('audioEl');
  if (audio && audio.paused && audio.src) audio.play().catch(() => { /* abaikan */ });
  toast('Adzan selesai — pemutaran dilanjutkan.');
}

function renderAdzanBanner(s) {
  const banner = $('adzanBanner');
  if (!banner) return;
  if (!s.aktif) { banner.hidden = true; return; }
  const sisa = Math.max(0, s.selesai - (new Date().getHours() * 60 + new Date().getMinutes()));
  banner.hidden = false;
  $('adzanBannerText').textContent = `Sedang adzan ${s.nama} — pemutaran dijeda otomatis (±${sisa} menit lagi).`;
}

/** Tampilan jadwal + pengaturan adzan di Pengaturan acara (admin). */
function renderAdzanSetting() {
  const box = $('adzanJadwal');
  const enabled = $('adzanEnabled');
  const durasi = $('adzanDurasi');
  if (enabled) enabled.checked = adzan.enabled;
  if (durasi) durasi.value = adzan.durasi;
  if (!box) return;
  if (!adzan.jadwal) {
    box.replaceChildren(el('p', { class: 'hint', text: 'Jadwal belum diatur. Tekan "Atur dari lokasi saya" (butuh izin lokasi browser).' }));
    return;
  }
  box.replaceChildren(
    el('p', { class: 'adzan-jadwal__title', text: 'Jadwal hari ini' }),
    ...Object.entries(adzan.jadwal).map(([key, jam]) => el('div', { class: 'adzan-jadwal__row' }, [
      el('span', { text: ADZAN_NAMA[key] || key }),
      el('b', { text: jam }),
    ])),
  );
}

function setupAdzan() {
  $('adzanLokasiBtn').addEventListener('click', async () => {
    const note = $('adzanNote');
    note.dataset.tone = '';
    note.textContent = 'Mengambil lokasi…';
    if (!('geolocation' in navigator)) {
      note.dataset.tone = 'error';
      note.textContent = 'Browser tidak mendukung deteksi lokasi.';
      return;
    }
    let pos;
    try {
      pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: false });
      });
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = (err && err.message) || 'Izin lokasi ditolak.';
      return;
    }
    note.textContent = 'Mengambil jadwal adzan…';
    try {
      const res = await fetch('/api/adzan/lokasi', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dj-token': token },
        body: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          tanggal: tanggalLocal(),
          durasi: Number($('adzanDurasi').value) || adzan.durasi,
          enabled: $('adzanEnabled').checked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengatur jadwal adzan.');
      adzan.jadwal = data.jadwal;
      adzan.durasi = data.durasi;
      adzan.enabled = data.enabled;
      note.dataset.tone = 'ok';
      note.textContent = 'Jadwal adzan diatur dari lokasi kamu.';
      renderAdzanSetting();
      cekAdzan();
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    }
  });

  $('adzanEnabled').addEventListener('change', async (e) => {
    try {
      const res = await fetch('/api/adzan/pengaturan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dj-token': token },
        body: JSON.stringify({ enabled: e.target.checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.');
      adzan.enabled = data.enabled;
      cekAdzan();
    } catch (err) {
      e.target.checked = adzan.enabled;
      toast(err.message, 'error');
    }
  });

  $('adzanDurasi').addEventListener('change', async (e) => {
    const d = Math.min(Math.max(Number(e.target.value) || 10, 1), 60);
    e.target.value = d;
    try {
      const res = await fetch('/api/adzan/pengaturan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dj-token': token },
        body: JSON.stringify({ durasi: d }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.');
      adzan.durasi = data.durasi;
      cekAdzan();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* --------------------------------------------------- keybind spacebar */

function togglePlayPause() {
  const audio = $('audioEl');
  if (audio && audio.src) {
    if (audio.paused) audio.play().catch(() => { /* abaikan */ });
    else audio.pause();
    return;
  }
  if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') {
    toast('Belum ada lagu yang dimuat. Tekan "Putar berikutnya" dulu.');
    return;
  }
  if (ytPlayer.getPlayerState() === 1 /* PLAYING */) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function setupSpacebar() {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const tag = ((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
    if (e.target && e.target.isContentEditable) return;
    e.preventDefault();
    if (!kitaPegang()) {
      toast('Jadikan device ini pemutar utama dulu sebelum mengatur lagu.', 'error');
      return;
    }
    if (adzan.aktif) {
      toast('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
      return;
    }
    togglePlayPause();
  });
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  setupLogin();
  setupPlayerControls();
  setupSettings();
  setupPassword();
  setupUserMenu();
  setupAdzan();
  setupSpacebar();
  setInterval(detakPemutar, 5000);
  setInterval(detakAdzan, 20000);
  connect();
  try {
    const res = await fetch('/api/state');
    state = await res.json();
  } catch {
    toast('Gagal memuat state awal.', 'error');
  }
  if (token && state) {
    try {
      // validasi token + peran lewat /api/me (panel DJ sekarang admin-only)
      const resMe = await fetch('/api/me', { headers: { 'x-dj-token': token } });
      const dataMe = await resMe.json().catch(() => ({}));
      if (!resMe.ok) throw new Error('token tidak valid');
      if (dataMe.peran !== 'admin') {
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        const note = $('loginNote');
        note.dataset.tone = 'error';
        note.textContent = `Kamu masuk sebagai ${dataMe.nama || 'user'}, tapi panel DJ hanya untuk admin. Request lagu lewat halaman tamu ya.`;
        $('toGuestBtn').hidden = false;
        return;
      }
      user = { username: dataMe.username, nama: dataMe.nama, peran: dataMe.peran };
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      showApp();
      render();
      muatAdzan();
    } catch {
      // token hangus — biarkan layar login tampil
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } else if (state) {
    render();
  }
}

boot();
