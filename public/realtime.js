/* Realtime: kanal broadcast Supabase untuk halaman tamu & panel DJ.
 *
 * - Server (Vercel) mem-post event `update` setiap kali state tersimpan, jadi
 *   semua halaman bisa menyegarkan dirinya SEKETIKA, bukan menunggu polling.
 * - Panel DJ mengirim event `beat` (posisi lagu) langsung antar tab — tamu
 *   melihat bar progres jalan mulus tanpa menyentuh server sama sekali.
 * - Kehadiran (presence) dipakai untuk angka "N online".
 *
 * Kuncinya kunci PUBLIK (anon) — ini memang kunci untuk browser; yang
 * rahasia (service role) tidak pernah masuk ke sisi klien. */
'use strict';

const RL_URL = 'https://roowyrmfytbldcdvagbp.supabase.co';
const RL_KUNCI_PUBLIK =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvb3d5cm1meXRibGRjZHZhZ2JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2OTkyMTIsImV4cCI6MjA4NzI3NTIxMn0.y8Cxe1c5tYWW5JGgAxuVNTA6AsK-8gRjb3eii0s5wB0';
const RL_KANAL = 'requestlagu';

/** Pasang realtime & langgan kanal `requestlagu`.
 *  handler: { onUpdate?() , onBeat?(payload), onOrang?(n), onStatus?(hidup) }
 *  Kembalikan { kirimBeat(payload), hidup() } — atau null bila tidak tersedia
 *  (vendor gagal dimuat, jaringan mati, dsb). Semua kegagalan diam: polling
 *  tetap jalan sebagai jaring pengaman. */
function RLsambung(handler) {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
  try {
    const sb = window.supabase.createClient(RL_URL, RL_KUNCI_PUBLIK, {
      realtime: { params: { eventsPerSecond: 5 } },
    });
    const identitas = (crypto.randomUUID && crypto.randomUUID()) ||
      ('tab' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    const kanal = sb.channel(RL_KANAL, { config: { presence: { key: identitas } } });

    if (handler.onUpdate) {
      kanal.on('broadcast', { event: 'update' }, () => {
        try { handler.onUpdate(); } catch { /* abaikan */ }
      });
    }
    if (handler.onBeat) {
      kanal.on('broadcast', { event: 'beat' }, (pesan) => {
        try { handler.onBeat((pesan && pesan.payload) || {}); } catch { /* abaikan */ }
      });
    }
    if (handler.onOrang) {
      kanal.on('presence', { event: 'sync' }, () => {
        try {
          const kunci = Object.keys(kanal.presenceState() || {});
          handler.onOrang(kunci.length);
        } catch { /* abaikan */ }
      });
    }

    kanal.subscribe((status) => {
      const hidup = status === 'SUBSCRIBED';
      if (hidup) {
        try { kanal.track({ p: 1 }); } catch { /* abaikan */ }
      }
      if (handler.onStatus) {
        try { handler.onStatus(hidup); } catch { /* abaikan */ }
      }
    });

    return {
      /** Kirim beat-grid DARI panel DJ ke semua tamu (antar-tab, tanpa server). */
      kirimBeat: (payload) => {
        try {
          kanal.send({ type: 'broadcast', event: 'beat', payload });
          return true;
        } catch { return false; }
      },
      hidup: () => kanal.state === 'joined',
    };
  } catch {
    return null;
  }
}

window.RLReal = { sambung: RLsambung };
