import * as React from 'react';
import { Badge, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, fetchDjUsers, resetPassword } from '@/lib/api';
import type { User } from '@/lib/types';

interface PanitiaBoxProps {
  token: string;
  toast: (message: string, tone?: 'ok' | 'error') => void;
}

/**
 * Kelola panitia (admin): daftar akun + reset password panitia yang lupa
 * tanpa perlu password lamanya. Daftar dimuat saat mount (untuk pill jumlah)
 * dan segarkan tiap kali section dibuka.
 */
export function PanitiaBox({ token, toast }: PanitiaBoxProps) {
  const [users, setUsers] = React.useState<User[] | null>(null);
  const [error, setError] = React.useState('');
  const [note, setNote] = React.useState('');
  const [noteTone, setNoteTone] = React.useState<'ok' | 'error' | ''>('');
  const [dibuka, setDibuka] = React.useState(true);

  const muat = React.useCallback(async () => {
    try {
      const data = await fetchDjUsers(token);
      setUsers(data.users || []);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar panitia.');
    }
  }, [token]);

  React.useEffect(() => {
    void muat();
  }, [muat]);

  const onToggle = (open: boolean) => {
    setDibuka(open);
    if (open) void muat();
  };

  return (
    <details
      className="overflow-hidden rounded-xl bg-surface-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)] group"
      open={dibuka}
      onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:hidden">
        <span className="flex items-center gap-2.5">
          <Badge className="size-5 text-primary" aria-hidden />
          <span className="text-base font-bold text-on-surface">Akses Panitia</span>
          {users && users.length > 0 && (
            <span className="rounded-full bg-surface-4 px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">
              {users.length} Aktif
            </span>
          )}
        </span>
        <ChevronDown
          className="size-4 text-on-surface-variant transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="flex flex-col gap-1 border-t border-white/8 px-3 pb-3 pt-2">
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
          Kalau ada panitia yang lupa password, kamu bisa bikin password baru di sini tanpa
          perlu password lamanya. Sesi panitia yang sedang login langsung keluar.
        </p>

        <div className="grid gap-1" aria-live="polite">
          {error && <p className="px-1 py-1 text-sm text-destructive">{error}</p>}
          {users !== null && users.length === 0 && (
            <p className="px-1 py-1 text-sm text-muted-foreground">Belum ada akun panitia.</p>
          )}
          {users?.map((u) => (
            <PanitiaRow
              key={u.username}
              user={u}
              token={token}
              toast={toast}
              note={note}
              noteTone={noteTone}
              setNote={(pesan, tone) => {
                setNote(pesan);
                setNoteTone(tone);
              }}
              onChanged={() => void muat()}
            />
          ))}
        </div>

        {note && (
          <p
            role="alert"
            data-tone={noteTone}
            className="px-1 pt-1 text-sm font-medium data-[tone=error]:text-destructive data-[tone=ok]:text-primary data-[tone='']:text-muted-foreground"
          >
            {note}
          </p>
        )}
      </div>
    </details>
  );
}

function PanitiaRow({
  user,
  token,
  toast,
  setNote,
  onChanged,
}: {
  user: User;
  token: string;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  note: string;
  noteTone: 'ok' | 'error' | '';
  setNote: (pesan: string, tone: 'ok' | 'error' | '') => void;
  onChanged: () => void;
}) {
  const bisaReset = user.peran !== 'admin';
  const [buka, setBuka] = React.useState(false);
  const [baru, setBaru] = React.useState('');
  const [ulang, setUlang] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const admin = user.peran === 'admin';

  const kirim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (baru.length < 6) {
      setNote('Password baru minimal 6 karakter.', 'error');
      return;
    }
    if (baru !== ulang) {
      setNote('Password baru tidak sama di kedua kotak.', 'error');
      return;
    }
    setBusy(true);
    setNote(`Menyimpan password baru untuk ${user.username}…`, '');
    try {
      await resetPassword(token, user.username, baru);
      setNote(`Password ${user.username} diganti. Sesi dia di device lain sudah keluar.`, 'ok');
      setBuka(false);
      setBaru('');
      setUlang('');
      onChanged();
      toast(`Password ${user.username} direset.`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Gagal mereset password.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg transition-colors hover:bg-surface-3">
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={
              admin
                ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary'
                : 'flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-xs font-bold text-on-surface'
            }
            aria-hidden
          >
            {(user.nama || user.username).slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-on-surface">
              {user.nama || user.username}
            </span>
            {bisaReset ? (
              <button
                type="button"
                className="text-left text-[11px] text-primary hover:underline"
                onClick={() => setBuka((b) => !b)}
              >
                {buka ? 'Batal' : 'Reset password'}
              </button>
            ) : (
              <span className="text-[11px] text-on-surface-variant/70">Ganti sendiri</span>
            )}
          </div>
        </div>
        <span
          className={
            admin
              ? 'rounded bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary'
              : 'rounded bg-surface-4 px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant'
          }
        >
          {admin ? 'Super Admin' : 'Operator'}
        </span>
      </div>

      {bisaReset && buka && (
        <form onSubmit={kirim} className="grid gap-3 border-t border-white/8 p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`pwBaru_${user.username}`} className="text-xs">
              Password baru
            </Label>
            <Input
              id={`pwBaru_${user.username}`}
              type="password"
              minLength={6}
              autoComplete="new-password"
              required
              placeholder="minimal 6 karakter"
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`pwUlang_${user.username}`} className="text-xs">
              Ulangi password baru
            </Label>
            <Input
              id={`pwUlang_${user.username}`}
              type="password"
              minLength={6}
              autoComplete="new-password"
              required
              value={ulang}
              onChange={(e) => setUlang(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy} className="w-full rounded-full sm:w-auto">
              {busy ? 'Menyimpan…' : 'Simpan password baru'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
