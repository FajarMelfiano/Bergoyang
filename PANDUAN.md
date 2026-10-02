# Request Lagu Live — Panduan

Web request lagu untuk event/DJ/karaoke: tamu kirim lagu dari HP, vote antrean,
DJ setujui dan putar dari panel. Server Node.js **tanpa dependensi npm**
(hanya `node:http`), realtime pakai Server-Sent Events (lokal) / polling
otomatis (daring).

**Dua mode — pilih salah satu saat acara:**

| Mode | Alamat | Data | Kapan dipakai |
|---|---|---|---|
| **Daring (Vercel)** | `https://requestlagu.vercel.app` | Redis (Upstash) | **Bawaan sekarang** — HP tamu cukup punya internet, tidak perlu satu Wi-Fi |
| **Lokal** | `http://localhost:3000` / IP laptop | `data/state.json` | Cadangan offline / acara tanpa internet |

Jangan jalankan keduanya untuk acara yang sama — state-nya terpisah.

Isi folder:

| File | Keterangan |
|---|---|
| `server.js` | Server + API + SSE + autentikasi multi-user (mode lokal & daring) |
| `api/app.js` | Titik masuk serverless untuk Vercel (meneruskan ke `server.js`) |
| `vercel.json` | Konfigurasi routing/bundle Vercel |
| `public/index.html` + `guest.js` | Halaman tamu |
| `public/dj.html` + `dj.js` | Panel DJ (login + **pemutar utama**) |
| `public/styles.css` | Desain "set list panggung" (dipakai bersama tamu & panel) |
| `public/dj.css` | Desain khusus panel DJ ("konsol siaran") |
| `data/songs.json` | Katalog lagu untuk pencarian (edit bebas) |
| `data/state.json` | Antrean, pengaturan & user (dibuat otomatis saat jalan) |
| `data/secret.txt` | Secret server (dibuat otomatis, jangan dihapus) |
| `scripts/seed_users.js` | Buat/reset daftar user panel DJ (lokal & Redis) |
| `audio/` | Folder file mp3 untuk pemutaran lokal |
| `extension/` | *(tidak dipakai lagi — versi lama pemutar via YouTube Music; dipindahkan ke panel DJ)* |
| `PANDUAN.md` | Dokumen ini |

## Langkah 1 — Jalankan server

Butuh Node.js 18+ (sudah terpasang di laptop ini). Tidak perlu `npm install`.

```bash
cd ~/Documents/PPB/RequestLagu
node server.js
```

Banner yang muncul:

```
  Request Lagu Live
  Tamu    : http://localhost:3000/
            http://10.16.3.217:3000/   (HP tersambung Wi-Fi yang sama)
  Panel DJ: http://localhost:3000/dj  (login pakai username + password)
  Pemutar : mainkan langsung di panel DJ (tombol Putar berikutnya)
```

- **Port lain:** `PORT=8080 node server.js`
- Berhenti: `Ctrl+C` (antrean tetap tersimpan di `data/state.json`).

### Mode daring — Vercel (sudah ter-deploy)

Server sudah hidup di **`https://requestlagu.vercel.app`**. Tidak perlu
menjalankan `node server.js` — buka alamat itu dari HP/komputer mana saja
yang punya internet.

- **Halaman tamu wajib login** (privat): panitia masuk dengan username +
  password masing-masing, baru bisa request & vote. Orang yang belum
  terdaftar tidak bisa masuk maupun mengirim request.
- **Panel DJ `/dj` hanya untuk admin** — akun panitia biasa ditolak dengan
  pesan + link kembali ke halaman tamu.

```bash
# memperbarui versi daring setelah mengubah kode:
cd ~/Documents/PPB/RequestLagu
vercel deploy --prod --yes
```

Yang berbeda di mode daring (sudah otomatis, tidak perlu disetel):

- **Realtime** — serverless tidak bisa menahan koneksi SSE, jadi halaman
  nyata memakai polling tiap ~2,5 detik. Pengalaman tamu/panel tetap sinkron
  (status footer tetap "Tersambung"); tidak perlu refresh.
- **Penyimpanan** — antrean & pengaturan disimpan di Redis (Upstash, dibuat
  lewat Vercel Marketplace), bukan file. Backup otomatis.
- **File mp3 lokal** (`audio/`) hanya untuk mode lokal — di mode daring pemutar
  memakai YouTube.
- **Pencarian lagu otomatis** tetap jalan (server cari di YouTube).

Kalau internet mati saat acara, pakai mode lokal sebagai cadangan: jalankan
`node server.js` dan buka `http://<IP-laptop>:3000/dj`.

## Langkah 2 — Halaman tamu (HP)

Halaman tamu bersifat **privat**: hanya panitia terdaftar yang bisa request.
Tamu membuka alamat, **masuk dengan username + password** sekali, lalu form
request langsung muncul. Orang yang belum terdaftar tidak bisa masuk maupun
mengirim request.

1. Pastikan HP dan laptop di **Wi-Fi/hotspot yang sama**.
2. Buka alamat LAN dari banner di browser HP, misal `http://10.16.3.217:3000/`.
3. Masuk dengan username + password panitia (sama seperti yang dibagikan).
   Sesi tersimpan di tab ini sampai kamu **Keluar** dari menu nama di pojok
   kanan atas.
4. Ketik judul lagu → saran muncul **live dari seluruh katalog YouTube**
   (judul + artis + durasi) → pilih salah satu, atau biarkan saja.
   Baris **"Terdeteksi: ..."** di bawah kolom pencarian menunjukkan sumber
   lagu yang paling cocok; tekan **pakai ini** untuk memakainya.
   Kolom **Sumber lagu** boleh dikosongkan — server mencari sendiri.
   Request **wajib punya sumber**: link yang ditempel dipakai apa adanya;
   kalau kosong dan judul tidak bisa dicari server, request ditolak dengan
   pesan jelas.
5. Setelah terkirim, catatan menampilkan **posisi antrean** milikmu, misal
   "posisi antrean #5 dari 9. Naik urutan kalau dapat vote."
6. Semua HP langsung sinkron (tanpa refresh): lagu baru, vote, dan lagu yang
   sedang diputar ikut berubah sendiri.

Aturan untuk tamu:

- **Antrean tidak dibatasi** — request berapa pun dan dari berapa pun perangkat.
  Yang dibatasi hanya kecepatan kirim (10 request per menit per perangkat,
  untuk mencegah antrean membanjir).
- **Urutan antrean = vote terbanyak.** Begitu ada suara baru, lagunya **naik
  sendiri secara real-time** di semua layar (tamu & panel DJ). Lagu paling
  banyak vote ditandai **Berikutnya** dan itulah yang diputar berikutnya.
- Tombol **▲** di kanan slip = vote (sekali klik = sekali vote, klik lagi = batal).
- Kalau DJ menyalakan **persetujuan otomatis** (bawaan), lagu langsung masuk
  antrean; kalau mati, lagu berstatus *menunggu* sampai DJ menyetujui.

## Langkah 3 — Panel DJ (sekaligus pemutar)

1. Buka `http://localhost:3000/dj` (atau alamat LAN + `/dj`) di komputer DJ.
2. Masuk dengan **akun admin**. Hanya admin yang bisa membuka panel DJ;
   password disimpan sebagai hash (tidak pernah disimpan polos di server) dan
   **bisa diganti sendiri** lewat menu nama di pojok kanan atas panel.
3. Fungsi panel:

| Kontrol | Fungsi |
|---|---|
| **Putar berikutnya** | Judul teratas antrean jadi *sedang diputar*, muncul di semua HP |
| **Hentikan** | Berhenti, tidak pindah ke lagu berikutnya |
| **Putar** (per baris) | Putar lagu itu sekarang juga (lompati antrean) |
| **Tolak** | Tolak permintaan (masuk daftar selesai, transparan) |
| **Naik / Turun** | Ubah urutan antrean (hanya berlaku kalau jumlah vote-nya sama — vote selalu jadi prioritas utama) |
| **Sumber audio** (per baris) | Cari otomatis di YouTube / tempel link / pilih file mp3 |
| **Selesai (n)** | Daftar lagu yang sudah diputar |

### Peran: user & admin

Ada dua peran sekarang:

- **`user`** (panitia, 15 akun) — **hanya request + vote + ganti password
  sendiri**, semuanya lewat **halaman tamu**.
  - ✅ Buka halaman tamu (wajib login), kirim request, vote lagu, ganti
    password sendiri lewat menu nama di pojok kanan atas.
  - ❌ Tidak boleh: membuka panel DJ, memutar/menghentikan lagu, menyetujui
    atau menolak request, mengubah urutan, mengosongkan antrean, mengubah
    pengaturan acara. User yang mencoba masuk ke `/dj` langsung **ditolak**
    dengan pesan *"Panel DJ hanya untuk admin"*, dan request anonymous
    (tanpa login) ditolak server dengan **401**.
- **`admin`** (1 akun) — satu-satunya yang boleh membuka **panel DJ**:
  memutar & menghentikan lagu, menyetujui/menolak, mengubah urutan,
  mengosongkan antrean, mengatur sumber lagu, dan mengubah pengaturan acara
  (termasuk jadwal adzan otomatis). Promosi admin dilakukan lewat
  `scripts/seed_users.js --admin <username>`.

### Akun admin panel DJ

Ada **satu akun `admin` terpisah** untuk menjalankan panel DJ saat acara
(memutar, setujui/tolak, ubah urutan, kosongkan antrean, buka/tutup request,
atur pengaturan + adzan). Akun admin dipakai di komputer yang menjadi
pemutar utama.

Buat/reset (hanya mengganti akun `admin`, password 15 user lain tak tersentuh
selama pakai `--file`):

```bash
node scripts/seed_users.js --file /tmp/opencode/admin_user.json --admin admin
```

Setiap kali browser dibuka → **wajib login lagi** (panel memakai
`sessionStorage`, otomatis terhapus saat tab/browser ditutup). Menutup lalu
membuka panel baru selalu menampilkan layar login.

Panel DJ sekarang **memutar sendiri** lewat pemutar YouTube yang tertanam di
halaman — tidak perlu extension atau tab YouTube Music lagi. Suara keluar dari
komputer panel DJ; sambungkan ke sound system seperti biasa.

### Auto-play (antrean jalan sendiri)

- **Putar berikutnya** otomatis menyalakan auto-play; **Hentikan** otomatis
  mematikannya (sampai DJ tekan Putar lagi). Toggle **`Auto-play`** juga
  tersedia di panel.
- Saat auto-play aktif: lagu selesai → **otomatis lanjut** ke lagu berikutnya
  dari urutan vote tertinggi. DJ tidak perlu menekan apa-apa.
- Video yang tidak bisa diputar (diblokir/hak cipta) **otomatis dilompati** ke
  lagu berikutnya dengan notifikasi.
- Kalau browser memblokir autoplay suara, panel menampilkan tombol play di
  pemutar — tekan sekali, lalu auto-play jalan normal.
- Chip **`Player: …`** di atas panel = status pemutar: `memutar <judul>`,
  `siap`, atau `jeda`.

### Kendali pemutar (hanya satu panel yang bunyi)

Chip **`Kendali pemutar`** menunjukkan siapa yang memegang pemutar:

- **`Kendali pemutar: panel ini`** — panel ini sedang memutar. Hanya **satu**
  panel yang boleh memutar sekaligus, jadi tidak ada dua suara bertumpuk.
- **`Kendali pemutar: panel lain`** — ada panel DJ lain (tab/komputer lain)
  yang pegang kendali. Panel ini **diam** dan menampilkan catatan
  *"Diputar di panel DJ lain"*. Tekan tombol **`Ambil kendali`** untuk
  memindahkan pemutaran ke panel ini.
- Kendali dilepas otomatis saat DJ **keluar** (logout) dari panel. Panel yang
  tertutup tanpa logout melepas kendali sendiri dalam ~12 detik, lalu panel
  lain bisa mengambil alih.

### Adzan otomatis (pemutar jeda sendiri)

Panel DJ bisa **menjeda pemutaran otomatis saat adzan masuk**, dan
melanjutkannya sendiri setelah selesai — cocok untuk acara yang menghormati
waktu shalat.

Ada tiga cara mendapatkan jadwal, dari yang paling pasti sampai yang paling rapuh. Panel selalu menampilkan **sumber jadwal yang sedang dipakai**, jadi
tidak lagi ada "jadi ini jamnya benar atau bukan":

1. **Ambil dari kota** (paling disarankan). Tulis kota atau kabupaten acara di
   kolom **Kota atau kabupaten acara**, lalu tekan **`Ambil dari kota`**.
   Jadwal diambil dari daftar 514 kota/kabupaten Indonesia dan **dihitung ulang
   otomatis tiap ganti tanggal** — tidak ada hubungannya dengan lokasi HP.
   Kalau nama kotanya ambigu (misal "Bandung" bisa berarti kota atau
   kabupaten), panel menolistkan pilihan; ejaan salah seperti "jakrta" juga
   diberi saran.
   **Kalau masjidmu punya jadwal sendiri**, pakai kolom **koreksi (mnt)** di
   sebelah kanan tiap salat: contoh Krian–Sidoarjo, jadwal standar nasional
   menyebut Ashar 14:29 (Kompas/Tirto/Muslim Pro), sementara masjid membunyikan
   adzan 15:00 — jadi Ashar diisi koreksi `+31`, dan panel menampilkan
   `14:29 +31 mnt → 15:00`. Koreksi ikut terhitung ulang tiap hari, jadi tidak
   perlu diubah tiap tanggal.
2. **Simpan jam manual** (paling akurat). Kalau masjid punya jadwal cetak
   sendiri, isi saja lima kolom jam (Subuh, Dzuhur, Ashar, Maghrib, Isya)
   lalu tekan **`Simpan jam`**. Selama jam manual terisi, sumber lain diabaikan.
   Perbedaan antar ormas (±8 menit untuk Subuh: Kemenag 20°, Muhammadiyah 18°)
   baru bisa diselesaikan lewat cara ini.
3. **Ambil dari lokasi HP** (paling rapuh). Jangan dipakai sebagai acuan:
   koordinat HP bukan koordinat acara, dan itulah yang pernah membuat jam
   meleset puluhan menit.

- Atur **`Lama jeda adzan`** (menit, bawaan 10). Saat waktu masuk, pemutar
  utama langsung **jeda**, muncul **popup “Jeda — Maghrib”** di panel (dapat
  ditutup dengan `Kembali ke panel`, DJ tetap bisa managing antrean) dan band
  pemberitahuan di halaman tamu. Setelah jeda selesai, lagu
  **dilanjutkan otomatis**.
- Bisa dimatikan sementara lewat centang **`Aktifkan jeda adzan`** tanpa
  menghapus jadwal. Jadwal diperbarui otomatis setiap ganti tanggal.
- Saat jeda adzan aktif, tombol pemutar sengaja **diblokir** (Putar berikutnya,
  Putar per baris, tombol spasi) agar tidak ada musik yang mengganggu adzan.

### Auto-lanjut (sakelar di bawah tombol Hentikan)

Ada sakelar **Auto-lanjut** di panel, tepat di bawah tombol
**Putar berikutnya** dan **Hentikan**:

- **Nyala** — lagu berikutnya diputar otomatis begitu lagu selesai, dan
  **request baru yang masuk saat panel sedang idle ikut diputar otomatis**
  (dalam ≤5 detik, biasanya seketika).
- **Mati** — semuanya berhenti: tidak ada auto-lanjut, dan request baru
  **tidak** diputar sampai DJ menekan **Putar berikutnya** atau menyalakan
  sakelar lagi. Panel menampilkan catatan: *"Request ini menunggu…"*.
- Tombol **Hentikan** mematikan sakelar ini. Kalau sakelar mati, DJ tetap bisa
  menyalakannya kembali kapan saja tanpa harus memutar lagu.

Dua hal yang otomatis terjadi tanpa perlu klik:

1. Setelah menekan **Jadikan ini pemutar utama**, kalau antrean sudah berisi
   dan belum ada yang diputar, lagu pertama **langsung bunyi**.
2. Begitu ada request baru saat panel idle, langsung diputar — tidak perlu
   menekan **Putar berikutnya**.

Auto-play tetap hormat jeda adzan, dan hanya device yang memegang pemutar
utama yang boleh memulainya.

### Tombol spasi = jeda/mainkan

Di panel DJ, tekan **spasi** di keyboard untuk **menjeda atau memutar lagu**
tanpa harus mengklik. Berlaku hanya di device yang menjadi pemutar utama dan
sedang tidak dalam jeda adzan. Saat fokus ada di kolom isian atau tombol,
spasi berfungsi normal (tidak memicu pemutar).

## Mengelola user panel DJ

Daftar user diatur lewat `scripts/seed_users.js`. Password acak dibuat di
sana, disimpan sebagai **hash scrypt + salt per user** (tidak pernah polos),
dan peta `username → password` dicetak ke **stdout** — simpan di luar proyek
(mis. `/tmp/opencode/users_seed.json`) lalu bagikan ke masing-masing orang.
**Jangan** menyimpan password polos di dalam folder proyek (Vercel mengunggah
folder ini ke server publik).

```bash
cd ~/Documents/PPB/RequestLagu

# mode lokal: buat 15 user dari daftar nama, password acak
RL_DATA_DIR=data node scripts/seed_users.js --buat /tmp/opencode/daftar_nama.json > /tmp/opencode/users_seed.json

# mode daring (Redis): sekalian jadikan melfiano & pakandri admin
node scripts/seed_users.js --buat /tmp/opencode/daftar_nama.json \
  --admin melfiano --admin pakandri > /tmp/opencode/users_seed.json
```

Format file daftar nama: `["melfiano", "habib", {"username":"pakandri","nama":"Pak Andri"}]`.

Setelah masuk, setiap user **wajib/boleh ganti password sendiri** lewat menu
namanya di pojok kanan atas → "Ganti password saya". Password baru langsung
menggantikan yang lama; sesi di perangkat lain otomatis keluar.

## Data & reset

- **Mode daring**: antrean & pengaturan ada di Redis (Upstash) — otomatis
  tersimpan di server, tidak ada file yang perlu dicadangkan.
- **Mode lokal**: semua tersimpan di `data/state.json` — server boleh dimatikan,
  antrean tidak hilang.
- Reset total (mode lokal): berhenti server → hapus `data/state.json` →
  jalankan lagi. Katalog lagu pencarian ada di `data/songs.json` (tambah lagu
  bebas, format: `{"title": "...", "artist": "..."}`).
- Reset antrean (mode daring): dari panel DJ → **Kosongkan semua antrean**
  (hanya **admin**).

## Troubleshooting

| Masalah | Solusi |
|---|---|
| HP tidak bisa buka halaman | **Mode daring**: cukup internet → `https://requestlagu.vercel.app`. **Mode lokal**: satu Wi-Fi/hotspot, firewall izinkan Node, pakai alamat LAN dari banner (bukan `localhost`) |
| Port 3000 sudah dipakai | `PORT=8080 node server.js` (mode lokal) |
| Lagu tidak lanjut otomatis | **Auto-play** sedang mati — tekan **Putar berikutnya** di panel DJ (bukan Hentikan) |
| Panel tidak memutar, ada tulisan "Diputar di panel DJ lain" | Panel lain pegang kendali — tekan **Ambil kendali** |
| Dua suara terdengar bersamaan | Hanya satu panel yang boleh memutar — tutup panel lain, atau tekan **Ambil kendali** di panel yang dipakai |
| Video YouTube tidak mau jalan | Butuh internet; fallback ke file di `audio/` (khusus mode lokal) |
| Browser blokir autoplay suara | Tekan tombol play di pemutar panel sekali, lalu auto-play jalan normal |
| Lagu tidak muncul di HP lain | Muat ulang halaman tamu; lihat status "Tersambung" di footer — merah = server mati |
| Lupa password | Minta admin mereset lewat `scripts/seed_users.js`, atau ganti sendiri lewat menu nama di panel (kalau masih bisa masuk) |
| Antrean berbeda antara laptop & HP | Dua mode punya data terpisah — pilih satu saja untuk acara (lihat tabel di atas) |
| Panel DJ keluar sendiri | Token sesi hilang saat browser ditutup — masuk lagi dengan username + password |

## Hasil pengujian

Uji E2E otomatis (Playwright, server uji terisolasi port 3100, reseed per tes)
— **7/7 suite lulus**:

**Login multi-user + permission** (`test_login.py`):

1. Login username+password benar → token + nama + peran; password/username
   salah → 401; kode DJ lama (`2468`) → **401 (sudah diganti total)**.
2. Role **user** hanya boleh: request lagu, vote, dan ganti password sendiri.
   Semua endpoint panel DJ (`/api/dj/*`, `/api/player/*`, `/api/event`)
   mengembalikan **403** untuk user.
3. Role **admin** boleh semua operasi panel DJ.
4. Request & vote **anonymous** (tanpa token) → **401**.
5. Ganti password: password lama salah → 401; password baru < 6 karakter →
   400; sukses → token baru, **token lama langsung hangus**.
6. UI halaman tamu: sebelum login hanya form masuk yang terlihat; setelah
   login muncul form request + menu user (ganti password, keluar).
7. UI panel DJ: user biasa **ditolak** (pesan + link kembali ke halaman
   tamu); admin masuk ke console lengkap dengan **Pengaturan acara**.

**Panel DJ sebagai pemutar utama** (`test_panel_player.py`):

1. Login admin → klaim kendali tersimpan di server (`state.player.panel`).
2. Chip `Kendali pemutar: panel ini` muncul.
3. Auto-play mengambil lagu dengan **vote terbanyak** lebih dulu (urutan vote
   dihormati, bukan urutan masuk).
4. Pemutar YouTube tertanam termuat & memutar video yang benar.
5. Detak status `memutar <judul>` tersimpan di server (chip `Player:` hidup).
6. **Putar berikutnya** → lagu berikutnya mengikuti urutan vote.
7. **Hentikan** → pemutaran benar-benar berhenti + auto-play off.
8. Panel kedua: chip `Kendali pemutar: panel lain` + tombol **Ambil kendali**
   muncul, panel kedua **diam** (tidak ikut memutar).
9. **Ambil kendali** → kepemilikan pindah ke panel kedua; panel pertama
   otomatis menyerah.

**Auto-play natural** (`test_ended.py`, `test_autoplay_natural.py`):

1. Auto-play mulai memutar lagu teratas.
2. Video **selesai secara natural** (ENDED) → otomatis lanjut ke lagu
   berikutnya tanpa perintah DJ.

**Halaman tamu** (`test_tamu.py`):

1. Pencarian lagu menampilkan saran dari YouTube.
2. Kirim judul saja → server mencari sumber otomatis; **setiap lagu di antrean
   dijamin punya sumber YouTube**.
3. Pilih saran → sumber dipakai apa adanya (id video sesuai pilihan).
4. Vote mengubah urutan antrean (`order` di server), halaman tamu ikut
   urutan vote.

**Layout & keadaan panel** (`test_3perbaikan.py`, `test_layout_slip.py`):
placeholder pemutar saat kosong, tombol "Jadikan ini pemutar utama", tidak
ada dua suara, dan layout slip Berikutnya + vote di halaman tamu.

**Audit mekanik desain panel baru** (`audit.py`): tidak ada luapan horizontal
(desktop & mobile), layout dua kolom, kolom deck sticky dengan **gulir
internal** (tidak lagi menutupi konten di bawahnya — bug lama teratasi),
menu user & form password terjangkau, dan semua kontrol ≥ 32px (di atas
WCAG 2.2 AA 24px).
