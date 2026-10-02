import * as React from 'react';
import { adzanLokasi, adzanPengaturan, fetchAdzan, SessionExpiredError } from '@/lib/api';
import { tanggalLocal } from '@/guest/adzan';

const ADZAN_NAMA: Record<string, string> = {
  Fajr: 'Subuh',
  Dhuhr: 'Dzuhur',
  Asr: 'Ashar',
  Maghrib: 'Maghrib',
  Isha: 'Isya',
};

export { ADZAN_NAMA, tanggalLocal };

export interface AdzanBridge {
  /** jeda semua pemutar; true = tadi ada yang sedang bunyi */
  pauseForAdzan: () => boolean;
  /** lanjutkan yang tertahan saat adzan selesai */
  resumeFromAdzan: () => void;
}

export interface AdzanController {
  /** nama adzan yang sedang berlangsung, null = tidak dalam jeda adzan */
  aktif: string | null;
  /** teks banner status (null = banner tersembunyi) */
  banner: string | null;
  jadwal: Record<string, string> | null;
  durasi: number;
  enabled: boolean;
  /** catatan hasil aksi di panel pengaturan ('' = bersih) */
  note: string;
  noteTone: 'ok' | 'error' | '';
  busy: boolean;
  aturDariLokasi: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  setDurasi: (menit: number) => Promise<void>;
  /** cek jendela adzan sekarang juga (dipanggil saat tab kembali terlihat) */
  cek: () => void;
}

/**
 * Jeda adzan panel DJ: muat jadwal hari ini, detekti jendela adzan tiap 20
 * detik (ganti tanggal otomatis), jeda pemutar saat masuk dan lanjutkan saat
 * selesai — plus pengaturan (lokasi/enabled/durasi) untuk panel admin.
 */
export function useAdzanDj(
  token: string,
  bridge: AdzanBridge,
  toast: (message: string, tone?: 'ok' | 'error') => void,
): AdzanController {
  const [jadwal, setJadwal] = React.useState<Record<string, string> | null>(null);
  const [durasi, setDurasiState] = React.useState(10);
  const [enabled, setEnabledState] = React.useState(true);
  const [aktif, setAktif] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [noteTone, setNoteTone] = React.useState<'ok' | 'error' | ''>('');
  const [busy, setBusy] = React.useState(false);

  const tanggalRef = React.useRef(tanggalLocal());
  const aktifRef = React.useRef(false);
  const bridgeRef = React.useRef(bridge);
  const toastRef = React.useRef(toast);
  const tokenRef = React.useRef(token);
  React.useEffect(() => {
    bridgeRef.current = bridge;
    toastRef.current = toast;
    tokenRef.current = token;
  });

  const statusSekarang = React.useCallback((): { aktif: boolean; nama: string; selesai: number } | null => {
    if (!enabled || !jadwal) return null;
    const now = new Date();
    const menit = now.getHours() * 60 + now.getMinutes();
    for (const [key, jam] of Object.entries(jadwal)) {
      const bagian = String(jam).split(':').map(Number);
      if (bagian.length < 2 || bagian.some((n) => !Number.isFinite(n))) continue;
      const mulai = (bagian[0] ?? 0) * 60 + (bagian[1] ?? 0);
      const selesai = mulai + durasi;
      if (menit >= mulai && menit < selesai) {
        return { aktif: true, nama: ADZAN_NAMA[key] || key, selesai };
      }
    }
    return null;
  }, [jadwal, durasi, enabled]);

  const cek = React.useCallback(() => {
    const s = statusSekarang();
    if (s && !aktifRef.current) {
      // adzan masuk → jeda semua pemutar di device ini
      aktifRef.current = true;
      bridgeRef.current.pauseForAdzan();
      toastRef.current(`Adzan ${s.nama} — pemutaran dijeda, lanjut otomatis setelah selesai.`);
    } else if (!s && aktifRef.current) {
      aktifRef.current = false;
      bridgeRef.current.resumeFromAdzan();
      toastRef.current('Adzan selesai — pemutaran dilanjutkan.');
    }
    if (s) {
      const sisa = Math.max(0, s.selesai - (new Date().getHours() * 60 + new Date().getMinutes()));
      setAktif(s.nama);
      setBanner(`Sedang adzan ${s.nama} — pemutaran dijeda otomatis (±${sisa} menit lagi).`);
    } else {
      setAktif(null);
      setBanner(null);
    }
  }, [statusSekarang]);

  const muat = React.useCallback(async () => {
    try {
      const data = await fetchAdzan(tanggalLocal());
      setJadwal(data.jadwal);
      setDurasiState(Number(data.durasi) || 10);
      setEnabledState(data.enabled !== false);
    } catch {
      /* belum disetel atau offline — diam */
    }
    tanggalRef.current = tanggalLocal();
  }, []);

  React.useEffect(() => {
    void muat();
  }, [muat]);

  // detak: jendela adzan tiap 20 detik + ganti tanggal otomatis
  React.useEffect(() => {
    cek();
    const timer = window.setInterval(() => {
      if (tanggalRef.current !== tanggalLocal()) {
        void muat();
        return;
      }
      cek();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [cek, muat, tanggalRef]);

  const catat = (pesan: string, tone: 'ok' | 'error' | '') => {
    setNote(pesan);
    setNoteTone(tone);
  };

  const aturDariLokasi = React.useCallback(async () => {
    const tok = tokenRef.current;
    if (!tok) return;
    setBusy(true);
    catat('Mengambil lokasi…', '');
    if (!('geolocation' in navigator)) {
      catat('Browser tidak mendukung deteksi lokasi.', 'error');
      setBusy(false);
      return;
    }
    let pos: GeolocationPosition;
    try {
      pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          enableHighAccuracy: false,
        });
      });
    } catch (err) {
      catat((err as GeolocationPositionError | Error)?.message || 'Izin lokasi ditolak.', 'error');
      setBusy(false);
      return;
    }
    catat('Mengambil jadwal adzan…', '');
    try {
      const data = await adzanLokasi(tok, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        tanggal: tanggalLocal(),
        durasi: durasi,
        enabled,
      });
      setJadwal(data.jadwal);
      setDurasiState(Number(data.durasi) || 10);
      setEnabledState(data.enabled !== false);
      catat('Jadwal adzan diatur dari lokasi kamu.', 'ok');
      cek();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        catat('Sesi habis — masuk ulang.', 'error');
      } else {
        catat(err instanceof Error ? err.message : 'Gagal mengatur jadwal adzan.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }, [cek, durasi, enabled]);

  const simpanPengaturan = React.useCallback(
    async (payload: { enabled?: boolean; durasi?: number }) => {
      const tok = tokenRef.current;
      if (!tok) return false;
      try {
        const data = await adzanPengaturan(tok, payload);
        setEnabledState(data.enabled !== false);
        setDurasiState(Number(data.durasi) || 10);
        return true;
      } catch (err) {
        toastRef.current(
          err instanceof Error ? err.message : 'Gagal menyimpan.',
          'error',
        );
        return false;
      }
    },
    [],
  );

  const setEnabled = React.useCallback(
    async (on: boolean) => {
      const sebelum = enabled;
      setEnabledState(on); // optimistis, dikembalikan kalau gagal
      if (!(await simpanPengaturan({ enabled: on }))) setEnabledState(sebelum);
      else cek();
    },
    [enabled, cek, simpanPengaturan],
  );

  const setDurasi = React.useCallback(
    async (menit: number) => {
      const d = Math.min(Math.max(Number(menit) || 10, 1), 60);
      const sebelum = durasi;
      setDurasiState(d);
      if (!(await simpanPengaturan({ durasi: d }))) setDurasiState(sebelum);
      else cek();
    },
    [durasi, cek, simpanPengaturan],
  );

  return {
    aktif,
    banner,
    jadwal,
    durasi,
    enabled,
    note,
    noteTone,
    busy,
    aturDariLokasi,
    setEnabled,
    setDurasi,
    cek,
  };
}
