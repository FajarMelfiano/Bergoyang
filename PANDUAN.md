# Request Lagu Live — Panduan

Web request lagu untuk event/DJ/karaoke: tamu kirim lagu dari HP, vote antrean,
DJ setujui dan putar dari panel. Frontend **React + Vite** (halaman tamu &
panel DJ dua entry terpisah), server Node.js **tanpa dependensi npm**
(hanya `node:http`), realtime pakai Server-Sent Events (lokal) / polling
otomatis (daring).

**Dua mode — pilih salah satu saat acara:**

| Mode | Alamat | Data | Kapan dipakai |
|---|---|---|---|
| **Daring (Vercel)** | `https://requestlagu.vercel.app` | Redis (Upstash) | **Bawaan sekarang** — HP tamu cukup punya internet, tidak perlu satu Wi-Fi |
| **Lokal** | `http://localhost:3000` / IP laptop | `data/state.json` | Cadangan offline / acara tanpa internet |

Jangan jalankan keduanya untuk acara yang sama — state-nya terpisah.

## Isi folder

| File/folder | Keterangan |
|---|---|
| `client/` | Kode frontend React + Vite (`index.html` tamu, `dj.html` panel, `src/`) |
| `client/src/styles/index.css` | Token desain (warna surface, primary hijau, radius, font) |
| `client/src/dj/` | Panel DJ (console, antrean, pengaturan, akses panitia, visualizer) |
| `client/src/guest/` | Halaman tamu (hero, form request, antrean, vote) |
| `public/` | **Hasil build** — inilah yang disajikan `server.js` & Vercel |
| `server.js` | Server + API + SSE + autentikasi multi-user (lokal & daring) |
| `api/app.js` | Titik masuk serverless untuk Vercel (meneruskan ke `server.js`) |
| `vercel.json` | Routing/bundle Vercel (semua rute → `api/app`, bundle: `public/` + `data/`) |
| `vite.config.mts` | Build React → `public/`, dev server proxy `/api` & `/audio` ke `:3000` |
| `playwright.config.mjs` | Konfigurasi E2E (start API + Vite otomatis) |
| `data/songs.json` | Katalog lagu untuk pencarian (edit bebas) |
| `data/state.json` | Antrean, pengaturan & user (dibuat otomatis saat jalan) |
| `data/secret.txt` | Secret server (dibuat otomatis, jangan dihapus) |
| `scripts/seed_users.js` | Buat/reset daftar user panel DJ (lokal & Redis) |
| `tests/api.test.js` | Uji API (node --test, server uji terisolasi) |
| `e2e/app.spec.js` | Uji E2E Playwright (alur login, request, vote, putar, tolak) |
| `audio/` | File mp3 untuk pemutaran lokal |
| `.design-ref/` | Referensi desain HTML + screenshot (dokumen internal) |
| `PANDUAN.md` | Dokumen ini |

## Langkah 1 — Jalankan

Butuh Node.js 18+ dan `npm install` sekali di awal (dependensi pengembangan:
Vite, TypeScript, Playwright — server produksi tetap tanpa dependensi).

```bash
cd ~/Documents/Inggrit/skarisabergoyang/Bergoyang
npm install

# mode lokal / acara: server + halaman jadi
npm run build          # compile React → public/ (sekali, atau tiap ubah kode)
node server.js
```

Banner yang muncul:

```
  Request Lagu Live
  Tamu    : http://localhost:3000/
            http://10.16.3.217:3000/   (HP tersambung Wi-Fi yang sama)
  Panel DJ: http://localhost:3000/dj  (login pakai username + password)
```

- **Port lain:** `PORT=8080 node server.js`
- Berhenti: `Ctrl+C` (antrean tetap tersimpan di `data/state.json`).

### Mode pengembangan (hot-reload)

Terminal 1 (API) dan terminal 2 (frontend dev server):

```bash
node server.js         # API :3000 (pakai RL_DATA_DIR=/tmp/... untuk data uji)
npm run dev            # Vite :5173, proxy /api & /audio ke :3000
```

Buka `http://localhost:5173` (tamu) / `http://localhost:5173/dj` (panel).
Tanpa terminal 2, buka `:3000` — menyajikan hasil `npm run build` dari `public/`.

### Mode daring — Vercel (sudah ter-deploy)

Server hidup di **`https://requestlagu.vercel.app`**. Semua rute diteruskan
ke `server.js` lewat `api/app.js`; file di `public/` disertakan sebagai
bundle, jadi **`npm run build` dulu sebelum deploy**.

```bash
npm run build && vercel deploy --prod --yes
```

Yang berbeda di mode daring (sudah otomatis):

- **Realtime** — serverless tidak bisa menahan SSE, jadi halaman memakai
  polling tiap ~2,5 detik. Status footer tetap "Tersambung"; tidak perlu refresh.
- **Penyimpanan** — antrean & pengaturan di Redis (Upstash), bukan file.
- **File mp3 lokal** (`audio/`) hanya untuk mode lokal — daring memakai YouTube.
- **Pencarian lagu otomatis** tetap jalan (server cari di YouTube, butuh internet).

Kalau internet mati saat acara: jalankan `node server.js` lokal sebagai cadangan.

## Langkah 2 — Halaman tamu (HP)

Halaman tamu **privat**: hanya panitia terdaftar yang bisa request.

1. Pastikan HP & laptop di **Wi-Fi/hotspot yang sama** (mode lokal).
2. Buka alamat LAN dari banner, misal `http://10.16.3.217:3000/`.
3. Masuk dengan username + password panitia. Sesi tersimpan di tab ini
   sampai **Keluar** dari menu nama di pojok kanan atas.
4. Isi **Judul Lagu** → saran muncul **live dari katalog YouTube** (judul +
   artis + durasi) → pilih salah satu, atau biarkan. **Link YouTube** boleh
   dikosongkan — server mencari sumbernya otomatis; kalau gagal dicari,
   request ditolak dengan pesan jelas.
5. Setelah terkirim, request muncul di **Antrean Lagu** (menunggu konfirmasi
   DJ bila persetujuan otomatis mati).
6. Semua HP sinkron tanpa refresh: lagu baru, vote, urutan, dan lagu yang
   sedang diputar ikut berubah sendiri.

Aturan untuk tamu:

- **Antrean tidak dibatasi**; yang dibatasi kecepatan kirim (10 request/menit
  per akun, anti-abuse).
- **Urutan antrean = vote terbanyak.** Ada suara baru → lagu **naik sendiri
  real-time** di semua layar. Lagu vote tertinggi ditandai **Berikutnya**.
- Tombol **▲** di baris antrean = vote (klik lagi = batal). Vote hanya untuk
  lagu yang sudah masuk antrean (queued).
- Persetujuan otomatis **bawaan menyala** (DJ bisa matikan di Pengaturan Sesi).

## Langkah 3 — Panel DJ (sekaligus pemutar)

1. Buka `http://localhost:3000/dj` (atau LAN + `/dj`) di komputer DJ.
2. Masuk dengan **akun admin** (`ID Operator` + `Security Token`). Hanya
   admin; user biasa ditolak dengan pesan + link ke halaman tamu.
3. Fungsi panel:

| Kontrol | Fungsi |
|---|---|
| **Putar berikutnya** | Lagu vote teratas jadi *sedang diputar*, muncul di semua HP |
| **Hentikan** | Berhenti, tidak pindah ke lagu berikutnya |
| **Putar** (per baris) | Putar lagu itu sekarang juga (lompati antrean) |
| **Setujui / Tolak** (baris menunggu) | Masukkan antrean atau tolak (transparan, masuk daftar selesai) |
| **Naik / Turun** | Ubah urutan (hanya saat jumlah vote sama — vote selalu prioritas) |
| **Sumber audio** (per baris) | Cari otomatis di YouTube / tempel link / file mp3 |
| **Selesai (n)** | Daftar lagu yang sudah diputar |
| **Kosongkan semua / selesai** | Pengaturan Sesi → tombol merah (hanya admin) |

Tata letak panel (dark, ala konsol DJ):

- **Bar atas** — pill *Live DJ Deck*, status koneksi, link lihat halaman
  tamu, chip nama akun, tombol Keluar (sticky).
- **Kolom kiri (scrollable, sticky)** — **Konsol Pemutar**: visualizer
  (Avee) + chip BPM/Energi real-time dari detak musik, kontrol putar;
  **Pengaturan Sesi** (nama acara, buka/tutup request, persetujuan otomatis,
  voting, adzan otomatis, tombol merah); **Akses Panitia** (daftar akun
  online, default terbuka).
- **Kolom kanan** — Antrean: *Menunggu Persetujuan DJ* → *Sedang Diputar
  Sekarang* (kartu LIVE ON AIR) → *Antrean Aktif* (tabel).

### Peran: user & admin

- **`user`** (panitia) — **hanya request + vote + ganti password sendiri**,
  lewat halaman tamu. Mencoba buka `/dj` → ditolak (*"panel DJ hanya untuk
  admin"*); request/vote tanpa token → server balas **401**.
- **`admin`** — satu-satunya yang boleh membuka panel DJ: putar/hentikan,
  setujui/tolak, ubah urutan, kosongkan antrean, atur sumber, pengaturan
  acara + adzan. Promosi lewat `scripts/seed_users.js --admin <username>`.

Password disimpan sebagai **hash scrypt + salt** (tidak pernah polos).

### Akun admin panel DJ

Buat/reset (hanya mengganti akun `admin`, user lain tak tersentuh selama
pakai `--file`):

```bash
node scripts/seed_users.js --file /tmp/opencode/admin_user.json --admin admin
```

Setiap kali browser dibuka → **wajib login lagi** (`sessionStorage`, terhapus
saat tab ditutup). Panel memutar sendiri lewat pemutar YouTube tertanam —
suara keluar dari komputer panel DJ; sambungkan ke sound system.

### Auto-play, kendali pemutar, adzan, spasi

- **Putar berikutnya** menyalakan auto-play; **Hentikan** mematikannya. Saat
  auto-play: lagu selesai → lanjut otomatis mengikuti vote tertinggi; video
  yang diblokir/hak cipta **otomatis dilompati** dengan notifikasi.
- **Kendali pemutar** — hanya **satu** panel yang bunyi: chip *panel ini* /
  *panel lain* + tombol **Ambil kendali**. Kendali dilepas saat logout atau
  ~12 detik setelah panel tertutup tanpa logout.
- **Adzan otomatis** — Pengaturan Sesi → *Adzan otomatis* → **Atur dari
  lokasi saya** (izin lokasi sekali; jadwal dari aladhan.com). Saat waktu
  masuk: pemutar **jeda otomatis**, banner *“Sedang adzan …”* muncul di panel
  + strip di halaman tamu, lagu **lanjut sendiri** setelah jeda (bawaan 10
  menit). Tombol pemutar diblokir selama jeda.
- **Tombol spasi** di panel = jeda/mainkan (kecuali fokus di kolom isian atau
  sedang jeda adzan).

## Mengelola user panel DJ

Daftar user diatur lewat `scripts/seed_users.js`. Password acak dibuat di
sana, disimpan sebagai **hash scrypt + salt per user**, dan peta
`username → password` dicetak ke **stdout** — simpan di luar proyek
(mis. `/tmp/opencode/users_seed.json`) lalu bagikan ke masing-masing orang.
**Jangan** simpan password polos di dalam folder proyek (Vercel mengunggah
folder ini ke server publik).

```bash
# mode lokal: buat user dari daftar nama, password acak
RL_DATA_DIR=data node scripts/seed_users.js --buat /tmp/opencode/daftar_nama.json > /tmp/opencode/users_seed.json

# mode daring (Redis): sekalian jadikan melfiano & pakandri admin
node scripts/seed_users.js --buat /tmp/opencode/daftar_nama.json \
  --admin melfiano --admin pakandri > /tmp/opencode/users_seed.json
```

Format file daftar nama: `["melfiano", "habib", {"username":"pakandri","nama":"Pak Andri"}]`.

Setelah masuk, setiap user bisa **ganti password sendiri** lewat menu nama di
pojok kanan atas. Password baru langsung menggantikan yang lama; sesi di
perangkat lain otomatis keluar.

## Pengembangan

```bash
npm run typecheck   # tsc --noEmit (client + config node)
npm test            # 34 uji API (node --test, server uji terisolasi)
npm run test:e2e    # 5 uji Playwright (login, request, vote, putar, tolak)
npm run build       # Vite build → public/ (MPA: index.html + dj.html)
```

Catatan penting:

- **Auth API** memakai header `x-dj-token` (bukan `Bearer`), format
  `username.<64-hex>`; 401 = sesi hangus → klien kembali ke gerbang login.
- Endpoint kunci: `POST /api/login`, `POST /api/request`, `POST /api/vote`,
  `PATCH /api/event`, `POST /api/dj/track/:id {action}`, `POST /api/dj/beat`.
- **E2E** memakai `e2e/fixtures/users.json` (kredensial uji) dan start server
  dengan `RL_DATA_DIR=/tmp/bergoyang-e2e` bila server belum berjalan; test
  memakai judul unik sehingga aman terhadap data lama.
- Jangan ubah kontrak `server.js` / `vercel.json` tanpa keperluan kuat —
  itulah yang membuat deploy Vercel tetap jalan.

## Data & reset

- **Mode daring**: antrean & pengaturan di Redis — otomatis tersimpan.
- **Mode lokal**: semua di `data/state.json` — server boleh dimatikan,
  antrean tidak hilang.
- Reset total (lokal): berhenti server → hapus `data/state.json` → jalankan
  lagi. Katalog pencarian di `data/songs.json`
  (format: `{"title": "...", "artist": "..."}`).
- Reset antrean (daring): panel DJ → **Kosongkan semua antrean** (admin).

## Troubleshooting

| Masalah | Solusi |
|---|---|
| HP tidak bisa buka halaman | **Daring**: cukup internet. **Lokal**: satu Wi-Fi/hotspot, firewall izinkan Node, pakai alamat LAN (bukan `localhost`) |
| Port 3000 sudah dipakai | `PORT=8080 node server.js` |
| Halaman kosong / setelah deploy lama | Jalankan `npm run build` — `public/` harus berisi hasil build terbaru |
| `:5173` tidak terbuka saat dev | Pastikan `node server.js` jalan (Vite hanya proxy) |
| Lagu tidak lanjut otomatis | **Auto-play** mati — tekan **Putar berikutnya** |
| "Diputar di panel DJ lain" | Panel lain pegang kendali — tekan **Ambil kendali** |
| Dua suara bersamaan | Hanya satu panel yang bunyi — tutup panel lain / ambil kendali |
| Video YouTube tidak mau jalan | Butuh internet; fallback file `audio/` (mode lokal) |
| Browser blokir autoplay | Tekan tombol play di pemutar sekali |
| Lagu tidak muncul di HP lain | Muat ulang halaman; lihat status "Tersambung" — merah = server mati |
| Lupa password | Admin mereset lewat `scripts/seed_users.js` |
| Panel DJ keluar sendiri | Token hilang saat tab ditutup — masuk lagi |
| E2E gagal connect | Jalurkan `npx playwright install` bila browser belum ada; port 5173/3000 dikelola otomatis config |

## Hasil pengujian

- **Uji API** (`npm test`, `tests/api.test.js`) — **34/34 lulus**: login
  multi-user, permission (user vs admin, 401/403), request, vote, endpoint
  DJ (putar/tolak/urutan/clear), patch event, beat-grid, adzan, rate limit.
- **Uji E2E** (`npm run test:e2e`, `e2e/app.spec.js`, Playwright/Chromium)
  — **5/5 lulus**:
  1. Gerbang tamu: login salah ditolak, login benar masuk.
  2. Tamu: kirim request → muncul di antrean → vote (aria-pressed).
  3. DJ: putar lagu dari antrean → toast + kartu *LIVE ON AIR*.
  4. DJ: tolak request pending → hilang dari antrean.
  5. Gerbang DJ: user biasa ditolak dengan notice "hanya untuk admin".
- **Typecheck** (`npm run typecheck`) lulus; **build** (`npm run build`)
  menghasilkan `public/index.html` + `public/dj.html` + `assets/`.
- Verifikasi produksi: kedua halaman disajikan `node server.js` langsung
  (tanpa Vite) berjalan tanpa error JavaScript.
