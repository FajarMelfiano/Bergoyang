'use strict';
/**
 * Baseline kontrak perilaku API Request Lagu Live.
 * Dijalankan terhadap server.js apa adanya (sebelum refactor frontend),
 * dengan data terisolasi — tidak pernah menyentuh data/ acara nyata.
 *
 * Jalankan: npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, login, SEED, YT } = require('./helpers/harness.js');

let h;
let adminToken;
let user1Token;
let user2Token;

/** Kosongkan antrean sepenuhnya (pakai antara grup uji agar urutan tak bocor). */
async function resetQueue() {
  await h.api('POST', '/api/dj/clear-all', { token: adminToken });
  const st = (await h.api('GET', '/api/state')).json;
  for (const t of st.tracks.filter((x) => x.status === 'playing')) {
    await h.api('POST', `/api/dj/track/${t.id}`, { token: adminToken, body: { action: 'done' } });
  }
  await h.api('POST', '/api/dj/clear-done', { token: adminToken });
}

before(async () => {
  h = await startServer();
  adminToken = (await login(h, 'admin')).token;
  user1Token = (await login(h, 'user1')).token;
  user2Token = (await login(h, 'user2')).token;
});

after(async () => { if (h) await h.stop(); });

/* ------------------------------------------------------- 1. statis & state */

test('GET / dan /dj menyajikan HTML', async () => {
  for (const p of ['/', '/dj']) {
    const res = await fetch(h.base + p);
    assert.equal(res.status, 200, `${p} harus 200`);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<title>/, `${p} harus memuat <title>`);
  }
});

test('/api/state punya bentuk publik yang benar', async () => {
  const r = await h.api('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.event, 'object');
  assert.equal(typeof r.json.event.open, 'boolean');
  assert.ok(Array.isArray(r.json.tracks));
  assert.ok(Array.isArray(r.json.order));
  assert.equal(typeof r.json.serverTime, 'number');
  assert.equal(r.json.autoNext, true);
  // data internal tidak boleh bocor ke publik
  assert.equal(r.json.users, undefined);
});

/* ------------------------------------------------------------------ 2. auth */

test('login sukses mengembalikan token, nama, peran', async () => {
  const r = await h.api('POST', '/api/login', {
    body: { username: SEED.admin.username, password: SEED.admin.password },
  });
  assert.equal(r.status, 200);
  assert.match(r.json.token, /^.+\.[a-f0-9]{64}$/u, 'token = username.mac(hex64)');
  assert.equal(r.json.peran, 'admin');
  assert.ok(r.json.username);
});

test('login salah → 401', async () => {
  const r = await h.api('POST', '/api/login', {
    body: { username: SEED.admin.username, password: 'salah' },
  });
  assert.equal(r.status, 401);
});

test('/api/me: tanpa token → 401, dengan token → 200', async () => {
  assert.equal((await h.api('GET', '/api/me')).status, 401);
  const r = await h.api('GET', '/api/me', { token: user1Token });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, SEED.user1.username);
  assert.equal(r.json.peran, 'user');
});

test('token palsu → 401', async () => {
  const r = await h.api('GET', '/api/me', { token: 'panitia1.deadbeef'.padEnd(64, '0') });
  assert.equal(r.status, 401);
});

/* ------------------------------------------------------- 3. hak akses peran */

test('user biasa ditolak (403) dari semua endpoint panel DJ', async () => {
  const djEndpoints = [
    ['POST', '/api/dj/advance', {}],
    ['POST', '/api/dj/auto', { enabled: false }],
    ['POST', '/api/dj/clear-all', {}],
    ['POST', '/api/dj/clear-done', {}],
    ['POST', '/api/event', { open: false }],
    ['PATCH', '/api/event', { open: false }],
    ['GET', '/api/dj/users', undefined],
    ['POST', '/api/dj/reset-password', { username: 'x', passwordBaru: '123456' }],
    ['POST', '/api/player/status', { status: 'siap' }],
    ['POST', '/api/player/claim', { panel: 'p1' }],
    ['POST', '/api/adzan/pengaturan', { durasi: 5 }],
  ];
  for (const [method, p, body] of djEndpoints) {
    const r = await h.api(method, p, { token: user1Token, body });
    assert.equal(r.status, 403, `${method} ${p} harus 403 untuk user, dapat ${r.status}`);
  }
});

test('tanpa token, endpoint DJ → 401', async () => {
  const r = await h.api('POST', '/api/dj/advance', {});
  assert.equal(r.status, 401);
});

test('admin boleh membaca daftar panitia tanpa hash/salt', async () => {
  const r = await h.api('GET', '/api/dj/users', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.json.users.length >= 3);
  for (const u of r.json.users) {
    assert.equal(u.hash, undefined);
    assert.equal(u.salt, undefined);
    assert.ok(['admin', 'user'].includes(u.peran));
  }
});

/* --------------------------------------------------------- 4. alur request */

test('request anonim → 401', async () => {
  const r = await h.api('POST', '/api/request', { body: { title: 'Lagu Bebas', yt: YT } });
  assert.equal(r.status, 401);
});

test('request tanpa judul → 400', async () => {
  const r = await h.api('POST', '/api/request', { token: user1Token, body: { yt: YT } });
  assert.equal(r.status, 400);
});

test('request dengan sumber explicit → 201, masuk antrean (queued)', async () => {
  const r = await h.api('POST', '/api/request', {
    token: user1Token,
    body: { title: 'Lagu Satu', artist: 'Artis', yt: YT },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'queued', 'autoApprove default → langsung queued');
  assert.equal(r.json.track.yt, YT);
  assert.equal(r.json.track.requester, SEED.user1.username, 'peminta = username login');
  assert.ok(r.json.track.votes && typeof r.json.track.votes === 'object');
});

test('rate limit: request ke-11 dalam 60 detik → 429', async () => {
  await resetQueue();
  for (let i = 0; i < 10; i++) {
    const r = await h.api('POST', '/api/request', {
      token: user1Token,
      body: { title: `Banjir ${i}`, yt: YT },
    });
    assert.equal(r.status, 201, `request #${i + 1} harus 201`);
  }
  const r = await h.api('POST', '/api/request', {
    token: user1Token,
    body: { title: 'Banjir berlebih', yt: YT },
  });
  assert.equal(r.status, 429);
  // user lain tidak terdampak (limit per akun)
  const lain = await h.api('POST', '/api/request', {
    token: user2Token,
    body: { title: 'Bukan banjir', yt: YT },
  });
  assert.equal(lain.status, 201);
  await resetQueue();
});

test('autoApprove mati → request berstatus pending', async () => {
  await h.api('PATCH', '/api/event', { token: adminToken, body: { autoApprove: false } });
  const r = await h.api('POST', '/api/request', {
    token: user1Token,
    body: { title: 'Perlu Persetujuan', yt: YT },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'pending');
  await h.api('PATCH', '/api/event', { token: adminToken, body: { autoApprove: true } });
  await resetQueue();
});

test('event ditutup → request ditolak 403', async () => {
  await h.api('PATCH', '/api/event', { token: adminToken, body: { open: false } });
  const r = await h.api('POST', '/api/request', {
    token: user1Token,
    body: { title: 'Saat Tutup', yt: YT },
  });
  assert.equal(r.status, 403);
  await h.api('PATCH', '/api/event', { token: adminToken, body: { open: true } });
});

/* ---------------------------------------------------------------- 5. voting */

test('vote anonim → 401; vote toggle on/off; lagu non-queued → 409', async () => {
  await resetQueue();
  const t = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Korban Vote', yt: YT },
  })).json.track;

  assert.equal((await h.api('POST', '/api/vote', { body: { trackId: t.id } })).status, 401);

  const on = await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t.id } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.json, { voteCount: 1, voted: true });

  const off = await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t.id } });
  assert.deepEqual(off.json, { voteCount: 0, voted: false });

  await h.api('POST', '/api/vote', { token: user1Token, body: { trackId: t.id } });
  const done = await h.api('POST', '/api/dj/track/' + t.id, {
    token: adminToken, body: { action: 'done' },
  });
  assert.equal(done.status, 200);
  const after = await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t.id } });
  assert.equal(after.status, 409, 'hanya lagu queued yang bisa divoting');

  const hilang = await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: 'tidak-ada' } });
  assert.equal(hilang.status, 404);
  await resetQueue();
});

test('voting mengubah urutan antrean (vote terbanyak di depan)', async () => {
  await resetQueue();
  const t1 = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Tanpa Suara', yt: YT },
  })).json.track;
  const t2 = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Banyak Suara', yt: YT },
  })).json.track;

  await h.api('POST', '/api/vote', { token: user1Token, body: { trackId: t2.id } });
  await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t2.id } });

  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.order[0], t2.id, 'vote terbanyak harus urutan pertama');
  assert.equal(st.nextId, t2.id);
  await resetQueue();
});

test('voting dimatikan → 403', async () => {
  await resetQueue();
  const t = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Korban Lock', yt: YT },
  })).json.track;
  await h.api('PATCH', '/api/event', { token: adminToken, body: { allowVotes: false } });
  const r = await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t.id } });
  assert.equal(r.status, 403);
  await h.api('PATCH', '/api/event', { token: adminToken, body: { allowVotes: true } });
  await resetQueue();
});

/* ---------------------------------------------------------- 6. pemutar & DJ */

test('claim pemutar: panel lain yang masih segar → 409, paksa → menang', async () => {
  const a = await h.api('POST', '/api/player/claim', { token: adminToken, body: { panel: 'A' } });
  assert.equal(a.status, 200);
  assert.equal(a.json.player.panel, 'A');

  const b = await h.api('POST', '/api/player/claim', { token: adminToken, body: { panel: 'B' } });
  assert.equal(b.status, 409, 'klaim saat pemegang masih detak → 409');
  assert.equal(b.json.pemegang, 'A');

  const bpaksa = await h.api('POST', '/api/player/claim', {
    token: adminToken, body: { panel: 'B', paksa: true },
  });
  assert.equal(bpaksa.status, 200);
  assert.equal(bpaksa.json.player.panel, 'B');

  await h.api('POST', '/api/player/release', { token: adminToken, body: { panel: 'B' } });
  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.player, null);
});

test('status pemutar tersimpan & tampil di state publik', async () => {
  await h.api('POST', '/api/player/status', {
    token: adminToken, body: { panel: 'A', status: 'memutar', detail: 'Lagu Satu', trackId: 'x' },
  });
  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.player.status, 'memutar');
  assert.equal(st.player.panel, 'A');
  await h.api('POST', '/api/player/release', { token: adminToken, body: { panel: 'A' } });
});

test('advance memutar vote tertinggi & menyalakan autoNext', async () => {
  await resetQueue();
  const t1 = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Rendah', yt: YT },
  })).json.track;
  const t2 = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Tinggi', yt: YT },
  })).json.track;
  await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t2.id } });
  await h.api('POST', '/api/dj/auto', { token: adminToken, body: { enabled: false } });

  const adv = await h.api('POST', '/api/dj/advance', { token: adminToken });
  assert.equal(adv.status, 200);
  assert.equal(adv.json.playing.id, t2.id, 'vote terbanyak diputar lebih dulu');

  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.autoNext, true, 'advance selalu menyalakan auto-play');
  assert.equal(st.tracks.find((x) => x.id === t2.id).status, 'playing');

  const adv2 = await h.api('POST', '/api/dj/advance', { token: adminToken });
  assert.equal(adv2.json.playing.id, t1.id);
  const st2 = (await h.api('GET', '/api/state')).json;
  assert.equal(st2.tracks.find((x) => x.id === t2.id).status, 'done');
  await resetQueue();
});

test('clear-all menyisakan lagu yang sedang diputar; clear-done menghapus riwayat', async () => {
  await resetQueue();
  await h.api('POST', '/api/request', { token: user1Token, body: { title: 'Antre', yt: YT } });
  await h.api('POST', '/api/dj/advance', { token: adminToken }); // mainkan satu
  await h.api('POST', '/api/request', { token: user1Token, body: { title: 'Belum Main', yt: YT } });

  await h.api('POST', '/api/dj/clear-all', { token: adminToken });
  let st = (await h.api('GET', '/api/state')).json;
  assert.ok(st.tracks.every((t) => t.status === 'playing'), 'hanya playing yang tersisa');

  await h.api('POST', '/api/dj/clear-done', { token: adminToken });
  st = (await h.api('GET', '/api/state')).json;
  assert.ok(st.tracks.every((t) => t.status !== 'done'), 'riwayat selesai bersih');
  await resetQueue();
});

test('aksi per lagu: approve/reject/play/done/link/audio/up-down', async () => {
  await resetQueue();
  await h.api('PATCH', '/api/event', { token: adminToken, body: { autoApprove: false } });
  const pending = (await h.api('POST', '/api/request', {
    token: user1Token, body: { title: 'Pending Satu', yt: YT },
  })).json.track;

  const approve = await h.api('POST', `/api/dj/track/${pending.id}`, {
    token: adminToken, body: { action: 'approve' },
  });
  assert.equal(approve.json.track.status, 'queued');

  const reject = await h.api('POST', `/api/dj/track/${pending.id}`, {
    token: adminToken, body: { action: 'reject' },
  });
  assert.equal(reject.json.track.status, 'rejected');

  // play & done
  await h.api('PATCH', '/api/event', { token: adminToken, body: { autoApprove: true } });
  const a = (await h.api('POST', '/api/request', { token: user1Token, body: { title: 'A', yt: YT } })).json.track;
  const b = (await h.api('POST', '/api/request', { token: user1Token, body: { title: 'B', yt: YT } })).json.track;
  await h.api('POST', `/api/dj/track/${a.id}`, { token: adminToken, body: { action: 'play' } });
  let st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.tracks.find((t) => t.id === a.id).status, 'playing');
  await h.api('POST', `/api/dj/track/${b.id}`, { token: adminToken, body: { action: 'play' } });
  st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.tracks.find((t) => t.id === a.id).status, 'done', 'play lain menutup lagu lama');
  assert.equal(st.tracks.find((t) => t.id === b.id).status, 'playing');

  // link valid/invalid
  const link = await h.api('POST', `/api/dj/track/${a.id}`, {
    token: adminToken, body: { action: 'link', yt: 'https://youtu.be/abcABC12345' },
  });
  assert.equal(link.status, 200);
  const linkBuruk = await h.api('POST', `/api/dj/track/${a.id}`, {
    token: adminToken, body: { action: 'link', yt: 'bukan-link' },
  });
  assert.equal(linkBuruk.status, 400);

  // audio tidak ada di folder audio/
  const audioHilang = await h.api('POST', `/api/dj/track/${a.id}`, {
    token: adminToken, body: { action: 'audio', file: 'tidak-ada.mp3' },
  });
  assert.equal(audioHilang.status, 404);

  // aksi dikenal tapi tak dikenal → 400
  const aksi = await h.api('POST', `/api/dj/track/${a.id}`, {
    token: adminToken, body: { action: 'meledak' },
  });
  assert.equal(aksi.status, 400);

  await resetQueue();
});

test('geser antrean (up/down) hanya saat vote sama', async () => {
  await resetQueue();
  const t1 = (await h.api('POST', '/api/request', { token: user1Token, body: { title: 'Urut A', yt: YT } })).json.track;
  const t2 = (await h.api('POST', '/api/request', { token: user1Token, body: { title: 'Urut B', yt: YT } })).json.track;
  await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t2.id } }); // t2 unggul

  const gagal = await h.api('POST', `/api/dj/track/${t1.id}`, {
    token: adminToken, body: { action: 'up' },
  });
  assert.equal(gagal.status, 200, 'aksi tetap 200');
  let st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.order[0], t2.id, 'vote lebih banyak tidak bisa digeser turun');

  await h.api('POST', '/api/vote', { token: user2Token, body: { trackId: t2.id } }); // seri lagi
  const ok = await h.api('POST', `/api/dj/track/${t1.id}`, {
    token: adminToken, body: { action: 'up' },
  });
  assert.equal(ok.status, 200);
  st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.order[0], t1.id, 'vote seri → geser manual berlaku');
  await resetQueue();
});

/* ------------------------------------------------------- 7. password & sesi */

test('ganti password: lama salah 401, baru <6 400, sukses → token lama hangus', async () => {
  const lama = await login(h, 'user2');

  const salah = await h.api('POST', '/api/dj/password', {
    token: lama.token,
    body: { passwordLama: 'keliru', passwordBaru: 'barubanget' },
  });
  assert.equal(salah.status, 401);

  const pendek = await h.api('POST', '/api/dj/password', {
    token: lama.token,
    body: { passwordLama: SEED.user2.password, passwordBaru: '12345' },
  });
  assert.equal(pendek.status, 400);

  const ok = await h.api('POST', '/api/dj/password', {
    token: lama.token,
    body: { passwordLama: SEED.user2.password, passwordBaru: 'barubanget' },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token && ok.json.token !== lama.token);

  assert.equal((await h.api('GET', '/api/me', { token: lama.token })).status, 401,
    'token lama harus hangus setelah password berubah');
  assert.equal((await h.api('GET', '/api/me', { token: ok.json.token })).status, 200);

  const masuk = await h.api('POST', '/api/login', {
    body: { username: SEED.user2.username, password: 'barubanget' },
  });
  assert.equal(masuk.status, 200, 'password baru bisa dipakai login');

  // kembalikan seperti semula agar suite bisa diulang
  const balik = await h.api('POST', '/api/dj/password', {
    token: ok.json.token,
    body: { passwordLama: 'barubanget', passwordBaru: SEED.user2.password },
  });
  assert.equal(balik.status, 200);
});

test('reset password admin: tanpa password lama, sesi target hangus', async () => {
  const sesiUser = await login(h, 'user1');
  const r = await h.api('POST', '/api/dj/reset-password', {
    token: adminToken,
    body: { username: SEED.user1.username, passwordBaru: 'reset-baru-1' },
  });
  assert.equal(r.status, 200);
  assert.equal((await h.api('GET', '/api/me', { token: sesiUser.token })).status, 401);

  // kembalikan
  const balik = await h.api('POST', '/api/dj/reset-password', {
    token: adminToken,
    body: { username: SEED.user1.username, passwordBaru: SEED.user1.password },
  });
  assert.equal(balik.status, 200);
});

test('reset password menolak username tak dikenal & password pendek', async () => {
  const t = await h.api('POST', '/api/dj/reset-password', {
    token: adminToken, body: { username: 'tidak-ada', passwordBaru: '123456' },
  });
  assert.equal(t.status, 404);
  const p = await h.api('POST', '/api/dj/reset-password', {
    token: adminToken, body: { username: SEED.user1.username, passwordBaru: '12345' },
  });
  assert.equal(p.status, 400);
});

/* --------------------------------------------------------------- 8. realtime */

test('SSE /api/events mengalirkan state sebagai data:', async () => {
  const ac = new AbortController();
  const res = await fetch(`${h.base}/api/events`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (!buf.includes('\n\n')) {
    if (Date.now() - t0 > 5000) break;
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  ac.abort();
  assert.match(buf, /^data: \{.*"tracks"/su, 'harus memuat payload state');
});

test('autoNext bisa dimatikan lewat /api/dj/auto', async () => {
  const off = await h.api('POST', '/api/dj/auto', { token: adminToken, body: { enabled: false } });
  assert.equal(off.json.autoNext, false);
  const on = await h.api('POST', '/api/dj/auto', { token: adminToken, body: { enabled: true } });
  assert.equal(on.json.autoNext, true);
});

/* -------------------------------------------------- 9. beat-grid visualizer */

test('POST /api/dj/beat: admin OK, hasilnya terbaca di /api/state', async () => {
  const r = await h.api('POST', '/api/dj/beat', {
    token: adminToken,
    body: { pos: 42.5, dur: 246, bpm: 128, energy: 0.7, playing: true, trackId: 'abc123' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(typeof st.beat, 'object');
  assert.equal(st.beat.pos, 42.5);
  assert.equal(st.beat.dur, 246);
  assert.equal(st.beat.bpm, 128);
  assert.equal(st.beat.energy, 0.7);
  assert.equal(st.beat.playing, true);
  assert.equal(st.beat.trackId, 'abc123');
  assert.equal(typeof st.beat.t, 'number');
});

test('POST /api/dj/beat: di-clamp (bpm & energy keluar rentang, pos negatif)', async () => {
  await h.api('POST', '/api/dj/beat', {
    token: adminToken,
    body: { pos: -10, bpm: 999, energy: 5, playing: false },
  });
  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.beat.pos, 0);
  assert.equal(st.beat.bpm, 240);
  assert.equal(st.beat.energy, 1);
  assert.equal(st.beat.playing, false);
  assert.equal(st.beat.trackId, null);
});

test('POST /api/dj/beat: bpm null diterima (tanpa analisis)', async () => {
  await h.api('POST', '/api/dj/beat', { token: adminToken, body: { pos: 1, bpm: null } });
  const st = (await h.api('GET', '/api/state')).json;
  assert.equal(st.beat.bpm, null);
});

test('POST /api/dj/beat: user biasa 403, tanpa token 401, method lain 405', async () => {
  // login ulang — token dari before() sudah hangus oleh grup password
  const segar = (await login(h, 'user1')).token;
  const asUser = await h.api('POST', '/api/dj/beat', {
    token: segar,
    body: { pos: 0 },
  });
  assert.equal(asUser.status, 403);
  const noToken = await h.api('POST', '/api/dj/beat', { body: { pos: 0 } });
  assert.equal(noToken.status, 401);
  const put = await h.api('PUT', '/api/dj/beat', { token: adminToken, body: {} });
  assert.equal(put.status, 405);
});

test('SSE: POST /api/dj/beat mengalirkan named event "beat"', async () => {
  const ac = new AbortController();
  const res = await fetch(`${h.base}/api/events`, { signal: ac.signal });
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const readUntil = async (needle, ms = 5000) => {
    const t0 = Date.now();
    while (!buf.includes(needle)) {
      if (Date.now() - t0 > ms) break;
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    return buf.includes(needle);
  };

  // pastikan stream siap (state awal) dulu, lalu kirim beat
  const siap = await readUntil('data: {', 5000);
  assert.ok(siap, 'stream SSE harus mengirim state awal');
  buf = '';
  const kirim = await h.api('POST', '/api/dj/beat', {
    token: adminToken,
    body: { pos: 7, bpm: 120, energy: 0.5, playing: true },
  });
  assert.equal(kirim.status, 200);
  const ada = await readUntil('event: beat', 5000);
  ac.abort();
  assert.ok(ada, 'harus menerima event: beat');
  assert.match(buf, /"bpm":120/);
});
