import * as React from 'react';
import { MapPin, Mosque, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError, djClearAll, djClearDone, patchEvent } from '@/lib/api';
import type { AppState } from '@/lib/types';
import { ADZAN_NAMA } from '@/dj/useAdzanDj';
import type { AdzanController } from '@/dj/useAdzanDj';

interface SettingsBoxProps {
  state: AppState;
  token: string;
  adzan: AdzanController;
  toast: (message: string, tone?: 'ok' | 'error') => void;
}

const TOGGLES: {
  key: 'open' | 'autoApprove' | 'allowVotes' | 'allowMessages';
  label: string;
  hint: string;
}[] = [
  { key: 'open', label: 'Buka request tamu', hint: 'Penonton bisa mengirim slip request' },
  { key: 'autoApprove', label: 'Setujui otomatis', hint: 'Request langsung masuk antrean' },
  { key: 'allowVotes', label: 'Voting antrean', hint: 'Tamu bisa vote lagu favorit' },
  { key: 'allowMessages', label: 'Pesan/dedikasi', hint: 'Tamu bisa melampirkan pesan' },
];

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Terjadi kesalahan.';
}

export function SettingsBox({ state, token, adzan, toast }: SettingsBoxProps) {
  const [nama, setNama] = React.useState(state.event.name);
  const [tagline, setTagline] = React.useState(state.event.tagline);
  const [vals, setVals] = React.useState({
    open: state.event.open,
    autoApprove: state.event.autoApprove,
    allowVotes: state.event.allowVotes,
    allowMessages: state.event.allowMessages,
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setVals({
      open: state.event.open,
      autoApprove: state.event.autoApprove,
      allowVotes: state.event.allowVotes,
      allowMessages: state.event.allowMessages,
    });
  }, [
    state.event.open,
    state.event.autoApprove,
    state.event.allowVotes,
    state.event.allowMessages,
  ]);

  const simpan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await patchEvent(token, { name: nama.trim(), tagline: tagline.trim() });
      toast('Pengaturan disimpan.');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (key: (typeof TOGGLES)[number]['key'], next: boolean) => {
    const sebelum = vals[key];
    setVals((v) => ({ ...v, [key]: next }));
    try {
      await patchEvent(token, { [key]: next });
    } catch (err) {
      setVals((v) => ({ ...v, [key]: sebelum }));
      toast(errText(err), 'error');
    }
  };

  const bersihRiwayat = async () => {
    try {
      await djClearDone(token);
      toast('Riwayat dibersihkan.');
    } catch (err) {
      toast(errText(err), 'error');
    }
  };

  const kosongkanSemua = async () => {
    if (!window.confirm('Kosongkan semua request selain yang sedang diputar?')) return;
    try {
      await djClearAll(token);
      toast('Antrean dikosongkan.');
    } catch (err) {
      toast(errText(err), 'error');
    }
  };

  return (
    <section
      aria-labelledby="settingsTitle"
      className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Settings2 className="size-5 text-primary" aria-hidden />
          <h3 id="settingsTitle" className="text-base font-bold text-on-surface">
            Pengaturan Sesi
          </h3>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          Live
        </span>
      </header>

      {/* input acara */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="evName" className="text-xs font-medium text-on-surface-variant">
          Nama Acara &amp; Catatan
        </Label>
        <Input
          id="evName"
          maxLength={60}
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          className="border-0 bg-surface-3 focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Input
          id="evTagline"
          aria-label="Tagline"
          maxLength={60}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Tagline"
          className="border-0 bg-surface-3 text-on-surface-variant focus-visible:ring-2 focus-visible:ring-primary focus-visible:text-on-surface"
        />
        <Button
          type="button"
          disabled={busy}
          onClick={() => void simpan()}
          className="mt-2 w-full rounded-full font-bold shadow-md"
        >
          {busy ? 'Menyimpan…' : 'Simpan Pengaturan'}
        </Button>
      </div>

      {/* toggles rapi tanpa kotak */}
      <div className="flex flex-col gap-3.5 py-1">
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex items-start justify-between gap-4">
            <span className="grid gap-0.5">
              <span className="text-sm text-on-surface">{t.label}</span>
              <span className="text-[11px] text-on-surface-variant/70">{t.hint}</span>
            </span>
            <Switch
              checked={vals[t.key]}
              onCheckedChange={(v) => void toggle(t.key, v)}
              aria-label={t.label}
              className="shrink-0"
            />
          </div>
        ))}
      </div>

      {/* adzan otomatis */}
      <div className="flex flex-col gap-3 rounded-lg bg-surface-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
            <Mosque className="size-4 text-primary" aria-hidden />
            Adzan otomatis
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-on-surface-variant">
            <Switch
              checked={adzan.enabled}
              onCheckedChange={(v) => void adzan.setEnabled(v)}
              aria-label="Aktifkan jeda adzan"
            />
            Jeda otomatis
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Pemutar utama jeda sendiri saat adzan masuk, dan lanjut otomatis setelah selesai.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5 rounded-full"
            disabled={adzan.busy}
            onClick={() => void adzan.aturDariLokasi()}
          >
            <MapPin className="size-3.5" aria-hidden />
            {adzan.busy ? 'Memuat…' : 'Atur dari lokasi saya'}
          </Button>
          <label className="flex items-center gap-2 text-xs text-on-surface-variant">
            Lama jeda (menit)
            <Input
              id="adzanDurasi"
              type="number"
              min={1}
              max={60}
              step={1}
              value={adzan.durasi}
              onChange={(e) => void adzan.setDurasi(Number(e.target.value))}
              className="h-8 w-16 border-0 bg-surface-4 text-center focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
        </div>

        {adzan.jadwal ? (
          <div className="grid gap-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Jadwal hari ini
            </p>
            {Object.entries(adzan.jadwal).map(([key, jam]) => (
              <div
                key={key}
                className="flex justify-between border-b border-white/8 py-1 text-xs last:border-0"
              >
                <span className="text-on-surface-variant">{ADZAN_NAMA[key] || key}</span>
                <b className="font-mono text-primary">{jam}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Jadwal belum diatur. Tekan “Atur dari lokasi saya” (butuh izin lokasi browser).
          </p>
        )}

        {adzan.note && (
          <p
            role="alert"
            data-tone={adzan.noteTone}
            className="text-xs font-medium data-[tone=error]:text-destructive data-[tone=ok]:text-primary data-[tone='']:text-muted-foreground"
          >
            {adzan.note}
          </p>
        )}
      </div>

      {/* aksi berbahaya ala ref */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={() => void bersihRiwayat()}
          className="w-1/2 rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
        >
          Bersihkan Riwayat
        </button>
        <button
          type="button"
          onClick={() => void kosongkanSemua()}
          className="w-1/2 rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
        >
          Kosongkan Antrean
        </button>
      </div>
    </section>
  );
}
