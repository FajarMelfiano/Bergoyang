import * as React from 'react';
import { Check, ChevronDown, ListMusic, MonitorPlay, Music4, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ApiError, djTrackAction, listAudioFiles, SessionExpiredError, ytSearch } from '@/lib/api';
import type { AppState, Track } from '@/lib/types';
import { urutAntrean } from '@/lib/queue';
import type { PlayerEngine } from '@/dj/usePlayerEngine';

interface QueueSectionProps {
  state: AppState;
  token: string;
  engine: PlayerEngine;
  adzanAktif: boolean;
  toast: (message: string, tone?: 'ok' | 'error') => void;
}

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof SessionExpiredError) return err.message;
  return 'Terjadi kesalahan.';
}

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function QueueSection({ state, token, engine, adzanAktif, toast }: QueueSectionProps) {
  const pending = state.tracks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  const queued = urutAntrean(state, state.tracks.filter((t) => t.status === 'queued'));
  const playing = state.tracks.find((t) => t.status === 'playing') || null;
  const done = state.tracks.filter((t) => t.status === 'done');
  const jumlah = pending.length + queued.length + (playing ? 1 : 0);

  const run = async (track: Track, action: string, okMessage?: string) => {
    if (action === 'play' && adzanAktif) {
      toast('Sedang adzan — pemutaran lanjut otomatis setelah adzan selesai.');
      return;
    }
    try {
      await djTrackAction(token, track.id, action);
      if (okMessage) toast(okMessage);
    } catch (err) {
      toast(errText(err), 'error');
    }
  };

  const sumberDiperbarui = (updated: Track) => {
    if (engine.isCurrent(updated.id)) engine.startPlayback(updated);
  };

  return (
    <section aria-labelledby="djQueueTitle" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ListMusic className="size-[22px] text-primary" aria-hidden />
          <h2 id="djQueueTitle" className="text-[22px] font-bold tracking-tight text-on-surface">
            Antrean
          </h2>
          <span className="rounded-full bg-surface-4 px-3 py-0.5 text-xs font-bold text-on-surface-variant">
            {jumlah} menunggu
          </span>
        </div>
        <span className="text-xs text-on-surface-variant">Urutkan: Vote tertinggi</span>
      </header>

      {/* 1. menunggu persetujuan */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            tone="amber"
            text="Menunggu Persetujuan DJ"
            pill={`${pending.length} Permintaan Masuk`}
          />
          <div className="flex flex-col gap-2">
            {pending.map((t) => (
              <QueueRow
                key={t.id}
                track={t}
                nomor={null}
                token={token}
                toast={toast}
                onRun={run}
                onSourceChanged={sumberDiperbarui}
              />
            ))}
          </div>
        </div>
      )}

      {/* 2. sedang diputar */}
      {playing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionHead tone="primary" text="Sedang Diputar Sekarang" />
            <span className="flex items-center gap-2 font-mono text-xs font-bold text-primary">
              LIVE ON AIR
            </span>
          </div>
          <NowPlayingCard track={playing} beat={state.beat ?? null} />
        </div>
      )}

      {/* 3. antrean aktif */}
      {queued.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            tone="primary"
            text="Antrean Aktif"
            pill={`${queued.length} Lagu Berikutnya`}
          />
          {/* kepala tabel */}
          <div className="grid grid-cols-12 items-center gap-2 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-6 md:col-span-5">Judul Lagu</div>
            <div className="hidden md:col-span-3 md:block">Pemesan</div>
            <div className="col-span-5 text-right md:col-span-3">Vote &amp; Aksi</div>
          </div>
          <div className="flex flex-col gap-1.5">
            {queued.map((t, i) => (
              <QueueRow
                key={t.id}
                track={t}
                nomor={i + 1}
                token={token}
                toast={toast}
                onRun={run}
                onSourceChanged={sumberDiperbarui}
              />
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <details className="rounded-xl bg-surface-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-muted-foreground marker:hidden hover:text-foreground">
            <span>Selesai ({done.length})</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-2 border-t border-white/8 p-4 pt-3">
            {done
              .slice(-15)
              .reverse()
              .map((t) => (
                <QueueRow
                  key={t.id}
                  track={t}
                  nomor={null}
                  token={token}
                  toast={toast}
                  onRun={run}
                  onSourceChanged={sumberDiperbarui}
                />
              ))}
          </div>
        </details>
      )}

      {jumlah === 0 && (
        <div className="grid place-items-center gap-1 rounded-xl bg-surface-2/70 px-6 py-12 text-center shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          <ListMusic className="size-8 text-muted-foreground/60" aria-hidden />
          <b className="text-sm">Belum ada request</b>
          <span className="text-xs text-muted-foreground">
            Bagikan QR atau alamat halaman tamu ke penonton.
          </span>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------- section header */

function SectionHead({
  tone,
  text,
  pill,
}: {
  tone: 'amber' | 'primary';
  text: string;
  pill?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        aria-hidden
        className={cn(
          'size-2.5 rounded-full',
          tone === 'amber' ? 'bg-[#f59e0b]' : 'live-dot bg-primary',
        )}
      />
      <h3 className="text-sm font-bold text-on-surface">{text}</h3>
      {pill && (
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
            tone === 'amber' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' : 'bg-primary/15 text-primary',
          )}
        >
          {pill}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------- now playing compact */

function NowPlayingCard({ track, beat }: { track: Track; beat: AppState['beat'] }) {
  const sumber = track.audio ? `File MP3: ${track.audio}` : track.yt ? 'YouTube' : 'Belum ada sumber';
  const live = Boolean(beat?.playing);

  return (
    <article className="flex items-center justify-between gap-3 rounded-xl bg-surface-3 p-3 shadow-inner">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[#0e0e0e]">
          {track.yt ? (
            <MonitorPlay className="size-6 text-primary" aria-hidden />
          ) : (
            <Music4 className="size-6 text-primary" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-primary">{track.title}</span>
          <span className="truncate text-xs text-on-surface-variant">
            {track.artist || '—'} • diminta oleh {track.requester || 'Tamu'}
          </span>
          <span className="truncate text-[11px] text-on-surface-variant/70">{sumber}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden rounded-full bg-[#0e0e0e] px-3 py-1 font-mono text-xs font-bold text-on-surface sm:inline-flex">
          {mmss(beat?.pos ?? 0)}
          <span className="text-on-surface-variant"> / {mmss(beat?.dur ?? 0)}</span>
        </span>
        <span
          data-live={live}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary"
        >
          <span aria-hidden className="live-dot size-1.5 rounded-full bg-primary" />
          {live ? 'Mengudara' : 'Siaga'}
        </span>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- row */

interface QueueRowProps {
  track: Track;
  nomor: number | null;
  token: string;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  onRun: (track: Track, action: string, okMessage?: string) => Promise<void>;
  onSourceChanged: (track: Track) => void;
}

function QueueRow({
  track,
  nomor,
  token,
  toast,
  onRun,
  onSourceChanged,
}: QueueRowProps) {
  const voteCount = Object.keys(track.votes || {}).length;
  const showSource =
    track.status !== 'done' && track.status !== 'playing' && track.status !== 'rejected';
  const cover = track.yt ? `https://i.ytimg.com/vi/${track.yt}/default.jpg` : null;
  const sumberPill = track.audio
    ? 'File MP3'
    : track.yt
      ? 'YouTube'
      : 'Belum ada sumber';

  return (
    <article
      data-status={track.status}
      className="grid grid-cols-12 items-center gap-x-3 gap-y-2 rounded-xl bg-surface-2 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors hover:bg-surface-3 data-[status=playing]:bg-primary/8 data-[status=pending]:bg-surface-2"
    >
      {/* nomor */}
      <div className="col-span-1 hidden text-center font-mono text-sm font-bold text-on-surface-variant sm:block md:col-span-1">
        {nomor == null ? '\u00a0' : nomor}
      </div>

      {/* isi utama */}
      <div className="col-span-12 flex min-w-0 items-center gap-3 sm:col-span-8 md:col-span-6">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0e0e0e] md:size-12">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <Music4 className="size-5 text-on-surface-variant" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-bold text-on-surface">{track.title}</span>
            {track.artist && (
              <span className="hidden truncate text-xs text-on-surface-variant sm:inline">
                • {track.artist}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant md:hidden">
            <span className="font-semibold text-primary">{track.requester || 'Tamu'}</span>
            {track.message && (
              <span className="max-w-[24ch] truncate italic">“{track.message}”</span>
            )}
          </span>
        </span>
      </div>

      {/* pemesan (kolom tabel, desktop) */}
      <div className="hidden min-w-0 flex-col md:col-span-3 md:flex">
        <span className="truncate text-xs font-semibold text-on-surface">
          {track.requester || 'Tamu'}
        </span>
        {track.message && (
          <span className="truncate text-[11px] italic text-on-surface-variant">
            “{track.message}”
          </span>
        )}
      </div>

      {/* aksi */}
      <div className="col-span-12 flex flex-wrap items-center justify-end gap-2 sm:col-span-4 md:col-span-2">
        {track.status === 'pending' && (
          <>
            <span className="rounded bg-surface-4 px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
              {sumberPill}
            </span>
            <button
              type="button"
              title="Tolak lagu"
              aria-label={`Tolak ${track.title}`}
              onClick={() => void onRun(track, 'reject', 'Request ditolak.')}
              className="flex size-8 items-center justify-center rounded-full bg-destructive/15 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              title="Setujui & masukkan antrean"
              aria-label={`Setujui ${track.title}`}
              onClick={() => void onRun(track, 'approve', `“${track.title}” disetujui.`)}
              className="flex size-8 items-center justify-center rounded-full bg-primary text-black transition-transform hover:scale-110"
            >
              <Check className="size-4" strokeWidth={3} aria-hidden />
            </button>
          </>
        )}

        {track.status === 'queued' && (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-xs font-bold',
                voteCount > 0 ? 'bg-primary/15 text-primary' : 'bg-surface-4 text-on-surface-variant',
              )}
              title={`${voteCount} vote`}
            >
              ▲ {voteCount}
            </span>
            <button
              type="button"
              title="Naikkan urutan"
              aria-label={`Naikkan ${track.title}`}
              onClick={() => void onRun(track, 'up')}
              className="flex size-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-4 hover:text-on-surface"
            >
              <ChevronDown className="size-4 rotate-180" aria-hidden />
            </button>
            <button
              type="button"
              title="Turunkan urutan"
              aria-label={`Turunkan ${track.title}`}
              onClick={() => void onRun(track, 'down')}
              className="flex size-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-4 hover:text-on-surface"
            >
              <ChevronDown className="size-4" aria-hidden />
            </button>
            <Button
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => void onRun(track, 'play', `Memutar “${track.title}”.`)}
            >
              Putar
            </Button>
            <button
              type="button"
              title="Tolak lagu"
              aria-label={`Tolak ${track.title}`}
              onClick={() => void onRun(track, 'reject', 'Request ditolak.')}
              className="flex size-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="size-4" aria-hidden />
            </button>
          </>
        )}

        {track.status === 'playing' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            <span aria-hidden className="live-dot size-1.5 rounded-full bg-primary" />
            Diputar
          </span>
        )}

        {track.status === 'done' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => void onRun(track, 'play')}
          >
            Putar lagi
          </Button>
        )}

        {track.status === 'rejected' && (
          <span className="rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
            Ditolak
          </span>
        )}
      </div>

      {showSource && (
        <div className="col-span-12">
          <SourceControls
            track={track}
            token={token}
            toast={toast}
            onChanged={onSourceChanged}
          />
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------- source controls */

function SourceControls({
  track,
  token,
  toast,
  onChanged,
}: {
  track: Track;
  token: string;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  onChanged: (track: Track) => void;
}) {
  const [files, setFiles] = React.useState<string[] | null>(null);
  const [pilih, setPilih] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const muatFiles = async () => {
    if (files) return;
    try {
      const data = await listAudioFiles(token);
      setFiles(data.files || []);
    } catch {
      setFiles([]);
    }
  };

  const terapkan = async (fn: () => Promise<{ track: Track }>, pesan: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const hasil = await fn();
      toast(pesan);
      onChanged(hasil.track);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Gagal menyimpan sumber.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="mt-1 rounded-lg bg-[#0e0e0e]"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void muatFiles();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-bold text-on-surface-variant marker:hidden hover:text-on-surface">
        <span>Sumber audio</span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/8 p-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (busy) return;
              setBusy(true);
              toast('Mencari di YouTube…');
              try {
                const query = `${track.title} ${track.artist || ''}`.trim();
                const found = await ytSearch(token, query);
                const hasil = await djTrackAction(token, track.id, 'link', { yt: found.id });
                toast(`Sumber disetel: ${found.title || query}`);
                onChanged(hasil.track);
              } catch (err) {
                toast(err instanceof ApiError ? err.message : 'Gagal mencari.', 'error');
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <Search className="size-3.5" aria-hidden />
          Cari otomatis di YouTube
        </Button>

        <Input
          type="url"
          placeholder="tempel link YouTube"
          aria-label="Link YouTube"
          className="h-9 min-w-[160px] flex-1 border-0 bg-surface-3"
          disabled={busy}
          defaultValue={track.yt || ''}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== track.yt) {
              void terapkan(
                () => djTrackAction(token, track.id, 'link', { yt: v }),
                'Link YouTube disimpan.',
              );
            }
          }}
        />

        <select
          aria-label="File audio lokal"
          value={pilih}
          onChange={(e) => setPilih(e.target.value)}
          className="h-9 rounded-md bg-surface-4 px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">— pilih file di audio/ —</option>
          {(files || []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void terapkan(
              () => djTrackAction(token, track.id, 'audio', { file: pilih }),
              pilih ? `Memakai file ${pilih}` : 'Sumber file dilepas.',
            )
          }
        >
          Pakai file ini
        </Button>

        <p className="w-full text-[0.7rem] text-muted-foreground">
          Letakkan file mp3 di folder audio/ lalu muat ulang halaman ini.
        </p>
      </div>
    </details>
  );
}
