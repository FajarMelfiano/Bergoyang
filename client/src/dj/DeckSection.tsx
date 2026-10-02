import { Activity, ScreenShare, ScreenShareOff, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { djSetAuto, djTrackAction, SessionExpiredError, ApiError } from '@/lib/api';
import type { AppState, Track } from '@/lib/types';
import { urutAntrean } from '@/lib/queue';
import type { PlayerEngine } from '@/dj/usePlayerEngine';
import { CircleVisualizer } from '@/components/circle-visualizer';

interface DeckSectionProps {
  state: AppState;
  token: string;
  engine: PlayerEngine;
  toast: (message: string, tone?: 'ok' | 'error') => void;
}

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Terjadi kesalahan.';
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function DeckSection({ state, token, engine, toast }: DeckSectionProps) {
  const { ui } = engine;
  const playing = state.tracks.find((t) => t.status === 'playing') || null;
  const berikutnya =
    urutAntrean(state, state.tracks.filter((t) => t.status === 'queued'))[0] || null;
  const jmlVote = (t: Track) => Object.keys(t.votes || {}).length;

  const milikKita = engine.kitaPegang(state);
  const p = state.player;
  const segar = Boolean(p && p.updatedAt && Date.now() - p.updatedAt < 12000);

  const tones: Record<string, string> = { memutar: 'play', siap: 'ok', jeda: 'pause', error: 'error' };
  const playerTone = p && segar ? tones[p.status || ''] || 'ok' : p ? 'stale' : 'off';
  const playerTeks = p
    ? `${segar ? p.status || 'siap' : 'terputus'}${p.detail ? ` — ${p.detail}` : ''}`
    : 'nonaktif';
  const kendaliTeks = milikKita
    ? 'device ini'
    : segar && p?.panel
      ? 'device lain'
      : 'belum diatur';
  const kendaliTone = milikKita ? 'play' : segar && p?.panel ? 'pause' : 'off';

  const klaim = async (paksa: boolean) => {
    const ok = await engine.claim(paksa);
    if (ok && !paksa) {
      toast('Device ini sekarang pemutar utama. Lagu dipusatkan di sini.');
    } else if (ok && paksa) {
      toast('Kendali pemutar diambil device ini.');
    } else {
      toast('Device lain sedang memutar. Tekan "Ambil kendali" untuk memaksa.', 'error');
    }
  };

  const hentikan = async () => {
    try {
      await djSetAuto(token, false); // matikan auto-play
    } catch (err) {
      toast(errText(err), 'error');
      return;
    }
    if (!playing) {
      engine.stopPlayback();
      engine.setNote('Auto-play dijeda. Tekan "Putar berikutnya" untuk lanjut.');
      return;
    }
    try {
      await djTrackAction(token, playing.id, 'done');
      engine.stopPlayback();
      engine.setNote('Dihentikan. Tekan "Putar berikutnya" untuk lanjut.');
    } catch (err) {
      if (err instanceof SessionExpiredError) toast(err.message, 'error');
      else toast(errText(err), 'error');
    }
  };

  return (
    <section
      aria-labelledby="nowLabel"
      className="overflow-hidden rounded-xl bg-surface-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      {/* strip on-air */}
      <div className="flex items-center justify-between border-b border-white/8 bg-surface-3/70 px-4 py-2.5">
        <span id="nowLabel" className="text-[0.7rem] font-extrabold uppercase tracking-widest text-muted-foreground">
          Konsol pemutar
        </span>
        <span className="inline-flex items-center gap-2 text-xs font-bold">
          <span
            className={cn(
              'size-2 rounded-full',
              playing ? 'live-dot bg-destructive' : 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
          <span className={playing ? 'text-destructive' : 'text-muted-foreground'}>
            {playing ? 'Mengudara' : 'Siaga'}
          </span>
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        {/* layar player (disembunyikan saat kosong — teks empty ada di visualizer) */}
        <div
          data-on={ui.mode !== 'empty'}
          className="relative overflow-hidden rounded-lg bg-black data-[on=false]:hidden"
        >
          <div
            data-on={ui.mode === 'yt'}
            className="aspect-video w-full data-[on=false]:hidden [&_iframe]:h-full [&_iframe]:w-full"
          >
            <div ref={engine.hostRef} className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full" />
            {ui.hint && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/85 px-6 text-center">
                {ui.hint.map((line) => (
                  <p key={line} className="text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div
            data-on={ui.mode === 'empty'}
            className="flex aspect-video w-full flex-col items-center justify-center gap-1 data-[on=false]:hidden"
          >
            <strong className="text-sm">
              {playing && !milikKita ? 'Diputar di device lain' : 'Belum ada lagu diputar'}
            </strong>
            <span className="text-xs text-muted-foreground">
              {playing && !milikKita
                ? 'Tekan "Ambil kendali" untuk memutar di sini.'
                : 'Tekan “Putar berikutnya” untuk mulai.'}
            </span>
          </div>

          <audio
            ref={engine.audioRef}
            controls
            preload="none"
            hidden={ui.mode !== 'audio'}
            className="m-3 w-[calc(100%-1.5rem)]"
          />
        </div>

        {/* artwork / visualizer ala referensi: penuh, di atas judul */}
        <div className="relative overflow-hidden rounded-xl bg-surface-3/50">
          <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-1/80 via-transparent to-black/35"
            aria-hidden
          />
          <CircleVisualizer
            analyser={ui.analyserReady ? engine.analyser() : null}
            beat={state.beat}
            coverUrl={playing?.yt ? `https://i.ytimg.com/vi/${playing.yt}/hqdefault.jpg` : null}
            playing={Boolean(playing)}
            label={ui.bpm ? String(ui.bpm) : playing ? 'LIVE' : ''}
            className="relative mx-auto w-56 py-6 sm:w-64"
          />

          {ui.mode === 'empty' && playing && !milikKita && (
            <div className="absolute inset-x-0 bottom-12 z-20 flex flex-col items-center gap-0.5 px-6 text-center">
              <strong className="text-sm text-on-surface">Diputar di device lain</strong>
              <span className="text-xs text-on-surface-variant">
                Tekan “Ambil kendali” untuk memutar di sini.
              </span>
            </div>
          )}

          {/* badge ala referensi */}
          <span className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full bg-[#0e0e0e]/90 px-3 py-1 shadow-md backdrop-blur-md">
            <span aria-hidden className="live-dot size-2 rounded-full bg-primary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Visualizer Live
            </span>
          </span>
          <span className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-[#0e0e0e]/90 px-3 py-1 shadow-md backdrop-blur-md">
            <Activity className="size-3.5 text-primary" aria-hidden />
            <span className="text-[11px] font-bold text-on-surface">Realtime Beat</span>
          </span>
          <span className="absolute bottom-3 left-3 z-20 rounded-full bg-[#0e0e0e]/90 px-3 py-1 font-mono text-[11px] font-bold shadow-md backdrop-blur-md">
            <span className="text-primary">BPM</span>{' '}
            <span className="text-on-surface">{ui.bpm ?? (playing ? 120 : '—')}</span>
          </span>
          <span className="absolute bottom-3 right-3 z-20 rounded-full bg-primary px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider text-black shadow-md">
            AVEE • CH-01
          </span>
        </div>

        {/* readout */}
        <div className="grid min-w-0 gap-0.5 px-1">
          {playing ? (
            <>
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                {playing.title}
              </h1>
              {playing.artist && (
                <p className="truncate text-sm text-muted-foreground">{playing.artist}</p>
              )}
              <p className="text-sm text-muted-foreground">
                diminta oleh {playing.requester || 'Tamu'}
              </p>
            </>
          ) : (
            <>
              <strong className="text-base font-bold text-on-surface">
                Belum ada lagu diputar
              </strong>
              <p className="text-sm text-muted-foreground">
                Tekan “Putar berikutnya” untuk mulai.
              </p>
            </>
          )}
          {berikutnya && (
            <p className="mt-1 truncate text-xs font-semibold text-primary">
              Berikutnya: {berikutnya.title}
              {berikutnya.artist ? ` — ${berikutnya.artist}` : ''}
              {jmlVote(berikutnya) ? ` (${jmlVote(berikutnya)} vote)` : ''}
            </p>
          )}
        </div>

        {/* scrubber ala referensi */}
        <div className="flex flex-col gap-1.5 px-1 pt-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-4">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-linear"
              style={{
                width: `${
                  state.beat?.dur
                    ? Math.min(100, (state.beat.pos / state.beat.dur) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[11px] tabular-nums">
            <span className="text-primary">{mmss(state.beat?.pos ?? 0)}</span>
            <span className="text-muted-foreground">{mmss(state.beat?.dur ?? 0)}</span>
          </div>
        </div>

        {/* chips */}
        <div className="flex flex-wrap gap-2">
          <span
            data-tone={playerTone}
            title="Mesin pemutar di panel DJ ini"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
              'data-[tone=ok]:bg-primary/12 data-[tone=ok]:text-primary',
              'data-[tone=play]:bg-primary/12 data-[tone=play]:text-primary',
              'data-[tone=pause]:bg-warning/15 data-[tone=pause]:text-warning',
              'data-[tone=error]:bg-destructive/12 data-[tone=error]:text-destructive',
              'data-[tone=stale]:bg-warning/15 data-[tone=stale]:text-warning',
              'data-[tone=off]:bg-surface-3 text-muted-foreground',
            )}
          >
            Player: {playerTeks}
          </span>
          <span
            data-tone={kendaliTone}
            title="Device mana yang memutar lagu untuk semua tamu"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
              'data-[tone=ok]:bg-primary/12 data-[tone=ok]:text-primary',
              'data-[tone=play]:bg-primary/12 data-[tone=play]:text-primary',
              'data-[tone=pause]:bg-warning/15 data-[tone=pause]:text-warning',
              'data-[tone=off]:bg-surface-3 text-muted-foreground',
            )}
          >
            Pemutar: {kendaliTeks}
          </span>
          <button
            type="button"
            onClick={() => void engine.toggleCapture()}
            title="Analisis audio tab YouTube untuk visualizer (bagikan tab + centang audio)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors',
              ui.capture
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'bg-surface-3 text-muted-foreground hover:bg-surface-4',
            )}
          >
            {ui.capture ? (
              <ScreenShareOff className="size-3.5" aria-hidden />
            ) : (
              <ScreenShare className="size-3.5" aria-hidden />
            )}
            {ui.capture ? 'Analisis tab: aktif' : 'Analisis tab YouTube'}
          </button>
        </div>

        {/* klaim */}
        <div className="flex flex-wrap items-center gap-2">
          {!(milikKita || (segar && Boolean(p?.panel))) && (
            <Button type="button" onClick={() => void klaim(false)} className="rounded-full">
              Jadikan ini pemutar utama
            </Button>
          )}
          {segar && Boolean(p?.panel) && !milikKita && (
            <Button type="button" variant="secondary" size="sm" onClick={() => void klaim(true)}>
              Ambil kendali
            </Button>
          )}
        </div>

        {/* transport */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void engine.advance()} className="gap-2">
            Putar berikutnya
          </Button>
          <Button type="button" variant="destructive" onClick={() => void hentikan()}>
            Hentikan
          </Button>
        </div>

        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {ui.note}
        </p>

        {/* sumber audio lagu yang sedang diputar */}
        {playing && (
          <div className="rounded-lg bg-surface-3/70 p-3">
            <p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
              Sumber audio lagu ini
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {playing.audio
                ? `File lokal: ${playing.audio}`
                : playing.yt
                  ? `YouTube: ${playing.yt}`
                  : 'Belum ada sumber'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  void engine.resolveAndAssign(
                    playing,
                    `${playing.title} ${playing.artist || ''}`.trim(),
                  )
                }
              >
                <Search className="size-3.5" aria-hidden />
                Cari otomatis di YouTube
              </Button>
              <Input
                type="url"
                placeholder="tempel link YouTube"
                aria-label="Link YouTube"
                className="h-9 min-w-[180px] flex-1"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) return;
                  void (async () => {
                    try {
                      await djTrackAction(token, playing.id, 'link', { yt: v });
                      toast('Link YouTube disimpan.');
                      if (engine.isCurrent(playing.id)) {
                        engine.startPlayback({ ...playing, yt: v, audio: '' });
                      }
                    } catch (err) {
                      toast(errText(err), 'error');
                    }
                  })();
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
