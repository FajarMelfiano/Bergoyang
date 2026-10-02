import * as React from 'react';
import { Album, Heart, ListMusic, MonitorPlay, MoonStar, Play, Share2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError, SessionExpiredError, voteTrack } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/ui/toast';
import type { AppState, BeatInfo } from '@/lib/types';
import { CircleVisualizer } from '@/components/circle-visualizer';

interface HeroProps {
  state: AppState;
  adzan: string | null;
  beat?: BeatInfo | null;
}

/** beat dianggap basi kalau tak ada paket baru dari panel DJ */
const BEAT_STALE_MS = 6000;

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Hero({ state, adzan, beat = null }: HeroProps) {
  const { event } = state;
  const session = useSession();
  const { toast } = useToast();
  const playing = state.tracks.find((t) => t.status === 'playing') || null;

  const [busy, setBusy] = React.useState(false);

  // detak per detik supaya durasi tetap hidup walau paket beat cuma 1 Hz
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const beatSegar = beat && Date.now() - (beat.receivedAt ?? 0) < BEAT_STALE_MS ? beat : null;
  const live = Boolean(beatSegar?.playing && playing);
  const dur = live && beatSegar ? beatSegar.dur : 0;

  const coverUrl = playing?.yt ? `https://i.ytimg.com/vi/${playing.yt}/hqdefault.jpg` : null;
  const ytUrl = playing?.yt ? `https://www.youtube.com/watch?v=${playing.yt}` : '';

  const title = playing ? playing.title : event.name;
  const sumber = playing ? (playing.audio ? 'MP3 Lokal' : playing.yt ? 'YouTube' : '') : '';
  const voted = playing ? Boolean(playing.votes?.[session.user?.username ?? '']) : false;
  const jumlahVote = playing ? Object.keys(playing.votes || {}).length : 0;

  const suka = async () => {
    if (!playing || busy) return;
    setBusy(true);
    try {
      const result = await voteTrack(session.token, playing.id);
      if (result.voted) toast(`Vote untuk “${playing.title}” dikirim.`);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        session.expire();
        return;
      }
      toast(err instanceof ApiError ? err.message : 'Gagal vote.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const bagikan = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Tautan halaman disalin.');
    } catch {
      toast('Gagal menyalin tautan.', 'error');
    }
  };

  const durasiTampil = live && dur > 0;

  return (
    <section className="w-full bg-gradient-to-b from-[#25382b] via-[#1c1b1b] to-[#131313] px-4 pb-6 pt-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6">
        {/* sub-bar: konteks venue + status */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-4/60 px-4 py-1.5 backdrop-blur-md">
            <Album className="size-4 fill-primary text-primary" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface">
              Live Music Queue • {event.name}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {adzan && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-warning">
                <MoonStar className="size-3.5" aria-hidden />
                Adzan {adzan}
              </span>
            )}
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-4 py-1.5">
              <span className="live-dot size-2 rounded-full bg-primary" aria-hidden />
              <span className="text-[11px] font-bold uppercase tracking-wide text-primary">
                {event.open ? 'Request Dibuka' : 'Request Ditutup'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-4 px-4 py-1.5">
              <User className="size-4 text-on-surface-variant" aria-hidden />
              <span className="text-xs font-semibold text-on-surface">
                Tamu {session.user?.username ? `@${session.user.username}` : ''}
              </span>
            </span>
          </div>
        </div>

        {/* hero album-style ala Spotify */}
        <div className="flex flex-col items-center gap-7 pt-2 sm:flex-row sm:items-end sm:gap-10">
          {/* frame sampul */}
          <div className="relative size-56 shrink-0 overflow-hidden rounded-xl bg-[#0e0e0e] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.85),0_6px_16px_rgba(0,0,0,0.6)] md:size-[232px]">
            <CircleVisualizer
              coverUrl={coverUrl}
              playing={Boolean(playing)}
              beat={beatSegar}
              label={playing ? 'LIVE' : ''}
              className="w-full"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60"
            />
          </div>

          {/* metadata */}
          <div className="flex min-w-0 flex-1 flex-col justify-end self-stretch sm:self-end">
            <div className="mb-1 flex flex-wrap items-center gap-x-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                {playing ? 'Sedang Diputar' : 'Belum Ada Lagu Diputar'}
              </span>
              <span className="text-xs text-on-surface-variant">•</span>
              <span className="text-[11px] text-on-surface-variant">{event.name}</span>
            </div>

            <h1 className="mb-3 text-[36px] font-bold leading-tight tracking-tight text-on-surface md:text-5xl">
              {title}
            </h1>

            <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-on-surface-variant">
              {playing?.artist && (
                <span className="font-bold text-on-surface">{playing.artist}</span>
              )}
              {playing?.artist && <span>•</span>}
              {playing?.requester && (
                <span className="text-on-surface">
                  Diminta oleh <strong className="font-semibold text-primary">{playing.requester}</strong>
                </span>
              )}
              {playing?.requester && sumber && <span>•</span>}
              {sumber && (
                <span className="rounded bg-surface-4 px-2 py-0.5 text-[11px] font-semibold text-on-surface">
                  {sumber}
                </span>
              )}
              {sumber && durasiTampil && <span>•</span>}
              {durasiTampil && <span className="text-xs">{mmss(dur)}</span>}
            </div>

            <p className="mb-6 line-clamp-1 max-w-2xl text-xs text-on-surface-variant">
              {event.tagline}
            </p>

            {/* kontrol aksi */}
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                aria-label={ytUrl ? 'Putar lagu ini di YouTube' : 'Belum ada sumber YouTube'}
                disabled={!ytUrl}
                onClick={() => window.open(ytUrl, '_blank', 'noopener,noreferrer')}
                className="flex size-14 items-center justify-center rounded-full bg-primary text-black shadow-[0_8px_20px_rgba(30,215,96,0.35)] transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                <Play className="size-7 fill-current" aria-hidden />
              </button>

              <a
                href={ytUrl || undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!ytUrl}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-4 px-6 text-sm font-bold text-on-surface transition-colors hover:bg-surface-3 aria-disabled:pointer-events-none aria-disabled:opacity-40"
              >
                <MonitorPlay className="size-5 fill-[#ff4b4b] text-[#ff4b4b]" aria-hidden />
                Buka di YouTube
              </a>

              <button
                type="button"
                title={event.allowVotes ? 'Sukai lagu ini' : 'Vote tidak diaktifkan untuk acara ini'}
                aria-label={`Sukai lagu ini (${jumlahVote} vote)`}
                aria-pressed={voted}
                disabled={!playing || busy || !event.allowVotes}
                onClick={() => void suka()}
                className="flex size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-4 hover:text-on-surface disabled:pointer-events-none disabled:opacity-40"
              >
                <Heart
                  className={cn('size-5', voted && 'fill-primary text-primary')}
                  aria-hidden
                />
              </button>

              <button
                type="button"
                title="Bagikan"
                aria-label="Bagikan halaman ini"
                onClick={() => void bagikan()}
                className="flex size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-4 hover:text-on-surface"
              >
                <Share2 className="size-5" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* info antrean kecil — pengganti chip lama */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
          <ListMusic className="size-4 text-primary" aria-hidden />
          <span>
            {state.tracks.filter((t) => t.status === 'queued').length} antrean •{' '}
            {state.tracks.filter((t) => t.status === 'pending').length} menunggu DJ •{' '}
            {state.tracks.filter((t) => t.status === 'done').length} sudah diputar
          </span>
        </div>
      </div>
    </section>
  );
}
