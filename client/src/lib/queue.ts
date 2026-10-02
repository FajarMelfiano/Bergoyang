import type { AppState, Track } from '@/lib/types';

/**
 * Urutan antrean = urutan vote dari server (state.order). Kalau server belum
 * mengirim (mode lama), hitung sendiri: vote terbanyak, lalu yang lebih dulu
 * masuk. Sama dengan yang dipakai server dan halaman tamu.
 */
export function urutAntrean(state: AppState | null, tracks: Track[]): Track[] {
  const order = state?.order || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  const votes = (t: Track) => Object.keys(t.votes || {}).length;
  return tracks.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return votes(b) - votes(a) || a.createdAt - b.createdAt;
  });
}

export function jumlahVote(track: Track): number {
  return Object.keys(track.votes || {}).length;
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const menit = Math.floor(diff / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}
