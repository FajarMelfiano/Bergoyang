import * as React from 'react';
import { ArrowUp, Check, ListMusic, MonitorPlay, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError, SessionExpiredError, voteTrack } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/ui/toast';
import { urutAntrean } from '@/lib/queue';
import type { AppState, Track } from '@/lib/types';

interface QueuePanelProps {
  state: AppState;
}

type SortMode = 'baru' | 'vote';

export function QueuePanel({ state }: QueuePanelProps) {
  const deviceId = useSession().user?.username ?? '';
  const [sort, setSort] = React.useState<SortMode>('baru');
  const [doneOpen, setDoneOpen] = React.useState(false);

  const byTime = (a: Track, b: Track) => a.createdAt - b.createdAt;
  const pending = state.tracks.filter((t) => t.status === 'pending').sort(byTime);
  const playing = state.tracks.find((t) => t.status === 'playing') || null;
  const queuedSrc = state.tracks.filter((t) => t.status === 'queued');
  const queued =
    sort === 'vote' ? urutAntrean(state, queuedSrc) : queuedSrc.slice().sort(byTime);
  const rejectedMine = state.tracks
    .filter((t) => t.status === 'rejected' && t.deviceId === deviceId)
    .sort(byTime);
  const done = state.tracks.filter((t) => t.status === 'done');

  const rowsTerkonfirmasi = [...(playing ? [playing] : []), ...queued, ...rejectedMine];
  const jumlahBaris = pending.length + rowsTerkonfirmasi.length;

  return (
    <section id="antrean" aria-labelledby="queueTitle" className="flex flex-col gap-4">
      {/* header + filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id="queueTitle" className="text-[22px] font-bold tracking-tight text-on-surface">
            Antrean Lagu
          </h2>
          <span className="rounded-full bg-surface-4 px-4 py-0.5 text-xs font-bold text-on-surface">
            {jumlahBaris} lagu
          </span>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Urutkan antrean">
          <button
            type="button"
            aria-pressed={sort === 'baru'}
            onClick={() => setSort('baru')}
            className={cn(
              'rounded-full px-4 py-1 text-xs font-bold transition-colors',
              sort === 'baru'
                ? 'bg-white text-black'
                : 'bg-surface-4 text-on-surface hover:bg-surface-3',
            )}
          >
            Semua
          </button>
          <button
            type="button"
            aria-pressed={sort === 'vote'}
            onClick={() => setSort('vote')}
            className={cn(
              'rounded-full px-4 py-1 text-xs font-bold transition-colors',
              sort === 'vote'
                ? 'bg-white text-black'
                : 'bg-surface-4 text-on-surface hover:bg-surface-3',
            )}
          >
            Paling Banyak Di-vote
          </button>
        </div>
      </div>

      {jumlahBaris === 0 ? (
        <EmptyState title="Antrean kosong" hint="Jadi yang pertama minta lagu." />
      ) : (
        <div className="flex w-full flex-col">
          {/* kepala tabel */}
          <div className="mb-2 grid select-none grid-cols-12 items-center gap-3 border-b border-surface-4 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-6 md:col-span-5">Judul &amp; Artis</div>
            <div className="hidden md:col-span-3 md:block">Pesan</div>
            <div className="col-span-5 pr-2 text-right md:col-span-3">Status &amp; Vote</div>
          </div>

          {/* menunggu persetujuan */}
          {pending.length > 0 && (
            <>
              <SectionLabel tone="amber" text="Menunggu Persetujuan DJ" />
              <ul className="flex flex-col">
                {pending.map((track) => (
                  <QueueRow key={track.id} track={track} deviceId={deviceId} nomor={0} />
                ))}
              </ul>
            </>
          )}

          {/* terkonfirmasi */}
          {rowsTerkonfirmasi.length > 0 && (
            <>
              <SectionLabel tone="primary" text="Antrean Terkonfirmasi" />
              <ul className="flex flex-col">
                {rowsTerkonfirmasi.map((track) => (
                  <QueueRow
                    key={track.id}
                    track={track}
                    deviceId={deviceId}
                    nomor={track.status === 'queued' ? queued.indexOf(track) + 1 : 0}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {done.length > 0 && (
        <details
          open={doneOpen}
          onToggle={(e) => setDoneOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-xl bg-surface-2 px-5 py-4 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
        >
          <summary className="cursor-pointer select-none text-sm font-bold text-muted-foreground hover:text-foreground">
            Sudah diputar ({done.length})
          </summary>
          <ol className="mt-3 grid gap-1.5">
            {done.slice(-12).reverse().map((track) => (
              <li
                key={track.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 opacity-70 transition-opacity hover:opacity-100"
              >
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm font-semibold">{track.title}</b>
                  <span className="block truncate text-xs text-muted-foreground">
                    {track.artist || '—'} · diminta oleh {track.requester || 'Tamu'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function SectionLabel({ tone, text }: { tone: 'amber' | 'primary'; text: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <span
        aria-hidden
        className={cn('size-2 rounded-full', tone === 'amber' ? 'bg-[#f59e0b]' : 'bg-primary')}
      />
      <span
        className={cn(
          'text-[11px] font-bold uppercase tracking-wider',
          tone === 'amber' ? 'text-[#f59e0b]' : 'text-primary',
        )}
      >
        {text}
      </span>
    </div>
  );
}

function QueueRow({
  track,
  deviceId,
  nomor,
}: {
  track: Track;
  deviceId: string;
  nomor: number;
}) {
  const session = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const rejected = track.status === 'rejected';
  const isPlaying = track.status === 'playing';
  const pending = track.status === 'pending';
  const bisaVote = track.status === 'queued' || pending;
  const voted = Boolean(track.votes && track.votes[deviceId]);
  const jumlahVote = Object.keys(track.votes || {}).length;
  const cover = track.yt ? `https://i.ytimg.com/vi/${track.yt}/default.jpg` : null;

  const handleVote = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await voteTrack(session.token, track.id);
      if (result.voted) toast(`Vote untuk “${track.title}” dikirim.`);
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

  return (
    <li className="group grid h-14 grid-cols-12 items-center gap-3 rounded-lg px-4 transition-colors hover:bg-[#2A2A2A]">
      {/* nomor / play */}
      <div className="col-span-1 flex items-center justify-center text-sm text-on-surface-variant">
        {track.yt ? (
          <>
            <span className="group-hover:hidden tabular-nums">
              {nomor || (rejected ? '×' : isPlaying ? '♪' : pending ? '•' : '')}
            </span>
            <a
              href={`https://www.youtube.com/watch?v=${track.yt}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Putar ${track.title} di YouTube`}
              className="hidden group-hover:block"
            >
              <Play className="size-5 fill-primary text-primary" aria-hidden />
            </a>
          </>
        ) : (
          <span className="tabular-nums">{nomor || (rejected ? '×' : isPlaying ? '♪' : pending ? '•' : '')}</span>
        )}
      </div>

      {/* judul & artis */}
      <div className="col-span-6 flex min-w-0 items-center gap-3 pr-4 md:col-span-5">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-3">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ListMusic className="size-4.5 text-on-surface-variant" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate text-sm font-semibold text-on-surface transition-colors group-hover:text-primary',
              rejected && 'line-through',
            )}
          >
            {track.title}
          </span>
          <span className="truncate text-xs text-on-surface-variant">
            {track.artist || '—'}
            {track.requester ? ` • ${track.requester}` : ''}
          </span>
        </span>
      </div>

      {/* pesan */}
      <div className="hidden min-w-0 items-center pr-3 md:col-span-3 md:flex">
        {track.message ? (
          <span className="truncate text-xs italic text-on-surface-variant">
            “{track.message}”
          </span>
        ) : null}
      </div>

      {/* status + vote */}
      <div className="col-span-5 flex items-center justify-end gap-2 pr-2 text-right md:col-span-3">
        <StatusPill track={track} />
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold',
            !bisaVote && 'bg-transparent text-on-surface-variant',
            bisaVote && voted && 'bg-primary text-black',
            bisaVote && !voted && 'bg-surface-3 text-on-surface',
          )}
        >
          {bisaVote && (
            <button
              type="button"
              disabled={busy}
              aria-pressed={voted}
              aria-label={`${voted ? 'Batalkan vote' : 'Vote'} untuk ${track.title}`}
              onClick={() => void handleVote()}
              className="-ml-1 flex items-center disabled:opacity-50"
            >
              <ArrowUp
                className={cn('size-3.5', voted ? 'text-black' : 'text-primary')}
                strokeWidth={3}
                aria-hidden
              />
            </button>
          )}
          {jumlahVote}
        </span>
      </div>
    </li>
  );
}

function StatusPill({ track }: { track: Track }) {
  if (track.status === 'pending') {
    return (
      <span className="hidden rounded bg-[#f59e0b]/20 px-2 py-0.5 text-[11px] font-semibold text-[#f59e0b] sm:inline-block">
        Menunggu
      </span>
    );
  }
  if (track.status === 'playing') {
    return (
      <span className="rounded bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
        Diputar
      </span>
    );
  }
  if (track.status === 'rejected') {
    return (
      <span className="rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        Ditolak
      </span>
    );
  }
  return (
    <span className="rounded bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
      Antre
    </span>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-5 py-10 text-center shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
      <MonitorPlay className="mx-auto mb-2 size-6 text-muted-foreground/50" aria-hidden />
      <b className="block text-sm font-bold">{title}</b>
      <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>
    </div>
  );
}
