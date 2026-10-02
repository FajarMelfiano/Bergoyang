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

interface TopBarProps {
  open: boolean;
  conn: string;
}

const NAV = [
  { label: 'Live Queue', href: '/', active: true },
  { label: 'Song Catalog', href: '#antrean', active: false },
  { label: 'DJ Console', href: '/dj', active: false },
] as const;

export function TopBar({ open, conn }: TopBarProps) {
  const session = useSession();
  const connected = conn === 'tersambung';

  return (
    <header className="sticky top-0 z-50 bg-surface/90 shadow-[0_1px_8px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-8">
        <a href="/" className="flex shrink-0 items-center gap-3" aria-label="Skarisa Bergoyang">
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

          {session.status === 'authed' && session.user && <UserMenu />}
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const session = useSession();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const username = session.user?.username ?? '';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Akun ${username}`}
            className="flex size-8 items-center justify-center rounded-full bg-primary text-black transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <User className="size-4.5" strokeWidth={2.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Masuk sebagai {username}</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href="/dj">
              <Disc3 />
              Panel DJ
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <KeyRound />
            Ganti password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => session.logout()}>
            <LogOut />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PasswordDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
