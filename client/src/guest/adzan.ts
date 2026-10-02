import * as React from 'react';
import { fetchAdzan } from '@/lib/api';
import type { AdzanResponse } from '@/lib/types';

const ADZAN_NAMA: Record<string, string> = {
  Fajr: 'Subuh',
  Dhuhr: 'Dzuhur',
  Asr: 'Ashar',
  Maghrib: 'Maghrib',
  Isha: 'Isya',
};

export function tanggalLocal(): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

interface AdzanState extends AdzanResponse {
  tanggal: string;
}

/**
 * Strip "sedang adzan": muat jadwal hari ini, lalu cek tiap 30 detik apakah
 * waktu sekarang berada dalam jendela adzan (+durasi). Balikkan nama adzan
 * yang sedang berlangsung, atau null.
 */
export function useAdzan(): string | null {
  const [data, setData] = React.useState<AdzanState | null>(null);
  const [aktif, setAktif] = React.useState<string | null>(null);

  const muat = React.useCallback(async () => {
    try {
      const res = await fetchAdzan(tanggalLocal());
      setData({ ...res, tanggal: tanggalLocal() });
    } catch {
      /* offline — diam */
    }
  }, []);

  React.useEffect(() => {
    void muat();
  }, [muat]);

  React.useEffect(() => {
    const cek = () => {
      if (data && data.tanggal !== tanggalLocal()) {
        void muat();
        return;
      }
      if (!data || !data.enabled || !data.jadwal) {
        setAktif(null);
        return;
      }
      const now = new Date();
      const menit = now.getHours() * 60 + now.getMinutes();
      let nama: string | null = null;
      for (const [key, jam] of Object.entries(data.jadwal)) {
        const bagian = String(jam).split(':').map(Number);
        if (bagian.length < 2 || bagian.some((n) => !Number.isFinite(n))) continue;
        const jamBuka = bagian[0] ?? 0;
        const menitBuka = bagian[1] ?? 0;
        const mulai = jamBuka * 60 + menitBuka;
        const durasi = Number(data.durasi) || 10;
        if (menit >= mulai && menit < mulai + durasi) {
          nama = ADZAN_NAMA[key] || key;
          break;
        }
      }
      setAktif(nama);
    };

    cek();
    const timer = window.setInterval(cek, 30000);
    return () => window.clearInterval(timer);
  }, [data, muat]);

  return aktif;
}
