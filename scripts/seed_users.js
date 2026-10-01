#!/usr/bin/env node
/**
 * Seed daftar user panel DJ ke state (lokal atau Redis Vercel).
 *
 * Password acak dibuat di sini, disimpan sebagai hash scrypt + salt (tidak
 * pernah polos), lalu daftar username:password polos dicetak ke stdout supaya
 * bisa diserahkan ke masing-masing user. File seed polos JANGAN disimpan di
 * dalam proyek (Vercel mengunggah folder proyek) — simpan di luar, misal
 * /tmp/opencode/users_seed.json.
 *
 * Pakai:
 *   node scripts/seed_users.js --buat <file-nama>   # nama saja, password dibuat acak
 *   node scripts/seed_users.js --file <file-user>   # username+password sudah ditentukan
 *
 *   --admin <username>   (bisa diulang) jadikan user ini admin
 *
 * Contoh file nama (--buat):  ["melfiano", "habib", {"username":"pakandri","nama":"Pak Andri"}]
 * Contoh file user (--file):  [{"username":"melfiano","nama":"Melfiano","password":"aB3xK9qZ"}]
 *
 * Target penyimpanan:
 *   - lokal : RL_DATA_DIR atau folder data/ proyek (state.json)
 *   - daring : otomatis pakai Redis bila UPSTASH_REDIS_REST_URL/KV_REST_API_URL ter-set
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
function arg(nama) {
  const i = args.indexOf(nama);
  return i >= 0 ? args[i + 1] : null;
}

const fileNama = arg('--buat');
const fileUser = arg('--file');
// kumpulkan argumen --admin (bisa berulang)
const adminSet = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--admin' && args[i + 1]) adminSet.add(args[i + 1]);
}

if (!fileNama && !fileUser) {
  console.error('Pakai: node scripts/seed_users.js --buat <file-nama> | --file <file-user>');
  process.exit(2);
}

const ROOT = path.dirname(path.dirname(__filename)); // folder proyek (induk scripts/)
const DATA_DIR = process.env.RL_DATA_DIR ? path.resolve(process.env.RL_DATA_DIR) : path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const STATE_KEY = 'requestlagu:state';

function bacaJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function buatUser(username, nama, password, peran) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, nama, peran, salt, hash: hashPassword(password, salt) };
}

function passwordAcak() {
  // huruf besar/kecil + angka, hindari karakter ambigu (0/O, 1/l/I)
  const kata = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += kata[bytes[i] % kata.length];
  return out;
}

// bangun daftar {username, nama, password}
let daftar;
if (fileUser) {
  const mentah = bacaJson(fileUser);
  daftar = mentah.map((u) => ({
    username: String(u.username).trim(),
    nama: String(u.nama || u.username).trim(),
    password: String(u.password),
  }));
} else {
  const mentah = bacaJson(fileNama);
  daftar = mentah.map((u) => {
    const username = typeof u === 'string' ? u.trim() : String(u.username).trim();
    const nama = typeof u === 'string' ? username : String(u.nama || u.username).trim();
    return { username, nama, password: passwordAcak() };
  });
}

if (!daftar.length) {
  console.error('Daftar nama/user kosong.');
  process.exit(2);
}

// ambil user lama (hashnya dipertahankan kalau tidak ada di daftar baru)
async function ambilStateLama() {
  if (REDIS_URL && REDIS_TOKEN) {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(['GET', STATE_KEY]),
    });
    if (!res.ok) throw new Error(`Redis GET -> HTTP ${res.status}`);
    const raw = (await res.json()).result;
    return raw ? JSON.parse(raw) : {};
  }
  try {
    return bacaJson(STATE_FILE);
  } catch {
    return {};
  }
}

async function simpanState(state) {
  if (REDIS_URL && REDIS_TOKEN) {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(['SET', STATE_KEY, JSON.stringify(state)]),
    });
    if (!res.ok) throw new Error(`Redis SET -> HTTP ${res.status}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

(async () => {
  const state = await ambilStateLama();
  if (!Array.isArray(state.users)) state.users = [];

  for (const u of daftar) {
    const peran = adminSet.has(u.username) ? 'admin' : 'operator';
    const i = state.users.findIndex((x) => x.username === u.username);
    const baru = buatUser(u.username, u.nama, u.password, peran);
    if (i >= 0) state.users[i] = baru;
    else state.users.push(baru);
  }

  await simpanState(state);
  const target = (REDIS_URL && REDIS_TOKEN) ? 'Redis (daring)' : `file ${STATE_FILE}`;
  console.error(`[seed_users] ${daftar.length} user disimpan ke ${target}`);

  // cetak daftar username:password polos ke stdout (untuk diserahkan ke user)
  const polos = {};
  for (const u of daftar) polos[u.username] = u.password;
  console.log(JSON.stringify(polos, null, 2));
})().catch((err) => {
  console.error(`[seed_users] gagal: ${err.message}`);
  process.exit(1);
});
