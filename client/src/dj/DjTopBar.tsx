import * as React from 'react';
import { Disc3, KeyRound, LogOut, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PasswordDialog } from '@/components/password-dialog';
import { Wordmark } from '@/components/wordmark';
import { useSession } from '@/lib/session';
import type { ConnState } from '@/lib/useLiveState';

interface DjTopBarProps {
  open: boolean;
  conn: ConnState;
  onLogout: () => void;
}

const NAV = [
  { label: 'Live Queue', href: '/', active: false },
  { label: 'Song Catalog', href: '/#antrean', active: false },
  { label: 'DJ Console', href: '/dj', active: true },
] as const;

export function DjTopBar({ open, conn, onLogout }: DjTopBarProps) {
  const session = useSession();
  const connected = conn === 'tersambung';

  return (
    <header className="sticky top-0 z-50 bg-surface/90 shadow-[0_1px_8px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-8">
        <a href="/dj" className="flex shrink-0 items-center gap-2.5" aria-label="Skarisa Bergoyang">
          <span
            aria-hidden
            className="size-2.5 rounded-full bg-primary shadow-[0_0_10px_#1ed760] live-dot"
          />
          <Wordmark className="text-xl sm:text-2xl" />
        </a>

        <nav className="hidden items-center gap-4 md:flex" aria-label="Navigasi utama">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={
                item.active
                  ? 'rounded-full bg-surface-4 px-4 py-1.5 text-sm font-bold text-on-surface'
                  : 'rounded-full px-4 py-1.5 text-sm font-bold text-on-surface-variant transition-colors hover:text-on-surface'
              }
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <span
            data-state={connected && open ? 'open' : !connected ? 'reconnect' : 'closed'}
            className="hidden items-center gap-2 rounded-full bg-surface-3 px-4 py-1.5 sm:inline-flex"
          >
            <span
              aria-hidden
              className={`size-2 rounded-full ${
                connected && open
                  ? 'live-dot bg-primary'
                  : !connected
                    ? 'bg-warning'
                    : 'bg-muted-foreground/50'
              }`}
            />
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${
                connected && open ? 'text-primary' : !connected ? 'text-warning' : 'text-muted-foreground'
              }`}
            >
              {connected ? (open ? 'Accepting Requests' : 'Requests Closed') : 'Reconnecting…'}
            </span>
          </span>

          {session.status === 'authed' && session.user && (
            <UserMenu onLogout={onLogout} />
          )}
        </div>
      </div>
    </header>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const session = useSession();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const username = session.user?.username ?? '';
  const nama = session.user?.nama ?? username;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Akun ${nama}`}
            className="flex size-8 items-center justify-center rounded-full bg-primary text-black transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <User className="size-4.5" strokeWidth={2.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Masuk sebagai {nama} (admin)</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href="/">
              <Disc3 />
              Halaman tamu
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <KeyRound />
            Ganti password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onLogout}>
            <LogOut />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PasswordDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
