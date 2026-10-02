import * as React from 'react';
import { fetchState } from '@/lib/api';
import type { AppState, BeatInfo } from '@/lib/types';

export type ConnState = 'memuat' | 'tersambung' | 'reconnecting' | 'gagal memuat';

interface LiveState {
  state: AppState | null;
  conn: ConnState;
  /** beat-grid terbaru dari panel DJ (SSE named event / state polling) */
  beat: BeatInfo | null;
  /** paksa sinkron dari server (mis. tab kembali terlihat) */
  refresh: () => Promise<void>;
}

const HEARTBEAT_MS = 10000;
const SILENCE_LIMIT_MS = HEARTBEAT_MS + 15000; // dua kali periode + margin
const WATCHDOG_MS = 5000;
const RETRY_MS = 8000;

/**
 * State antrean real-time.
 *
 * - SSE (/api/events) = jalur utama (update seketika + heartbeat tiap 10 dtk).
 * - Polling /api/state tiap 2,5 dtk = cadangan bila SSE tidak tersedia
 *   (mis. Vercel) atau terdeteksi mati.
 * - Watchdog keheningan: proxy bisa menahan socket SSE mati tanpa memicu
 *   onerror (koneksi zombie). Bila tidak ada pesan/handa lanjut melewati
 *   batas, koneksi dibuang, polling dinyalakan, dan SSE dibuka ulang.
 */
export function useLiveState(): LiveState {
  const [state, setState] = React.useState<AppState | null>(null);
  const [conn, setConn] = React.useState<ConnState>('memuat');
  const [beat, setBeat] = React.useState<BeatInfo | null>(null);
  const applyRef = React.useRef<(next: AppState) => void>(() => {});

  React.useEffect(() => {
    let batal = false;
    let source: EventSource | null = null;
    let poll: number | undefined = undefined;
    let retry: number | undefined = undefined;
    let watchdog: number | undefined = undefined;
    let lastEventAt = Date.now();

    const sentuh = () => {
      lastEventAt = Date.now();
    };

    const terapkan = (next: AppState) => {
      if (batal) return;
      setState(next);
      // stempel penerimaan hanya saat beat.t berubah — paket lama dari cache
      // server tidak boleh terlihat basi-segar
      if (next.beat) {
        const b = next.beat;
        setBeat((prev) => (prev && prev.t === b.t ? prev : { ...b, receivedAt: Date.now() }));
      }
      setConn('tersambung');
    };
    applyRef.current = terapkan;

    const mulaiPolling = () => {
      if (poll !== undefined) return;
      const tick = async () => {
        try {
          terapkan(await fetchState());
        } catch {
          if (!batal) setConn('reconnecting');
        }
      };
      void tick();
      poll = window.setInterval(() => void tick(), 2500);
    };

    const berhentiPolling = () => {
      if (poll === undefined) return;
      window.clearInterval(poll);
      poll = undefined;
    };

    const tutupSse = () => {
      if (!source) return;
      source.close();
      source = null;
    };

    const jadwalUlang = (ms = RETRY_MS) => {
      if (batal || retry !== undefined) return;
      retry = window.setTimeout(() => {
        retry = undefined;
        bukaSse();
      }, ms);
    };

    const bukaSse = () => {
      if (batal) return;
      tutupSse();
      let es: EventSource;
      try {
        es = new EventSource('/api/events');
      } catch {
        mulaiPolling();
        jadwalUlang();
        return;
      }
      source = es;
      const hidup = () => {
        if (es !== source) return;
        sentuh();
        berhentiPolling();
        setConn('tersambung');
      };
      es.onopen = hidup;
      es.addEventListener('heartbeat', hidup);
      es.addEventListener('beat', (event) => {
        if (es !== source) return;
        sentuh();
        try {
          const b = JSON.parse((event as MessageEvent).data) as BeatInfo;
          setBeat({ ...b, receivedAt: Date.now() });
        } catch {
          /* abaikan paket rusak */
        }
      });
      es.onmessage = (event) => {
        if (es !== source) return;
        sentuh();
        try {
          terapkan(JSON.parse(event.data) as AppState);
        } catch {
          /* abaikan paket rusak */
        }
      };
      es.onerror = () => {
        if (es !== source) return;
        tutupSse();
        if (!batal) {
          setConn('reconnecting');
          mulaiPolling();
          jadwalUlang();
        }
      };
    };

    fetchState()
      .then(terapkan)
      .catch(() => {
        if (!batal) setConn('gagal memuat');
      });

    bukaSse();

    watchdog = window.setInterval(() => {
      if (batal || retry !== undefined) return;
      if (Date.now() - lastEventAt > SILENCE_LIMIT_MS) {
        // koneksi zombie: diam tanpa error → buang dan mulai ulang
        tutupSse();
        setConn('reconnecting');
        mulaiPolling();
        jadwalUlang(1000);
      }
    }, WATCHDOG_MS);

    return () => {
      batal = true;
      tutupSse();
      berhentiPolling();
      if (retry !== undefined) window.clearTimeout(retry);
      if (watchdog !== undefined) window.clearInterval(watchdog);
    };
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const next = await fetchState();
      applyRef.current(next);
    } catch {
      /* biarkan status conn apa adanya */
    }
  }, []);

  return { state, conn, beat, refresh };
}
