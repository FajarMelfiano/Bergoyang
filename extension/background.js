/**
 * Request Lagu — service worker extension.
 * Tugas: proxy API ke server (tanpa CORS) + login kode DJ.
 * Semua permintaan dari content script / popup lewat sini.
 *
 * Alamat server DIBAKUKAN (tidak ada kolom input di popup):
 * coba daftar server berikut sampai ada yang menjawab — server daring (Vercel)
 * dulu, server lokal sebagai cadangan. Urutan diingat selama service worker
 * hidup supaya panggilan berikutnya langsung ke server yang berhasil.
 */
'use strict';

const SERVERS = [
  'https://requestlagu.vercel.app', // ← URL proyek Vercel (dibakukan saat deploy)
  'http://localhost:3000',
];
// Batas waktu per server: harus cukup untuk cold start serverless Vercel
// ( fungsi diam >1 menit = baru start ulang, bisa 3–8 detik). Kalau terlalu
// pendek, server daring dianggap mati lalu jatuh ke lokal.
const FETCH_TIMEOUT_MS = 9000;
const DEFAULTS = { djCode: '' };

let activeIdx = -1;          // indeks server yang terakhir berhasil
let tokenState = { server: '', token: '', code: '' }; // token DJ terikat ke server + kode
let lastGood = '';           // server terakhir berhasil (diingat lintas restart SW)

// service worker sering di-restart Chrome — ingat server tadi supaya tidak
// selalu mencoba dari urutan awal (lokal dulu) dan salah fallback.
chrome.storage.local.get('rlLastGood').then((v) => { if (v.rlLastGood) lastGood = v.rlLastGood; });

async function config() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...saved };
}

/** fetch dengan batas waktu agar server mati tidak menahan panggilan lama. */
function timedFetch(url, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/** Urutan coba server: mulai dari yang terakhir berhasil, kalau belum ada → urut awal. */
function serverOrder() {
  const n = SERVERS.length;
  const base = activeIdx >= 0 ? activeIdx : Math.max(0, SERVERS.indexOf(lastGood));
  return Array.from({ length: n }, (_, i) => (base + i) % n);
}

async function login(server, code) {
  const res = await timedFetch(`${server}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login gagal (HTTP ${res.status})`);
  return data.token;
}

async function doFetch(server, path, method, body, tk) {
  try {
    const headers = {};
    if (tk) headers['x-dj-token'] = tk;
    if (body) headers['content-type'] = 'application/json';
    const res = await timedFetch(server + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: `Server tidak terjangkau (${server}).` } };
  }
}

async function handleApi({ path, method = 'GET', body }) {
  const { djCode } = await config();
  const failures = [];

  for (const idx of serverOrder()) {
    const server = SERVERS[idx];

    // Token dihitung dari secret tiap server dan kode yang dipakai — wajib
    // login ulang kalau server ATAU kode DJ berubah (mis. dari storage di luar popup).
    if (djCode && (tokenState.server !== server || tokenState.code !== djCode)) {
      try {
        tokenState = { server, token: await login(server, djCode), code: djCode };
      } catch (err) {
        failures.push(`${server}: ${err.message}`);
        continue;
      }
    }

    let out = await doFetch(server, path, method, body, djCode ? tokenState.token : '');

    if (out.status === 0) {
      failures.push(`${server}: tidak terjangkau`);
      continue; // coba server berikutnya
    }

    // token kedaluwarsa / kode DJ berubah → coba login ulang sekali
    if (out.status === 401 && djCode) {
      try {
        tokenState = { server, token: await login(server, djCode), code: djCode };
      } catch (err) {
        tokenState = { server: '', token: '', code: '' }; // biar percobaan berikutnya bersih
        const extra = failures.length ? ` (${failures.join('; ')})` : '';
        return { status: 401, data: { error: err.message + extra } };
      }
      out = await doFetch(server, path, method, body, tokenState.token);
    }

    activeIdx = idx; // ingat server yang berhasil
    if (server !== lastGood) {
      lastGood = server;
      chrome.storage.local.set({ rlLastGood: server }).catch(() => {});
    }
    return out;
  }

  return {
    status: 0,
    data: { error: `Server tidak terjangkau. Sudah dicoba: ${SERVERS.join(' & ')} — ${failures.join('; ')}` },
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'api') {
    handleApi(msg).then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === 'save') {
    chrome.storage.local.set(msg.values || {}).then(() => {
      tokenState = { server: '', token: '', code: '' }; // kode bisa berubah → login ulang berikutnya
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === 'config') {
    config().then((c) => sendResponse({ ...c, hasCode: Boolean(c.djCode) }));
    return true;
  }
  if (msg && msg.type === 'yt-antrean') {
    syncAntreanYouTube(msg.items || []).then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === 'yt-antrean-siap') {
    // tab bantu baru siap — pakai id tab pengirimnya
    if (sender && sender.tab) {
      tabBantu = { id: sender.tab.id, items: (tabBantu && tabBantu.items) || [] };
      chrome.storage.local.set({ rlSyncTab: tabBantu.id }).catch(() => {});
      if (tabBantu.items.length) kirimKeTabBantu();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'yt-antrean-hasil') {
    antreanHasil = msg.hasil || null;
    if (msg.hasil) {
      // kabari semua tab YouTube Music supaya chip sinkron menyegarkan —
      // hasil bisa tiba setelah tab pemutar berhenti menunggu.
      chrome.tabs.query({ url: 'https://music.youtube.com/*' }, (tabs) => {
        for (const t of tabs) {
          chrome.tabs.sendMessage(t.id, { type: 'yt-antrean-segarkan', hasil: msg.hasil },
            () => void chrome.runtime.lastError);
        }
      });
      if (tabBantu && tabBantu.id) tutupTabBantu();
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

/* ------------------------------------------------- tab bantu sinkron antrean
 * YouTube Music tidak punya API antrean, jadi sinkronisasi lewat DOM pada tab
 * BACKGROUND terpisah — tab pemutar tidak boleh diganggu sama sekali.
 * Tab bantu menutup sendiri setelah selesai.                                */

/** URL tab bantu WAJIB mengandung query "q". Tanpa "q", YouTube Music
 * mengalihkan ke halaman utama dan flag rl_sync=1 ikut hilang dari URL —
 * tab bantu kelak akan berubah menjadi tab pemutar. Karena itu tab langsung
 * diarahkan ke pencarian lagu pertama yang harus masuk antrean.             */
function urlTabBantu(items) {
  const q = encodeURIComponent(`${items[0].title} ${items[0].artist || ''}`.trim());
  return `https://music.youtube.com/search?q=${q}&rl_sync=1`;
}
let tabBantu = null;      // { id, items } — items = lagu yang harus masuk antrean
let antreanHasil = null;  // hasil sinkron terakhir dari tab bantu

// service worker bisa di-restart Chrome — ingat tab bantu supaya tidak
// membuka tab baru setiap kali.
chrome.storage.local.get('rlSyncTab').then((v) => {
  if (v.rlSyncTab) tabBantu = { id: v.rlSyncTab, items: [] };
});

function kirimKeTabBantu() {
  if (!tabBantu || !tabBantu.id) return;
  chrome.tabs.sendMessage(tabBantu.id, { type: 'yt-antrean-kerjakan', items: tabBantu.items || [] }, () => {
    void chrome.runtime.lastError; // tab mungkin belum siap — konten skrip akan minta lagi
  });
}

function tutupTabBantu() {
  const id = tabBantu && tabBantu.id;
  tabBantu = null;
  chrome.storage.local.remove('rlSyncTab').catch(() => {});
  if (!id) return;
  chrome.tabs.get(id, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    // hanya tab yang masih membawa flag rl_sync=1 — jangan pernah menutup
    // tab pemutar DJ.
    if (!/[?&]rl_sync=1/.test(tab.url || '')) return;
    chrome.tabs.remove(id, () => void chrome.runtime.lastError);
  });
}

function tabMasihHidup(id) {
  return new Promise((res) => {
    chrome.tabs.get(id, (tab) => {
      if (chrome.runtime.lastError || !tab) return res(false);
      // hanya dianggap tab bantu kalau flag rl_sync=1 masih ada di URL-nya
      res(/[?&]rl_sync=1/.test(tab.url || ''));
    });
  });
}

async function syncAntreanYouTube(items) {
  if (!items.length) return { status: 'sinkron' };
  antreanHasil = null;

  const hidup = tabBantu && tabBantu.id ? await tabMasihHidup(tabBantu.id) : false;
  if (hidup) {
    tabBantu.items = items;
    kirimKeTabBantu();
  } else {
    tabBantu = { id: null, items };
    await chrome.tabs.create({ url: urlTabBantu(items), active: false });
    // tab bantu akan mengirim 'yt-antrean-siap' begitu content script hidup
  }

  // tunggu laporan hasil dari tab bantu (maks 60 detik)
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (antreanHasil) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const hasil = antreanHasil;
  antreanHasil = null;
  if (hasil) return hasil;
  return { status: 'menyesuaikan', detail: 'tab bantu belum selesai' };
}
