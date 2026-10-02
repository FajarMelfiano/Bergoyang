import * as React from 'react';
import {
  ApiError,
  djAdvance,
  djBeat,
  djTrackAction,
  playerClaim,
  playerStatus,
  SessionExpiredError,
  ytSearch,
} from '@/lib/api';
import type { AppState, PlayerInfo, Track } from '@/lib/types';
import { urutAntrean } from '@/lib/queue';
import type { YTPlayerInstance } from '@/dj/yt';

const PANEL_KEY = 'requestlagu.panel';
const SEGAR_MS = 12000;

/** id tab panel DJ — satu per tab, dipakai server untuk klaim pemutar. */
function getPanelId(): string {
  let id = sessionStorage.getItem(PANEL_KEY) || '';
  if (!id) {
    id = `panel-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem(PANEL_KEY, id);
  }
  return id;
}

function loadYTApi(): Promise<typeof window.YT> {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('Player YouTube gagal dimuat (butuh internet).'));
    document.head.append(script);
    window.setTimeout(() => {
      if (window.YT && window.YT.Player) resolve(window.YT);
    }, 9000);
  });
}

export type DeckMode = 'empty' | 'yt' | 'audio';

export interface EngineUi {
  /** tampilan layar deck: kosong / frame YouTube / audio lokal */
  mode: DeckMode;
  /** pesan panduan di atas player (mis. autoplay diblokir) */
  hint: string[] | null;
  /** catatan status di bawah transport (aria-live) */
  note: string;
  /** BPM terdeteksi dari audio yang sedang diputar (null = belum tahu) */
  bpm: number | null;
  /** analisis tab (capture YouTube) sedang aktif */
  capture: boolean;
  /** graph Web Audio (analyser) sudah dibuat — untuk render ulang visualizer */
  analyserReady: boolean;
}

export interface PlayerEngineDeps {
  state: AppState | null;
  token: string;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  /** klaim berhasil → panel barukan disimpan di DjApp (merge dengan SSE) */
  onClaimed: (player: PlayerInfo | null) => void;
  /** 401/403 sesi hangus → gerbang login */
  onExpired: () => void;
  /** tab kembali terlihat → cek adzan + sinkron state */
  onVisible?: () => void;
}

export interface PlayerEngine {
  panelId: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  ui: EngineUi;
  /** device lain (segarnya masih hidup) yang sedang memegang pemutar */
  playerManaged: (state: AppState | null) => boolean;
  kitaPegang: (state: AppState | null) => boolean;
  claim: (paksa?: boolean) => Promise<boolean>;
  advance: () => Promise<void>;
  togglePlayPause: () => void;
  stopPlayback: () => void;
  /** taruh true saat jeda adzan berlaku — blokir advance/auto-play/Spasi */
  setAdzanAktif: (v: boolean) => void;
  isCurrent: (trackId: string) => boolean;
  startPlayback: (track: Track) => void;
  setNote: (note: string) => void;
  /** cari sumber YouTube otomatis lalu pasang ke track */
  resolveAndAssign: (track: Track, query: string) => Promise<void>;
  /** adzan masuk: jeda, kembalikan true kalau ada yang sedang bunyi */
  pauseForAdzan: () => boolean;
  /** adzan selesai: lanjutkan yang tadi */
  resumeFromAdzan: () => void;
  detakPemutar: () => Promise<void>;
  /** AnalyserNode untuk visualizer (null sebelum graph dibuat) */
  analyser: () => AnalyserNode | null;
  /** mulai/berhenti analisis audio tab (YouTube lewat getDisplayMedia) */
  toggleCapture: () => Promise<void>;
  stopCapture: () => void;
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Terjadi kesalahan.';
}

/**
 * Mesin pemutar panel DJ: YouTube iframe + audio lokal, klaim kepemilikan
 * per-tab, detak status 5 detik + auto-heal, auto-play antrean, dan Spasi.
 * Semua state imperatif (player YT, src audio) dipegang ref supaya aman
 * di bawah React StrictMode.
 */
export function usePlayerEngine(deps: PlayerEngineDeps): PlayerEngine {
  const { state, token, toast, onClaimed, onExpired, onVisible } = deps;

  const panelId = React.useMemo(() => getPanelId(), []);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const ytPlayer = React.useRef<YTPlayerInstance | null>(null);
  const currentSourceId = React.useRef<string | null>(null);
  const jedaManual = React.useRef(false);
  const advancing = React.useRef(false);
  const autoPlayTerakhir = React.useRef(0);
  const diputarSebelumAdzan = React.useRef(false);

  /* ------------------------------------------------- graph audio + beat */
  const audioCtx = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const mediaSrc = React.useRef<MediaElementAudioSourceNode | null>(null);
  const capStream = React.useRef<MediaStream | null>(null);
  const capSrc = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const bpmRef = React.useRef<number | null>(null);
  const energyRef = React.useRef(0);
  const tdBuf = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rmsBuf = React.useRef<Float32Array | null>(null);
  const rmsIdx = React.useRef(0);
  const lastBeat = React.useRef({ kirim: false, beatIdx: -1, t: 0 });

  const stateRef = React.useRef<AppState | null>(state);
  const tokenRef = React.useRef(token);
  const adzanRef = React.useRef(false);
  const toastRef = React.useRef(toast);
  const onExpiredRef = React.useRef(onExpired);
  React.useEffect(() => {
    stateRef.current = state;
    tokenRef.current = token;
    toastRef.current = toast;
    onExpiredRef.current = onExpired;
  });

  const [ui, setUi] = React.useState<EngineUi>({
    mode: 'empty',
    hint: null,
    note: '',
    bpm: null,
    capture: false,
    analyserReady: false,
  });
  const setHint = (hint: string[] | null) => setUi((u) => (u.hint === hint ? u : { ...u, hint }));
  const setNote = React.useCallback((note: string) => {
    setUi((u) => (u.note === note ? u : { ...u, note }));
  }, []);
  const setMode = (mode: DeckMode) => setUi((u) => (u.mode === mode ? u : { ...u, mode }));

  const segar = (st: AppState | null) =>
    Boolean(st?.player && st.player.updatedAt && Date.now() - st.player.updatedAt < SEGAR_MS);

  const playerManaged = React.useCallback(
    (st: AppState | null) =>
      Boolean(st && st.player && st.player.panel && st.player.panel !== panelId && segar(st)),
    [panelId],
  );
  const kitaPegang = React.useCallback(
    (st: AppState | null) => Boolean(st && st.player && st.player.panel === panelId),
    [panelId],
  );

  const handleErr = React.useCallback((err: unknown) => {
    if (err instanceof SessionExpiredError) {
      onExpiredRef.current();
      return;
    }
    toastRef.current(errMessage(err), 'error');
  }, []);

  /* ---------------------------------------------------- graph Web Audio */

  /**
   * Buat AudioContext + AnalyserNode (sekali), lalu coba resume. Media source
   * untuk elemen <audio> hanya dibuat setelah konteks benar-benar `running`
   * — kalau dibuat saat ter-suspend, suara mp3 jadi senyap.
   */
  const ensureGraph = React.useCallback(async (): Promise<AudioContext | null> => {
    let ctx = audioCtx.current;
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return null;
      }
      audioCtx.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      an.smoothingTimeConstant = 0.8;
      analyserRef.current = an;
      // jalur tarik supaya analyser tetap diproses walau input capture senyap
      const mute = ctx.createGain();
      mute.gain.value = 0;
      an.connect(mute);
      mute.connect(ctx.destination);
      setUi((u) => (u.analyserReady ? u : { ...u, analyserReady: true }));
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* menunggu gesture pengguna */
      }
    }
    if (ctx.state === 'running' && !mediaSrc.current && audioRef.current) {
      try {
        const src = ctx.createMediaElementSource(audioRef.current);
        src.connect(analyserRef.current!);
        src.connect(ctx.destination); // suara mp3 tetap terdengar
        mediaSrc.current = src;
      } catch {
        /* elemen sudah terhubung ke graph lain */
      }
    }
    return ctx;
  }, []);

  const setBpm = React.useCallback((bpm: number | null) => {
    bpmRef.current = bpm;
    setUi((u) => (u.bpm === bpm ? u : { ...u, bpm }));
  }, []);

  const stopCapture = React.useCallback(() => {
    try {
      capSrc.current?.disconnect();
    } catch {
      /* abaikan */
    }
    capSrc.current = null;
    capStream.current?.getTracks().forEach((t) => t.stop());
    capStream.current = null;
    setUi((u) => (u.capture ? { ...u, capture: false } : u));
  }, []);

  /** Analisis audio tab YouTube: bagikan tab + centang "Bagikan audio tab". */
  const toggleCapture = React.useCallback(async () => {
    if (capStream.current) {
      stopCapture();
      toastRef.current('Analisis tab dimatikan.');
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      toastRef.current('Pembagian tab dibatalkan.', 'error');
      return;
    }
    const ctx = await ensureGraph();
    if (!ctx || !analyserRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      toastRef.current('Web Audio tidak didukung browser ini.', 'error');
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      toastRef.current(
        'Tab tidak membagikan audio. Ulangi lalu centang "Bagikan audio tab".',
        'error',
      );
      return;
    }
    stream.getVideoTracks().forEach((t) => t.stop()); // cuma butuh audio
    audioTracks.forEach((t) => t.addEventListener('ended', () => stopCapture()));
    try {
      const src = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      src.connect(analyserRef.current);
      capSrc.current = src;
      capStream.current = stream;
      setUi((u) => (u.capture ? u : { ...u, capture: true }));
      toastRef.current('Analisis tab aktif — audio YouTube menggerakkan visualizer.');
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      toastRef.current('Gagal menghubungkan audio tab.', 'error');
    }
  }, [ensureGraph, stopCapture]);

  /** lagu baru → BPM lama tidak berlaku */
  const resetBeat = React.useCallback(() => {
    setBpm(null);
    energyRef.current = 0;
    lastBeat.current = { kirim: false, beatIdx: -1, t: 0 };
    rmsBuf.current?.fill(0);
    rmsIdx.current = 0;
  }, [setBpm]);

  /* ------------------------------------------------------- youtube/audio */

  const mainkanVideo = React.useCallback(() => {
    const p = ytPlayer.current;
    if (!p) return;
    try {
      p.playVideo();
    } catch {
      /* abaikan */
    }
  }, []);

  const ensureHost = React.useCallback((): HTMLElement | null => {
    const wrap = hostRef.current;
    if (!wrap) return null;
    const anak = wrap.firstElementChild as HTMLElement | null;
    if (anak && anak.dataset.ytHost === '1') return anak;
    wrap.replaceChildren();
    const div = document.createElement('div');
    div.dataset.ytHost = '1';
    wrap.append(div);
    return div;
  }, []);

  const stopPlayback = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        /* abaikan */
      }
    }
    const p = ytPlayer.current;
    if (p) {
      try {
        p.stopVideo();
      } catch {
        /* abaikan */
      }
      try {
        p.destroy();
      } catch {
        /* abaikan */
      }
      ytPlayer.current = null;
    }
    hostRef.current?.replaceChildren();
    currentSourceId.current = null;
    setMode('empty');
    setHint(null);
  }, []);

  const startPlayback = React.useCallback(
    (track: Track) => {
      currentSourceId.current = track.id;
      jedaManual.current = false;
      setHint(null);
      resetBeat();

      const audio = audioRef.current;
      const p = ytPlayer.current;
      if (p) {
        try {
          p.stopVideo();
        } catch {
          /* abaikan */
        }
      }
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }

      if (track.audio) {
        setMode('audio');
        void ensureGraph(); // analisis mp3 lokal (suara lewat graph setelah running)
        if (!audio) return;
        audio.src = `/audio/${encodeURIComponent(track.audio)}`;
        void audio.play().catch(() => {
          setNote('Browser memblokir autoplay — tekan tombol play di pemutar.');
        });
        return;
      }

      setMode('yt');
      if (!track.yt) {
        setHint([
          'Belum ada sumber audio.',
          'Pakai "Cari otomatis" atau tempel link YouTube di kotak Sumber.',
        ]);
        return;
      }

      loadYTApi()
        .then((YT) => {
          if (currentSourceId.current !== track.id || !YT) return;
          if (!ytPlayer.current) {
            const host = ensureHost();
            if (!host) return;
            ytPlayer.current = new YT.Player(host, {
              videoId: track.yt,
              playerVars: {
                autoplay: 1,
                rel: 0,
                playsinline: 1,
                modestbranding: 1,
                iv_load_policy: 3,
                showinfo: 0,
                disablekb: 1,
              },
              events: {
                onReady: () => mainkanVideo(),
                onStateChange: (event) => {
                  if (event.data === 0 /* ENDED */ && currentSourceId.current) {
                    void advanceRef.current();
                  }
                },
                onError: () => {
                  if (!currentSourceId.current) return;
                  toastRef.current(
                    'Video tidak bisa diputar — dilompati ke lagu berikutnya.',
                    'error',
                  );
                  void advanceRef.current();
                },
              },
            });
          } else {
            ytPlayer.current.loadVideoById(track.yt);
            mainkanVideo();
          }
        })
        .catch((err: unknown) => {
          setHint([errMessage(err)]);
        });
    },
    [ensureGraph, ensureHost, mainkanVideo, resetBeat, setNote],
  );

  /* ------------------------------------------------------------- advance */

  const advance = React.useCallback(async () => {
    if (advancing.current) return;
    if (adzanRef.current) {
      toastRef.current('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
      return;
    }
    if (!tokenRef.current) return;
    advancing.current = true;
    try {
      const result = await djAdvance(tokenRef.current);
      if (!result.playing) {
        stopPlayback();
        setNote('Antrean selesai. Tidak ada lagu berikutnya.');
      } else if (result.playing.id !== currentSourceId.current && kitaPegang(stateRef.current)) {
        // langsung dari hasil server — jangan tunggu push SSE (bisa tertunda
        // saat tab tidak terlihat)
        startPlayback(result.playing);
      }
    } catch (err) {
      handleErr(err);
    } finally {
      advancing.current = false;
    }
  }, [handleErr, kitaPegang, setNote, startPlayback, stopPlayback]);

  const advanceRef = React.useRef(advance);
  React.useEffect(() => {
    advanceRef.current = advance;
  });

  /* --------------------------------------------- sinkron state → pemutar */

  React.useEffect(() => {
    if (!state) return;
    const playing = state.tracks.find((t) => t.status === 'playing') || null;

    if (playerManaged(state)) {
      // device lain pegang kendali: berhenti walau lagunya sama (cuma 1 suara)
      if (currentSourceId.current) stopPlayback();
      setNote('Diputar di device lain — tekan "Ambil kendali" untuk memutar di sini.');
    } else if (playing && playing.id !== currentSourceId.current) {
      if (kitaPegang(state)) {
        setNote('');
        startPlayback(playing);
      } else {
        // belum ada device pemutar utama → jangan bunyikan di sini dulu
        stopPlayback();
        setNote('Tekan "Jadikan ini pemutar utama" untuk memusatkan pemutaran di device ini.');
      }
    } else if (!playing && currentSourceId.current) {
      stopPlayback();
    }

    // auto-play berikutnya (sekali per perubahan, dengan jeda 3 detik)
    if (
      token &&
      !advancing.current &&
      !adzanRef.current &&
      Date.now() - autoPlayTerakhir.current >= 3000 &&
      !playing &&
      state.autoNext &&
      kitaPegang(state)
    ) {
      const antri = urutAntrean(state, state.tracks.filter((t) => t.status === 'queued'));
      if (antri.length) {
        autoPlayTerakhir.current = Date.now();
        void advanceRef.current();
      }
    }
  }, [state, kitaPegang, playerManaged, setNote, startPlayback, stopPlayback, token]);

  /* -------------------------------------------------- detak status + heal */

  const detakPemutar = React.useCallback(async () => {
    const st = stateRef.current;
    const tok = tokenRef.current;
    if (!tok || !st) return;
    if (!(st.player && st.player.panel === panelId)) return; // hanya pemegang yang melapor
    const playing = st.tracks.find((t) => t.status === 'playing') || null;
    const audio = audioRef.current;
    const p = ytPlayer.current;
    let status = playing ? 'memutar' : st.autoNext ? 'siap' : 'jeda';
    let detail = playing ? playing.title : '';
    if (playing && playing.audio && audio?.paused) status = 'jeda';
    else if (playing && !playing.audio && p && typeof p.getPlayerState === 'function') {
      if (p.getPlayerState() === 2 /* PAUSED */) status = 'jeda';
    }

    // AUTO-HEAL: seharusnya memutar tapi terjeda (autoplay policy saat tab
    // tersembunyi, atau video selesai dimuat tapi tidak mulai). Coba lagi —
    // asal bukan jeda manual (Spasi) dan bukan jeda adzan.
    if (playing && !adzanRef.current && !jedaManual.current) {
      if (playing.audio && audio?.paused) {
        void audio.play().catch(() => {
          /* dicoba lagi di detak berikut */
        });
      } else if (
        !playing.audio &&
        p &&
        typeof p.getPlayerState === 'function' &&
        p.getPlayerState() === 2 /* PAUSED */
      ) {
        mainkanVideo();
      }
    }

    try {
      await playerStatus(tok, {
        status,
        detail,
        trackId: playing ? playing.id : '',
        panel: panelId,
      });
    } catch {
      /* server sibuk — coba detak berikutnya */
    }
  }, [mainkanVideo, panelId]);

  React.useEffect(() => {
    if (!token || !state) return;
    const timer = window.setInterval(() => void detakPemutar(), 5000);
    return () => window.clearInterval(timer);
  }, [token, state, detakPemutar]);

  /* -------------------------------------------------------------- klaim */

  const claim = React.useCallback(
    async (paksa = false): Promise<boolean> => {
      if (!tokenRef.current) return false;
      void ensureGraph(); // gesture klik = momentum resume AudioContext
      try {
        const res = await playerClaim(tokenRef.current, panelId, paksa);
        onClaimed(res.player ?? null);
        // stateRef ikut diperbarui sekarang juga supaya detak berikut
        // (langsung di bawah) tahu panel ini yang memegang
        if (stateRef.current && res.player) {
          stateRef.current = { ...stateRef.current, player: res.player };
        }
        void detakPemutar();
        return true;
      } catch {
        return false; // 409 = panel lain yang memegang
      }
    },
    [detakPemutar, ensureGraph, onClaimed, panelId],
  );

  /* ------------------------------------------------------ play / pause */

  const togglePlayPause = React.useCallback(() => {
    void ensureGraph(); // gesture Spasi/klik → resume konteks
    const audio = audioRef.current;
    if (audio && audio.src) {
      if (audio.paused) {
        jedaManual.current = false;
        void audio.play().catch(() => {
          /* abaikan */
        });
      } else {
        jedaManual.current = true;
        audio.pause();
      }
      return;
    }
    const p = ytPlayer.current;
    if (!p || typeof p.getPlayerState !== 'function') {
      toastRef.current('Belum ada lagu yang dimuat. Tekan "Putar berikutnya" dulu.', 'error');
      return;
    }
    if (p.getPlayerState() === 1 /* PLAYING */) {
      jedaManual.current = true;
      p.pauseVideo();
    } else {
      jedaManual.current = false;
      mainkanVideo();
    }
  }, [ensureGraph, mainkanVideo]);

  /* --------------------------------------------------- sumber audio yt */

  const resolveAndAssign = React.useCallback(
    async (track: Track, query: string) => {
      if (!tokenRef.current) return;
      toastRef.current('Mencari di YouTube…');
      try {
        const found = await ytSearch(tokenRef.current, query);
        const result = await djTrackAction(tokenRef.current, track.id, 'link', { yt: found.id });
        toastRef.current(`Sumber disetel: ${found.title || query}`);
        if (currentSourceId.current === track.id) {
          startPlayback({ ...result.track, audio: '' });
        }
      } catch (err) {
        handleErr(err);
      }
    },
    [handleErr, startPlayback],
  );

  /* ------------------------------------------------------------- adzan */

  const pauseForAdzan = React.useCallback((): boolean => {
    const audio = audioRef.current;
    const p = ytPlayer.current;
    diputarSebelumAdzan.current = false;
    if (p && typeof p.getPlayerState === 'function') {
      try {
        if (p.getPlayerState() === 1 /* PLAYING */) diputarSebelumAdzan.current = true;
      } catch {
        /* abaikan */
      }
    }
    if (audio && audio.src && !audio.paused) diputarSebelumAdzan.current = true;
    if (p && typeof p.pauseVideo === 'function') {
      try {
        p.pauseVideo();
      } catch {
        /* abaikan */
      }
    }
    if (audio && !audio.paused) audio.pause();
    return diputarSebelumAdzan.current;
  }, []);

  const resumeFromAdzan = React.useCallback(() => {
    if (!diputarSebelumAdzan.current) return;
    diputarSebelumAdzan.current = false;
    const p = ytPlayer.current;
    if (p && typeof p.playVideo === 'function') {
      try {
        p.playVideo();
      } catch {
        /* abaikan */
      }
    }
    const audio = audioRef.current;
    if (audio && audio.paused && audio.src) void audio.play().catch(() => {});
  }, []);

  /* ------------------------------------------------ audio ended → lanjut */

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (currentSourceId.current) void advanceRef.current();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  /* ------------------------------------------------------- spacebar */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      if (!kitaPegang(stateRef.current)) {
        toastRef.current(
          'Jadikan device ini pemutar utama dulu sebelum mengatur lagu.',
          'error',
        );
        return;
      }
      if (adzanRef.current) {
        toastRef.current('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
        return;
      }
      togglePlayPause();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlayPause]);

  /* ------------------------------------- tab terlihat: kejar yang tertunda */

  React.useEffect(() => {
    const onVis = () => {
      if (document.hidden) return;
      void detakPemutar();
      onVisible?.();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [detakPemutar, onVisible]);

  /* ------------------------------------- sampling audio (energi + BPM) */

  React.useEffect(() => {
    const SAMPLE = 60; // Hz — cukup halus untuk resolusi BPM
    const N = SAMPLE * 6; // jendela bergulir 6 detik
    rmsBuf.current = new Float32Array(N);
    rmsIdx.current = 0;
    const tick = window.setInterval(() => {
      const an = analyserRef.current;
      const ctx = audioCtx.current;
      if (!an || !ctx || ctx.state !== 'running') return;
      if (!tdBuf.current || tdBuf.current.length !== an.fftSize) {
        tdBuf.current = new Uint8Array(an.fftSize);
      }
      an.getByteTimeDomainData(tdBuf.current);
      const td = tdBuf.current;
      let sum = 0;
      for (let i = 0; i < td.length; i++) {
        const v = ((td[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / td.length);
      const buf = rmsBuf.current;
      if (!buf) return;
      buf[rmsIdx.current % N] = rms;
      rmsIdx.current += 1;
      // energy = loudness sesungguhnya (0 diam → 1 keras): attack cepat
      // supaya dentum terasa, release lambat supaya meredap mengikuti nada
      const target = Math.min(1, rms * 4);
      const k = target > energyRef.current ? 0.45 : 0.06;
      energyRef.current += (target - energyRef.current) * k;
    }, 1000 / SAMPLE);
    return () => window.clearInterval(tick);
  }, []);

  /* ------------------------------------------------- deteksi BPM (2 dtk) */

  React.useEffect(() => {
    const detect = window.setInterval(() => {
      const ctx = audioCtx.current;
      const buf = rmsBuf.current;
      if (!ctx || ctx.state !== 'running' || !buf) return;
      const audio = audioRef.current;
      const p = ytPlayer.current;
      const audioMain = Boolean(audio && audio.src && !audio.paused);
      const ytMain = Boolean(p && typeof p.getPlayerState === 'function' && p.getPlayerState() === 1);
      if (!audioMain && !ytMain) return;

      const N = buf.length;
      let peak = 0;
      for (let i = 0; i < N; i++) peak = Math.max(peak, buf[i] ?? 0);
      if (peak < 0.012) return; // hampir senyap

      // onset flux (kenaikan energi) → normalisasi mean
      const flux = new Float32Array(N);
      let mean = 0;
      for (let i = 1; i < N; i++) {
        const d = (buf[i] ?? 0) - (buf[i - 1] ?? 0);
        const f = d > 0 ? d : 0;
        flux[i] = f;
        mean += f;
      }
      mean /= N;
      let energy = 0;
      for (let i = 0; i < N; i++) {
        let f = (flux[i] ?? 0) - mean;
        if (f < 0) f = 0;
        flux[i] = f;
        energy += f * f;
      }
      if (energy < 1e-5) return;

      // autocorrelation pada lag 15..90 sampel @60 Hz = 240..40 BPM
      let bestLag = 0;
      let best = 0;
      for (let lag = 15; lag <= 90; lag++) {
        let acc = 0;
        for (let i = 0; i + lag < N; i++) acc += (flux[i] ?? 0) * (flux[i + lag] ?? 0);
        if (acc > best) {
          best = acc;
          bestLag = lag;
        }
      }
      if (!bestLag || best / energy < 0.16) return; // belum cukup yakin

      const bpm = 3600 / bestLag;
      if (bpm < 40 || bpm > 240) return;
      const cur = bpmRef.current;
      if (cur) {
        if (Math.abs(bpm - cur) <= 2) return; // stabil di sekitar nilai lama
        // tolak lompatan oktaf bolak-balik (bpm ↔ 2×bpm)
        if (Math.abs(bpm - cur * 2) <= 4 || Math.abs(bpm * 2 - cur) <= 4) return;
      }
      setBpm(Math.round(bpm));
    }, 2000);
    return () => window.clearInterval(detect);
  }, [setBpm]);

  /* ------------------------------- broadcast beat-grid ke server (250 ms) */

  React.useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => {
      const st = stateRef.current;
      const tok = tokenRef.current;
      if (!tok || !st) return;
      const playingTrack = st.tracks.find((t) => t.status === 'playing') || null;
      const milik = Boolean(st.player && st.player.panel === panelId);
      const audio = audioRef.current;
      let playing = false;
      let pos = 0;
      let dur = 0;
      if (playingTrack) {
        if (playingTrack.audio && audio && audio.src && !audio.paused && audio.readyState >= 2) {
          playing = true;
          pos = audio.currentTime;
          dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        } else if (!playingTrack.audio && ytPlayer.current) {
          try {
            const p = ytPlayer.current;
            playing = typeof p.getPlayerState === 'function' && p.getPlayerState() === 1;
            pos = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() || 0 : 0;
            dur = typeof p.getDuration === 'function' ? p.getDuration() || 0 : 0;
          } catch {
            /* player belum siap */
          }
        }
      }

      const prev = lastBeat.current;
      if (!milik || !playingTrack || !playing) {
        if (prev.kirim) {
          // transisi berhenti → kabarkan sekali lalu diam
          lastBeat.current = { kirim: false, beatIdx: -1, t: 0 };
          void djBeat(tok, {
            pos: 0,
            dur: 0,
            bpm: bpmRef.current,
            energy: 0,
            beatIdx: null,
            playing: false,
            trackId: playingTrack ? playingTrack.id : null,
          }).catch(() => {});
        }
        return;
      }

      // kirim tiap tick (250 ms): energy segar mengikuti dinamika nada,
      // beatIdx jadi pemicu denyut di klien (tempo tetap akurat).
      // Universal: tanpa analisis audio (YouTube iframe tanpa capture, capture
      // dibatalkan, dsb.) beat TETAP berjalan — tempo default 120 BPM + envelope
      // per beat. Saat analisis nyata aktif (capture tab / mp3 lokal) memakai
      // BPM terdeteksi + loudness asli dari audio.
      const bpmKirim = bpmRef.current ?? 120;
      const beatLen = 60 / bpmKirim;
      const beatIdx = Math.floor(pos / beatLen);
      const audioLokalMain = Boolean(
        audio && audio.src && !audio.paused && audio.readyState >= 2,
      );
      const analisisNyata =
        (Boolean(capStream.current) || audioLokalMain) &&
        audioCtx.current?.state === 'running';
      let energy: number;
      if (analisisNyata) {
        energy = energyRef.current;
      } else {
        // envelope per beat: puncak tepat di beat, meredap menjelang berikutnya
        const phase = (pos % beatLen) / beatLen;
        energy = 0.28 + 0.5 * Math.pow(1 - phase, 2);
      }
      lastBeat.current = { kirim: true, beatIdx, t: Date.now() };
      void djBeat(tok, {
        pos,
        dur,
        bpm: bpmKirim,
        energy,
        beatIdx,
        playing: true,
        trackId: playingTrack.id,
      }).catch(() => {});
    }, 250);
    return () => window.clearInterval(id);
  }, [token, panelId]);

  React.useEffect(() => () => stopCapture(), [stopCapture]);

  return {
    panelId,
    audioRef,
    hostRef,
    ui,
    playerManaged,
    kitaPegang,
    claim,
    advance: () => advanceRef.current(),
    togglePlayPause,
    stopPlayback,
    setNote,
    setAdzanAktif: (v: boolean) => {
      adzanRef.current = v;
    },
    isCurrent: (trackId: string) => currentSourceId.current === trackId,
    startPlayback,
    resolveAndAssign,
    pauseForAdzan,
    resumeFromAdzan,
    detakPemutar,
    analyser: () => analyserRef.current,
    toggleCapture,
    stopCapture,
  };
}
