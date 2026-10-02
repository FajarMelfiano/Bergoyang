import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wordmark } from '@/components/wordmark';
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Card className="rounded-2xl border-white/8 bg-surface-2 shadow-2xl shadow-black/40">
        <CardHeader className="items-center text-center">
          <Wordmark className="mb-1 text-3xl" />
          <CardTitle className="text-2xl">Masuk dulu</CardTitle>
          <CardDescription className="text-balance">
            Halaman ini privat — hanya panitia terdaftar yang bisa kirim request.
            Masuk pakai username &amp; password kamu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="loginUser">Username</Label>
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
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="loginPass">Password</Label>
              <Input
                id="loginPass"
                type="password"
                autoComplete="current-password"
                required
                placeholder="password kamu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {note && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {note}
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Masuk…' : 'Masuk'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
