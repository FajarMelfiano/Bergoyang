import * as React from 'react';
import { ExternalLink, Loader2, LogOut, User, Wifi } from 'lucide-react';
import { DjLoginGate } from '@/dj/DjLoginGate';
import { DjTopBar } from '@/dj/DjTopBar';
import { DeckSection } from '@/dj/DeckSection';
import { QueueSection } from '@/dj/QueueSection';
import { SettingsBox } from '@/dj/SettingsBox';
import { PanitiaBox } from '@/dj/PanitiaBox';
import { useAdzanDj } from '@/dj/useAdzanDj';
import { usePlayerEngine } from '@/dj/usePlayerEngine';
import { playerRelease } from '@/lib/api';
import type { AppState, PlayerInfo } from '@/lib/types';
import { useSession } from '@/lib/session';
import { useLiveState } from '@/lib/useLiveState';
import { useToast } from '@/components/ui/toast';

export function DjApp() {
  const session = useSession();
  const { state: rawState, conn, refresh } = useLiveState();
  const { toast } = useToast();
  const [localPlayer, setLocalPlayer] = React.useState<PlayerInfo | null>(null);

  // klaim lokal menang bila lebih baru dari push SSE (jembatan latensi)
  const state = React.useMemo(() => {
    if (!rawState) return null;
    if (!localPlayer) return rawState;
    const a = localPlayer.updatedAt ?? 0;
    const b = rawState.player?.updatedAt ?? 0;
    return a >= b ? { ...rawState, player: localPlayer } : rawState;
  }, [rawState, localPlayer]);

  // detak chip freshness (player/kendali bisa basi tanpa update state)
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const adzanCekRef = React.useRef<() => void>(() => {});
  const handleVisible = React.useCallback(() => {
    void refresh();
    adzanCekRef.current();
  }, [refresh]);

  const engine = usePlayerEngine({
    state,
    token: session.token,
    toast,
    onClaimed: setLocalPlayer,
    onExpired: () => session.expire(),
    onVisible: handleVisible,
  });

  const adzan = useAdzanDj(
    session.token,
    {
      pauseForAdzan: engine.pauseForAdzan,
      resumeFromAdzan: engine.resumeFromAdzan,
    },
    toast,
  );

  React.useEffect(() => {
    engine.setAdzanAktif(adzan.aktif !== null);
  }, [engine, adzan.aktif]);
  React.useEffect(() => {
    adzanCekRef.current = adzan.cek;
  });

  const handleLogout = () => {
    const tok = session.token;
    engine.stopPlayback();
    if (tok) void playerRelease(tok, engine.panelId).catch(() => {});
    setLocalPlayer(null);
    session.logout();
  };

  React.useEffect(() => {
    if (state) document.title = `Panel DJ — ${state.event.name}`;
  }, [state]);

  const authed = session.status === 'authed';
  const open = state?.event.open ?? true;
  const nama = session.user?.nama || session.user?.username || '';

  if (session.status === 'checking') {
    return (
      <div className="flex min-h-dvh flex-col">
        <DjTopBar open={open} conn={conn} onLogout={handleLogout} />
        <Loading label="Memeriksa sesi…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DjTopBar open={open} conn={conn} onLogout={handleLogout} />

      {!authed ? (
        <DjLoginGate />
      ) : state ? (
        <div className="relative flex w-full flex-1 flex-col">
          {/* sub-header bar ala referensi console */}
          <div className="sticky top-16 z-40 flex w-full flex-wrap items-center justify-between gap-3 bg-[#0e0e0e] px-4 py-3 shadow-md sm:px-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-3 px-4 py-1.5">
                <span aria-hidden className="live-dot size-2.5 rounded-full bg-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-primary">
                  Live DJ Deck
                </span>
              </span>
              <span
                data-ok={conn === 'tersambung'}
                className="hidden items-center gap-2 rounded-full bg-surface-2 px-4 py-1.5 text-xs font-semibold text-on-surface-variant data-[ok=true]:text-on-surface md:inline-flex"
              >
                <Wifi className="size-4 text-primary" aria-hidden />
                {conn === 'tersambung' ? 'Sesi Terhubung' : 'Menyambung ulang…'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-3 hover:text-on-surface"
              >
                Lihat halaman tamu
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
              <span aria-hidden className="h-4 w-px bg-surface-4" />
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-3 px-2 py-1">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-black">
                  {nama.slice(0, 1).toUpperCase() || <User className="size-4" aria-hidden />}
                </span>
                <span className="pr-1 text-xs font-semibold text-on-surface">{nama}</span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1.5 text-xs font-bold text-on-surface-variant transition-colors hover:bg-destructive/20 hover:text-destructive"
              >
                <LogOut className="size-3.5" aria-hidden />
                Keluar
              </button>
            </div>
          </div>

          <div className="relative w-full flex-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
          />
          {/* gradasi glow yang berdenyut mengikuti beat */}
          <BeatGlow beat={state?.beat ?? null} />
          <main className="relative flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:items-start lg:gap-8">
          {adzan.banner && (
            <div
              role="status"
              className="flex w-full basis-full shrink-0 items-center gap-3 rounded-xl bg-warning/12 px-4 py-3 text-sm font-semibold text-warning"
            >
              <span className="live-dot size-2 shrink-0 rounded-full bg-warning" aria-hidden />
              {adzan.banner}
            </div>
          )}

          <div className="scroll-thin flex w-full shrink-0 flex-col gap-4 [&>*]:shrink-0 lg:sticky lg:top-[120px] lg:max-h-[calc(100dvh-136px)] lg:w-[380px] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <DeckSection state={state} token={session.token} engine={engine} toast={toast} />
            <SettingsBox state={state} token={session.token} adzan={adzan} toast={toast} />
            <PanitiaBox token={session.token} toast={toast} />
          </div>

          <div className="min-w-0 flex-1">
            <QueueSection
              state={state}
              token={session.token}
              engine={engine}
              adzanAktif={adzan.aktif !== null}
              toast={toast}
            />
          </div>
          </main>
          </div>
        </div>
      ) : (
        <Loading label="Memuat antrean…" />
      )}
    </div>
  );
}

function BeatGlow({ beat }: { beat: AppState['beat'] }) {
  const on = Boolean(beat?.playing && beat.bpm && beat.bpm > 0);
  const dur = on && beat?.bpm ? 60 / beat.bpm : 0;
  const amp = Math.max(0, Math.min(1, beat?.energy ?? 0.4));

  if (!on) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/12 via-primary/5 to-transparent"
        style={{ opacity: 0.35 }}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/35 via-primary/14 to-transparent"
      style={
        {
          animation: `beat-glow ${dur.toFixed(3)}s cubic-bezier(.22,1,.36,1)`,
          '--amp': String(amp),
        } as React.CSSProperties
      }
    />
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}
