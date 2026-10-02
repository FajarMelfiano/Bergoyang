'use strict';
/**
 * Harness pengujian: menjalankan server.js dalam proses terpisah dengan
 * data terisolasi (RL_DATA_DIR) + user yang sudah di-seed, sehingga suite
 * tidak pernah menyentuh data/ acara nyata.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function buatUser(username, nama, password, peran) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, nama, peran, salt, hash: hashPassword(password, salt) };
}

const SEED = {
  admin: { username: 'admin', password: 'admin-pass-123', peran: 'admin' },
  user1: { username: 'panitia1', password: 'user-pass-123', peran: 'user' },
  user2: { username: 'panitia2', password: 'user-pass-456', peran: 'user' },
};

/** ID video YouTube valid (11 karakter) — dipakai untuk melewati pencarian jaringan. */
const YT = 'dQw4w9WgXcQ';

async function startServer({ port } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-test-'));
  const state = {
    event: {
      name: 'Acara Uji',
      tagline: 'uji coba',
      open: true,
      autoApprove: true,
      allowVotes: true,
      allowMessages: true,
    },
    tracks: [],
    autoNext: true,
    users: Object.values(SEED).map((u) =>
      buatUser(u.username, u.username, u.password, u.peran)),
  };
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(state, null, 2));

  const listening = port || 3100 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(listening), RL_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  const base = `http://127.0.0.1:${listening}`;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/state`);
      if (r.ok) break;
    } catch { /* server belum siap */ }
    if (Date.now() - t0 > 15000) {
      child.kill('SIGKILL');
      throw new Error(`Server tidak siap. Log:\n${logs.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const harness = {
    base,
    dataDir,
    logs,
    /** Panggil API JSON; kembalikan {status, json}. Token dikirim via x-dj-token. */
    async api(method, p, { token, body, headers } = {}) {
      const res = await fetch(base + p, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-dj-token': token } : {}),
          ...(headers || {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try { json = await res.json(); } catch { /* bukan JSON */ }
      return { status: res.status, json, headers: res.headers };
    },
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return harness;
}

async function login(h, which) {
  const u = typeof which === 'string' ? SEED[which] : which;
  const r = await h.api('POST', '/api/login', {
    body: { username: u.username, password: u.password },
  });
  if (r.status !== 200) {
    throw new Error(`Login ${u.username} gagal: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json; // { token, username, nama, peran }
}

module.exports = { startServer, login, SEED, YT };
