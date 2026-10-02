import * as React from 'react';
import { Activity, ArrowUpRight, Eye, EyeOff, Key, ListMusic, PlayCircle, ShieldCheck, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, SessionExpiredError } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Gerbang login panel DJ — gaya tiket pass sesuai .design-ref/dj-login.html. */
export function DjLoginGate() {
  const session = useSession();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const ditolak = session.notice;
  const pesan = ditolak || note;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote('');
    try {
      await session.login(username.trim(), password);
      setUsername('');
      setPassword('');
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setNote('Username atau password salah.');
      } else if (!(err instanceof ApiError && err.message === 'Panel DJ hanya untuk admin.')) {
        setNote(err instanceof ApiError ? err.message : 'Gagal masuk.');
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* ambient studio lighting ala referensi */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px] mix-blend-screen"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-1/3 size-80 rounded-full bg-surface-4/30 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 bottom-10 size-96 rounded-full bg-primary/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#e5e2e1_1px,transparent_1px)] opacity-[0.03] [background-size:24px_24px]"
      />

      {/* kartu tiket */}
      <div className="relative z-10 w-full max-w-[440px]">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-[18px] bg-gradient-to-b from-white/15 via-white/5 to-transparent"
        />
        <div className="relative overflow-hidden rounded-2xl bg-[#1f1f1f] shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9),0_0_40px_rgba(30,215,96,0.06)]">
          {/* header */}
          <div className="bg-[#1f1f1f] p-8 pb-6">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1">
                <span
                  aria-hidden
                  className="live-dot size-2 rounded-full bg-primary shadow-[0_0_8px_#1ed760]"
                />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Sesi Live Aktif
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface-variant">
                <Activity className="size-4 text-primary" aria-hidden />
                Lossless Audio
              </span>
            </div>

            <div className="mb-3 flex items-center gap-3.5">
              <span className="flex size-11 items-center justify-center rounded-full bg-[#0e0e0e] shadow-inner">
                <ListMusic className="size-6 text-primary" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Portal DJ &amp; Request Lagu
                </span>
                <h1 className="text-2xl font-bold leading-tight text-on-surface">
                  Skarisa Bergoyang
                </h1>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              Masuk ke konsol kontrol audio dan manajemen playlist interaktif Skarisa
              Bergoyang.
            </p>
          </div>

          {/* notch tiket */}
          <div className="relative flex h-5 w-full items-center justify-between overflow-hidden">
            <span className="-ml-2.5 size-5 rounded-full bg-[#131313] shadow-inner" aria-hidden />
            <span className="mx-2 flex-1 border-t-2 border-dashed border-white/10" aria-hidden />
            <span className="-mr-2.5 size-5 rounded-full bg-[#131313] shadow-inner" aria-hidden />
          </div>

          {/* form */}
          <div className="flex flex-col gap-5 bg-[#1f1f1f] p-8 pt-5">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="djLoginUser"
                  className="flex items-center justify-between text-sm text-on-surface"
                >
                  <span>ID Operator / Venue Desk</span>
                  <span className="text-[11px] font-normal text-on-surface-variant">Wajib</span>
                </Label>
                <div className="relative flex items-center">
                  <Tag
                    className="absolute left-3.5 size-4.5 text-on-surface-variant"
                    aria-hidden
                  />
                  <Input
                    id="djLoginUser"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
                    required
                    placeholder="misal: admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-11 rounded-lg border-0 bg-[#2a2a2a] pl-10 pr-4 focus-visible:bg-[#323232] focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="djLoginPass" className="text-sm text-on-surface">
                  Security Token / Password
                </Label>
                <div className="relative flex items-center">
                  <Key
                    className="absolute left-3.5 size-4.5 text-on-surface-variant"
                    aria-hidden
                  />
                  <Input
                    id="djLoginPass"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="Masukkan token akses venue"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 rounded-lg border-0 bg-[#2a2a2a] pl-10 pr-11 tracking-wider focus-visible:bg-[#323232] focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <button
                    type="button"
                    aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-3 flex items-center justify-center p-1 text-on-surface-variant transition-colors hover:text-on-surface"
                  >
                    {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                  </button>
                </div>
              </div>

              {pesan && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {pesan}
                </p>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="mt-1 flex h-12 w-full gap-2 rounded-full font-bold shadow-[0_8px_20px_rgba(30,215,96,0.35)] active:scale-[0.98]"
              >
                <PlayCircle className="size-5" aria-hidden />
                {busy ? 'Menghubungkan ke Deck…' : 'Masuk ke Deck DJ'}
              </Button>
            </form>

            {/* footer kartu */}
            <div className="mt-1 flex flex-col gap-3 border-t border-white/5 pt-4">
              <div className="flex items-start gap-2 text-xs text-on-surface-variant">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-on-surface-variant" aria-hidden />
                <p className="leading-snug">
                  Khusus kru panggung &amp; host audio — akses resmi hanya diizinkan melalui
                  tautan undangan panggung.
                </p>
              </div>
              <a
                href="/"
                className="inline-flex items-center gap-1 text-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface"
              >
                Kembali ke Halaman Tamu
                <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* tagline bawah */}
      <div className="relative z-10 mt-8 flex flex-col items-center gap-1.5 text-center">
        <span className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          Skarisa Bergoyang
          <span className="text-on-surface-variant/50">•</span>
          <span className="font-normal">Sistem Musik &amp; Antrean Tamu</span>
        </span>
      </div>
    </main>
  );
}
