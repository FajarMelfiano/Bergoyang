import * as React from 'react';
import { ListMusic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession } from '@/lib/session';
import { ApiError, SessionExpiredError } from '@/lib/api';

export function LoginGate() {
  const session = useSession();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

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
      } else {
        setNote(err instanceof ApiError ? err.message : 'Gagal masuk.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* glow ambient halus ala referensi */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
      />

      <div className="relative z-10 flex w-full max-w-[460px] flex-col rounded-2xl bg-[#1f1f1f] p-8 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9),0_0_40px_rgba(30,215,96,0.06)] sm:p-10">
        {/* branding */}
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-xl bg-[#0e0e0e] shadow-md">
            <ListMusic className="size-7 text-primary" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Masuk dulu</h1>
          <p className="mt-2 max-w-[320px] text-sm text-on-surface-variant">
            Halaman ini privat — hanya panitia terdaftar yang bisa kirim request. Masuk
            pakai username &amp; password kamu.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loginUser" className="text-sm text-on-surface">
              Username
            </Label>
            <Input
              id="loginUser"
              name="username"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              required
              placeholder="username kamu"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11 rounded-lg border-0 bg-[#2a2a2a] focus-visible:bg-[#323232] focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loginPass" className="text-sm text-on-surface">
              Kata Sandi
            </Label>
            <Input
              id="loginPass"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-lg border-0 bg-[#2a2a2a] focus-visible:bg-[#323232] focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          {note && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {note}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy}
            className="mt-1 flex h-12 w-full gap-2 rounded-full font-bold shadow-[0_8px_20px_rgba(30,215,96,0.35)] active:scale-[0.98]"
          >
            <Sparkles className="size-4.5" aria-hidden />
            {busy ? 'Masuk…' : 'Masuk & Request Lagu'}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-on-surface-variant/70">
          Akun dibuat oleh panitia acara. Belum punya akun? Hubungi kru di meja DJ.
        </p>
      </div>
    </main>
  );
}
