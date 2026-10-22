# Request Lagu Live

**Aplikasi request lagu untuk acara: tamu mengirim lagu, DJ memutar dari satu panel.**

Produksi: <https://requestlagu.vercel.app> · Branch aktif: `feat/batas-20-hapus-menunggu`

Halaman tamu (HP panitia) dan konsol DJ (panel + pemutar YouTube) berbagi satu sumber
keadaan, jadi layar selalu sinkon dalam hitungan **~150 ms** tanpa perlu refresh.

> Panduan pakai untuk operator (cara jalankan, cara pakai, kelola panitia) ada di
> **[PANDUAN.md](PANDUAN.md)**. Dokumen ini adalah panduan teknis: arsitektur, kontrak
> API, model data, performa, dan jebakan yang pernah terjadi.

---

## Daftar Isi

1. [Konsep Dasar](#1-konsep-dasar)
2. [Peran & Hak Akses](#2-peran--hak-akses)
3. [Fitur Lengkap](#3-fitur-lengkap)
4. [Arsitektur](#4-arsitektur)
5. [Model Data](#5-model-data)
6. [Kontrak API](#6-kontrak-api)
7. [Kontrak Realtime](#7-kontrak-realtime)
8. [Struktur Folder](#8-struktur-folder)
9. [Menjalankan Lokal](#9-menjalankan-lokal)
10. [Variabel Lingkungan](#10-variabel-lingkungan)
11. [Deploy ke Vercel](#11-deploy-ke-vercel)
12. [Performa](#12-performa)
13. [Checklist Operator](#13-checklist-operator)
14. [Troubleshooting](#14-troubleshooting)
15. [Jebakan & Pelajaran](#15-jebakan--pelajaran)
16. [Keamanan](#16-keamanan)
17. [Pengujian](#17-pengujian)
18. [Glosarium](#18-glosarium)

---

## 1. Konsep Dasar

Diagram alur satu request tamu:

```
Halaman tamu (HP)
   │  POST /api/request  { title, artist, yt, dur?, message? }
   ▼
Vercel Function (server.js)
   │  1. cek login        → 401 kalau token tidak valid
   │  2. cek duplikat     → video id sama? jangan antrekan dua kali
   │  3. cek batas durasi → tolak / tandai
   │  4. simpan state     → requestlagu:state (Postgres) + requestlagu:player
   │  5. siarkan          → event realtime "update" { v, state }
   ▼
Supabase Realtime ──► semua tab tamu & panel DJ langsung memakai state baru
```

Yang membuat ini terasa "instan":

- **State ikut di-push**, bukan hanya sinyal "ada perubahan". Klien tidak perlu
  menarik ulang ke server → tidak ada satu pun perjalanan bolak-balik untuk tahu
  apa yang berubah.
- **Cache edge** 2 detik untuk `GET /api/state` → sebagian besar tamu tidak pernah
  menyentuh server saat membuka halaman.
- **Beat antar tab** langsung antar klien (tidak lewat server) → bar progres di HP
  tamu bergerak mulus mengikuti video yang sedang diputar.

---

## 2. Peran & Hak Akses

| Peran | Jumlah | Boleh |
|---|---|---|
| `user` (panitia) | 15 | Masuk, kirim request, vote, pesan ke DJ, ganti password sendiri |
| `admin` | 1 | Semua kemampuan `user` + panel DJ: memutar, mengatur antrean, pengaturan acara, adzan, kelola panitia, reset password |

Aturan akses ditegakkan **di server** pada setiap endpoint `/api/dj/*`,
`/api/player/*`, `/api/event`, `/api/yt-search`, `/api/adzan/*` — bukan hanya dengan
menyembunyikan tombol di antarmuka.

Sesi login bertahan **30 hari** dan disimpan di `localStorage`
(`requestlagu.dj` untuk panel, `requestlagu.token` untuk tamu) sebagai
`{ t: token, e: batasWaktu }`. Sesi dicabut otomatis bila sandi berubah.

---

## 3. Fitur Lengkap

### 3.1 Halaman tamu (`/`)

| Fitur | Cara kerja |
|---|---|
| **Request lagu** | Cari di YouTube (scraper InnerTube, tanpa API key) atau tempel link. Server tetap mencari sumber otomatis bila hanya judul yang diisi — setiap request pasti punya sumber. |
| **Antrian real-time** | Antrean, urutan, dan lagu yang diputar masuk lewat push realtime; tanpa refresh. |
| **Bar progres** | Posisi video diinterpolasi dari beat terakhir + jam lokal → bergerak mulus (bukan melompat tiap 2 detik). **Bar tidak muncul sebelum beat pertama masuk** — posisi yang belum diketahui tidak boleh dikarang. Durasi total tetap tampil di kartu lagu. |
| **Vote** | Bisa dimatikan lewat pengaturan acara. Urutan antrean = vote terbanyak, lalu urutan manual DJ, lalu waktu masuk. |
| **Pesan/dedikasi** | Opsional, ikut ke DJ, bisa dimatikan. |
| **Sisa antrean** | Total durasi lagu yang menunggu, dihitung dari durasi yang diketahui. Ada tanda `~` kalau sebagian durasi belum diketahui, dan `?` kalau belum ada satu pun. |
| **Dedupe** | Kalau lagu yang sama (video id identik) sudah ada di antrean, request **tidak** digandakan; tamu diberi tahu posisinya dan keinginannya tetap dihitung sebagai vote. |
| **Batas durasi** | Kalau acara menetapkan durasi maksimum, lagu yang melebihi batas ditandai (atau ditolak, tergantung setelan DJ). |
| **Nomor online** | Presence realtime: berapa tab tamu yang terbuka. |

### 3.2 Panel DJ (`/dj`)

| Fitur | Cara kerja |
|---|---|
| **Konsol pemutar** | Satu panel yang memutar untuk semua orang. Panel lain hanya ikut antrean (tidak ada dua suara). |
| **Klaim pemutar** | Tombol "Jadikan ini pemutar utama". Kalau panel lain masih aktif (detak < 12 detik), klaim ditolak 409 — kecuali dipaksa. |
| **Auto-lanjut** | Lagu berikutnya diputar otomatis setelah yang sekarang selesai (bisa dimatikan). |
| **Bar progres** | Dibaca langsung dari pemutar YouTube (`getCurrentTime()`), jadi persis sama dengan video — bukan perkiraan. |
| **Lanjut dari titik terakhir** | Posisi lagu disimpan (lokalStorage + server). Kalau panel dimuat ulang atau DJ pindah device, lagu **lanjut dari detik terakhir**, bukan dari nol. |
| **Wake Lock** | Layar panel tidak ikut tidur selama acara (izin `navigator.wakeLock` diambil ulang tiap tab kembali terlihat). Chip "Layar dijaga" menandakan statusnya. |
| **Batas durasi acara** | Di "Pengaturan acara": durasi maksimum (menit) + perlakuan (tandai / tolak). |
| **Dedupe** | Otomatis di server; DJ tidak perlu apa-apa. |
| **Adzan otomatis** | Jeda otomatis saat waktu adzan masuk, lanjut otomatis setelah selesai. Jadwal dari **kota** (bukan GPS perangkat — GPS pernah meleset ~23 menit). |
| **Riwayat** | Lagu yang sudah diputar + durasinya, bisa dibersihkan. |
| **Kelola panitia** | Ganti password panitia yang lupa, lihat daftar akun (tanpa hash/salt). |
| **Pencarian & sumber** | "Cari otomatis di YouTube" atau tempel link; sumber audio lokal juga didukung (folder `audio/`). |
| **Pintasan** | Spasi = jeda/mainkan manual. Penyesuaian DJ manual tidak pernah ditimpa auto-heal. |

---

## 4. Arsitektur

```
┌─────────────────┐   ┌─────────────────┐
│  Halaman tamu   │   │   Panel DJ      │
│  (HP panitia)   │   │  (laptop DJ)    │
└────────┬────────┘   └────────┬────────┘
         │  fetch /api/*        │
         └──────────┬───────────┘
                    ▼
        ┌───────────────────────────┐
        │  Vercel Function          │
        │  (server.js, 1 fungsi)    │
        │                           │
        │  • routing + auth         │
        │  • logika antrean         │
        │  • kunci tulis            │
        │  • cache edge + snapshot  │
        └──────┬─────────────┬──────┘
               │             │
      ┌────────▼───────┐  ┌──▼────────────────────┐
      │ Supabase        │  │ Supabase Realtime     │
      │ PostgREST       │  │ (broadcast)           │
      │ tabel app_state │  │ kanal: requestlagu    │
      └─────────────────┘  └───────────────────────┘
```

### 4.1 Penyimpanan: satu tabel, beberapa baris

Semua state acara berada di tabel **`public.app_state`** (Postgres, lewat PostgREST):

| `key` | Isi | Kapan ditulis | Ukuran |
|---|---|---|---|
| `requestlagu:state` | State acara: `event`, `tracks`, `users`, `adzan`, `player`, `autoNext`, `versi` | Hanya saat ada **perubahan** (request, vote, putar, pengaturan) | ~10–45 KB (ikut riwayat) |
| `requestlagu:player` | Status pemutar: `panel`, `status`, `detail`, `trackId`, `posisi`, `updatedAt` | **Setiap detak panel (5 detik)**, tanpa kunci tulis | < 1 KB |
| `requestlagu:lock` | Kunci tulis lintas instance (`token` + `expiresAt`, TTL 8 detik) | Saat mutasi dimulai | < 1 KB |

Kenapa status pemutar dipisah? State utama berat (riwayat ikut). Kalau detak
menulisnya, tiap 5 detik ada satu tulisan penuh yang **menahan kunci** dan membuat
aksi DJ (setujui/tolak) ikut antre. Dengan baris kecil, detak jadi ringan dan
tidak pernah mengunci apa pun, tapi "masih hidup"-nya tetap awet.

### 4.2 Pembacaan state yang cepat

`GET /api/state` adalah endpoint paling ramai (semua tamu memoles). Tiga lapis
penyangga:

1. **Cache edge Vercel** (`s-maxage=2, stale-while-revalidate=4`) → sebagian besar
   permintaan dilayani dari CDN, tanpa menyentuh server.
2. **Snapshot per instance** (1 detik) → satu pembacaan store per detik per
   instance, berapa pun jumlah tamunya.
3. **Di luar mutex** → pembacaan tidak ikut antre di belakang request lain.

### 4.3 Alur mutasi

```
1. Token dicek                        → 401 kalau tidak valid
2. Kunci tulis diambil (baris lock)   → tunggu, kalau sibuk: 503
3. State dibaca dari store             (bukan dari memori instance)
4. Mutasi dijalankan (mutate/track action)
5. State ditulis + nomor versi naik
6. Kunci dilepas
7. Siaran: event realtime "update" { v, state } → semua klien memakai state baru
```

Nomor versi (`state.versi`) naik **satu kali per penyimpanan**, jadi semua jalur
perubahan (request, vote, putar, pengaturan) terwakili oleh satu penanda yang
meningkat.

---

## 5. Model Data

### 5.1 State acara

```jsonc
{
  "event": {
    "name": "Request Lagu Live",
    "tagline": "Kirim lagu, tunggu giliran, langsung diputar.",
    "open": true,              // request tamu dibuka/tutup
    "allowVotes": true,
    "allowMessages": true,
    "maksDurasiMenit": 0,      // 0 = tanpa batas durasi
    "perlakuanDurasiPanjang": "tandai"   // 'tandai' | 'tolak'
  },
  "tracks": [ /* lihat di bawah */ ],
  "order": ["id-lagu-1", "id-lagu-2"],   // urutan antrean (versi vote)
  "nextId": "id-lagu-1",
  "autoNext": true,
  "player": { "panel": "", "status": "siap", "detail": "", "trackId": "", "updatedAt": 0, "posisi": 0 },
  "users": [ /* hanya di server, tidak pernah dikirim ke klien */ ],
  "adzan": { "enabled": true, "durasi": 10, "jadwal": { /* per kota */ } },
  "versi": 245
}
```

### 5.2 Satu lagu (`track`)

```jsonc
{
  "id": "tmvg4jrb7dcf75764",
  "yt": "eVTXPUF4Oz4",          // id video YouTube (sumber)
  "audio": "",                 // kalau diisi, pakai file lokal (bukan YouTube)
  "title": "In The End",
  "artist": "Linkin Park",
  "requester": "panitia1",     // = username login, tidak bisa dipalsukan
  "deviceId": "panitia1",
  "message": "tolong diputar",  // pesan ke DJ
  "votes": { "panitia2": 1 },  // objek username → 1
  "status": "queued",          // queued | playing | done | rejected
  "dur": 219,                  // durasi dalam detik (0 = belum diketahui)
  "melebihiBatas": false,      // melewati batas durasi acara
  "createdAt": 1792641337088,
  "playedAt": 0
}
```

### 5.3 Bentuk publik (`GET /api/state`)

Yang dikirim ke klien sengaja dipangkas: `users` **tidak pernah** keluar, dan
`tracks` hanya berisi antrean + lagu yang diputar + 12 riwayat terakhir + 8
ditolak terakhir. Ini yang membuat payload turun dari **21 KB → 7–8 KB** saat
antrean berisi 70+ lagu.

### 5.4 Statistik

```jsonc
"statistik": {
  "antrean": { "lagu": 4, "detik": 1116, "durasiDiketahui": 4 },
  "diputar": { "lagu": 135, "detik": 32074, "durasiDiketahui": 134 },
  "durasiDiketahui": 138,
  "berlebihan": 0   // lagu di antrean yang melewati batas durasi acara
}
```

---

## 6. Kontrak API

Semua jawaban JSON. Autentikasi memakai header `x-dj-token: <token>`.
Kode status yang dipakai: `200`/`201` sukses, `400` input salah, `401` belum
masuk/token salah, `403` tidak berhak, `404` tidak ada, `405` method salah,
`409` konflik (duplikat/vote/lagu tidak bisa diubah), `429` terlalu cepat,
`503` server sibuk.

### Publik

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/state` | State publik (ramping). Aman di-cache edge 2 detik. |
| `GET` | `/api/songs?q=&limit=` | Pencarian lagu (katalog lokal + YouTube). |
| `GET` | `/api/detect?q=` | Deteksi sumber lagu dari judul. |
| `GET` | `/api/events` | Aliran SSE state (hanya mode lokal; di Vercel → 503, klien beralih ke realtime+polling). |
| `POST` | `/api/login` | `{ username, password }` → `{ token, username, nama, peran }`. |
| `GET` | `/api/me` | Validasi sesi → `{ username, nama, peran }`. |
| `POST` | `/api/request` | Kirim request lagu (butuh login). Lihat di bawah. |
| `POST` | `/api/vote` | `{ trackId }` → `{ voteCount, voted }`. |

### `POST /api/request` — dua jalur jawaban

```jsonc
//sukses
{ "track": { ... }, "status": "queued", "penuh": false,
  "melebihiBatas": false, "catatan": "" }

// lagu duplikat (tidak digandakan)
{ "duplikat": true, "track": { ... }, "status": "queued",
  "posisi": 3, "sudahVote": true,
  "catatan": "Lagu ini sudah ada di antrean (posisi #3)." }
```

Error: `403` (request ditutup / antrean penuh / lewat batas durasi dengan mode
`tolak`), `429` (lebih dari 10 request per menit per akun), `400` (judul kosong /
sumber tidak ditemukan).

### Panel DJ (butuh peran `admin`)

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/dj/users` | Daftar panitia (tanpa hash/salt). |
| `POST` | `/api/dj/advance` | Mainkan lagu berikutnya (urutan vote). |
| `POST` | `/api/dj/auto` | `{ enabled }` → auto-lanjut. |
| `POST` | `/api/dj/track/:id` | `{ action }`: `play` `done` `reject` `up` `down` `link` `audio`. |
| `POST` | `/api/dj/clear-all` | Mengosongkan antrean (lagu yang sedang diputar tetap). **Riwayat "done" ikut terhapus.** |
| `POST` | `/api/dj/clear-done` | Mengosongkan riwayat selesai saja. |
| `POST` | `/api/dj/durasi` | `{ id, dur }` → menyimpan durasi lagu (dari pemutar) + menandai yang melewati batas. |
| `POST` | `/api/dj/beat` | `{ pos, dur, bpm, energy }` → beat-grid (untuk visualizer). |
| `POST` | `/api/dj/password` | `{ passwordLama, passwordBaru }` → ganti sandi sendiri. |
| `POST` | `/api/dj/reset-password` | `{ username, passwordBaru }` → reset sandi panitia (admin). |
| `PATCH` | `/api/event` | `{ name, tagline, open, allowVotes, allowMessages, maksDurasiMenit, perlakuanDurasiPanjang }`. |
| `GET` | `/api/yt-search` | Cari video (dipakai tombol "Cari otomatis"). |
| `POST` | `/api/player/claim` | `{ panel, paksa? }` → ambil kendali pemutar (409 kalau panel lain masih hidup). |
| `POST` | `/api/player/release` | Lepas kendali. |
| `POST` | `/api/player/status` | Detak 5 detik: `{ panel, status, detail, trackId, posisi }`. |
| `GET` | `/api/audio-files` | Daftar file audio lokal. |
| `GET` | `/api/adzan`, `POST` `/api/adzan/kota`, `/api/adzan/lokasi`, `/api/adzan/pengaturan` | Jadwal & pengaturan adzan. |
| `GET` | `/api/diagnostik` | Ukur latensi tiap layanan dari sisi server (Redis/Supabase/broadcast). |

---

## 7. Kontrak Realtime

Kanal: **`requestlagu`** · Klien: `public/realtime.js` (supabase-js di-vendor lokal
sebagai `public/vendor/supabase.umd.js`, bukan CDN) · Kunci: **anon/publik** (kunci
browser memang untuk browser; kunci service tidak pernah masuk klien).

| Event | Payload | Kapan dikirim |
|---|---|---|
| `update` | `{ v, state }` — **state penuh** | Setiap penyimpanan state. Klien memakai `state` langsung, tanpa menarik ulang. |
| `player` | `{ panel, status, detail, trackId, updatedAt, posisi }` | Setiap detak panel DJ (5 detik), ringan, tanpa menulis store. |
| `beat` | `{ pos, dur, bpm, energy, playing, trackId, t }` | Langsung antar tab panel DJ → tamu (tidak lewat server). |

> Versi lawas server hanya mengirim `{ v }`; klien lama menarik ulang seperti
> biasa. Payload `{ v, state }` sengaja designed additive agar dua generasi
> klien bisa jalan berdampingan.

---

## 8. Struktur Folder

```
.
├── server.js               # seluruh logika: routing, auth, antrean, realtime, cache (2.377 baris)
├── api/app.js              # titik masuk serverless Vercel → server.js
├── public/                 # UI produksi (vanilla HTML/CSS/JS, tanpa build step)
│   ├── index.html          # halaman tamu
│   ├── dj.html             # panel DJ
│   ├── styles.css          # gaya dasar (Anton + Space Grotesk, palet amber/krem)
│   ├── guest.css           # gaya khusus halaman tamu
│   ├── dj.css              # gaya khusus panel DJ
│   ├── guest.js            # halaman tamu (1.017 baris)
│   ├── dj.js               # panel DJ + pemutar (2.227 baris)
│   ├── realtime.js         # klien realtime bersama (sambung, beat, presence)
│   └── vendor/             # supabase-js UMD (di-vendor, bukan CDN)
├── data/songs.json         # katalog lagu lokal
├── audio/                  # file audio lokal (tidak masuk repo)
├── scripts/seed_users.js   # seed akun panitia (ke Supabase)
├── tests/                  # suite kontrak API (node --test)
│   ├── api.test.js
│   └── helpers/harness.js  # menjalankan server terisolasi (RL_DATA_DIR) + akun uji
├── client/                 # eksperimen UI berikutnya (React + Vite + Tailwind) — belum dipakai produksi
├── extension/              # ekstensi browser (bantu request otomatis)
├── .design-ref/            # rujukan tampilan & tangkapan layar
├── PANDUAN.md              # panduan operator (cara pakai)
├── vercel.json             # rewrite semua rute ke /api/app + inklusi aset
└── package.json            # skrip: start, seed, dev, build:client, typecheck, test
```

---

## 9. Menjalankan Lokal

```bash
git clone -b feat/batas-20-hapus-menunggu https://github.com/FajarMelfiano/Bergoyang.git
cd Bergoyang
npm install                 # hanya perlu untuk test & tooling klien
```

Jalankan server (data terisolasi supaya data acara asli tidak tersentuh):

```bash
PORT=3100 RL_DATA_DIR=/tmp/rl-local node server.js
# Tamu : http://localhost:3100/
# DJ   : http://localhost:3100/dj
```

Buat akun uji (data dir harus sudah ada):

```bash
cat > /tmp/rl-local/state.json <<'JSON'
{ "event": { "name": "Acara Uji" }, "tracks": [], "users": [], "autoNext": true }
JSON
node scripts/seed_users.js --help     # lihat opsi seed
```

Jalankan test suite (server dijalankan otomatis di data terisolasi):

```bash
npm test          # node --test tests/**/*.test.js
```

> **Penting:** di mode lokal **tidak ada mutex** antar-request (mutex `chain` +
> kunci tulis hanya aktif di mode daring/Vercel). Dua request paralel bisa saling
> menimpa state saat menguji. Untuk uji yangellers insensitive, pakai
> `RL_DATA_DIR` sendiri per proses.

---

## 10. Variabel Lingkungan

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SUPABASE_URL` | ya (daring) | URL proyek Supabase, mis. `https://<ref>.supabase.co` |
| `SUPABASE_KEY` | ya (daring) | **Service role key** (server saja, tidak boleh masuk klien) |
| `APP_SECRET` | ya (daring) | Kunci HMAC untuk token sesi. Tanpa ini, token berubah tiap cold start → semua orang logout. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | tidak | Vercel KV (Upstash). Hanya dipakai kalau `REDIS_PANAS=1`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | tidak | Alternatif Upstash langsung. |
| `REDIS_PANAS` | tidak | `1` = pakai Redis/Vercel KV sebagai store utama state. **Default: mati** (lihat jebakan kuota). |
| `RL_DATA_DIR` | tidak (lokal) | Lokasi `state.json` untuk mode lokal. |
| `PORT` | tidak (lokal) | Default 3000. |

---

## 11. Deploy ke Vercel

```bash
# 1. deploy (build dari branch kerja)
vercel deploy --prod --yes

# 2. pastikan alias produksi benar-benar berganti
curl -s https://requestlagu.vercel.app/api/state | python3 -m json.tool | head -20
# belum berubah? arahkan manual:
vercel alias set https://<deployment-url> requestlagu.vercel.app

# 3. push branch (branch ini terhubung ke auto-deploy Vercel)
git push origin feat/batas-20-hapus-menunggu
```

> `vercel deploy --prod` **tidak selalu** memindahkan alias produksi (terlihat
> setelah `vercel rollback`). Selalu verifikasi dengan satu `curl`; kalau masih
> versi lama, pakai `vercel alias set`.

---

## 12. Performa

Angka diukur di produksi (20 permintaan bersamaan, acara live):

| Yang | Sebelum | Sekarang |
|---|---|---|
| `GET /api/state` p50 | 1.269–1.613 ms | **197–322 ms** |
| `GET /api/state` p95 | 3.320–3.962 ms | **260–468 ms** |
| Ukuran payload state | 21.876 B | **7.186 B** |
| Cache edge | selalu MISS (`no-store`) | **HIT / STALE** |
| Event realtime diterima | 2,7–4,7 detik (terlambat) | **75–240 ms** |
| Broadcast dari server | fire-and-forget (terhambat/ hilang) | **di-await** sebelum response |
| Durasi mutasi (request) | 6,3 detik + 503 | **1,2–2,7 detik, tanpa 503** |

Cara mengukur ulang:

```bash
node -e "/* 20 GET /api/state paralel → p50/p90/p95 */"
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://requestlagu.vercel.app/api/state
```

---

## 13. Checklist Operator

**Sebelum acara**

- [ ] Judul & tagline acara benar (Pengaturan acara)
- [ ] Request dibuka; voting & pesan sesuai kebutuhan
- [ ] Batas durasi diatur (mis. 6 menit) + perlakuan (tandai/tolak)
- [ ] Semua panitia sudah punya akun (Kelola panitia) dan tahu sandinya
- [ ] Panel DJ: **Jadikan ini pemutar utama** (khusus satu device)
- [ ] Jadwal adzan sudah dicek (kota, bukan lokasi HP)
- [ ] One request dari HP: cek antrean, vote, dan bar progres bergerak

**Selama acara**

- [ ] Chip "Player: memutar" (bukan "terputus") dan "Pemutar: device ini"
- [ ] Chip "Layar dijaga" menyala (wake lock)
- [ ] Bar progres bergerak di HP tamu
- [ ] Panel DJ **tidak di-refresh di tengah lagu** (bisa, tapi posisi dilanjutkan —
  lebih aman di jeda lagu)

**Setelah acara**

- [ ] "Sudah diputar" berisi daftar lagu + durasi
- [ ] Bilang total jam ke panitia (dari statistik)
- [ ] Kalau perlu: tombol "Bersihkan riwayat selesai"

---

## 14. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Semua orang logout tiba-tiba | `APP_SECRET` berubah / belum di-set | Set `APP_SECRET` di Vercel, redeploy |
| Chip "Player: terputus" padahal musik jalan | Panel masih kode lama, atau heartbeat tidak menyegarkan status | Reload panel DJ (kode baru pakai kenyataan lokal) |
| Halaman tamu "reconnecting…" | `/api/events` (SSE) tidak ada di serverless | Normal — klien otomatis pakai realtime + polling |
| Lagu tidak bertambah saat request | Dedupe: video sama sudah di antrean | Uses(response "sudah ada di antrean") |
| Durasi lagu kelihatan 0:03 | Format durasi YouTube berganti ke "3.39" | Sudah diperbaiki (normalisasi "3:39"); lagu lama perlu diputar sekali / diisi ulang |
| Request ditolak "antrean penuh" | Batas 20 lagu tercapai → event ditutup otomatis | Buka lagi request di Pengaturan acara |
| Musik berhenti setelah reload |Reload lama memulai lagu dari nol | Sudah diperbaiki: posisi dilanjutkan dari titik terakhir |
| Dua panel memutar bersamaan | Dua device diklaim jadi pemutar | Hanya satu device yang perlu diklaim; cek chip "Pemutar: device ini" |
| Delay saat banyak tamu | Beban polling + mutex | Edge cache + push state + polling 20 detik (sudah aktif) |
| `vercel deploy` tapi situsnya masih versi lama | Alias tidak berganti | `vercel alias set <deployment-url> requestlagu.vercel.app` |
| Redis/Vercel KV balas 403 | Kuota paket habis | Pakai Supabase (default) atau upgrade paket Upstash |

---

## 15. Jebakan & Pelajaran

Bagian ini adalah bagian paling berharga: semua ini **terbukti di produksi**, bukan
asumsi.

1. **Broadcast dari serverless harus di-await.** `fetch` tanpa `await` bisa
   tertahan 2,7–4,7 detik (atau hilang) karena container dibekukan setelah
   response. Gejalanya: "realtime-nya cuma kadang jalan".

2. **Satu request = satu baca + satu tulis.** Pola
   `loadState() → mutate() → return` membuat tiap request jadi beberapa
   perjalanan bolak-balik ke server. Pola yang dipakai sekarang: state dibaca
   **satu kali** per request di awal, mutasi diterapkan di memori, lalu disimpan
   **satu kali** di akhir. Efeknya: request yang tadinya 1,2 detik menjadi
  hitungan milidetik, dan `404` tidak lagi muncul.

3. **"Kalau sama, jangan tulis" bisa mematikan sinyal vital.** Jalan pintas
   heartbeat (hemat penulisan) ikut mematikan stempel "masih hidup" → chip
   "Player: terputus" padahal musik jalan. Kalau melompat penulisan, pastikan
   penanda liveness tetap disegarkan.

4. **Pisahkan yang sering berubah dari yang jarang.** State utama (berat) ditulis
   saat ada mutasi; status pemutar (kecil) ditulis tiap detak. Kalau digabung,
   yang ringan jadi berat.

5. **Endpoint "bersihkan" bisa menghapus hal yang tidak terlihat.** `clear-all`
   menghapus **semua** track kecuali yang sedang diputar — termasuk riwayat
   "done". Nama tombolnya harus jujur soal apa yang hilang.

6. **Reload panel DJ = lagu mulai dari nol** (versi lama). Karena panel memutar
   ulang track `playing` saat boot. Perbaikannya: simpan posisi (lokal + server)
   lalu lanjutkan dari sana.

7. **YouTube IFrame API punya dua jebakan perpindahan:**
   - `loadVideoById()` lalu `playVideo()` sesaat setelahnya → **video sebelumnya
     keputar lagi dari detik 0**.
   - `stopVideo()`/`loadVideoById()` menembakkan event `ENDED` untuk **video
     lama** → handler `advance()` membuat panel melompat ke lagu berikutnya di
     tengah lagu.
   Solusinya: catat video mana yang seharusnya main, abaikan event yang tidak
   cocok, dan kembalikan posisi saat video terputus.

8. **Format durasi YouTube berubah.** InnerTube kini menulis `"3.39"` (menit **titik**
   detik), bukan `"3:39"`. Parser harus menerima keduanya, dan hasil pencarian
   sebaiknya dinormalkan di satu tempat sebelum keluar ke klien.

9. **`ytId()` hanya menerima 11 karakter.** Id uji yang lebih pendek diam-diam
   ditolak → server menganggap tidak ada sumber → mencari YouTube sungguhan.
   Untuk uji, pakai id format sah.

10. **Vercel: alias tidak selalu ikut berganti.** Setelah `vercel rollback`,
    `vercel deploy --prod` tidak memindahkan alias. Verifikasi selalu.

11. **`vercel env pull` menyamarkan nilai sensitif** (`[SENSITIVE]`) untuk
    `SUPABASE_*` — nilainya tidak bisa diambil dari sana.

12. **Kuota Redis bisa habis kapan saja** (balas 403 "Fixed plan limits"). Karena
    itu Redis bukan default; state utama di Supabase, Redis opsional.

13. **Endpoint pengosong tidak punya "undo".** `clear-all` menghapus seluruh
    track kecuali yang sedang diputar — termasuk riwayat. Kalau hanya mau
    membersihkan satu lagu uji, pakai aksi per-lagu (`reject`), bukan `clear-all`.

14. **Mode lokal tidak punya mutex** (mutex `chain` + kunci tulis hanya aktif di
    mode daring). Perilaku bisa berbeda antara lokal dan produksi, jadi uji
    regresi yang sensitive dengan server daring.

---

## 16. Keamanan

- **Sandi tidak pernah disimpan polos**: `scrypt` (N=16384, r=8, p=1) + `salt`
  acak 16 byte per user. `salt` & `hash` hanya ada di sisi server dan tidak
  pernah keluar lewat `GET /api/state` maupun `GET /api/dj/users`.
- **Token sesi** = `username.MAC_HMAC_SHA256(username, APP_SECRET)`. Sesi 30
  hari sisi klien, dicabut bila sandi berubah.
- **Kunci service Supabase hanya di server** (`SUPABASE_KEY`). Kunci yang ada di
  klien hanyalah kunci **anon/publik** — memang untuk peramban, dan tidak
  memberi akses ke tabel.
- **Endpoint DJ ditolak 403** untuk peran `user`, apa pun yang dikirim klien.
- **BatasAnti-abuse**: 10 request per menit per akun; 20 lagu per antrean.
- **Anti path traversal**: file audio hanya dibaca dari folder `audio/` dengan
  nama file yang disanitasi.
- **CORS**: tidak ada; API hanya untuk first-party (tanpa header CORS →
  peramban situs lain tidak bisa membacanya).

---

## 17. Pengujian

```bash
npm test          # 40 test kontrak API (39 lulus, 1 skipped)
```

Suite memakai **harness terisolasi**: server dijalankan sebagai proses terpisah
dengan `RL_DATA_DIR` sementara, jadi data acara asli tidak pernah tersentuh.
Akun uji: `admin` / `admin-pass-123`, `panitia1` / `user-pass-123`,
`panitia2` / `user-pass-456`.

Yang diuji: bentuk state publik, login/token, hak akses peran, alur request
(201/400/401/403/429), voting, klaim pemutar, heartbeat status, advance, aksi
per lagu, geser antrean, ganti & reset sandi, SSE, beat-grid, **dedupe**,
**batas durasi**, **penyimpanan durasi**, **statistik**, dan **balasan detak
pemutar**.

Uji manual di peramban (untuk bagian yang hanya ada di klien):

- **Bar progres**: buka dua tab (panel + tamu), putar lagu → bar tamu bergerak
  mulus, tidak melompat.
- **Dedupe**: kirim lagu yang sama dua kali → tamu kedua melihat "sudah ada di
  antrean (posisi #N)".
- **Batas durasi**: set maksimum 3 menit → request lagu 5 menit ditandai.
- **Resume posisi**: putar 30 detik → reload panel → lagu lanjut dari ~30 detik.
- **Wake Lock**: chip "Layar dijaga" menyala; layar tidak tidur saat acara.

---

## 18. Glosarium

| Istilah | Arti |
|---|---|
| **Antrian** | Daftar lagu yang menunggu diputar, urut menurut vote. |
| **Beat-grid** | Data posisi lagu yang dikirim antar tab (visualizer + bar progres). |
| **Detak pemutar** | Laporan status pemutar dari panel DJ ke server, tiap 5 detik. |
| **Klaim pemutar** | Proses menentukan device mana yang boleh memutar (satu saja). |
| **Snapshot** | Salinan state publik terbaru di instance server (1 detik). |
| **State ramp** | Bentuk state yang dipangkas untuk dikirim ke klien. |
| **Posisi** | Detik ke berapa video sedang berjalan; dipakai untuk melanjutkan lagu. |
| **Dedup(e)** | Larangan video yang sama masuk antrean dua kali. |
| **Batas durasi** | Lamanya maksimum satu lagu yang boleh diantrekan. |
| **Wake Lock** | Izin browser agar layar tidak tidur sendiri. |

---

Lisensi MIT · Dibangun untuk acara — dan untuk acara berikutnya.
