/**
 * Request Lagu Live — server lokal tanpa dependensi eksternal.
 *
 * Jalankan:   node server.js
 * Tamu buka:  http://<ip-laptop>:3000/
 * Panel DJ:   http://<ip-laptop>:3000/dj   (login: username+password, lihat PANDUAN.md)
 *
 * Fitur: REST API + real-time lewat Server-Sent Events, penyimpanan JSON
 * di folder data/, pemutaran lagu (YouTube / file audio lokal), voting,
 * moderasi antrean oleh DJ.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const AUDIO_DIR = path.join(ROOT, 'audio');
// RL_DATA_DIR hanya untuk pengujian otomatis (state terisolasi dari acara nyata).
const DATA_DIR = process.env.RL_DATA_DIR ? path.resolve(process.env.RL_DATA_DIR) : path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');

/**
 * Mode daring (Vercel serverless): VERCEL=1.
 * - state dipindah ke Redis (Upstash REST, tanpa dependensi npm)
 * - filesystem baca-saja → folder data/ & audio/ tidak dibuat
 * - SSE diganti polling di sisi klien (endpoint /api/events balas 503)
 * Mode lokal (node server.js) berperilaku persis seperti sediakala.
 */
const IS_VERCEL = process.env.VERCEL === '1';

if (!IS_VERCEL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

/* ---------------------------------------------------------------- state */

const DEFAULT_EVENT = {
  name: 'Request Lagu Live',
  tagline: 'Kirim lagu, tunggu giliran, langsung diputar.',
  open: true,
  allowVotes: true,
  allowMessages: true,
  // Batas durasi lagu untuk acara ini. 0 = tanpa batas.
  maksDurasiMenit: 0,
  // 'tandai' = lagu yang melebihi batas tetap masuk tapi ditandai;
  // 'tolak'  = request-nya ditolak dengan alasan yang jelas.
  perlakuanDurasiPanjang: 'tandai',
};

let state = loadState();
let secret = loadSecret();
const songs = loadSongs();

function normalizeState(parsed) {
  parsed = parsed && typeof parsed === 'object' ? parsed : {};
  parsed.event = { ...DEFAULT_EVENT, ...(parsed.event || {}) };
  // batas durasi: angka rapi, perlakuan hanya dua nilai yang sah
  parsed.event.maksDurasiMenit = Math.max(0, Math.min(120, Number(parsed.event.maksDurasiMenit) || 0));
  if (!['tandai', 'tolak'].includes(parsed.event.perlakuanDurasiPanjang)) {
    parsed.event.perlakuanDurasiPanjang = DEFAULT_EVENT.perlakuanDurasiPanjang;
  }
  parsed.tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
  for (const t of parsed.tracks) {
    if (t.votes == null || typeof t.votes !== 'object') t.votes = {};
    // tidak ada lagi status "menunggu" — request yang masih tertahan langsung
    // masuk antrean supaya tidak menggantung tanpa bisa diputar
    if (t.status === 'pending') t.status = 'queued';
  }
  if (typeof parsed.autoNext !== 'boolean') parsed.autoNext = true;
  // daftar user panel (hanya hash+salt, tidak pernah password polos)
  parsed.users = Array.isArray(parsed.users) ? parsed.users : [];
  for (const u of parsed.users) if (u.peran === 'operator') u.peran = 'user'; // migrasi nama peran lama
  // pengaturan adzan otomatis (pemutar dijeda saat adzan)
  if (!parsed.adzan || typeof parsed.adzan !== 'object') parsed.adzan = {};
  if (typeof parsed.adzan.enabled !== 'boolean') parsed.adzan.enabled = true;
  if (!Number.isFinite(parsed.adzan.durasi)) parsed.adzan.durasi = 10;
  if (parsed.adzan.jadwal && typeof parsed.adzan.jadwal !== 'object') delete parsed.adzan.jadwal;
  return parsed;
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return normalizeState({});
  }
}

function loadSongs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SONGS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSecret() {
  try {
    const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (s) return s;
  } catch {}
  if (IS_VERCEL) {
    // Jangan tulis apa pun (filesystem baca-saja); wajib diset via env.
    if (!process.env.APP_SECRET) {
      console.error('[RequestLagu] APP_SECRET belum di-set — login DJ akan gagal di cold start berikutnya.');
    }
    return process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
  }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}

/* ------------------------------------------- penyimpanan mode daring (Supabase & Redis) */

/**
 * Penyimpanan daring memakai dua lapis:
 * - Supabase (PostgREST) = store utama. Menulis state & membaca state.
 * - Redis (Upstash REST / Vercel KV) = cadangan kalau Supabase tidak bisa
 *   dihubungi. Semua perintah Redis dibatasi waktunya supaya tidak pernah
 *   menggantungkan request (terladyang saat deploy pertama, Redis sempat
 *   menahan seluruh situs sampai 504).
 */
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY;
const USE_SUPABASE = Boolean(IS_VERCEL && SUPABASE_URL && SUPABASE_KEY);

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const USE_REDIS = Boolean(IS_VERCEL && !USE_SUPABASE && REDIS_URL && REDIS_TOKEN);
/** Redis sebagai store panas (kunci tulis + baca/tulis state). Nyalakan dengan
 *  env REDIS_PANAS=1. Semua perintah Redis dibatasi 1,5 detik, jadi kalau
 *  Redis bermasalah sistem otomatis jatuh ke Supabase — tidak menggantung. */
const PAKAI_REDIS_PANAS = Boolean(
  IS_VERCEL && process.env.REDIS_PANAS === '1' && REDIS_URL && REDIS_TOKEN
);

const STATE_KEY = 'requestlagu:state';
const LOCK_KEY = 'requestlagu:lock';
/* Status pemutar (siapa yang memegang, lagu apa, posisi) disimpan di baris
 * KECIL tersendiri — bukan di state utama. Alasannya: panel DJ mengirim
 * detak tiap 5 detik; kalau itu menulis state utama (puluhan KB), setiap
 * detak jadi satu penulisan penuh yang menahan kunci dan antre di belakang
 * aksi DJ. Baris kecil ini ditulis tanpa kunci, jadi detak selalu ringan. */
const PLAYER_KEY = 'requestlagu:player';
/** Batas lagu yang boleh menunggu di antrean. Setelah tercapai, request
 *  ditutup otomatis sampai DJ membukanya lagi. */
const BATAS_REQUEST = 20;
let dirty = false; // penanda ada mutasi yang belum disimpan (mode daring)
let stateSiap = false; // state request ini benar-benar termuat dari cloud?

const RL_KANAL = 'requestlagu';

/** Kirim satu event ke semua klien lewat Supabase Realtime (HTTP).
 *  WAJIB di-await oleh pemanggil: container Vercel boleh dibekukan tepat
 *  setelah response dikirim, jadi fetch "fire-and-forget" bisa tertahan
 *  detik-detik (terukur 2,7–4,7 detik) atau hilang sama sekali. */
async function kirimRealtime(namaEvent, muatan) {
  if (!USE_SUPABASE) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast/${RL_KANAL}/events/${namaEvent}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(muatan),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) console.warn(`Broadcast realtime HTTP ${r.status} (${namaEvent})`);
  } catch (err) {
    console.warn(`Broadcast realtime meleset (${namaEvent}): ${err && err.message}`);
  }
}

/** Umumkan state terbaru ke semua klien dalam SATU event.
 *  Isinya bukan sekadar "ada perubahan" — state-nya ikut dikirim, jadi
 *  halaman tamu bisa langsung memakai data baru tanpa menarik ulang dari
 *  server (memotong satu putaran jaringan dari syarat "paling cepat").
 *  Klien lama tetap berfungsi: mereka tetap mendengarkan event `update` lalu
 *  menarik ulang seperti biasa, karena isinya tidak berubah bagi mereka. */
async function umumkanState() {
  if (!USE_SUPABASE) return;
  const payload = publicStateRamping();
  simpanSnapshot(payload); // snapshot lokal ikut segar supaya bacaan berikutnya instan
  await kirimRealtime('update', { v: state.versi, state: payload });
}

/* --- Supabase (PostgREST) --- */

async function ambilKunciSupabase() {
  const token = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const now = Date.now();
  const expiresAt = now + 8000;
  try {
    const getUrl = `${SUPABASE_URL}/rest/v1/app_state?key=eq.${encodeURIComponent(LOCK_KEY)}&select=value`;
    const getRes = await fetch(getUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        accept: 'application/json',
      },
    });
    if (!getRes.ok) {
      const errText = await getRes.text().catch(() => '');
      console.error(`Gagal cek lock Supabase (HTTP ${getRes.status}):`, errText);
      return { ok: false, reason: 'redis' };
    }
    const rows = await getRes.json();
    const curr = Array.isArray(rows) && rows.length > 0 ? rows[0].value : null;
    if (curr && typeof curr === 'object' && curr.expiresAt && curr.expiresAt > now) {
      return { ok: false, reason: 'dimiliki' };
    }

    const postUrl = `${SUPABASE_URL}/rest/v1/app_state`;
    const postRes = await fetch(postUrl, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        key: LOCK_KEY,
        value: { token, expiresAt },
        updated_at: new Date().toISOString(),
      }),
    });
    if (!postRes.ok) {
      const errText = await postRes.text().catch(() => '');
      console.error(`Gagal ambil lock Supabase (HTTP ${postRes.status}):`, errText);
      return { ok: false, reason: 'redis' };
    }
    return { ok: true, token };
  } catch (err) {
    console.error('Gagal mengambil kunci tulis Supabase:', err.message);
    return { ok: false, reason: 'redis' };
  }
}

async function lepasKunciSupabase(token) {
  if (!token || token === 'lokal') return;
  try {
    const delUrl = `${SUPABASE_URL}/rest/v1/app_state?key=eq.${encodeURIComponent(LOCK_KEY)}`;
    await fetch(delUrl, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
  } catch { /* kunci kedaluwarsa otomatis lewat expiresAt */ }
}

async function loadStateSupabase() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/app_state?key=eq.${encodeURIComponent(STATE_KEY)}&select=value`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`Gagal mengambil state dari Supabase (HTTP ${res.status}):`, errText);
      return { ok: false, error: `Supabase HTTP ${res.status}: ${errText}` };
    }
    const rows = await res.json();
    const raw = Array.isArray(rows) && rows.length > 0 ? rows[0].value : null;
    return { ok: true, state: raw ? normalizeState(raw) : null };
  } catch (err) {
    console.error('Gagal mengambil state dari Supabase:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Tulis state ke cadangan durable Supabase (PostgREST).
 *  Tidak menaikkan versi dan tidak menyiarkan apa pun — tugas itu milik
 *  saveStateRemote() supaya ada SATU tempat yang mengatur nomor versi. */
async function simpanCadanganSupabase() {
  const url = `${SUPABASE_URL}/rest/v1/app_state`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: STATE_KEY,
      value: state,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase UPSERT -> HTTP ${res.status}: ${errText}`);
  }
}

/* --- Redis (Upstash) --- */

async function ambilKunciRedis() {
  const token = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const res = await redis('SET', LOCK_KEY, token, 'NX', 'EX', '8');
    return res === 'OK' ? { ok: true, token } : { ok: false, reason: 'dimiliki' };
  } catch (err) {
    console.error('Gagal mengambil kunci tulis Redis:', err.message);
    return { ok: false, reason: 'redis' };
  }
}

async function lepasKunciRedis(token) {
  if (!token || token === 'lokal') return;
  try {
    const sekarang = await redis('GET', LOCK_KEY);
    if (sekarang === token) await redis('DEL', LOCK_KEY);
  } catch { /* kunci akan hilang sendiri setelah kedaluwarsa */ }
}

async function redis(cmd, ...args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify([cmd, ...args]),
    // Batas waktu wajib: perintah yang menggantung akan menahan seluruh
    // request sampai Vercel membunuhnya (504).
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Redis ${cmd} -> HTTP ${res.status}: ${errText}`);
  }
  return (await res.json()).result;
}

async function loadStateRedis() {
  try {
    const raw = await redis('GET', STATE_KEY);
    return { ok: true, state: raw ? normalizeState(JSON.parse(raw)) : null };
  } catch (err) {
    console.error('Gagal mengambil state dari Redis:', err.message);
    return { ok: false, error: err.message };
  }
}

/* --- Baris status pemutar (kecil, ditulis tanpa kunci tulis state utama) --- */

async function simpanPemutar(player) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_state`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: PLAYER_KEY,
      value: player,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Simpan status pemutar -> HTTP ${res.status}`);
}

/** Status pemutar terakhir yang tersimpan (sumber kebenaran "masih hidup"). */
async function ambilPemutar() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_state?key=eq.${PLAYER_KEY}&select=value`, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0].value : null;
}

async function saveStateRedis() {
  await redis('SET', STATE_KEY, JSON.stringify(state));
}

/** Detak status pemutar dari panel DJ.
 *  Ringan: hanya menulis baris status pemutar (kecil) + menyiarkannya ke
 *  panel lain. State utama tidak disentuh, jadi detak tidak pernah menahan
 *  kunci tulis dan tidak menggeser antrean. */
async function layaniStatusPemutar(req, res) {
  if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
  const body = await readBody(req);
  const player = {
    status: clean(body.status, 24) || 'siap',
    detail: clean(body.detail, 200),
    trackId: clean(body.trackId, 64),
    panel: clean(body.panel, 40) || (state.player && state.player.panel) || '',
    updatedAt: Date.now(),
    // Posisi lagu yang sedang diputar (detik) — dipakai supaya panel yang
    // dimuat ulang atau DJ yang pindah device melanjutkan dari titik ini.
    posisi: Math.max(0, Math.min(86400, Number(body.posisi) || 0)),
  };
  state.player = player;
  if (USE_SUPABASE) {
    try { await simpanPemutar(player); }
    catch (err) { console.error('Gagal menyimpan status pemutar:', err.message); }
    // Kabari panel-panel lain (ringan, tanpa menulis ke database).
    try { await kirimRealtime('player', player); } catch { /* abaikan */ }
  }
  return sendJson(res, 200, { ok: true, player });
}

/* --- Dispatcher Penyimpanan Daring --- */
/* Kunci ditulis berbeda per backend, jadi token diberi awalan agar pelepasan
 * kunci tahu harus ke backend mana: 'r:' = Redis, 's:' = Supabase. */

async function ambilKunci() {
  if (!IS_VERCEL) return { ok: true, token: 'lokal' };
  if (PAKAI_REDIS_PANAS) {
    const r = await ambilKunciRedis();
    if (r.ok) return { ok: true, token: `r:${r.token}` };
    console.error('Kunci Redis gagal, lanjut ke Supabase:', r.error || r.reason);
  }
  if (USE_SUPABASE) {
    const s = await ambilKunciSupabase();
    if (s.ok) return { ok: true, token: `s:${s.token}` };
    return s;
  }
  if (USE_REDIS) {
    const r = await ambilKunciRedis();
    if (r.ok) return { ok: true, token: `r:${r.token}` };
    return r;
  }
  return { ok: true, token: 'lokal' };
}

async function lepasKunci(token) {
  if (!token || token === 'lokal') return;
  if (token.startsWith('s:')) return lepasKunciSupabase(token.slice(2));
  if (token.startsWith('r:')) return lepasKunciRedis(token.slice(2));
}

async function loadStateRemote() {
  if (!IS_VERCEL) return { ok: true, state: null, lokal: true };
  if (PAKAI_REDIS_PANAS) {
    const r = await loadStateRedis();
    if (r.ok && r.state) return { ok: true, state: r.state };
    if (!r.ok) console.error('Redis tidak terbaca, lanjut ke Supabase:', r.error);
    // Redis kosong → ambil dari cadangan durable, lalu semai Redis.
    if (USE_SUPABASE) {
      const s = await loadStateSupabase();
      if (s.ok && s.state) {
        try { await redis('SET', STATE_KEY, JSON.stringify(s.state)); }
        catch (err) { console.error('Gagal menyemai Redis:', err.message); }
      }
      return s;
    }
    return { ok: true, state: null };
  }
  if (USE_SUPABASE) return loadStateSupabase();
  if (USE_REDIS) return loadStateRedis();
  return { ok: true, state: null, lokal: true };
}

async function saveStateRemote() {
  if (!IS_VERCEL) return;
  // Penyimpanan = gerbang mutasi, jadi kenaikan nomor versi di sini
  // mewakili SEMUA jalur perubahan (antrean, vote, pengaturan acara).
  state.versi = (state.versi || 0) + 1;
  if (PAKAI_REDIS_PANAS) {
    let amanRedis = false;
    try {
      await redis('SET', STATE_KEY, JSON.stringify(state));
      amanRedis = true;
    } catch (err) {
      console.error('Gagal menyimpan ke Redis:', err.message);
    }
    // Cadangan durable tetap ditulis ke Supabase (dibaca balik kalau Redis
    // kosong), jadi data utama tidak pernah hanya hidup di satu tempat.
    if (USE_SUPABASE) await simpanCadanganSupabase();
    if (!amanRedis && !USE_SUPABASE) throw new Error('Gagal menyimpan state');
  } else if (USE_SUPABASE) {
    await simpanCadanganSupabase(); // gagal = mutasi gagal, klien diberi tahu
  } else if (USE_REDIS) {
    await saveStateRedis();
  } else {
    throw new Error('Tidak ada store yang bisa menyimpan state');
  }
  // Umumkan ke semua klien. WAJIB ditunggu: container Vercel bisa langsung
  // dibekukan setelah response, jadi broadcast yang belum terkirim akan molor
  // beberapa detik atau hilang (terukur 2,7–4,7 detik di produksi).
  await umumkanState();
}

/* --- Baca state cepat (GET /api/state) ---
 * Halaman tamu memanggil endpoint ini terus-menerus. Setiap pembacaan store
 * (~300-500 ms) masuk antrean mutex per instance, jadi saat acara ramai
 * antrean menumpuk dan semua orang menunggu beberapa detik (terukur p95
 * 3,3-4,0 detik). Tiga lapis perbaikan:
 *  1) jalur baca ini TIDAK ikut antrean mutex — satu request yang lambat
 *     tidak menahan yang lain;
 *  2) snapshot per instance (1 detik) → satu pembacaan store per detik per
 *     instance, berapa pun jumlah tamu;
 *  3) cache edge Vercel (2 detik) → sebagian besar request tidak menyentuh
 *     server sama sekali.
 * Perubahan terbaru tetap sampai lewat push realtime, jadi snapshot 1 detik
 * tidak membuat layar lama. */
const SNAPSHOT_MS = 1000;
const HEADER_CACHE_STATE = 'public, s-maxage=2, stale-while-revalidate=4';
let snapshotPayload = null;
let snapshotPada = 0;
let muatStateBerjalan = null;

function ambilSnapshot() {
  if (snapshotPayload && Date.now() - snapshotPada < SNAPSHOT_MS) return snapshotPayload;
  return null;
}

function simpanSnapshot(payload) {
  snapshotPayload = payload;
  snapshotPada = Date.now();
}

/** Baca state dari store. Permintaan yang datang bersamaan digabung jadi satu
 *  pembacaan supaya tidak ada badai permintaan ke database. */
async function muatStateSekali() {
  if (muatStateBerjalan) return muatStateBerjalan;
  muatStateBerjalan = (async () => {
    try {
      const hasil = await loadStateRemote();
      if (!hasil.ok) return { ok: false, error: hasil.error };
      if (!hasil.state) return { ok: true, payload: publicStateRamping() };
      const payload = publicStateRamping(hasil.state);
      simpanSnapshot(payload);
      return { ok: true, payload, state: hasil.state };
    } finally {
      muatStateBerjalan = null;
    }
  })();
  return muatStateBerjalan;
}

/** Balas GET /api/state tanpa mengunci mutex dan tanpa menyentuh store kalau
 *  snapshot masih segar. */
async function serveStateCepat(req, res) {
  const snap = ambilSnapshot();
  if (snap) return sendJson(res, 200, snap, HEADER_CACHE_STATE);
  try {
    const hasil = await muatStateSekali();
    if (!hasil.ok) {
      return sendJson(res, 503, { error: 'Data acara sedang tidak terbaca. Coba lagi sebentar.' }, 'no-store');
    }
    return sendJson(res, 200, hasil.payload, HEADER_CACHE_STATE);
  } catch (err) {
    console.error('Gagal membaca state:', err.message);
    return sendJson(res, 503, { error: 'Data acara sedang tidak terbaca. Coba lagi sebentar.' }, 'no-store');
  }
}

let saveTimer = null;
function save() {
  if (IS_VERCEL) {
    dirty = true; // disimpan oleh pemanggil request setelah handler selesai
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Gagal menyimpan state:', err.message);
    }
  }, 120);
}

function newId() {
  return 't' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ------------------------------------------------------------ sse clients */

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/** Terakhir dikirim panel DJ — beat-grid untuk visualizer tamu (tidak dipersist). */
let beatCache = null;

/** Broadcast beat sebagai named event supaya murah & tidak memicu render state penuh. */
function broadcastBeat(payload) {
  beatCache = payload;
  const line = `event: beat\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
}

/** Bentuk state untuk dikirim ke klien: antrean, lagu yang sedang diputar, dan
 *  riwayat terbaru saja. Riwayat lama tidak pernah tampil di layar, tapi dulu
 *  ikut terunggah setiap kali (21 KB saat antrean 68 lagu). Dipakai untuk
 *  response /api/state dan untuk isi event realtime. */
function publicStateRamping(dariState = state) {
  const p = publicState(dariState);
  const semua = Array.isArray(dariState.tracks) ? dariState.tracks : [];
  const antrian = semua.filter((t) => t.status === 'queued' || t.status === 'playing');
  const selesai = semua.filter((t) => t.status === 'done').slice(-12);
  const ditolak = semua.filter((t) => t.status === 'rejected').slice(-8);
  p.tracks = antrian.concat(selesai, ditolak);
  return p;
}

/** YouTube kadang menulis durasi dengan TITIK ("3.39" = 3 menit 39 detik),
 *  terutama di hasil pencarian InnerTube. Semua yang membaca durasi di app ini
 *  (tampilan, hitungan detik, total jam) mengira "m:ss" — jadi bentuknya
 *  dinormalkan di satu tempat, sebelum keluar ke klien. */
function normalisasiDurasi(teks) {
  const s = String(teks == null ? '' : teks).trim();
  if (!s) return '';
  // "3.39" atau "3:39" → "3:39"; "1.02.03" → "1:02:03"
  if (/^\d+\.\d{2}$/.test(s)) return s.replace('.', ':');
  if (/^\d+\.\d{2}\.\d{2}$/.test(s)) return s.replace(/\./g, ':');
  // detik polos → "m:ss"
  if (/^\d+$/.test(s)) {
    const d = Number(s);
    const j = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const sisa = d % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sisa).padStart(2, '0');
    return j > 0 ? `${j}:${mm}:${ss}` : `${m}:${ss}`;
  }
  return s;
}

/** Ubah durasi YouTube ("3:45" / "1:02:03" / "3.39") menjadi detik. */
function durasiKeDetik(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return 0;
  if (typeof nilai === 'number') return Number.isFinite(nilai) ? Math.max(0, Math.round(nilai)) : 0;
  const mentah = String(nilai).trim();
  // "3.39" (menit.detik) ikut dibaca sebagai 3 menit 39 detik. Angka desimal
  // satu digit ("3.4") dianggap detik biasa, bukan menit.detik.
  const pemisah = /^\d+(\.\d{2}){1,2}$/.test(mentah) ? '.' : ':';
  const bagian = mentah.split(pemisah).map((x) => Number(x));
  if (!bagian.length || bagian.some((x) => !Number.isFinite(x))) return 0;
  let detik = 0;
  for (const b of bagian) detik = detik * 60 + b;
  return Math.max(0, Math.min(Math.round(detik), 86400));
}

/** Ringkasan durasi acara: berapa lama antrean, berapa lama sudah diputar.
 * tracks yang durasinya belum diketahui tetap dihitung sebagai 0 — makanya
 *  angka ditampilkan sebagai batas bawah, bukan karangan. */
function hitungStatistik(dariState = state) {
  let antreanLagu = 0; let antreanDetik = 0; let antreanDiketahui = 0;
  let diputarLagu = 0; let diputarDetik = 0; let diputarDiketahui = 0;
  let durasiDiketahui = 0;
  let berlebihan = 0; // lagu di antrean yang melewati batas durasi acara
  for (const t of dariState.tracks || []) {
    const dur = durasiKeDetik(t.dur);
    if (dur > 0) durasiDiketahui += 1;
    if (t.status === 'queued') {
      antreanLagu += 1; antreanDetik += dur;
      if (dur > 0) antreanDiketahui += 1;
      if (t.melebihiBatas) berlebihan += 1;
    } else if (t.status === 'done') {
      diputarLagu += 1; diputarDetik += dur;
      if (dur > 0) diputarDiketahui += 1;
    }
  }
  return {
    antrean: { lagu: antreanLagu, detik: antreanDetik, durasiDiketahui: antreanDiketahui },
    diputar: { lagu: diputarLagu, detik: diputarDetik, durasiDiketahui: diputarDiketahui },
    durasiDiketahui,
    berlebihan,
  };
}

function publicState(dariState = state) {
  const order = queueOrder(dariState).map((t) => t.id); // urutan antrean versi vote
  return {
    event: {
      name: dariState.event.name,
      tagline: dariState.event.tagline,
      open: dariState.event.open,
      allowVotes: dariState.event.allowVotes,
      allowMessages: dariState.event.allowMessages,
      maksDurasiMenit: dariState.event.maksDurasiMenit || 0,
      perlakuanDurasiPanjang: dariState.event.perlakuanDurasiPanjang || 'tandai',
    },
    tracks: dariState.tracks,
    order,
    nextId: order[0] || null,
    autoNext: Boolean(dariState.autoNext),
    player: dariState.player || null,
    beat: beatCache,
    batas: BATAS_REQUEST,
    statistik: hitungStatistik(dariState),
    serverTime: Date.now(),
  };
}

/* ------------------------------------------------------------------
   Jadwal adzan per kota (myquran.com) — lebih tepercaya daripada GPS
   perangkat: koordinat HP bisa di luar lokasi acara, dan itu yang bikin
   jam meleset. Daftar kota Indonesia diambil dari sana, sekali saja.
   ------------------------------------------------------------------ */

let cacheKota = { daftar: null, diambilPada: 0 };
const UMUR_KOTA_MS = 12 * 60 * 60 * 1000; // 12 jam

// Kalau pengambilan jadwal gagal, jangan langsung mencoba lagi: setiap buka
// halaman akan memicu percobaan ulang dan sumber jadwal bisa-rate-limit (429),
// sehingga satu gangguan kecil berubah macet terus. Jeda 10 menit dulu.
const JEDA_GAGAL_MS = 10 * 60 * 1000;
let jedaCobaJadwal = 0;

/** Ambil JSON dengan satu percobaan ulang (sumber kadang gagal sesaat). */
async function ambilJson(url) {
  for (let percobaan = 0; percobaan < 2; percobaan += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return await res.json();
      const terakhir = percobaan === 1;
      if (!terakhir && res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    } catch (err) {
      if (percobaan === 1) throw err;
      await new Promise((r) => setTimeout(r, 400)); // jeda sebentar lalu coba lagi
    }
  }
  throw new Error('Gagal mengambil jadwal');
}

/** Ambil daftar kota/kabupaten Indonesia (id + nama) dari myquran. */
async function ambilDaftarKota() {
  if (cacheKota.daftar && Date.now() - cacheKota.diambilPada < UMUR_KOTA_MS) {
    return cacheKota.daftar;
  }
  const data = await ambilJson('https://api.myquran.com/v2/sholat/kota/semua');
  const daftar = (Array.isArray(data.data) ? data.data : [])
    .map((k) => ({ id: String(k.id || ''), nama: String(k.lokasi || '').trim() }))
    .filter((k) => k.id && k.nama);
  if (!daftar.length) throw new Error('Daftar kota kosong');
  cacheKota = { daftar, diambilPada: Date.now() };
  return daftar;
}

/** Samakan disparate penulisan: "KAB. BOGOR" dan "bogor" harus ketemu. */
function normalisasiKota(nama) {
  return String(nama || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Pecah nama kota jadi kata-kata yang sudah bersih. Harus dari nama mentah:
 * normalisasiKota menghapus spasi, sehingga "KOTA JAKARTA" jadi satu gumpalan
 * dan tidak bisa dipisahkan lagi.
 */
function kataKota(nama) {
  return String(nama || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((w) => normalisasiKota(w))
    .filter(Boolean);
}

/**
 * Cari kota dari teks yang diketik DJ.
 * Urutan: persis → diawali → memuat → Similar. Kalau gagal, kembalikan
 * saran supaya DJ tahu apa yang dimaksud (bukan "tidak ditemukan").
 */
async function cariKota(teks) {
  const cari = normalisasiKota(teks);
  if (!cari) return { ok: false, saran: [] };
  const daftar = await ambilDaftarKota();

  const persis = daftar.find((k) => normalisasiKota(k.nama) === cari);
  if (persis) return { ok: true, kota: persis };

  const diawali = daftar.find((k) => normalisasiKota(k.nama).startsWith(cari));
  if (diawali) return { ok: true, kota: diawali };

  const memuat = daftar.filter((k) => normalisasiKota(k.nama).includes(cari));
  if (memuat.length === 1) return { ok: true, kota: memuat[0] };
  if (memuat.length > 1) {
    return { ok: false, saran: memuat.slice(0, 8).map((k) => k.nama) };
  }

  // Dua huruf depan teks sering tidak cocok dengan nama kota yang diawali
  // "KOTA"/"KAB" — jadi lihat juga awal setiap kata di nama kota, dan zobraf
  // tertukar huruf ("jakrta" -> "jakarta").
  const awal = cari.slice(0, 3);
  const huruf = cari.split('').slice().sort().join('');
  const mirip = daftar.filter((k) => kataKota(k.nama).some((w) => w.length >= 3
    && (w.startsWith(awal) || w.split('').sort().join('') === huruf))).slice(0, 8);
  return { ok: false, saran: mirip.map((k) => k.nama) };
}

/** Jadwal salat satu kota untuk satu tanggal (myquran v1: /tahun/bulan/tanggal). */
async function ambilJadwalKota(idKota, tanggal) {
  const [tgl, bulan, tahun] = String(tanggal).split('-'); // "02-10-2026"
  if (!tgl || !bulan || !tahun) throw new Error('Tanggal tidak valid');
  // myquran v1 memakai urutan /tahun/bulan/tanggal (bukan urutan aslinya)
  const u = `https://api.myquran.com/v1/sholat/jadwal/${encodeURIComponent(idKota)}`
    + `/${encodeURIComponent(tahun)}/${encodeURIComponent(bulan)}/${encodeURIComponent(tgl)}`;
  const data = await ambilJson(u);
  const j = (data && data.data && data.data.jadwal) || null;
  if (!j) throw new Error('Jadwal kota kosong');
  const jadwal = {};
  if (cekJamAdzan(j.subuh)) jadwal.Fajr = j.subuh;
  if (cekJamAdzan(j.dzuhur)) jadwal.Dhuhr = j.dzuhur;
  if (cekJamAdzan(j.ashar)) jadwal.Asr = j.ashar;
  if (cekJamAdzan(j.maghrib)) jadwal.Maghrib = j.maghrib;
  if (cekJamAdzan(j.isya)) jadwal.Isha = j.isya;
  if (Object.keys(jadwal).length < 5) throw new Error('Jadwal kota tidak lengkap');
  return { jadwal, lokasi: String(data.data.lokasi || '').trim() };
}

/* ---------------------------------------------------------------- helpers */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webp': 'image/webp',
};

/** Kirim JSON. `cacheControl` opsional: dipakai untuk response yang aman
 *  di-cache edge Vercel (mis. state acara yang juga disiarkan lewat realtime). */
function sendJson(res, code, obj, cacheControl) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl || 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  // Body boleh dibaca lebih dari sekali (mis. pengecekan cepat sebelum
  // handler jalan) — hasil pertama disimpan di req.
  if (req._bodySudahDibaca) return Promise.resolve(req._bodySudahDibaca);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body terlalu besar'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) { req._bodySudahDibaca = {}; return resolve({}); }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        req._bodySudahDibaca = parsed;
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('JSON tidak valid'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Kredensial user: { username, nama, peran, salt, hash }.
 * Password tidak pernah disimpan polos — hanya hash scrypt + salt per user.
 * Peran: 'user' (request + vote + ganti password sendiri, via halaman tamu)
 * atau 'admin' (memutar & mengelola antrean di panel DJ).
 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function buatUser(username, nama, password, peran = 'user') {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, nama, peran, salt, hash: hashPassword(password, salt) };
}

/** @returns user jika username+password cocok, null jika tidak. */
function cekUser(username, password) {
  const u = state.users.find((x) => x.username === username);
  if (!u) return null;
  try {
    if (crypto.timingSafeEqual(
      Buffer.from(hashPassword(password, u.salt), 'hex'),
      Buffer.from(u.hash, 'hex'),
    )) return u;
  } catch { /* panjang beda → tidak cocok */ }
  return null;
}

/**
 * Token = <username>.<hmac(secret, username, hash)>. Stateless (tanpa sesi
 * server) dan otomatis tidak berlaku tiap kali password diganti, karena hash
 * ikut dicampur ke dalam hmac.
 */
function buatToken(user) {
  const mac = crypto.createHash('sha256')
    .update(`${secret}:${user.username}:${user.hash}`).digest('hex');
  return `${user.username}.${mac}`;
}

/** @returns { username, peran } jika token valid, null jika tidak. */
function djSesi(req) {
  const raw = String(req.headers['x-dj-token'] || '');
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const username = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const u = state.users.find((x) => x.username === username);
  if (!u || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const want = crypto.createHash('sha256')
    .update(`${secret}:${u.username}:${u.hash}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(want, 'hex'))) return null;
  } catch { return null; }
  return { username: u.username, peran: u.peran || 'user' };
}

function isDj(req) {
  return Boolean(djSesi(req));
}

/** Sesi admin saja — dipakai endpoint pemutar & adzan (panel DJ sekarang admin-only). */
function adminSesi(req) {
  const sesi = djSesi(req);
  return sesi && sesi.peran === 'admin' ? sesi : null;
}

function isAdmin(req) {
  return Boolean(adminSesi(req));
}

function clean(str, max) {
  return String(str ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function ytId(input) {
  const s = clean(input, 300);
  const m = s.match(/^([A-Za-z0-9_-]{11})$/) || s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || s.match(/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function findTrack(id) {
  return state.tracks.find((t) => t.id === id) || null;
}

/** Lagu yang sama persis (video id sama) yang masih menunggu atau sedang
 *  diputar. Lagu yang sudah selesai tidak dihitung — request ulang setelah
 *  lagu selesai itu wajar. */
function cariLaguSama(yt) {
  if (!yt) return null;
  return state.tracks.find(
    (t) => t.yt === yt && (t.status === 'queued' || t.status === 'playing'),
  ) || null;
}

/** Jawab request lagu yang sudah ada di antrean: tidak dibuat duplikat,
 *  tapi keinginkan peminta tetap dihitung lewat vote (kalau voting dibuka). */
function kirimDuplikat(res, track, deviceId) {
  let sudahVote = false;
  if (state.event.allowVotes && track.votes && !track.votes[deviceId]) {
    sudahVote = true;
    mutate(() => { track.votes[deviceId] = 1; });
  }
  const antrean = antreanUrut(state.tracks.filter((t) => t.status === 'queued'));
  const posisi = antrean.findIndex((t) => t.id === track.id) + 1;
  return sendJson(res, 200, {
    duplikat: true,
    track,
    status: track.status,
    posisi: posisi > 0 ? posisi : 0,
    sudahVote,
    catatan: track.status === 'playing'
      ? 'Lagu ini sedang diputar.'
      : `Lagu ini sudah ada di antrean${posisi > 0 ? ` (posisi #${posisi})` : ''}.`,
  });
}

function playingTrack() {
  return state.tracks.find((t) => t.status === 'playing') || null;
}

/**
 * Antrean diurutkan berdasarkan vote: paling banyak vote dulu. Votes yang
 * seri diselesaikan dengan urutan manual DJ (prio), lalu yang masuk lebih
 * dulu. Server, panel DJ, dan halaman tamu memakai urutan yang sama
 * supaya semua layar sinkron real-time.
 */
function antreanUrut(list) {
  return list.slice().sort(
    (a, b) => voteCount(b) - voteCount(a)
      || (a.prio ?? a.createdAt) - (b.prio ?? b.createdAt)
      || a.createdAt - b.createdAt,
  );
}

function queuedTrack() {
  return antreanUrut(state.tracks.filter((t) => t.status === 'queued'))[0] || null;
}

/** Seluruh antrean (sudah terurut) — dipakai advance() dan laporan sinkronisasi. */
function queueOrder(dariState = state) {
  return antreanUrut(dariState.tracks.filter((t) => t.status === 'queued'));
}

function voteCount(track) {
  return Object.keys((track && track.votes) || {}).length;
}

function mutate(fn) {
  fn();
  save();
  broadcast();
}

/** Tandai lagu yang sedang diputar selesai, lalu naikkan lagu queued berikutnya. */
function advance() {
  state.autoNext = true; // maju berikutnya selalu menyalakan kembali auto-play
  const current = playingTrack();
  if (current) {
    current.status = 'done';
    current.playedAt = Date.now();
  }
  const next = queuedTrack(); // urutan vote, bukan urutan masuk
  if (next) {
    next.status = 'playing';
    next.playedAt = Date.now();
  }
  save();
  broadcast();
  return next;
}

/* ------------------------------------------------- youtube search (opsional) */

const ytCache = new Map(); // q -> {results:[...], at}
const YT_CACHE_TTL = 1000 * 60 * 30; // 30 menit

/** Ambil halaman hasil pencarian YouTube (dipakai bersama oleh semua fitur). */
async function youtubeResultsPage(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'id-ID,id;q=0.9,en;q=0.6',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`YouTube merespons ${response.status}`);
  return response.text();
}

function unescapeJson(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s; }
}

/** Pecah HTML hasil YouTube menjadi daftar video {id,title,channel,duration}. */
function parseVideoRenderers(html, limit = 12) {
  const out = [];
  let cursor = 0;
  while (out.length < limit) {
    const marker = html.indexOf('"videoRenderer":', cursor);
    if (marker === -1) break;
    // satu renderer ≈ 2–6 KB; ambil potongan secukupnya untuk semua regex
    const slice = html.slice(marker, marker + 6000);
    cursor = marker + 16;

    const id = slice.match(/"videoId":"([\w-]{11})"/);
    if (!id || id[1] === '---------------') continue;

    const title = slice.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    const owner = slice.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    const secs = slice.match(/"simpleText":"(\d+):(\d{2})"/);
    const thumb = slice.match(/"thumbnail":\{"thumbnails":\[\{"url":"https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/hqdefault\.jpg/);

    if (out.some((r) => r.id === id[1])) continue; // abaikan duplikat
    out.push({
      id: id[1],
      title: title ? unescapeJson(title[1]) : '',
      channel: owner ? unescapeJson(owner[1]) : '',
      duration: normalisasiDurasi(secs ? `${secs[1]}:${secs[2]}` : ''),
      thumbnail: Boolean(thumb),
    });
  }
  return out;
}

/**
 * Cari video lewat API internal YouTube (InnerTube). Hasilnya JSON bersih
 * lengkap dengan durasi, jadi lebih akurat daripada mengurai HTML. Kalau
 * gagal, jinak ke penyaring HTML.
 */
async function youtubeSearchInnerTube(q, limit = 20) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': '2.20240304.00.00',
      'accept-language': 'id-ID,id;q=0.9,en;q=0.6',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240304.00.00', hl: 'id', gl: 'ID' } },
      query: q,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`InnerTube menjawab ${response.status}`);
  const json = await response.json();
  const out = [];
  kumpulkanVideo(json, out, 0);
  const unik = [];
  for (const v of out) {
    if (!v.id || v.id.length !== 11) continue;
    if (unik.some((u) => u.id === v.id)) continue;
    unik.push(v);
    if (unik.length >= limit) break;
  }
  if (!unik.length) throw new Error('InnerTube tidak mengembalikan video');
  return unik;
}

/** Telusuri seluruh JSON InnerTube dan ambil setiap videoRenderer. */
function kumpulkanVideo(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 14 || out.length > 60) return;
  if (Array.isArray(node)) {
    for (const item of node) kumpulkanVideo(item, out, depth + 1);
    return;
  }
  const v = node.videoRenderer;
  if (v) {
    const teks = (x) => (x && x.runs ? x.runs.map((r) => r.text).join('') : (x && x.simpleText) || '');
    out.push({
      id: v.videoId,
      title: teks(v.title),
      channel: teks(v.ownerText) || teks(v.longBylineText),
      duration: normalisasiDurasi((v.lengthText && (v.lengthText.simpleText || '')) || ''),
    });
  }
  for (const nilai of Object.values(node)) kumpulkanVideo(nilai, out, depth + 1);
}

/**
 * Urutkan hasil pencarian menurut kecocokan kata dengan permintaan. Untuk
 * lagu Indonesia, peringkat bawaan YouTube sering meleset, jadi penilaian
 * akhir dilakukan di sini: judul dan channel yang memuat lebih banyak
 * kata kunci dari pertanyaan tamu diurutkan lebih dulu.
 */
function urutkanCocok(query, results) {
  const kata = uniqKata(query);
  if (!kata.length) return results;
  return results
    .map((r, i) => {
      const teks = `${r.title} ${r.channel}`.toLowerCase();
      let cocok = 0;
      for (const k of kata) if (teks.includes(k)) cocok += 1;
      return { r, i, skor: cocok / kata.length, cocok };
    })
    .sort((a, b) => b.skor - a.skor || a.i - b.i)
    .map((x) => x.r);
}

function uniqKata(q) {
  const stop = new Set(['lagu', 'song', 'official', 'audio', 'video', 'musik', 'yang', 'dan', 'di']);
  return [...new Set(
    String(q).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((k) => k.length > 1 && !stop.has(k)),
  )];
}

/**
 * Pencarian YouTube banyak hasil — dasar autosuggestion di halaman tamu
 * (bukan hanya katalog lokal) dan auto-deteksi sumber lagu.
 */
async function youtubeSearchMany(q, limit = 12) {
  const key = q.toLowerCase();
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.at < YT_CACHE_TTL) return hit.results.slice(0, limit);

  let results = [];
  try {
    results = await youtubeSearchInnerTube(q, Math.max(limit * 2, 20));
  } catch {
    results = parseVideoRenderers(await youtubeResultsPage(q), Math.max(limit, 12));
  }
  results = urutkanCocok(q, results);
  ytCache.set(key, { results, at: Date.now() });
  return results.slice(0, limit);
}

/** Satu hasil terbaik — dipakai auto-deteksi sumber lagu. */
async function youtubeSearch(q) {
  const many = await youtubeSearchMany(q, 1);
  if (!many.length) throw new Error('Video tidak ditemukan');
  return many[0];
}

/* --------------------------------------------------------------- adzan otomatis */

const ADZAN_WAKTU = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

/** Tanggal lokal server sebagai 'DD-MM-YYYY' (fallback bila klien tak mengirim). */
function tanggalLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Validasi format tanggal 'DD-MM-YYYY'. */
function cekTanggal(t) {
  return /^[0-3]\d-[01]\d-\d{4}$/.test(String(t || '')) ? String(t) : null;
}

/**
 * Ambil jadwal adzan dari aladhan.com untuk tanggal & koordinat tertentu.
 * method=20 = Kemenag (Indonesia). Hasil hanya "HH:MM" lokal di lokasi tsb.
 */
async function ambilJadwalAdzan(latitude, longitude, tanggal) {
  const u = `https://api.aladhan.com/v1/timings/${encodeURIComponent(tanggal)}`
    + `?latitude=${latitude}&longitude=${longitude}&method=20`;
  const data = await ambilJson(u);
  const t = (data && data.data && data.data.timings) || {};
  const jadwal = {};
  for (const nama of ADZAN_WAKTU) if (t[nama]) jadwal[nama] = String(t[nama]).slice(0, 5);
  if (!Object.keys(jadwal).length) throw new Error('Jadwal adzan kosong');
  return jadwal;
}

/** Validasi jam "HH:MM" 24 jam (00:00 - 23:59). */
function cekJamAdzan(jam) {
  return typeof jam === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(jam.trim());
}

/**
 * Susun jadwal manual dari body request. Hasil null berarti "kembali ke otomatis".
 * Semua lima waktu wajib ada & valid — kalau tidak, kembalikan alasan gagalnya.
 */
function susunJadwalManual(body) {
  if (body.jadwal === null) return { jadwal: null };            // hapus manual
  const masuk = body.jadwal;
  if (!masuk || typeof masuk !== 'object') return { jadwal: null, manual: true };
  const jadwal = {};
  for (const nama of ADZAN_WAKTU) {
    const jam = String(masuk[nama] == null ? '' : masuk[nama]).trim();
    if (!cekJamAdzan(jam)) {
      return { jadwal: null, manual: true, error: `Jam ${nama} tidak valid (pakai format HH:MM).` };
    }
    jadwal[nama] = jam;
  }
  return { jadwal, manual: true };
}

/**
 * Koreksi menit per salat. Jadwal standar Indonesia (Kompas/Tirto/Muslim Pro)
 * belum tentu sama dengan jadwal cetak masjidmu — cara ini tinggal
 * menumpuk koreksinya di atas jadwal kota, jadi tetap ikut berubah tiap hari.
 */
function susunKoreksi(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'koreksi') && body.koreksi === null) {
    return { ada: true, koreksi: null };
  }
  const m = body.koreksi;
  if (!m || typeof m !== 'object') return { ada: false };
  const out = {};
  for (const nama of ADZAN_WAKTU) {
    const n = Math.round(Number(m[nama] == null ? 0 : m[nama]));
    if (!Number.isFinite(n) || Math.abs(n) > 120) {
      return { ada: true, koreksi: null, error: `Koreksi ${nama} harus angka antara -120 dan 120 menit.` };
    }
    out[nama] = n;
  }
  return { ada: true, koreksi: out };
}

/** Geser setiap jam sebesar koreksinya (memutar lewat tengah malam bila perlu). */
function terapkanKoreksi(jadwal, koreksi) {
  if (!jadwal) return null;
  if (!koreksi) return jadwal;
  const out = {};
  for (const nama of ADZAN_WAKTU) {
    const jam = jadwal[nama];
    if (!jam) continue;
    const geser = Math.round(Number(koreksi[nama]) || 0);
    const total = (Number(String(jam).slice(0, 2)) * 60 + Number(String(jam).slice(3)) + geser + 1440) % 1440;
    out[nama] = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  return out;
}

/** Simpan jadwal satu tanggal (cache ringan, maks 3 tanggal terakhir). */
function simpanJadwalAdzan(tanggal, jadwal) {
  if (!state.adzan) state.adzan = { enabled: true, durasi: 10 };
  const semua = { ...(state.adzan.jadwal || {}), [tanggal]: jadwal };
  // "DD-MM-YYYY" tidak bisa diurutkan sebagai teks (15-09 > 02-10 secara abjad),
  // jadi urutkan berdasarkan tanggal sebenarnya supaya cache terbaru tidak terbuang.
  const urut = (t) => {
    const [d, bln, th] = String(t).split('-').map(Number);
    return Number.isFinite(d) && Number.isFinite(bln) && Number.isFinite(th)
      ? th * 10000 + bln * 100 + d
      : 0;
  };
  const keys = Object.keys(semua).sort((a, b) => urut(b) - urut(a)).slice(0, 3);
  state.adzan.jadwal = {};
  for (const k of keys) state.adzan.jadwal[k] = semua[k];
}

/* --------------------------------------------------------------- routing */

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  /* --- publik --- */
  if (method === 'GET' && p === '/api/state') {
    // Di mode daring jalur ini dilayani lebih dulu oleh serveStateCepat();
    // yang di sini adalah jalur lokal (dan cadangan kalau dipanggil langsung).
    return sendJson(res, 200, publicStateRamping(), HEADER_CACHE_STATE);
  }

  if (method === 'GET' && p === '/api/songs') {
    const q = clean(url.searchParams.get('q'), 80).toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 8, 1), 12);

    // Katalog lokal (antrean acara) + YouTube (semua lagu). Katalog lokal
    // tidak diprioritaskan karena sering tidak lengkap.
    const lokal = q
      ? songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q))
      : songs;
    const lokalList = lokal.slice(0, limit).map((s) => ({
      title: s.title,
      artist: s.artist || '',
      yt: '',
      duration: '',
      source: 'katalog',
    }));

    if (!q) return sendJson(res, 200, { songs: lokalList, detected: null });

    try {
      const found = await youtubeSearchMany(q, limit);
      const ytList = found.map((r) => ({
        title: r.title,
        artist: r.channel,
        yt: r.id,
        duration: r.duration,
        source: 'youtube',
      }));
      // Hasil teratas = sumber lagu yang paling cocok (hasil auto-deteksi).
      const detected = ytList[0] || null;
      // katalog lokal hanya melengkapi kalau hasil YouTube kurang
      const gabung = [...ytList, ...lokalList.filter(
        (l) => !ytList.some((y) => y.title.toLowerCase() === l.title.toLowerCase()),
      )].slice(0, limit + 2);
      return sendJson(res, 200, { songs: gabung, detected });
    } catch (err) {
      return sendJson(res, 200, { songs: lokalList, detected: null, catat: err.message });
    }
  }

  /* Auto-deteksi sumber lagu dari judul (live di form tamu). */
  if (method === 'GET' && p === '/api/detect') {
    const q = clean(url.searchParams.get('q'), 120);
    if (q.length < 3) return sendJson(res, 200, { detected: null });
    try {
      const found = await youtubeSearchMany(q, 1);
      const r = found[0];
      return sendJson(res, 200, {
        detected: r ? { title: r.title, artist: r.channel, yt: r.id, duration: r.duration } : null,
      });
    } catch {
      return sendJson(res, 200, { detected: null });
    }
  }

  if (method === 'POST' && p === '/api/login') {
    const body = await readBody(req);
    const username = clean(body.username, 64);
    const password = String(body.password || '').slice(0, 200);
    const u = username ? cekUser(username, password) : null;
    if (!u) return sendJson(res, 401, { error: 'Username atau password salah.' });
    return sendJson(res, 200, {
      token: buatToken(u),
      username: u.username,
      nama: u.nama || u.username,
      peran: u.peran || 'user',
    });
  }

  /* --- info sesi sendiri (validasi token di halaman tamu & panel) --- */
  if (method === 'GET' && p === '/api/me') {
    const sesi = djSesi(req);
    if (!sesi) return sendJson(res, 401, { error: 'Belum masuk.' });
    const u = state.users.find((x) => x.username === sesi.username);
    return sendJson(res, 200, {
      username: sesi.username,
      nama: (u && u.nama) || sesi.username,
      peran: sesi.peran,
    });
  }

  if (method === 'POST' && p === '/api/request') {
    const body = await readBody(req);
    const sesi = djSesi(req);
    if (!sesi) return sendJson(res, 401, { error: 'Kamu harus masuk dulu untuk request lagu.' });
    const deviceId = sesi.username; // identitas request = username yang login

    // Dedupe: lagu yang video id-nya sama persis tidak diantrekan dua kali.
    // Dicek lebih dulu (kalau tamu menempel link, id-nya sudah ada tanpa perlu
    // mencari YouTube) supaya jawabannya "sudah ada di antrean" — bukan
    // "antrean penuh".
    const ytDiminta = ytId(body.yt);
    if (ytDiminta) {
      const sama = cariLaguSama(ytDiminta);
      if (sama) return kirimDuplikat(res, sama, deviceId);
    }

    if (!state.event.open) {
      // Bedakan tutup manual oleh DJ dengan tutup otomatis karena antrean penuh
      const penuh = state.tracks.filter((t) => t.status === 'queued').length >= BATAS_REQUEST;
      return sendJson(res, 403, {
        error: penuh
          ? `Antrean sudah penuh (${BATAS_REQUEST} lagu). Tunggu DJ membuka lagi.`
          : 'Request sedang ditutup oleh DJ.',
        penuh,
      });
    }

    // Batas antrean: begitu mencapai BATAS_REQUEST, request otomatis ditutup
    // supaya tamu tidak menumpuk lagu tanpa batas. DJ yang membuka lagi.
    const jumlahAntrean = () => state.tracks.filter((t) => t.status === 'queued').length;
    if (jumlahAntrean() >= BATAS_REQUEST) {
      if (state.event.open) mutate(() => { state.event.open = false; });
      return sendJson(res, 403, {
        error: `Antrean sudah penuh (${BATAS_REQUEST} lagu). Tunggu DJ membuka lagi.`,
        penuh: true,
      });
    }

    // Selain batas antrean, yang dibatasi hanya kecepatan kirim (anti-abuse)
    // supaya satu orang tidak membanjiri antrean dalam sekejap.
    const recent = state.tracks.filter(
      (t) => t.deviceId === deviceId
        && t.status === 'queued'
        && Date.now() - (t.createdAt || 0) < 60_000,
    ).length;
    if (recent >= 10) return sendJson(res, 429, { error: 'Terlalu cepat — tunggu sebentar sebelum kirim lagi.' });

    const title = clean(body.title, 120);
    if (!title) return sendJson(res, 400, { error: 'Judul lagu wajib diisi.' });

    // Setiap request WAJIB punya sumber lagu: pakai link tempelan tamu,
    // atau cari otomatis di YouTube dari judul + artis.
    let yt = ytDiminta;
    // Durasi ikut dikirim tamu dari hasil pencarian (dalam detik). Kalau tamu
    // mengetik judul manual, server ambil sendiri dari hasil pencarian YouTube.
    let dur = durasiKeDetik(body.dur);
    if (!yt) {
      const artist = clean(body.artist, 120);
      try {
        const found = await youtubeSearch(`${title} ${artist}`.trim());
        yt = found.id;
        if (!dur) dur = durasiKeDetik(found.duration);
      } catch {
        return sendJson(res, 400, {
          error: 'Sumber lagu tidak ditemukan otomatis. Tulis judul lebih spesifik atau tempel link YouTube-nya.',
        });
      }
      // Lagu yang ketemu otomatis juga bisa saja sudah ada di antrean.
      const sama = cariLaguSama(yt);
      if (sama) return kirimDuplikat(res, sama, deviceId);
    }

    // Batas durasi acara: DJ boleh menetapkan lama maksimal lagu.
    // Mode 'tolak' → request ditolak dengan alasan; mode 'tandai' → tetap
    // masuk antrean tapi ditandai, jadi DJ bisa memutuskan sendiri.
    const maksDetik = (Number(state.event.maksDurasiMenit) || 0) * 60;
    let melebihiBatas = false;
    if (maksDetik > 0 && dur > maksDetik) {
      if (state.event.perlakuanDurasiPanjang === 'tolak') {
        return sendJson(res, 403, {
          error: `Lagu ini ${Math.round(dur / 60)} menit, sedangkan batas acara ${state.event.maksDurasiMenit} menit. Pilih lagu yang lebih pendek ya.`,
          melebihiBatas: true,
        });
      }
      melebihiBatas = true;
    }

    const track = {
      id: newId(),
      deviceId,
      title,
      artist: clean(body.artist, 120),
      // Peminta = username yang login (satu sumber kebenaran dengan deviceId),
      // bukan teks yang diketik di form — supaya nama di antrean selalu cocok
      // dengan akun pengirim dan tidak bisa dipalsukan.
      requester: sesi.username,
      message: state.event.allowMessages ? clean(body.message, 240) : '',
      yt,
      audio: '',
      votes: {},
      // Tidak ada lagi status "menunggu": setiap request langsung masuk antrean
      status: 'queued',
      createdAt: Date.now(),
      dur, // durasi lagu dalam detik (0 = belum diketahui)
      melebihiBatas, // melewati batas durasi acara (kalau ada batasnya)
      playedAt: 0,
    };
    // Antrean penuh → request ditutup otomatis. DJ yang membuka kembali.
    const penuh = state.tracks.filter((t) => t.status === 'queued').length + 1 >= BATAS_REQUEST;
    mutate(() => {
      state.tracks.push(track);
      if (penuh) state.event.open = false;
    });
    return sendJson(res, 201, {
      track,
      status: track.status,
      penuh,
      melebihiBatas,
      // Catatan untuk tamu kalau lagunya melewati batas durasi acara.
      catatan: melebihiBatas
        ? `Lagu ini ${Math.round(dur / 60)} menit, melewati batas ${state.event.maksDurasiMenit} menit untuk acara ini — DJ yang memutuskan.`
        : '',
    });
  }

  if (method === 'POST' && p === '/api/vote') {
    const body = await readBody(req);
    if (!state.event.allowVotes) return sendJson(res, 403, { error: 'Voting sedang dimatikan.' });
    const sesi = djSesi(req);
    if (!sesi) return sendJson(res, 401, { error: 'Kamu harus masuk dulu untuk vote.' });
    const deviceId = sesi.username;
    const track = findTrack(clean(body.trackId, 64));
    if (!track) return sendJson(res, 404, { error: 'Lagu tidak ditemukan.' });
    if (track.status !== 'queued') return sendJson(res, 409, { error: 'Hanya lagu di antrean yang bisa divoting.' });
    mutate(() => {
      if (track.votes[deviceId]) delete track.votes[deviceId];
      else track.votes[deviceId] = 1;
    });
    return sendJson(res, 200, { voteCount: Object.keys(track.votes).length, voted: Boolean(track.votes[deviceId]) });
  }

  /* --- sumber alternatif otomatis ---
   * Kalau video yang dipilih tidak tersedia (dihapus, diblokir, atau tidak
   * ada di wilayah), lagunya jangan langsung dilewati: cari video lain
   * dengan judul serupa supaya tetap bisa diputar. Kandidat dikembalikan
   * urut dari yang paling cocok; video yang baru saja gagal dikecualikan. */
  if (method === 'POST' && p === '/api/dj/sumber-alternatif') {
    if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);
    const track = findTrack(clean(body.id, 64));
    if (!track) return sendJson(res, 404, { error: 'Lagu tidak ditemukan.' });
    const judul = `${track.title} ${track.artist || ''}`.trim();
    const exclude = new Set(
      [track.yt, ...(Array.isArray(body.gagal) ? body.gagal : [])].filter(Boolean),
    );
    try {
      const hasil = await youtubeSearchMany(judul, 10);
      const kandidat = hasil
        .filter((r) => r && r.id && !exclude.has(r.id))
        .map((r) => ({
          yt: r.id,
          title: r.title,
          channel: r.channel,
          dur: durasiKeDetik(r.duration),
        }));
      // Diurutkan: channel yang sama dengan artis lebih dulu, lalu durasi yang
      // mirip dengan durasi lagu aslinya. Video "official" hampir selalu di
      // channel artis — upload acak sering sama judulnya tapi versinya berbeda.
      const artis = (track.artist || '').toLowerCase().trim();
      const durAsli = durasiKeDetik(track.dur);
      kandidat.sort((a, b) => {
        const ca = artis && (a.channel || '').toLowerCase().includes(artis) ? 0 : 1;
        const cb = artis && (b.channel || '').toLowerCase().includes(artis) ? 0 : 1;
        if (ca !== cb) return ca - cb;
        if (durAsli) {
          const da = a.dur ? Math.abs(a.dur - durAsli) / durAsli : 9;
          const db = b.dur ? Math.abs(b.dur - durAsli) / durAsli : 9;
          if (da !== db) return da - db;
        }
        return 0;
      });
      return sendJson(res, 200, { kandidat, gagal: track.yt });
    } catch (err) {
      return sendJson(res, 502, { error: `Pencarian sumber alternatif gagal: ${err.message}` });
    }
  }

  /* --- status pemutar (diisi panel DJ yang sedang memegang kendali) --- */
  if (method === 'POST' && p === '/api/player/status') {
    return layaniStatusPemutar(req, res);
  }

  /* --- klaim kepemilikan pemutar ---
   * Hanya satu panel DJ yang boleh memutar. Panel lain yang masih aktif
   * (detak < 12 detik) menang atas klaim baru, kecuali klaim dipaksa.       */
  if (method === 'POST' && p === '/api/player/claim') {
    if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);
    const panel = clean(body.panel, 40);
    // Kelayakan diambil dari baris status pemutar (selalu diperbarui setiap
    // detak) — bukan dari state utama, karena detak tidak menulis state utama.
    let pemegang = state.player && state.player.panel;
    let segar = state.player && Date.now() - state.player.updatedAt < 12000;
    try {
      const live = await ambilPemutar();
      if (live && live.panel) {
        pemegang = live.panel;
        segar = Date.now() - (live.updatedAt || 0) < 12000;
      }
    } catch { /* pakai state utama */ }
    if (pemegang && pemegang !== panel && segar && !body.paksa) {
      return sendJson(res, 409, { ok: false, pemegang });
    }
    mutate(() => {
      state.player = {
        status: 'siap',
        detail: '',
        trackId: '',
        panel: panel || '',
        updatedAt: Date.now(),
        posisi: 0,
      };
    });
    try { await simpanPemutar(state.player); } catch { /* abaikan */ }
    return sendJson(res, 200, { ok: true, player: state.player });
  }

  /* --- lepaskan kepemilikan pemutar (saat DJ keluar dari panel) --- */
  if (method === 'POST' && p === '/api/player/release') {
    if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);
    const panel = clean(body.panel, 40);
    let dilepas = false;
    mutate(() => {
      if (!panel || (state.player && state.player.panel === panel)) {
        state.player = null;
        dilepas = true;
      }
    });
    if (dilepas) {
      // baris status pemutar juga dibersihkan, supaya panel lain tahu
      // pemutar sudah bebas (dan tidak menganggapnya "masih hidup").
      try { await simpanPemutar({ panel: '', status: 'siap', detail: '', trackId: '', updatedAt: Date.now(), posisi: 0 }); }
      catch { /* abaikan */ }
    }
    return sendJson(res, 200, { ok: true });
  }

  /* --- adzan otomatis (pemutar dijeda saat adzan) --- */
  if (p === '/api/adzan') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
    const a = state.adzan;
    const tanggal = cekTanggal(clean(url.searchParams.get('tanggal'), 20)) || tanggalLocal();

    // Jam yang diketik DJ selalu menang. Lokasi browser sering tidak sesuai
    // dengan lokasi acara, jadi hasil geolokasi tidak boleh menimpa pilihan itu.
    const manual = a && a.jadwalManual;
    if (manual && ADZAN_WAKTU.every((n) => cekJamAdzan(manual[n]))) {
      return sendJson(res, 200, {
        jadwal: Object.fromEntries(ADZAN_WAKTU.map((n) => [n, String(manual[n]).trim()])),
        jadwalPokok: Object.fromEntries(ADZAN_WAKTU.map((n) => [n, String(manual[n]).trim()])),
        sumber: 'manual',
        kotaNama: a.kotaNama || null,
        koreksi: a.koreksi || null,
        durasi: Number.isFinite(a.durasi) ? a.durasi : 10,
        enabled: Boolean(a.enabled),
      });
    }

    if (!a) return sendJson(res, 200, {
      jadwal: null,
      sumber: null,
      durasi: 10,
      enabled: true,
    });

    // Urutan sumber: jam manual > kota acara > lokasi perangkat.
    const sudahAda = Boolean(a.jadwal && a.jadwal[tanggal]);
    // masih di dalam jeda setelah gagal sebelumnya → jangan sentuh sumber lagi
    if (!sudahAda && Date.now() < jedaCobaJadwal) {
      const cadangan = (a.jadwal && Object.values(a.jadwal)[0]) || null;
      return sendJson(res, 200, {
        jadwal: cadangan && terapkanKoreksi(cadangan, a.koreksi),
        sumber: a.kotaId ? 'kota' : (a.lat ? 'lokasi' : null),
        kotaNama: a.kotaNama || null,
        koreksi: a.koreksi || null,
        durasi: a.durasi,
        enabled: a.enabled,
        error: 'Sumber jadwal sedang tidak bisa dihubungi. Jadwal terakhir tetap dipakai.',
      });
    }
    if (!sudahAda) {
      try {
        jedaCobaJadwal = 0;
        if (a.kotaId) {
          // kota acara: akurat, dan ikut ter-refresh sendiri tiap ganti tanggal
          const hasil = await ambilJadwalKota(a.kotaId, tanggal);
          mutate(() => simpanJadwalAdzan(tanggal, hasil.jadwal));
        } else if (a.lat) {
          const jadwal = await ambilJadwalAdzan(a.lat, a.lng, tanggal);
          mutate(() => simpanJadwalAdzan(tanggal, jadwal));
        }
      } catch {
        jedaCobaJadwal = Date.now() + JEDA_GAGAL_MS; // jangan spam sumber
        const cadangan = (state.adzan && state.adzan.jadwal) || null;
        return sendJson(res, 200, {
          jadwal: (cadangan && Object.values(cadangan)[0]) || null,
          sumber: a.kotaId ? 'kota' : (a.lat ? 'lokasi' : null),
          kotaNama: a.kotaNama || null,
          durasi: state.adzan.durasi,
          enabled: state.adzan.enabled,
          error: 'Sumber jadwal sedang tidak bisa dihubungi. Jadwal terakhir tetap dipakai.',
        });
      }
    }

    const sumber = a.kotaId ? 'kota' : (a.lat ? 'lokasi' : null);
    const mentah = (state.adzan && state.adzan.jadwal && state.adzan.jadwal[tanggal]) || null;
    return sendJson(res, 200, {
      jadwal: terapkanKoreksi(mentah, a.koreksi),
      jadwalPokok: mentah,
      sumber,
      kotaNama: a.kotaNama || null,
      koreksi: a.koreksi || null,
      durasi: state.adzan.durasi,
      enabled: state.adzan.enabled,
    });
  }

  /* Atur jadwal dari kota/kabupaten acara (bukan dari lokasi perangkat). */
  if (p === '/api/adzan/kota') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
    const sesi = adminSesi(req);
    if (!sesi) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);
    const tanggal = cekTanggal(clean(body.tanggal, 20)) || tanggalLocal();

    let hasilCari;
    try {
      hasilCari = await cariKota(clean(body.kota, 80));
    } catch {
      return sendJson(res, 502, { error: 'Gagal membaca daftar kota. Periksa internet server.' });
    }
    if (!hasilCari.ok) {
      return sendJson(res, 404, {
        error: hasilCari.saran.length
          ? `Kota "${clean(body.kota, 40)}" tidak ada. Maksudmu salah satu ini?`
          : `Kota "${clean(body.kota, 40)}" tidak ditemukan.`,
        saran: hasilCari.saran,
      });
    }

    let hasil;
    try {
      hasil = await ambilJadwalKota(hasilCari.kota.id, tanggal);
    } catch {
      jedaCobaJadwal = Date.now() + JEDA_GAGAL_MS;
      return sendJson(res, 502, {
        error: 'Sumber jadwal tidak bisa dihubungi. Periksa internet server, lalu coba lagi.',
      });
    }

    const durasi = Math.min(Math.max(Number(body.durasi) || (state.adzan && state.adzan.durasi) || 10, 1), 60);
    mutate(() => {
      if (!state.adzan) state.adzan = { enabled: true, durasi };
      state.adzan.kotaId = hasilCari.kota.id;
      state.adzan.kotaNama = hasil.lokasi || hasilCari.kota.nama;
      state.adzan.durasi = durasi;
      if (body.enabled !== undefined) state.adzan.enabled = Boolean(body.enabled);
      simpanJadwalAdzan(tanggal, hasil.jadwal);
    });
    return sendJson(res, 200, {
      ok: true,
      kota: state.adzan.kotaNama,
      kotaId: state.adzan.kotaId,
      jadwal: state.adzan.jadwalManual ? state.adzan.jadwalManual : terapkanKoreksi(hasil.jadwal, state.adzan.koreksi),
      jadwalPokok: state.adzan.jadwalManual ? state.adzan.jadwalManual : hasil.jadwal,
      sumber: state.adzan.jadwalManual ? 'manual' : 'kota',
      koreksi: state.adzan.koreksi || null,
      durasi: state.adzan.durasi,
      enabled: state.adzan.enabled,
    });
  }

  if (p === '/api/adzan/lokasi') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
    const sesi = adminSesi(req);
    if (!sesi) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
        || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return sendJson(res, 400, { error: 'Koordinat lokasi tidak valid.' });
    }
    const tanggal = cekTanggal(clean(body.tanggal, 20)) || tanggalLocal();
    let jadwal;
    try {
      jadwal = await ambilJadwalAdzan(lat, lng, tanggal);
    } catch {
      return sendJson(res, 502, { error: 'Gagal mengambil jadwal adzan. Periksa internet panel.' });
    }
    const durasi = Math.min(Math.max(Number(body.durasi) || (state.adzan && state.adzan.durasi) || 10, 1), 60);
    mutate(() => {
      if (!state.adzan) state.adzan = { enabled: true, durasi };
      state.adzan.lat = lat;
      state.adzan.lng = lng;
      state.adzan.durasi = durasi;
      if (body.enabled !== undefined) state.adzan.enabled = Boolean(body.enabled);
      simpanJadwalAdzan(tanggal, jadwal);
    });
    const masihManual = Boolean(state.adzan.jadwalManual);
    return sendJson(res, 200, {
      jadwal: masihManual ? state.adzan.jadwalManual : jadwal,
      sumber: masihManual ? 'manual' : 'lokasi',
      lat, lng,
      durasi: state.adzan.durasi,
      enabled: state.adzan.enabled,
      catatan: masihManual
        ? 'Lokasi tersimpan, tapi jam yang dipakai tetap yang diketik manual.'
        : '',
    });
  }

  if (p === '/api/adzan/pengaturan') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
    const sesi = adminSesi(req);
    if (!sesi) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
    const body = await readBody(req);

    // koreksi menit per salat (hanya berlaku untuk jadwal dari kota/lokasi)
    const hasilKoreksi = susunKoreksi(body);
    if (hasilKoreksi.error) return sendJson(res, 400, { error: hasilKoreksi.error });
    if (hasilKoreksi.ada) {
      mutate(() => {
        if (!state.adzan) state.adzan = { enabled: true, durasi: 10 };
        if (hasilKoreksi.koreksi === null) delete state.adzan.koreksi;
        else state.adzan.koreksi = hasilKoreksi.koreksi;
      });
    }

    // jam manual: null = kembali ke jadwal dari lokasi
    if (Object.prototype.hasOwnProperty.call(body, 'jadwal')) {
      const hasil = susunJadwalManual(body);
      if (hasil.error) return sendJson(res, 400, { error: hasil.error });
      mutate(() => {
        if (!state.adzan) state.adzan = { enabled: true, durasi: 10 };
        if (hasil.jadwal === null) delete state.adzan.jadwalManual;
        else state.adzan.jadwalManual = hasil.jadwal;
      });
    }

    mutate(() => {
      if (!state.adzan) state.adzan = { enabled: true, durasi: 10 };
      if (body.durasi !== undefined && body.durasi !== null && body.durasi !== '') {
        const d = Number(body.durasi);
        if (Number.isFinite(d)) state.adzan.durasi = Math.min(Math.max(d, 1), 60);
      }
      if (body.enabled !== undefined) state.adzan.enabled = Boolean(body.enabled);
    });
    const aktifManual = Boolean(state.adzan.jadwalManual);
    return sendJson(res, 200, {
      ok: true,
      jadwal: aktifManual ? state.adzan.jadwalManual : null,
      sumber: aktifManual ? 'manual' : (state.adzan.kotaId ? 'kota' : (state.adzan.lat ? 'lokasi' : null)),
      kotaNama: state.adzan.kotaNama || null,
      koreksi: state.adzan.koreksi || null,
      durasi: state.adzan.durasi,
      enabled: state.adzan.enabled,
    });
  }

  /* --- khusus DJ --- */
  if (p.startsWith('/api/dj') || p === '/api/event') {
    const sesi = djSesi(req);
    if (!sesi) return sendJson(res, 401, { error: 'Token DJ tidak valid. Masuk ulang.' });
    // daftar panitia dibaca dengan GET; sisanya hanya tulis (POST/PATCH)
    const bacaDaftar = method === 'GET' && p === '/api/dj/users';
    if (method !== 'POST' && method !== 'PATCH' && !bacaDaftar) {
      return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
    }
    const body = await readBody(req);
    const kelola = sesi.peran === 'admin'; // admin memutar & mengelola; user hanya via halaman tamu

    if (!kelola) {
      // user biasa: tidak ada akses panel — hanya ganti password sendiri
      if (p !== '/api/dj/password') {
        return sendJson(res, 403, {
          error: 'Panel DJ hanya untuk admin. Kamu bisa request lewat halaman tamu.',
        });
      }
    }

    if (method === 'POST' && p === '/api/dj/password') {
      const passwordLama = String(body.passwordLama || '').slice(0, 200);
      const passwordBaru = clean(body.passwordBaru, 64);
      const u = state.users.find((x) => x.username === sesi.username);
      if (!u) return sendJson(res, 401, { error: 'User tidak ditemukan.' });
      if (!cekUser(u.username, passwordLama)) {
        return sendJson(res, 401, { error: 'Password lama salah.' });
      }
      if (passwordBaru.length < 6) {
        return sendJson(res, 400, { error: 'Password baru minimal 6 karakter.' });
      }
      const baru = buatUser(u.username, u.nama, passwordBaru, u.peran);
      mutate(() => {
        const idx = state.users.findIndex((x) => x.username === u.username);
        if (idx >= 0) state.users[idx] = baru;
      });
      // password berubah → token lama hangus; kirim token pengganti
      return sendJson(res, 200, { token: buatToken(baru) });
    }

    /* --- daftar panitia (admin): untuk melihat siapa saja yang punya akun --- */
    if (bacaDaftar && p === '/api/dj/users') {
      if (!kelola) {
        return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      }
      // hash & salt TIDAK pernah dikirim ke klien
      return sendJson(res, 200, {
        users: state.users.map((u) => ({
          username: u.username,
          nama: u.nama || u.username,
          peran: u.peran || 'user',
        })),
      });
    }

    /* --- tambah panitia baru (admin) --- */
    if (method === 'POST' && p === '/api/dj/users') {
      if (!kelola) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      const username = clean(body.username, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const nama = clean(body.nama, 60) || username;
      const password = clean(body.password, 64);
      const peran = body.peran === 'admin' ? 'admin' : 'user';

      if (!username || username.length < 3) {
        return sendJson(res, 400, { error: 'Username minimal 3 karakter (hanya huruf, angka, _, -).' });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { error: 'Password minimal 6 karakter.' });
      }
      if (state.users.some((x) => x.username === username)) {
        return sendJson(res, 409, { error: `Username "${username}" sudah digunakan.` });
      }

      const baru = buatUser(username, nama, password, peran);
      mutate(() => {
        state.users.push(baru);
      });
      return sendJson(res, 201, {
        ok: true,
        user: { username: baru.username, nama: baru.nama, peran: baru.peran },
      });
    }

    /* --- reset password panitia (admin): tanpa perlu password lama, buat
     *     ulang password orang yang lupa. Sesi lama user tsb otomatis hangus
     *     karena hash ikut dicampur ke dalam token. --- */
    if (method === 'POST' && p === '/api/dj/reset-password') {
      if (!kelola) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      const username = clean(body.username, 40).toLowerCase();
      const passwordBaru = clean(body.passwordBaru, 64);
      if (!username) return sendJson(res, 400, { error: 'Pilih user yang password-nya mau direset.' });
      if (passwordBaru.length < 6) {
        return sendJson(res, 400, { error: 'Password baru minimal 6 karakter.' });
      }
      const target = state.users.find((x) => x.username === username);
      if (!target) return sendJson(res, 404, { error: `Username "${username}" tidak ada.` });
      mutate(() => {
        const idx = state.users.findIndex((x) => x.username === username);
        // peran lama dipertahankan — reset password tidak mengubah hak akses
        if (idx >= 0) state.users[idx] = buatUser(target.username, target.nama, passwordBaru, target.peran);
      });
      return sendJson(res, 200, { ok: true, username });
    }

    if (method === 'PATCH' && p === '/api/event') {
      const allowed = ['name', 'tagline', 'open', 'allowVotes', 'allowMessages', 'maksDurasiMenit', 'perlakuanDurasiPanjang'];
      mutate(() => {
        for (const key of allowed) {
          if (!(key in body)) continue;
          if (key === 'name' || key === 'tagline') {
            const value = clean(body[key], 60);
            if (value) state.event[key] = value;
          } else if (key === 'maksDurasiMenit') {
            state.event.maksDurasiMenit = Math.max(0, Math.min(120, Number(body[key]) || 0));
          } else if (key === 'perlakuanDurasiPanjang') {
            state.event.perlakuanDurasiPanjang = body[key] === 'tolak' ? 'tolak' : 'tandai';
          } else {
            state.event[key] = Boolean(body[key]);
          }
        }
      });
      return sendJson(res, 200, { event: publicState().event });
    }

    if (method === 'POST' && p === '/api/dj/advance') {
      const next = mutateAndReturn(() => advance());
      return sendJson(res, 200, { playing: next, done: true });
    }

    /* --- beat-grid: panel DJ mengirim posisi + BPM + energi (tanpa mutate,
     *     hanya broadcast supaya visualizer tamu ikut berdenyut) --- */
    if (method === 'POST' && p === '/api/dj/beat') {
      if (!kelola) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      const pos = Number(body.pos);
      const dur = Number(body.dur);
      const bpmRaw = body.bpm === null || body.bpm === undefined ? null : Number(body.bpm);
      const bpm = bpmRaw !== null && Number.isFinite(bpmRaw)
        ? Math.min(Math.max(bpmRaw, 40), 240)
        : null;
      const energyRaw = Number(body.energy);
      const energy = Number.isFinite(energyRaw) ? Math.min(Math.max(energyRaw, 0), 1) : 0;
      const idxRaw = Number(body.beatIdx);
      const beatIdx = Number.isFinite(idxRaw)
        ? Math.min(Math.max(Math.trunc(idxRaw), -1), 1000000)
        : null;
      broadcastBeat({
        pos: Number.isFinite(pos) ? Math.min(Math.max(pos, 0), 86400) : 0,
        dur: Number.isFinite(dur) ? Math.min(Math.max(dur, 0), 86400) : 0,
        bpm,
        energy,
        beatIdx,
        playing: Boolean(body.playing),
        trackId: clean(String(body.trackId || ''), 40) || null,
        t: Date.now(),
      });
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && p === '/api/dj/auto') {
      mutate(() => { state.autoNext = Boolean(body.enabled); });
      return sendJson(res, 200, { autoNext: state.autoNext });
    }

    if (method === 'POST' && p === '/api/dj/clear-done') {
      mutate(() => {
        state.tracks = state.tracks.filter((t) => t.status !== 'done');
      });
      return sendJson(res, 200, { ok: true });
    }

    /* Durasi lagu yang sudah diputar — dikirim panel DJ dari pemutar YouTube.
     * Ini sumber durasi paling akurat, dan juga mengisi lagu-lagu lama yang
     *.request-nya dibuat sebelum durasi disimpan. */
    if (method === 'POST' && p === '/api/dj/durasi') {
      const track = findTrack(clean(body.id, 64));
      if (!track) return sendJson(res, 404, { error: 'Lagu tidak ditemukan.' });
      const dur = durasiKeDetik(body.dur);
      if (!dur) return sendJson(res, 400, { error: 'Durasi tidak valid.' });
      if (durasiKeDetik(track.dur) !== dur) {
        mutate(() => {
          track.dur = dur;
          // Durasi asli dari pemutar bisa diketahui belakangan — kalau ternyata
          // melewati batas acara, tandai juga supaya DJ melihatnya.
          const maks = (Number(state.event.maksDurasiMenit) || 0) * 60;
          if (maks > 0 && dur > maks) track.melebihiBatas = true;
        });
      }
      return sendJson(res, 200, { ok: true, id: track.id, dur });
    }

    if (method === 'POST' && p === '/api/dj/clear-all') {
      mutate(() => {
        state.tracks = state.tracks.filter((t) => t.status === 'playing');
      });
      return sendJson(res, 200, { ok: true });
    }

    const trackMatch = p.match(/^\/api\/dj\/track\/([\w-]+)$/);
    if (trackMatch) {
      const track = findTrack(trackMatch[1]);
      if (!track) return sendJson(res, 404, { error: 'Lagu tidak ditemukan.' });
      const action = clean(body.action, 24);

      if (action === 'reject') mutate(() => { track.status = 'rejected'; });
      else if (action === 'play') {
        mutate(() => {
          const current = playingTrack();
          if (current && current !== track) { current.status = 'done'; current.playedAt = Date.now(); }
          track.status = 'playing';
          track.playedAt = Date.now();
        });
      } else if (action === 'done') mutate(() => { track.status = 'done'; track.playedAt = Date.now(); });
      else if (action === 'up' || action === 'down') {
        mutate(() => moveTrack(track, action === 'up' ? -1 : 1));
      } else if (action === 'link') {
        const id = ytId(body.yt);
        if (!id) return sendJson(res, 400, { error: 'Link YouTube tidak valid.' });
        mutate(() => { track.yt = id; });
      } else if (action === 'audio') {
        const file = clean(body.file, 120);
        if (file && !audioFiles().includes(file)) return sendJson(res, 404, { error: 'File audio tidak ada di folder audio/.' });
        mutate(() => { track.audio = file; });
      } else {
        return sendJson(res, 400, { error: 'Aksi tidak dikenal.' });
      }
      return sendJson(res, 200, { track });
    }

    return sendJson(res, 404, { error: 'Endpoint DJ tidak ditemukan.' });
  }

  return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
}

function mutateAndReturn(fn) {
  const out = fn();
  save();
  broadcast();
  return out;
}

/** Geser track satu langkah melewati tetangga berstatus queued. */
/**
 * Naikkan/turunkan lagu dalam antrean. Votes tetap jadi prioritas utama —
 * perintah DJ hanya berlaku sebagai pemutus saat jumlah vote sama, jadi
 * menggeser lagu tanpa vote tidak mengalahkan lagu yang lebih banyak vote.
 */
function moveTrack(track, direction) {
  if (track.status !== 'queued') return false;
  const antrean = queueOrder();
  const i = antrean.findIndex((t) => t.id === track.id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= antrean.length) return false;

  const a = antrean[i];
  const b = antrean[j];
  if (voteCount(a) !== voteCount(b)) return false; // beda suara → tidak bisa digeser
  const pa = a.prio ?? a.createdAt;
  const pb = b.prio ?? b.createdAt;
  if (pa === pb) {
    a.prio = pa - 1;
    b.prio = pb + 1;
  } else {
    a.prio = pb;
    b.prio = pa;
  }
  return true;
}

function audioFiles() {
  try {
    return fs.readdirSync(AUDIO_DIR).filter((f) => !f.startsWith('.')).sort();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ static files */

function serveFile(res, filePath, cache = false) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Tidak ditemukan');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': cache ? 'no-cache' : 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(data);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/dj') pathname = '/dj.html';

  if (pathname.startsWith('/audio/')) {
    const name = path.basename(pathname.slice('/audio/'.length));
    return serveFile(res, path.join(AUDIO_DIR, name), false);
  }

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end('Dilarang');
  }
  const isAsset = /\.(css|js|png|jpg|svg|ico|webp)$/.test(pathname);
  serveFile(res, filePath, isAsset);
}

/* ---------------------------------------------------------------- server */

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/events') {
      if (IS_VERCEL) {
        // SSE tidak didukung serverless — klien otomatis beralih ke polling.
        return sendJson(res, 503, { error: 'SSE tidak tersedia di mode daring.' });
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/api/audio-files') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      return sendJson(res, 200, { files: audioFiles() });
    }

    /* --- Diagnostik (admin) ---
     * Mengukur latensi masing-masing layanan dari sisi server Vercel, supaya
     * keputusan "pakai Redis atau tidak" berdasar angka, bukan dugaan. */
    if (url.pathname === '/api/diagnostik') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      const hasil = {};
      const tR = Date.now();
      try {
        await redis('PING');
        hasil.redis = { ok: true, ms: Date.now() - tR };
      } catch (err) {
        hasil.redis = { ok: false, ms: Date.now() - tR, pesan: String(err.message || err) };
      }
      const tS = Date.now();
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/app_state?key=eq.${STATE_KEY}&select=updated_at`, {
          headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        await r.text();
        hasil.supabaseBaca = { ok: r.ok, ms: Date.now() - tS };
      } catch (err) {
        hasil.supabaseBaca = { ok: false, ms: Date.now() - tS, pesan: String(err.message || err) };
      }
      const tB = Date.now();
      try {
        const r = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast/${RL_KANAL}/events/diagnostik`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ v: state.versi || 0 }),
          signal: AbortSignal.timeout(4000),
        });
        await r.text();
        hasil.broadcast = { ok: r.ok, ms: Date.now() - tB };
      } catch (err) {
        hasil.broadcast = { ok: false, ms: Date.now() - tB, pesan: String(err.message || err) };
      }
      hasil.waktuServer = Date.now();
      return sendJson(res, 200, hasil);
    }

    if (url.pathname === '/api/yt-search') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Panel DJ hanya untuk admin.' });
      const q = clean(url.searchParams.get('q'), 160);
      if (!q) return sendJson(res, 400, { error: 'Kata kunci kosong.' });
      try {
        const found = await youtubeSearch(q);
        return sendJson(res, 200, { ...found, url: `https://www.youtube.com/watch?v=${found.id}` });
      } catch (err) {
        return sendJson(res, 502, { error: `Pencarian YouTube gagal: ${err.message}` });
      }
    }

    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    return serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Kesalahan server.' });
    else res.end();
  }
}

/* ------------------------------------- pembungkus mode daring (Vercel) */

let chain = Promise.resolve();

async function processRequest(req, res) {
  dirty = false;
  stateSiap = !IS_VERCEL; // mode lokal: state sudah dimuat dari berkas

  if (IS_VERCEL && (req.url || '').startsWith('/api/')) {
    // Request yang mengubah data harus memegang kunci supaya tidak menimpa
    // instance lain yang sedang menyimpan hasil-nya.
    const mauUbah = req.method !== 'GET' && req.method !== 'HEAD';
    let kunci = null;
    if (mauUbah) {
      // Tunggu kalau kuncinya dipegang instance lain. Jendela tunggunya
      // sengaja lebih panjang (25 × 150 ms ≈ 3,8 detik): saat acara ramai
      // banyak mutasi berebut kunci, dan gagal terlalu cepat membuat DJ
      // menerima 503 padahal antrean sebenarnya hanya sebentar.
      for (let i = 0; i < 25; i++) {
        const kunciRes = await ambilKunci();
        if (kunciRes.ok) { kunci = kunciRes.token; break; }
        if (kunciRes.reason === 'redis') {
          return sendJson(res, 503, { error: 'Data acara sedang tidak terbaca. Coba lagi sebentar.' });
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!kunci) {
        return sendJson(res, 503, { error: 'Server sedang sibuk. Coba lagi sebentar.' });
      }
    }

    try {
      const hasil = await loadStateRemote();
      if (!hasil.ok) {
        // Redis tidak terbaca: JANGAN mutate dan JANGAN simpan — memuat dari
        // state default lalu 저장 akan menghapus seluruh antrean & akun.
        return sendJson(res, 503, { error: 'Data acara sedang tidak terbaca. Coba lagi sebentar.' });
      }
      if (hasil.state) state = hasil.state;
      stateSiap = true;
    } catch (err) {
      return sendJson(res, 503, { error: 'Data acara sedang tidak terbaca. Coba lagi sebentar.' });
    }

    try {
      await serve(req, res);
    } finally {
      if (dirty && stateSiap) {
        try {
          await saveStateRemote();
        } catch (err) {
          console.error('Gagal menyimpan state ke Redis:', err.message);
        }
      }
      await lepasKunci(kunci);
    }
    return;
  }

  await serve(req, res);
}

/**
 * Titik masuk untuk Vercel (dipakai api/app.js) maupun mode lokal.
 * Mode daring memakai mutex antar-request dalam satu instance, karena state
 * adalah variabel modul yang dimuat ulang dari Redis per request.
 */
function handleRequest(req, res) {
  if (!IS_VERCEL) return serve(req, res);
  // GET /api/state adalah bacaan murni yang paling sering dipanggil (semua
  // tamu). Jalur ini sengaja DI LUAR antrean mutex supaya tidak ikut tertahan
  // oleh request lain yang lebih lambat.
  const jalur = String(req.url || '').split('?')[0];
  if (req.method === 'GET' && jalur === '/api/state') {
    return serveStateCepat(req, res);
  }
  // Detak status pemutar juga ringan (cuma baris kecil) → tidak perlu kunci.
  if (req.method === 'POST' && jalur === '/api/player/status') {
    return layaniStatusPemutar(req, res);
  }
  const next = chain.then(() => processRequest(req, res), () => processRequest(req, res));
  chain = next.catch(() => {});
  return next;
}

/* --------------------------------------------------------- mode lokal */

function startLocal() {
  const server = http.createServer((req, res) => { serve(req, res); });

  // heartbeat berupa named event (bukan comment) supaya EventSource klien
  // bisa mendeteksi koneksi zombie (proxy menahan socket mati tanpa onerror).
  const heartbeat = setInterval(() => {
    for (const res of sseClients) {
      try { res.write('event: heartbeat\ndata: 1\n\n'); } catch { sseClients.delete(res); }
    }
  }, 10000);

  server.listen(PORT, () => {
    const nets = require('node:os').networkInterfaces();
    const ips = [];
    for (const list of Object.values(nets)) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
    console.log('----------------------------------------------------------');
    console.log(`  ${state.event.name}`);
    console.log('----------------------------------------------------------');
    console.log(`  Tamu    : http://localhost:${PORT}/`);
    for (const ip of ips) console.log(`            http://${ip}:${PORT}/   (HP tersambung Wi-Fi yang sama)`);
    console.log(`  Panel DJ: http://localhost:${PORT}/dj  (login pakai username+password)`);
    console.log('  Pemutar : mainkan langsung di panel DJ (tombol Putar berikutnya)');
    console.log('----------------------------------------------------------');
    console.log('  Tekan Ctrl+C untuk berhenti.');
  });

  process.on('SIGINT', () => {
    clearInterval(heartbeat);
    for (const res of sseClients) try { res.end(); } catch {}
    if (saveTimer) clearTimeout(saveTimer);
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
    console.log('\nServer berhenti. State tersimpan.');
    process.exit(0);
  });
}

if (require.main === module) startLocal();

module.exports = { handleRequest, serve, IS_VERCEL };
