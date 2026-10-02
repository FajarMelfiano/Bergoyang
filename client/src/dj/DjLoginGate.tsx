import * as React from 'react';
import { Disc3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wordmark } from '@/components/wordmark';
import { ApiError, SessionExpiredError } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Gerbang login panel DJ — gaya tiket, admin-only. */
export function DjLoginGate() {
  const session = useSession();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // pesan penolakan non-admin dari boot /api/me atau percobaan login
  const ditolak = session.notice;
  const pesan = ditolak || note;
  const tampilkanTamu = Boolean(ditolak);

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
        // penolakan admin sudah tampil lewat session.notice
        setNote(err instanceof ApiError ? err.message : 'Gagal masuk.');
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="overflow-hidden rounded-2xl bg-surface-2 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-white/8 bg-surface-3/70 px-6 py-4">
          <Wordmark className="text-xl" />
          <span className="rounded-full bg-surface-4 px-2.5 py-0.5 text-[0.68rem] font-extrabold uppercase tracking-wider text-muted-foreground">
            Akses panel
          </span>
        </div>

        <div className="grid gap-4 px-6 py-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Panel DJ</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hanya admin yang bisa mengelola panel DJ. Masuk dengan akun admin.
            </p>
          </div>

          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="djLoginUser">Username</Label>
              <Input
                id="djLoginUser"
                name="username"
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                required
                placeholder="username admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="djLoginPass">Password</Label>
              <Input
                id="djLoginPass"
                type="password"
                autoComplete="current-password"
                required
                placeholder="password kamu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {pesan && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {pesan}
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Masuk…' : 'Masuk'}
            </Button>
          </form>

          {tampilkanTamu && (
            <Button asChild variant="secondary" className="w-full gap-2">
              <a href="/">
                <Disc3 className="size-4" aria-hidden />
                Kembali ke halaman tamu
              </a>
            </Button>
          )}
        </div>

        <p className="border-t border-white/8 px-6 py-4 text-center text-xs text-muted-foreground">
          Panel DJ hanya untuk admin. Panitia lain request lewat halaman tamu.
        </p>
      </div>
    </main>
  );
}
