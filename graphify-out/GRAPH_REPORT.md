# Graph Report - Bergoyang  (2026-10-02)

## Corpus Check
- Corpus is ~24,307 words - fits in a single context window. You may not need a graph.

## Summary
- 321 nodes · 654 edges · 17 communities (14 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Server API & Session Core
- DJ Console Frontend
- Guest Voting Page
- YouTube Sync Content Script
- User Seeding Script
- Docs & UI State Guide
- Extension Background Worker
- Extension Manifest Config
- Package Metadata
- Popup Player Controls
- Popup Config UI
- Vercel Deployment Config
- Auto-play Controls
- Adzan Auto Settings
- Admin Menus
- DJ Settings Box

## God Nodes (most connected - your core abstractions)
1. `handleApi()` - 27 edges
2. `toast()` - 19 edges
3. `boot()` - 18 edges
4. `tick()` - 16 edges
5. `api()` - 14 edges
6. `render()` - 14 edges
7. `boot()` - 13 edges
8. `setupPlayerControls()` - 12 edges
9. `renderNow()` - 12 edges
10. `serve()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Konsol pemutar (deck) panel DJ` --semantically_similar_to--> `Info pemutar popup extension`  [INFERRED] [semantically similar]
  public/dj.html → extension/popup.html
- `Status koneksi footer (Tersambung)` --references--> `Realtime: SSE lokal / polling daring`  [INFERRED]
  public/index.html → PANDUAN.md
- `Tombol Auto-play popup extension` --conceptually_related_to--> `Auto-play antrean`  [INFERRED]
  extension/popup.html → PANDUAN.md
- `Kendali transport (Putar berikutnya / Hentikan)` --implements--> `Auto-play antrean`  [INFERRED]
  public/dj.html → PANDUAN.md
- `Pengaturan adzan otomatis panel DJ` --implements--> `Adzan otomatis (pemutar jeda sendiri)`  [INFERRED]
  public/dj.html → PANDUAN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Sinkronisasi antrean realtime ke semua layar** — public_index_queue_display, public_dj_queue_setlist, panduan_realtime_mekanisme, panduan_vote_antrean [EXTRACTED 1.00]
- **Alur jeda adzan otomatis (panel jeda, tamu diberi strip)** — panduan_adzan_otomatis, public_dj_adzan_settings, public_dj_player_console, public_index_adzan_strip [EXTRACTED 1.00]
- **Kendali pemutar tunggal antar panel DJ** — panduan_kendali_pemutar_tunggal, public_dj_kendali_chip, public_dj_player_console, public_dj_transport_controls [EXTRACTED 1.00]

## Communities (17 total, 3 thin omitted)

### Community 0 - "Server API & Session Core"
Cohesion: 0.05
Nodes (74): { handleRequest }, adminSesi(), advance(), ADZAN_WAKTU, ambilJadwalAdzan(), ambilKunci(), antreanUrut(), AUDIO_DIR (+66 more)

### Community 1 - "DJ Console Frontend"
Cohesion: 0.11
Nodes (58): advance(), adzan, ADZAN_NAMA, api(), applyState(), bisaKelola(), boot(), cekAdzan() (+50 more)

### Community 2 - "Guest Voting Page"
Cohesion: 0.15
Nodes (33): ADZAN_NAMA, adzanTamu, applyState(), boot(), cekAdzanTamu(), connect(), el(), handleVote() (+25 more)

### Community 3 - "YouTube Sync Content Script"
Cohesion: 0.16
Nodes (31): api(), bacaPlan(), continuePending(), isLeader(), jalankanTabBantu(), langkah(), lastReport, lastYtSync (+23 more)

### Community 4 - "User Seeding Script"
Cohesion: 0.11
Nodes (13): adminSet, ambilStateLama(), args, bacaJson(), buatUser(), crypto, fileNama, fileUser (+5 more)

### Community 5 - "Docs & UI State Guide"
Cohesion: 0.13
Nodes (15): Mode daring (Vercel + Redis), Mode lokal (offline, state.json), Penyimpanan Redis (Upstash) untuk mode daring, Peran user & admin, Realtime: SSE lokal / polling daring, Request Lagu Live (sistem), scripts/seed_users.js (buat/reset user & admin), server.js (server + API + SSE + auth multi-user) (+7 more)

### Community 6 - "Extension Background Worker"
Cohesion: 0.22
Nodes (13): config(), DEFAULTS, doFetch(), handleApi(), kirimKeTabBantu(), login(), serverOrder(), SERVERS (+5 more)

### Community 7 - "Extension Manifest Config"
Cohesion: 0.15
Nodes (12): action, default_popup, default_title, background, service_worker, content_scripts, description, host_permissions (+4 more)

### Community 8 - "Package Metadata"
Cohesion: 0.17
Nodes (11): description, engines, node, license, main, name, private, scripts (+3 more)

### Community 9 - "Popup Player Controls"
Cohesion: 0.22
Nodes (7): Input Kode DJ (popup extension lama), Info pemutar popup extension, Tombol Buka YT Music popup, Kendali pemutar tunggal (hanya satu panel bunyi), Chip kendali pemutar & tombol Ambil kendali, Konsol pemutar (deck) panel DJ, Antrean setlist panel DJ

### Community 10 - "Popup Config UI"
Cohesion: 0.57
Nodes (5): api(), escapeHtml(), refresh(), save(), toggleAuto()

### Community 11 - "Vercel Deployment Config"
Cohesion: 0.33
Nodes (5): includeFiles, maxDuration, functions, api/app.js, rewrites

### Community 13 - "Auto-play Controls"
Cohesion: 0.67
Nodes (3): Tombol Auto-play popup extension, Auto-play antrean, Kendali transport (Putar berikutnya / Hentikan)

### Community 14 - "Adzan Auto Settings"
Cohesion: 0.67
Nodes (3): Adzan otomatis (pemutar jeda sendiri), Pengaturan adzan otomatis panel DJ, Strip notifikasi adzan halaman tamu

## Knowledge Gaps
- **77 isolated node(s):** `{ handleRequest }`, `SERVERS`, `DEFAULTS`, `tokenState`, `TAB_ID` (+72 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 94 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 2 inferred relationships involving `boot()` (e.g. with `detakAdzan()` and `detakPemutar()`) actually correct?**
  _`boot()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ handleRequest }`, `SERVERS`, `DEFAULTS` to the rest of the system?**
  _77 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server API & Session Core` be split into smaller, more focused modules?**
  _Cohesion score 0.05031645569620253 - nodes in this community are weakly interconnected._
- **Should `DJ Console Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.11396843950905904 - nodes in this community are weakly interconnected._
- **Should `User Seeding Script` be split into smaller, more focused modules?**
  _Cohesion score 0.11052631578947368 - nodes in this community are weakly interconnected._
- **Should `Docs & UI State Guide` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._