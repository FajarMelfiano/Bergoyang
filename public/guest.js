/* Halaman tamu: form request, pencarian lagu, antrean real-time, voting.
 * Halaman ini privat: hanya user terdaftar (login) yang bisa request & vote. */
'use strict';

const TOKEN_KEY = 'requestlagu.token';
const USER_KEY = 'requestlagu.user';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
/** @type {{username:string,nama:string,peran:string}|null} */
let user = null;
try { user = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { user = null; }
// identitas request/vote = username yang login (server pakai token, bukan device)
let deviceId = (user && user.username) || '';

let state = null;
let searchTimer = null;

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ utilitas */

/**
 * Urutan antrean = urutan vote dari server (state.order). Kalau server belum
 * mengirim (mode lama), hitung sendiri: vote terbanyak, lalu yang lebih dulu
 * masuk. Dipakai juga untuk memberi tahu tamu posisi sebenarnya.
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

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dj-token': token },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // sesi habis atau belum login → kembali ke gerbang login
    hanguskanSesi();
    throw new Error('Sesi kamu habis. Masuk ulang untuk request lagi.');
  }
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data;
}

/* ------------------------------------------------------------- login tamu */

function showLogin() {
  document.body.dataset.auth = 'false';
  $('guestMenu').hidden = true;
  $('guestMenu').removeAttribute('open');
  $('guestChip').textContent = '';
}

function showApp() {
  document.body.dataset.auth = 'true';
  $('guestMenu').hidden = false;
  // identitas yang tampil memakai username (bukan nama tampilan) — sama
  // dengan yang dipakai server saat menyimpan siapa peminta lagu
  $('guestChip').textContent = user ? user.username : '';
  if (user && user.username) $('requester').value = user.username;
}

function hanguskanSesi(notify = true) {
  token = '';
  user = null;
  deviceId = '';
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  showLogin();
  if (notify) toast('Sesi habis — masuk ulang untuk request lagi.', 'error');
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal masuk.');
      token = data.token;
      user = { username: data.username, nama: data.nama, peran: data.peran };
      deviceId = user.username;
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      note.textContent = '';
      $('loginUser').value = '';
      $('loginPass').value = '';
      showApp();
      toast(`Halo ${user.username}! Kamu bisa request lagu sekarang.`);
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    hanguskanSesi(false);
    toast('Kamu sudah keluar. Masuk lagi kapan saja.');
  });
}

/* ----------------------------------------------------- ganti password tamu */

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
      const data = await post('/api/dj/password', {
        passwordLama: $('passLama').value,
        passwordBaru: baru,
      });
      token = data.token; // password berubah → token baru
      sessionStorage.setItem(TOKEN_KEY, token);
      note.dataset.tone = 'ok';
      note.textContent = 'Password diganti.';
      $('passLama').value = '';
      $('passBaru').value = '';
      $('passBaru2').value = '';
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    }
  });
}

/* --------------------------------------------- menu user (tutup otomatis) */

function setupGuestMenu() {
  const menu = $('guestMenu');
  document.addEventListener('click', (e) => {
    if (menu.hasAttribute('open') && !menu.contains(e.target)) menu.removeAttribute('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.hasAttribute('open')) {
      menu.removeAttribute('open');
      const trigger = menu.querySelector('summary');
      if (trigger) trigger.focus();
    }
  });
}

/* --------------------------------------------------- strip adzan di tamu */

const ADZAN_NAMA = { Fajr: 'Subuh', Dhuhr: 'Dzuhur', Asr: 'Ashar', Maghrib: 'Maghrib', Isha: 'Isya' };
let adzanTamu = { jadwal: null, durasi: 10, enabled: true, tanggal: '' };

function tanggalLocal() {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

async function muatAdzanTamu() {
  try {
    const res = await fetch(`/api/adzan?tanggal=${encodeURIComponent(tanggalLocal())}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    adzanTamu.jadwal = data.jadwal || null;
    adzanTamu.durasi = Number(data.durasi) || 10;
    adzanTamu.enabled = data.enabled !== false;
    adzanTamu.tanggal = tanggalLocal();
  } catch { /* offline — diam */ }
  cekAdzanTamu();
}

function cekAdzanTamu() {
  const strip = $('adzanStrip');
  if (!strip) return;
  if (adzanTamu.tanggal && adzanTamu.tanggal !== tanggalLocal()) { muatAdzanTamu(); return; }
  if (!adzanTamu.enabled || !adzanTamu.jadwal) { strip.hidden = true; return; }
  const sekarang = new Date();
  const menit = sekarang.getHours() * 60 + sekarang.getMinutes();
  let nama = null;
  for (const [key, jam] of Object.entries(adzanTamu.jadwal)) {
    const bagian = String(jam).split(':').map(Number);
    if (bagian.length < 2 || bagian.some((n) => !Number.isFinite(n))) continue;
    const mulai = bagian[0] * 60 + bagian[1];
    if (menit >= mulai && menit < mulai + adzanTamu.durasi) { nama = ADZAN_NAMA[key] || key; break; }
  }
  strip.hidden = !nama;
  if (nama) $('adzanStripText').textContent = `Sedang adzan ${nama} — lagu lanjut otomatis setelah selesai`;
}

/* -------------------------------------------------------------- antrean */

const STATUS_LABEL = {
  pending: 'Menunggu DJ',
  queued: 'Di antrean',
  playing: 'Sedang diputar',
  done: 'Selesai',
  rejected: 'Ditolak',
};

function slipBody(track) {
  return el('div', { class: 'slip__body' }, [
    el('div', { class: 'slip__title', text: track.title }),
    track.artist ? el('div', { class: 'slip__artist', text: track.artist }) : null,
    el('div', { class: 'slip__meta' }, [
      el('span', { text: `diminta oleh ${track.requester || 'Tamu'}` }),
      track.createdAt ? el('span', { text: relativeTime(track.createdAt) }) : null,
    ]),
  ]);
}

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const menit = Math.floor(diff / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

function renderNowPlaying(container, track) {
  container.replaceChildren();
  if (!track) {
    container.append(el('div', { class: 'empty' }, [
      el('b', { text: 'Belum ada yang diputar' }),
      el('span', { text: 'Kirim lagu pertama, DJ akan memutarnya.' }),
    ]));
    return;
  }
  const slip = el('article', { class: 'slip slip--live' }, [
    el('div', { class: 'slip__no', text: '♪' }),
    slipBody(track),
    track.yt
      ? el('div', { class: 'slip__side' }, [
          el('a', { class: 'link-btn', href: `https://www.youtube.com/watch?v=${track.yt}`, target: '_blank', rel: 'noopener', text: 'dengarkan' }),
        ])
      : null,
    el('div', { class: 'stamp' }, [
      el('span', { class: 'eq', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]),
      document.createTextNode('Sedang diputar'),
    ]),
    track.message ? el('div', { class: 'slip__msg', text: `“${track.message}”` }) : null,
  ]);
  container.append(slip);
}

function renderQueue(container, tracks) {
  container.replaceChildren();
  if (!tracks.length) {
    container.append(el('div', { class: 'empty' }, [
      el('b', { text: 'Antrean kosong' }),
      el('span', { text: 'Jadi yang pertama minta lagu.' }),
    ]));
    return;
  }
  let nomor = 0;
  tracks.forEach((track) => {
    const isMine = track.deviceId === deviceId;
    const rejected = track.status === 'rejected';
    if (!rejected) nomor += 1;
    const canVote = state.event.allowVotes && track.status === 'queued';
    const voted = Boolean(track.votes && track.votes[deviceId]);
    const nextUp = track.status === 'queued' && state.nextId === track.id;
    const jumlahVote = Object.keys(track.votes || {}).length;

    // Kolom sisi slip: tag "Berikutnya" (kalau lagu teratas) dan tombol vote
    // WAJIB dibungkus satu wadah .slip__side. Kalau dipasang sebagai anak grid
    // terpisah, tombol vote melimpah ke baris baru (grid .slip hanya 3 kolom).
    const sideParts = [];
    if (nextUp) sideParts.push(el('span', { class: 'tag tag--live', text: 'Berikutnya' }));
    if (canVote) {
      sideParts.push(el('button', {
        class: 'vote',
        type: 'button',
        'aria-pressed': voted ? 'true' : 'false',
        'aria-label': `${voted ? 'Batalkan vote' : 'Vote'} untuk ${track.title}`,
        onclick: (e) => handleVote(track, e.currentTarget),
      }, [
        el('span', { 'aria-hidden': 'true', text: '▲' }),
        el('small', { text: String(jumlahVote) }),
      ]));
    }
    if (isMine && track.status === 'pending') {
      sideParts.push(el('span', { class: 'tag', text: STATUS_LABEL.pending }));
    }
    if (rejected) sideParts.push(el('span', { class: 'tag', text: 'Ditolak' }));
    const side = sideParts.length ? el('div', { class: 'slip__side' }, sideParts) : null;

    container.append(el('article', {
      class: [rejected ? 'slip slip--done' : 'slip', nextUp ? 'slip--next' : ''].filter(Boolean).join(' '),
    }, [
      el('div', { class: 'slip__no', text: rejected ? '✕' : String(nomor) }),
      slipBody(track),
      side,
      track.message && !rejected ? el('div', { class: 'slip__msg', text: `“${track.message}”` }) : null,
    ]));
  });
}

function renderDone(container, tracks) {
  container.replaceChildren();
  tracks.forEach((track) => {
    container.append(el('article', { class: 'slip slip--done' }, [
      el('div', { class: 'slip__no', text: '✓' }),
      slipBody(track),
      el('div', { class: 'slip__side' }, [el('span', { class: 'tag', text: 'Selesai' })]),
    ]));
  });
}

async function handleVote(track, button) {
  button.disabled = true;
  try {
    const result = await post('/api/vote', { trackId: track.id });
    const small = button.querySelector('small');
    if (small) small.textContent = String(result.voteCount);
    button.setAttribute('aria-pressed', result.voted ? 'true' : 'false');
    if (result.voted) toast(`Vote untuk “${track.title}” dikirim.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------------------------------------- render */

function render() {
  if (!state) return;
  const { event, tracks } = state;

  document.title = event.name;
  $('brand').textContent = event.name;
  $('eventName').textContent = event.name;
  $('eventTagline').textContent = event.tagline;
  $('footerName').textContent = event.name;

  $('liveBadge').dataset.open = event.open ? 'true' : 'false';
  $('liveText').textContent = event.open ? 'Request dibuka' : 'Request ditutup';

  const playing = tracks.find((t) => t.status === 'playing') || null;
  const queued = urutAntrean(tracks.filter((t) => t.status === 'queued'));
  const pending = tracks.filter((t) => t.status === 'pending');
  const done = tracks.filter((t) => t.status === 'done');
  const rejectedMine = tracks.filter((t) => t.status === 'rejected' && t.deviceId === deviceId);

  $('statQueued').textContent = String(queued.length);
  $('statPlayed').textContent = String(done.length);
  $('statWaiting').textContent = String(pending.length);
  $('queueCount').textContent = `${queued.length} lagu`;

  renderNowPlaying($('nowPlaying'), playing);
  renderQueue($('queue'), queued.concat(rejectedMine));

  const doneWrap = $('doneWrap');
  doneWrap.hidden = done.length === 0;
  $('doneSummary').textContent = `Sudah diputar (${done.length})`;
  if (done.length) renderDone($('doneList'), done.slice(-12).reverse());

  const closed = !event.open;
  $('submitBtn').disabled = closed;
  $('formHint').textContent = closed
    ? 'Request sedang ditutup oleh DJ. Tunggu dibuka lagi.'
    : 'Ketik judul — semua lagu di YouTube bisa dicari. Urutan antrean mengikuti vote tertinggi.';
  $('messageField').hidden = !event.allowMessages;
}

/* ---------------------------------------------------------- pencarian */

let pickedYt = '';      // id YouTube yang dipilih dari saran (biar tidak cari ulang)
let detectTimer = null;
let searchSeq = 0;      // abaikan jawaban pencarian yang sudah basi

/** Ambil saran dari server: katalog acara + semua hasil YouTube. */
async function searchSongs(query) {
  const seq = ++searchSeq;
  try {
    const res = await fetch(`/api/songs?q=${encodeURIComponent(query)}&limit=8`);
    const data = await res.json();
    if (seq !== searchSeq) return; // sudah ada permintaan lebih baru
    renderResults(data.songs || [], query);
    isiDeteksi(data.detected || null);
  } catch {
    if (seq === searchSeq) {
      renderResults([], query);
      isiDeteksi(null);
    }
  }
}

/** Baris "terdeteksi otomatis" — sumber lagu yang akan dipakai server. */
function isiDeteksi(detected) {
  const wrap = $('detect');
  if (!wrap) return;
  wrap.replaceChildren();
  if (!detected || !detected.yt) return;
  wrap.hidden = false;
  wrap.append(
    el('span', { class: 'detect__label', text: 'Terdeteksi:' }),
    el('b', { text: `${detected.title}${detected.artist ? ` — ${detected.artist}` : ''}` }),
    detected.duration ? el('span', { class: 'detect__meta', text: detected.duration }) : null,
    el('button', {
      class: 'link-btn',
      type: 'button',
      onclick: () => pilihSuggestion(detected),
    }, ['pakai ini']),
  );
}

function pilihSuggestion(song) {
  $('title').value = song.title;
  $('artist').value = song.artist || '';
  pickedYt = song.yt || '';
  $('results').replaceChildren();
  const wrap = $('detect');
  if (wrap) wrap.hidden = true;
  $('title').focus();
}

function renderResults(songs, query) {
  const list = $('results');
  list.replaceChildren();
  if (!songs.length) {
    if (query && query.length >= 2) {
      list.append(el('li', { class: 'results__note' }, [
        el('span', { text: `Belum ada saran untuk “${query}” — tetap bisa kirim, server akan mencari sendiri.` }),
      ]));
    }
    return;
  }
  for (const song of songs) {
    const button = el('button', {
      type: 'button',
      role: 'option',
      onclick: () => pilihSuggestion(song),
    }, [
      el('b', { text: song.title }),
      el('span', { text: song.artist || '' }),
      song.duration ? el('small', { text: song.duration }) : null,
    ]);
    list.append(el('li', {}, [button]));
  }
}

/* ---------------------------------------------------------------- form */

function setupForm() {
  const form = $('requestForm');
  const titleInput = $('title');

  titleInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    pickedYt = ''; // ketik manual → biarkan server yang mencari sumber lagu
    const value = titleInput.value.trim();
    if (value.length < 2) {
      $('results').replaceChildren();
      const wrap = $('detect');
      if (wrap) wrap.hidden = true;
      return;
    }
    searchTimer = setTimeout(() => searchSongs(value), 260);
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('results').replaceChildren();
    if (e.key === 'ArrowDown') {
      const first = $('results').querySelector('button');
      if (first) { e.preventDefault(); first.focus(); }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = $('formNote');
    const title = titleInput.value.trim();
    if (!title) {
      note.dataset.tone = 'error';
      note.textContent = 'Judul lagu wajib diisi.';
      titleInput.focus();
      return;
    }

    const payload = {
      title,
      artist: $('artist').value.trim(),
      // requester tidak dikirim: server memakai username dari sesi login
      message: $('message') ? $('message').value.trim() : '',
      // pilihan dari saran lebih dulu; kalau tidak ada, tempelan manual.
      yt: pickedYt || ($('source') && $('source').value.trim() ? $('source').value.trim() : ''),
    };

    $('submitBtn').disabled = true;
    note.dataset.tone = 'ok';
    note.textContent = payload.yt ? 'Mengirim slip request…' : 'Mencari sumber lagu di YouTube…';
    try {
      const result = await post('/api/request', payload);
      const queued = urutAntrean(state ? state.tracks.filter((t) => t.status === 'queued') : []);
      const posisi = queued.findIndex((t) => t.id === result.track.id) + 1;
      note.dataset.tone = 'ok';
      note.textContent = result.status === 'pending'
        ? 'Slip terkirim, menunggu persetujuan DJ.'
        : posisi > 0
          ? `Slip terkirim — posisi antrean #${posisi} dari ${queued.length}. Naik urutan kalau dapat vote.`
          : 'Slip terkirim.';
      toast(`“${payload.title}” masuk antrean.`);
      form.reset();
      pickedYt = '';
      $('results').replaceChildren();
      const wrap = $('detect');
      if (wrap) { wrap.hidden = true; wrap.replaceChildren(); }
    } catch (err) {
      note.dataset.tone = 'error';
      note.textContent = err.message;
    } finally {
      $('submitBtn').disabled = state ? !state.event.open : false;
    }
  });
}

/* ------------------------------------------------------------ koneksi */

function applyState(next) {
  state = next;
  render();
  $('connState').textContent = 'tersambung';
}

let pollTimer = null;

/** Polling cadangan bila SSE tidak tersedia (mis. di Vercel). */
function startPolling() {
  if (pollTimer) return;
  const tick = async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      applyState(await res.json());
    } catch {
      $('connState').textContent = 'reconnecting…';
    }
  };
  tick();
  pollTimer = setInterval(tick, 2500);
}

function connect() {
  const source = new EventSource('/api/events');
  source.onopen = () => { $('connState').textContent = 'tersambung'; };
  source.onmessage = (event) => {
    try { applyState(JSON.parse(event.data)); } catch { /* abaikan */ }
  };
  source.onerror = () => {
    // SSE tidak tersedia (mode daring) → tutup & beralih ke polling.
    source.close();
    $('connState').textContent = 'reconnecting…';
    startPolling();
  };
}

async function boot() {
  setupForm();
  setupLogin();
  setupPassword();
  setupGuestMenu();
  try {
    const res = await fetch('/api/state');
    applyState(await res.json());
  } catch {
    $('connState').textContent = 'gagal memuat';
  }
  connect();
  // perbarui label waktu relatif
  setInterval(() => { if (state) render(); }, 60000);
  // cek sesi tersimpan: validasi token ke server sebelum buka halaman
  if (token) {
    try {
      const res = await fetch('/api/me', { headers: { 'x-dj-token': token } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('hangus');
      user = { username: data.username, nama: data.nama, peran: data.peran };
      deviceId = user.username;
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      showApp();
    } catch {
      hanguskanSesi(false);
    }
  } else {
    showLogin();
  }
  muatAdzanTamu();
  setInterval(cekAdzanTamu, 30000);
}

boot();
