import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useSession();
  const [lama, setLama] = React.useState('');
  const [baru, setBaru] = React.useState('');
  const [baru2, setBaru2] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reset = () => {
    setLama('');
    setBaru('');
    setBaru2('');
    setNote('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (baru !== baru2) {
      setNote('Password baru tidak sama di kedua kotak.');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      await session.changePassword(lama, baru);
      onOpenChange(false);
      reset();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Gagal mengganti password.');
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    if (!open) reset();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ganti password saya</DialogTitle>
          <DialogDescription>
            Password baru langsung dipakai untuk masuk berikutnya.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="passLama">Password lama</Label>
            <Input
              id="passLama"
              type="password"
              autoComplete="current-password"
              required
              value={lama}
              onChange={(e) => setLama(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="passBaru">Password baru</Label>
            <Input
              id="passBaru"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              placeholder="minimal 6 karakter"
              value={baru}
              onChange={(e) => setBaru(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="passBaru2">Ulangi password baru</Label>
            <Input
              id="passBaru2"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              value={baru2}
              onChange={(e) => setBaru2(e.target.value)}
            />
          </div>

          {note && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {note}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? 'Menyimpan…' : 'Ganti password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
