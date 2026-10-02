import * as React from 'react';
import { ListMusic, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, searchSongs, SessionExpiredError, submitRequest } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/ui/toast';
import type { AppState, Song } from '@/lib/types';

interface RequestPanelProps {
  state: AppState;
  /** Urutan antrean menurut vote (dipakai menghitung posisi setelah kirim). */
  queueOrder: AppState['order'];
}

export function RequestPanel({ state, queueOrder }: RequestPanelProps) {
  const session = useSession();
  const { toast } = useToast();

  const [title, setTitle] = React.useState('');
  const [artist, setArtist] = React.useState('');
  const [source, setSource] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [results, setResults] = React.useState<Song[]>([]);
  const [detected, setDetected] = React.useState<Song | null>(null);
  const [pickedYt, setPickedYt] = React.useState('');
  const [note, setNote] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const titleRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const searchSeq = React.useRef(0);
  const searchTimer = React.useRef<number | undefined>(undefined);

  const closed = !state.event.open;

  const onTitleChange = (value: string) => {
    setTitle(value);
    setPickedYt('');
    const trim = value.trim();
    window.clearTimeout(searchTimer.current);
    if (trim.length < 2) {
      setResults([]);
      setDetected(null);
      return;
    }
    const seq = ++searchSeq.current;
    searchTimer.current = window.setTimeout(async () => {
      try {
        const data = await searchSongs(trim);
        if (seq !== searchSeq.current) return;
        setResults(data.songs || []);
        setDetected(data.detected?.yt ? data.detected : null);
      } catch {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setDetected(null);
      }
    }, 260);
  };

  const pilih = (song: Song) => {
    setTitle(song.title);
    setArtist(song.artist || '');
    setPickedYt(song.yt || '');
    setResults([]);
    setDetected(null);
    titleRef.current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const judul = title.trim();
    if (!judul) {
      setNote({ tone: 'error', text: 'Judul lagu wajib diisi.' });
      titleRef.current?.focus();
      return;
    }

    const payload = {
      title: judul,
      artist: artist.trim(),
      message: message.trim(),
      yt: pickedYt || source.trim(),
    };

    setBusy(true);
    setNote({ tone: 'ok', text: payload.yt ? 'Mengirim slip request…' : 'Mencari sumber lagu di YouTube…' });
    try {
      const result = await submitRequest(session.token, payload);
      const antreanBaru = state.tracks.filter((t) => t.status === 'queued');
      const rank = new Map(queueOrder.map((id, i) => [id, i]));
      const terurut = antreanBaru.slice().sort(
        (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
      const posisi = terurut.findIndex((t) => t.id === result.track.id) + 1;
      setNote({
        tone: 'ok',
        text:
          result.status === 'pending'
            ? 'Slip terkirim, menunggu persetujuan DJ.'
            : posisi > 0
              ? `Slip terkirim — posisi antrean #${posisi} dari ${terurut.length}. Naik urutan kalau dapat vote.`
              : 'Slip terkirim.',
      });
      toast(`“${payload.title}” masuk antrean.`);
      setTitle('');
      setArtist('');
      setSource('');
      setMessage('');
      setPickedYt('');
      setResults([]);
      setDetected(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        session.expire();
        return;
      }
      setNote({ tone: 'error', text: err instanceof ApiError ? err.message : 'Gagal mengirim.' });
    } finally {
      setBusy(false);
    }
  };

  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setResults([]);
      setDetected(null);
    }
    if (e.key === 'ArrowDown') {
      const first = resultsRef.current?.querySelector<HTMLButtonElement>('button[role="option"]');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <section className="rounded-xl bg-surface-2 p-6 shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
      <header className="flex items-center justify-between pb-1">
        <h2 className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-on-surface">
          <ListMusic className="size-[22px] text-primary" aria-hidden />
          Request Lagu
        </h2>
        <span className="text-[11px] font-semibold text-primary">
          @{session.user?.username || 'tamu'}
        </span>
      </header>
      <p className="text-xs text-on-surface-variant">
        {closed
          ? 'Request sedang ditutup oleh DJ. Tunggu dibuka lagi.'
          : 'Pilih lagu favoritmu untuk diputar DJ di panggung utama malam ini.'}
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="title"
              className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant"
            >
              Judul Lagu *
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="title"
                ref={titleRef}
                name="title"
                autoComplete="off"
                maxLength={120}
                required
                placeholder="misal: Lowkey atau Gala Bunga Matahari"
                className="border-0 bg-[#2A2A2A] pl-10 focus-visible:ring-2 focus-visible:ring-primary"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                onKeyDown={onTitleKeyDown}
                aria-describedby="titleHelp"
              />
              {(results.length > 0 || (detected && title.trim().length >= 2)) && (
                <div
                  ref={resultsRef}
                  role="listbox"
                  aria-label="Hasil pencarian lagu"
                  className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-popover p-1.5 shadow-2xl shadow-black/60"
                >
                  {detected && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-left hover:bg-primary/15"
                      onClick={() => pilih(detected)}
                    >
                      <span className="text-xs font-bold text-primary">Terdeteksi:</span>
                      <span className="truncate text-sm font-semibold text-foreground">
                        {detected.title}
                        {detected.artist ? ` — ${detected.artist}` : ''}
                      </span>
                      {detected.duration && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {detected.duration}
                        </span>
                      )}
                    </button>
                  )}
                  {results.map((song, i) => (
                    <button
                      key={`${song.yt || song.title}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                      onClick={() => pilih(song)}
                    >
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-sm font-semibold">{song.title}</b>
                        {song.artist && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {song.artist}
                          </span>
                        )}
                      </span>
                      {song.duration && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {song.duration}
                        </span>
                      )}
                    </button>
                  ))}
                  {!results.length && detected && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Belum ada saran lain — tetap bisa kirim, server akan mencari sendiri.
                    </p>
                  )}
                </div>
              )}
            </div>
            <p id="titleHelp" className="sr-only">
              Pilih dari hasil pencarian atau ketik judul sendiri.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="artist"
              className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant"
            >
              Artis *
            </Label>
            <Input
              id="artist"
              name="artist"
              autoComplete="off"
              maxLength={120}
              placeholder="misal: NIKI / Sal Priadi"
              className="border-0 bg-[#2A2A2A] focus-visible:ring-2 focus-visible:ring-primary"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="source"
              className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant"
            >
              Link YouTube <span className="font-normal normal-case tracking-normal">(opsional)</span>
            </Label>
            <Input
              id="source"
              name="source"
              type="url"
              inputMode="url"
              maxLength={300}
              placeholder="kosongkan — server cari sumbernya otomatis dari judul"
              className="border-0 bg-[#2A2A2A] focus-visible:ring-2 focus-visible:ring-primary"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          {state.event.allowMessages && (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="message"
                className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant"
              >
                Pesan Singkat <span className="font-normal normal-case tracking-normal">(opsional)</span>
              </Label>
              <Textarea
                id="message"
                name="message"
                maxLength={240}
                placeholder="Pesan atau salam untuk teman..."
                className="border-0 bg-[#2A2A2A] focus-visible:ring-2 focus-visible:ring-primary"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          )}

          <div className="mt-1 flex flex-col gap-3">
            <Button
              type="submit"
              disabled={busy || closed}
              className="h-11 w-full gap-2 rounded-full bg-primary font-bold text-black shadow-[0_4px_16px_rgba(30,215,96,0.25)] hover:bg-brand-hover"
            >
              <Send className="size-4" aria-hidden />
              {busy ? 'Mengirim…' : 'Kirim Request'}
            </Button>
            {note && (
              <p
                role="status"
                aria-live="polite"
                className={
                  note.tone === 'error'
                    ? 'text-sm font-medium text-destructive'
                    : 'text-sm font-medium text-primary'
                }
              >
                {note.text}
              </p>
            )}
          </div>
        </form>
    </section>
  );
}
