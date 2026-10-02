import * as React from 'react';
import { AudioLines, Headphones, Loader2 } from 'lucide-react';
import { Hero } from '@/guest/Hero';
import { LoginGate } from '@/guest/LoginGate';
import { QueuePanel } from '@/guest/QueuePanel';
import { RequestPanel } from '@/guest/RequestPanel';
import { TopBar } from '@/guest/TopBar';
import { useAdzan } from '@/guest/adzan';
import { useSession } from '@/lib/session';
import { useLiveState } from '@/lib/useLiveState';

export function GuestApp() {
  const session = useSession();
  const { state, conn, beat } = useLiveState();
  const adzan = useAdzan();

  React.useEffect(() => {
    if (state) document.title = state.event.name;
  }, [state]);

  const authed = session.status === 'authed';
  const open = state?.event.open ?? true;

  if (session.status === 'checking') {
    return (
      <div className="flex min-h-dvh flex-col">
        <TopBar open={open} conn={conn} />
        <Loading label="Memeriksa sesi…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar open={open} conn={conn} />

      {!authed ? (
        <LoginGate />
      ) : state ? (
        <>
          <Hero state={state} adzan={adzan} beat={beat} />
          <main className="flex w-full flex-1 flex-col gap-8 px-4 py-8 sm:px-8">
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <RequestPanel state={state} queueOrder={state.order} />
              </div>
              <div className="lg:col-span-8">
                <QueuePanel state={state} />
              </div>
            </div>
          </main>
          <EventFooter />
          <SiteFooter />
        </>
      ) : (
        <Loading label="Memuat antrean…" />
      )}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}

function EventFooter() {
  return (
    <footer className="w-full">
      <div className="flex w-full flex-col items-center justify-between gap-2 px-4 pb-4 pt-6 text-xs text-on-surface-variant sm:flex-row sm:px-8">
        <span className="flex items-center gap-2">
          <Headphones className="size-[18px] text-primary" aria-hidden />
          Skarisa Bergoyang • Live Request Sound System Booth
        </span>
        <span className="flex items-center gap-4">
          <span>
            Dikelola oleh <strong className="font-semibold text-on-surface">DJ Alvi</strong>
          </span>
          <span aria-hidden>•</span>
          <span>Table #12 Active</span>
        </span>
      </div>
    </footer>
  );
}

function SiteFooter() {
  const tahun = new Date().getFullYear();
  return (
    <footer className="w-full bg-[#0e0e0e]">
      <div className="flex w-full flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-8">
        <span className="flex items-center gap-2 text-xs text-on-surface-variant">
          <AudioLines className="size-[18px] text-primary" aria-hidden />
          Skarisa Bergoyang • Powered by Spotify Web Player Engine
        </span>
        <span className="text-xs text-on-surface-variant">
          © {tahun} Skarisa Bergoyang. All music metadata and rights reserved.
        </span>
      </div>
    </footer>
  );
}
