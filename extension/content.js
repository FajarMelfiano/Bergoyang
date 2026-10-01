/**
 * Request Lagu — content script pemutar otomatis (berjalan di music.youtube.com).
 *
 *   request masuk  → tab ini memutar sesuai antrean, tanpa DJ menekan play
 *   lagu selesai   → otomatis lanjut ke lagu berikutnya
 *   DJ "Hentikan"  → jeda sampai DJ "Putar berikutnya"
 *
 * Status dikirim ke server (/api/player/status) sehingga chip "Player:" di
 * panel DJ ikut ter-update. Komunikasi API lewat background (tanpa CORS).
 */
'use strict';

const POLL_MS = 1500;
const HEARTBEAT_MS = 5000;
const MAX_ATTEMPT = 2;        // percobaan penuh (watch + cari) sebelum lagu dilompati
const PENDING_KEY = 'rlPending'; // sessionStorage — bertahan saat tab pindah halaman

const TAB_ID = Math.random().toString(36).slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log('[RequestLagu]', ...args);

let busy = false;
let currentId = '';      // track.id yang sedang/telah diputar di tab ini
let expectedVid = '';    // video id yang kita muat
let attempts = 0;
let mediaGoneSince = 0;
let lastT = -1;
let progressAt = 0;
let lastReport = { status: '', detail: '', trackId: '' };
let lastBeat = 0;

/* ------------------------------------------------------------- API server */

async function api(path, method = 'GET', body) {
  const r = await chrome.runtime.sendMessage({ type: 'api', path, method, body });
  if (!r) throw new Error('Extension tidak terhubung ke background.');
  if (r.status === 0) throw new Error((r.data && r.data.error) || 'Server tidak terjangkau.');
  if (r.status >= 400) {
    const err = new Error((r.data && r.data.error) || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.data;
}

async function report(status, detail = '', trackId = '') {
  const changed = status !== lastReport.status || detail !== lastReport.detail || trackId !== lastReport.trackId;
  if (!changed && Date.now() - lastBeat < HEARTBEAT_MS) return;
  lastReport = { status, detail, trackId };
  lastBeat = Date.now();
  try {
    await api('/api/player/status', 'POST', {
      ...lastReport,
      ytSync: lastYtSync.status,
      ytNext: lastYtSync.next,
    });
  } catch { /* server sibuk — coba nanti */ }
}

/* ------------------------------------ sinkronisasi antrean dengan YouTube
 *
 * Yang memutar SELALU urutan vote dari server — itu yang menjamin tidak ada
 * yang salah putar. Tambahan: antrean di aplikasi YouTube Music ("Berikutnya")
 * ikut disesuaikan, tapi dikerjakan di TAB BANTU (tab background) supaya
 * tab pemutar tidak pernah terganggu. Tab bantu mencari lagu di YouTube Music
 * lalu memilih menu "\u22ee \u2192 Tambahkan ke antrean".
 *
 * Semua langkah best-effort: kalau gagal, hanya label chip yang berubah.      */

const lastYtSync = { status: 'tidak diketahui', next: '' };
let ytSyncBusy = false;
let ytSyncSig = '';

/** Lagu yang akan diputar berikutnya, sesuai urutan vote server. */
function upcomingTracks(st, limit = 3) {
  const byId = new Map(st.tracks.map((t) => [t.id, t]));
  return (st.order || [])
    .map((id) => byId.get(id))
    .filter((t) => t && t.status === 'queued' && t.yt)
    .slice(0, limit);
}

/** Tab pembantu: minta background membuka/kirim daftar lagu untuk disinkronkan. */
async function syncYouTubeQueue(st) {
  if (ytSyncBusy) return;
  const upcoming = upcomingTracks(st);
  const sig = upcoming.map((t) => `${t.yt}`).join(',');
  if (sig === ytSyncSig) return;
  ytSyncSig = sig;

  if (!upcoming.length) {
    lastYtSync.status = 'sinkron';
    lastYtSync.next = '';
    return;
  }

  lastYtSync.status = 'menyesuaikan';
  lastYtSync.next = upcoming[0].title;
  ytSyncBusy = true;
  try {
    const hasil = await chrome.runtime.sendMessage({
      type: 'yt-antrean',
      items: upcoming.map((t) => ({ title: t.title, artist: t.artist || '', yt: t.yt })),
    });
    if (hasil && hasil.status) {
      lastYtSync.status = hasil.status;
      log('sinkron YT:', hasil.status, hasil.detail || '');
    }
  } catch (err) {
    lastYtSync.status = 'gagal';
    log('sinkron YT gagal:', err && err.message);
  } finally {
    ytSyncBusy = false;
  }
}

/** Paksa sinkron ulang (dipakai kalau chip perlu segera menyegarkan). */
function mintaSinkronUlang() {
  ytSyncSig = '';
}

/* --------------------------------------------------------- media di halaman */

function readMedia() {
  const v = document.querySelector('video');
  if (!v) return null;
  let vid = '';
  try { vid = new URL(location.href).searchParams.get('v') || ''; } catch { /* abaikan */ }
  return {
    vid,
    dur: Number.isFinite(v.duration) ? v.duration : 0,
    t: v.currentTime,
    paused: v.paused,
    ended: Boolean(v.ended),
  };
}

async function waitForMedia(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const m = readMedia();
    if (m && m.dur > 0) return m;
    await sleep(700);
  }
  return null;
}

function pauseMedia() {
  const v = document.querySelector('video');
  if (v && !v.paused) v.pause();
}

function resumeMedia() {
  const v = document.querySelector('video');
  if (v && v.paused && !v.ended) v.play().catch(() => {});
}

function mediaEnded(m) {
  if (!m) return false;
  if (m.ended) return true;
  if (expectedVid && m.vid && m.vid !== expectedVid) return true; // tab pindah video sendiri
  if (m.dur >= 40 && m.t >= m.dur - 0.8) return true;            // dur ≥40dtk menghindari iklan pendek
  return false;
}

/* -------------------------------------------- penanganan navigasi penuh
 * location.assign mematikan instance content script ini; instance baru
 * melanjutkan dari "pending" yang disimpan di sessionStorage.            */

function readPending() {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}

function writePending(p) {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* abaikan */ }
}

function query(track) {
  return `${track.title} ${track.artist || ''}`.trim();
}

function startLoad(track, attempt) {
  attempts = attempt;
  const stage = track.yt ? 'watch' : 'search';
  writePending({ trackId: track.id, stage, attempt, title: track.title, artist: track.artist || '', yt: track.yt || '', query: query(track) });
  report('memutar', track.title, track.id); // lapor dulu — pemuatan bisa butuh beberapa detik
  log(`memuat (percobaan ${attempt}, ${stage}): ${track.title}`);
  const url = stage === 'watch'
    ? `https://music.youtube.com/watch?v=${track.yt}`
    : `https://music.youtube.com/search?q=${encodeURIComponent(query(track))}`;
  location.assign(url);
}

function skipTrack(track, reason) {
  log(`lompat ${track.title}: ${reason}`);
  report('error', `Gagal memutar “${track.title}” — dilompati.`);
  currentId = '';
  expectedVid = '';
  writePending(null);
  attempts = 0;
  api('/api/dj/advance', 'POST', {}).catch((err) => log('advance gagal:', err.message));
}

/** Lanjutkan rantai muat yang tertunda (dipanggil tiap tick selama pending ada). */
async function continuePending(track, pending) {
  if (pending.stage === 'watch') {
    const m = await waitForMedia(12000);
    if (m) return settleLoad(track, pending, m);
    // video tidak bisa diputar (mis. "Video unavailable") → cari manual
    pending.stage = 'search';
    writePending(pending);
    log('watch?v= gagal → cari manual');
    location.assign(`https://music.youtube.com/search?q=${encodeURIComponent(pending.query)}`);
    return;
  }

  // stage 'search': klik hasil pencarian satu per satu (SPA — instance tetap sama)
  let rows = [];
  const rowDeadline = Date.now() + 8000;
  while (Date.now() < rowDeadline && rows.length === 0) {
    rows = [...document.querySelectorAll('ytmusic-responsive-list-item-renderer, yt-lockup-view-model')]
      .slice(0, 5);
    if (rows.length === 0) await sleep(1000);
  }
  for (const row of rows) {
    try {
      const urlSebelum = location.href;
      row.click();
      const m = await waitForMedia(8000);
      if (m) return settleLoad(track, pending, m);
      if (location.href !== urlSebelum) { // navigasi SPA terjadi tapi tak ada video
        history.back();
        await sleep(1500);
      }
    } catch { /* baris berikutnya */ }
  }

  // rantai gagal total
  if (pending.attempt >= MAX_ATTEMPT) skipTrack(track, 'watch & pencarian gagal');
  else startLoad(track, pending.attempt + 1);
}

function settleLoad(track, pending, media) {
  currentId = track.id;
  expectedVid = media.vid || pending.yt || '';
  attempts = pending.attempt;
  writePending(null);
  progressAt = Date.now();
  lastT = -1;
  mediaGoneSince = 0;
  report('memutar', track.title, track.id);
  log(`memutar: ${track.title} (${expectedVid || 'tanpa id'})`);
}

/* ------------------------------------------------------------- loop utama */

async function isLeader() {
  try {
    const s = await chrome.storage.local.get('rlLock');
    const now = Date.now();
    const lock = s.rlLock;
    if (lock && lock.id !== TAB_ID && now - lock.at < 6000) return false; // tab lain memimpin
    if (!lock || lock.id !== TAB_ID || now - lock.at > 2000) {
      await chrome.storage.local.set({ rlLock: { id: TAB_ID, at: now } });
    }
    return true;
  } catch {
    return true; // storage bermasalah → jalan saja
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!(await isLeader())) return; // tab YouTube Music lain memegang kendali

    const st = await api('/api/state');
    const playing = st.tracks.find((t) => t.status === 'playing') || null;
    // urutan vote server = urutan yang harus dipakai di mana pun
    const queued = upcomingTracks(st, 99);
    // sinkron antrean YouTube jalan di tab bantu — TIDAK ditunggu agar
    // loop pemutaran tidak ikut melambat.
    syncYouTubeQueue(st).catch(() => {});

    // pending yang track-nya sudah tidak berlaku → buang
    let pending = readPending();
    if (pending && (!playing || playing.id !== pending.trackId)) {
      writePending(null);
      pending = null;
    }

    /* --- tidak ada lagu yang sedang diputar --- */
    if (!playing) {
      currentId = '';
      expectedVid = '';
      attempts = 0;
      pauseMedia();
      if (!st.autoNext) await report('jeda', 'Auto-play dijeda oleh DJ.');
      else if (queued.length) {
        await api('/api/dj/advance', 'POST', {});
        await report('siap', `Antrean ditemukan — mulai memutar ${queued.length} lagu.`);
      } else {
        await report('siap', 'Menunggu request masuk.');
      }
      return;
    }

    /* --- file lokal: panel DJ yang memutar, YouTube Music diamkan --- */
    if (playing.audio) {
      currentId = '';
      expectedVid = '';
      pauseMedia();
      await report('siap', `File lokal: ${playing.audio}`);
      return;
    }

    /* --- masih dalam proses muat (setelah navigasi) --- */
    if (pending) {
      await continuePending(playing, pending);
      return;
    }

    /* --- track baru / belum dimuat --- */
    if (currentId !== playing.id) {
      attempts = 0;
      await startLoad(playing, 1);
      return;
    }

    /* --- pantau pemutaran yang sedang berjalan --- */
    const m = readMedia();
    if (!m) {
      if (!mediaGoneSince) mediaGoneSince = Date.now();
      if (Date.now() - mediaGoneSince > 6000) {
        log('media hilang (halaman berganti?) — muat ulang');
        mediaGoneSince = 0;
        if (attempts >= MAX_ATTEMPT) skipTrack(playing, 'media hilang berulang');
        else startLoad(playing, attempts + 1);
      }
      return;
    }
    mediaGoneSince = 0;

    if (mediaEnded(m)) {
      log(`selesai: ${playing.title}`);
      currentId = '';
      expectedVid = '';
      writePending(null);
      if (st.autoNext) {
        await api('/api/dj/advance', 'POST', {});
        await report('siap', 'Lagu selesai — lanjut berikutnya.');
      } else {
        pauseMedia();
        await report('jeda', 'Lagu selesai. Auto-play dijeda oleh DJ.');
      }
      return;
    }

    // watchdog: waktu tidak bergerak sama sekali → coba play(), lalu lewati
    if (m.t !== lastT) {
      lastT = m.t;
      progressAt = Date.now();
    } else if (progressAt && Date.now() - progressAt > 75000) {
      log('stuck — mencoba play() ulang');
      resumeMedia();
      if (Date.now() - progressAt > 150000) {
        skipTrack(playing, 'pemutaran macet total');
        return;
      }
    }

    if (m.paused && !m.ended) resumeMedia();
    // report() sudah ikut membawa status sinkron antrean YouTube
    await report('memutar', playing.title, playing.id);
  } catch (err) {
    if (err && err.status === 401) {
      log('butuh kode DJ — buka popup extension lalu simpan kodenya.');
      // tidak bisa lapor status tanpa token; popup yang menuntun pengguna
    } else {
      log('gangguan:', err && err.message);
      await report('error', `Gangguan: ${err && err.message}`.slice(0, 160));
    }
  } finally {
    busy = false;
  }
}

log('aktif — menyambung ke server…');

/* ------------------------------------------------ mode tab bantu sinkron
 *
 * Tab background (?rl_sync=1) TIDAK memutar apa pun. Tugasnya satu saja:
 * memasukkan lagu yang akan diputar berikutnya ke antrean YouTube Music lewat
 * menu "\u22ee \u2192 Tambahkan ke antrean".
 *
 * Cara aman: tab bantu berpindah halaman penuh (bukan mengetik di kotak
 * pencarian) dan peptide "rl_sync=1" selalu ikut di URL — dengan begitu tab ini
 * tidak mungkin salah berubah jadi tab pemutar. Rencana kerja disimpan di
 * sessionStorage supaya tetap jalan setelah tiap muat ulang halaman.
 */

const MODE_SYNK = /[?&]rl_sync=1/.test(location.search);
const PLAN_KEY = 'rlSyncPlan';

/* Tandai tab bantu di sessionStorage. Kalau flag rl_sync=1 suatu saat hilang
 * dari URL (mis. YouTube Music mengalihkan halaman), tab ini tetap tidak akan
 * keliru menjadi tab pemutar — keamanan ekstra di samping pengecekan URL.    */
if (MODE_SYNK) {
  try { sessionStorage.setItem('rlPernahSinkron', '1'); } catch { /* abaikan */ }
}

if (MODE_SYNK) {
  jalankanTabBantu();
} else if (sessionStorage.getItem('rlPernahSinkron') === '1') {
  log('tab bantu kehilangan flag rl_sync — diam, tidak menjadi pemutar');
} else {
  tick();
  setInterval(tick, POLL_MS);
}

/* Background menyampaikan hasil sinkron dari tab bantu (bisa tiba setelah
 * sinkron YouTube selesai dikerjakan) — segarkan chip tanpa memicu sinkron
 * ulang.                                                                 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'yt-antrean-segarkan' && msg.hasil) {
    if (msg.hasil.status) lastYtSync.status = msg.hasil.status;
    if (msg.hasil.next) lastYtSync.next = msg.hasil.next;
  }
  return false;
});

function bacaPlan() {
  try { return JSON.parse(sessionStorage.getItem(PLAN_KEY) || 'null'); } catch { return null; }
}
function tulisPlan(plan) {
  if (plan) sessionStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  else sessionStorage.removeItem(PLAN_KEY);
}

function jalankanTabBantu() {
  // Kalau masih ada rencana di sessionStorage → ini kelanjutan setelah muat
  // ulang halaman. JANGAN minta pekerjaan baru, kalau tidak akan mengulang
  // pekerjaan yang sama terus-menerus.
  if (bacaPlan()) {
    langkah();
    return;
  }

  log('tab bantu sinkron antrean aktif');

  // kabari background bahwa tab ini siap menerima pekerjaan
  chrome.runtime.sendMessage({ type: 'yt-antrean-siap' }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'yt-antrean-kerjakan') {
      mulaiRencana(msg.items || []);
      return false; // tidak perlu respons
    }
    return false;
  });
}

/** items: [{title, artist, yt}] */
function mulaiRencana(items) {
  if (!items.length) return;
  if (bacaPlan()) return; // sedang bekerja — jangan mulai dari awal
  tulisPlan({ items, index: 0, ok: 0, gagal: 0 });
  langkah();
}

/**
 * Satu langkah: cari lagu di URL search → klik menu → "Tambahkan ke antrean"
 * → lanjut ke lagu berikutnya. Setiap perpantian lagu = satu muat halaman,
 * lalu instance content script baru melanjutkan dari sessionStorage.
 */
async function langkah() {
  const plan = bacaPlan();
  if (!plan) return;
  const item = plan.items[plan.index];
  if (!item) return selesai(plan);

  const q = encodeURIComponent(`${item.title} ${item.artist || ''}`.trim());
  const tujuan = `https://music.youtube.com/search?q=${q}&rl_sync=1`;
  const diTempat = location.pathname === '/search'
    && location.searchParams.get('q') === decodeURIComponent(q)
    && /[?&]rl_sync=1/.test(location.search);

  if (!diTempat) {
    location.assign(tujuan); // muat ulang → lanjut di instance berikutnya
    return;
  }

  const row = await tungguBaris(item.yt, 12000);
  if (!row) {
    plan.gagal += 1;
    plan.index += 1;
    tulisPlan(plan);
    if (plan.index >= plan.items.length) return selesai(plan);
    return langkah();
  }

  const menu = row.querySelector(
    'ytmusic-menu-renderer button, ytmusic-menu-renderer tp-yt-paper-icon-button, #menu button',
  );
  if (!menu) {
    plan.gagal += 1;
    plan.index += 1;
    tulisPlan(plan);
    if (plan.index >= plan.items.length) return selesai(plan);
    return langkah();
  }

  menu.click();
  await sleep(800);
  const pilihan = [...document.querySelectorAll('ytmusic-menu-service-item-renderer, tp-yt-paper-item')]
    .find((n) => /tambahkan ke antrean|add to queue|play next/i.test(n.textContent || ''));
  if (!pilihan) {
    document.body.click();
    plan.gagal += 1;
  } else {
    pilihan.click();
    plan.ok += 1;
  }
  await sleep(600);

  plan.index += 1;
  tulisPlan(plan);
  if (plan.index >= plan.items.length) return selesai(plan);
  return langkah();
}

/** Tunggu baris hasil pencarian untuk video tertentu (maks ms). */
async function tungguBaris(yt, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = [...document.querySelectorAll(
      'ytmusic-responsive-list-item-renderer, yt-lockup-view-model, ytmusic-two-row-item-renderer',
    )];
    const cocok = rows.find((row) => {
      const a = row.querySelector('a[href*="watch?v="]');
      return a && (a.getAttribute('href') || '').includes(`v=${yt}`);
    });
    if (cocok) return cocok;
    if (rows.length) return rows[0]; // hasil tidak persis — pakai baris pertama
    await sleep(400);
  }
  return null;
}

/** Selesai: laporkan hasil ke background lalu tabs ditutup dari sana. */
function selesai(plan) {
  const total = plan.items.length;
  const status = plan.gagal === 0 && plan.ok === total ? 'sinkron' : (plan.ok ? 'menyesuaikan' : 'gagal');
  tulisPlan(null);
  chrome.runtime.sendMessage({
    type: 'yt-antrean-hasil',
    hasil: { status, detail: `${plan.ok}/${total} masuk antrean YouTube` },
  }).catch(() => {});
  log(`sinkron YT selesai: ${status} (${plan.ok}/${total})`);
}
