import * as React from 'react';
import { changePassword, fetchMe, login as apiLogin, SessionExpiredError, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

const USER_KEY = 'requestlagu.user';

export type SessionStatus = 'checking' | 'guest' | 'authed';

export interface SessionOptions {
  /** Kunci sessionStorage untuk token. Tamu: requestlagu.token; DJ: requestlagu.dj. */
  tokenKey?: string;
  /** Panel DJ: tolak login/boot untuk akun non-admin. */
  adminOnly?: boolean;
  /** Pesan toast setelah login berhasil. */
  welcome?: (me: User) => string;
  expireMessage?: string;
  logoutMessage?: string;
}

interface SessionValue {
  status: SessionStatus;
  user: User | null;
  token: string;
  /** Pesan ditolak (adminOnly) yang harus ditampilkan gerbang login. */
  notice: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  expire: (notify?: boolean) => void;
  changePassword: (lama: string, baru: string) => Promise<void>;
}

const SessionContext = React.createContext<SessionValue | null>(null);

function SessionProvider({
  children,
  tokenKey = 'requestlagu.token',
  adminOnly = false,
  welcome,
  expireMessage = 'Sesi habis — masuk ulang untuk request lagi.',
  logoutMessage = 'Kamu sudah keluar. Masuk lagi kapan saja.',
}: SessionOptions & { children: React.ReactNode }) {
  const { toast } = useToast();
  const [token, setToken] = React.useState<string>(() => sessionStorage.getItem(tokenKey) || '');
  const [user, setUser] = React.useState<User | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null') as User | null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = React.useState<SessionStatus>(() =>
    sessionStorage.getItem(tokenKey) ? 'checking' : 'guest',
  );
  const [notice, setNotice] = React.useState('');

  const clear = React.useCallback(() => {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(USER_KEY);
    setToken('');
    setUser(null);
    setStatus('guest');
  }, [tokenKey]);

  const expire = React.useCallback(
    (notify = true) => {
      clear();
      if (notify) toast(expireMessage, 'error');
    },
    [clear, toast, expireMessage],
  );

  React.useEffect(() => {
    const t = sessionStorage.getItem(tokenKey);
    if (!t) return;
    let batal = false;
    fetchMe(t)
      .then((me) => {
        if (batal) return;
        if (adminOnly && me.peran !== 'admin') {
          clear();
          setNotice(
            `Kamu masuk sebagai ${me.nama}, tapi panel DJ hanya untuk admin. Request lagu lewat halaman tamu ya.`,
          );
          return;
        }
        setUser(me);
        setToken(t);
        setStatus('authed');
        sessionStorage.setItem(USER_KEY, JSON.stringify(me));
      })
      .catch(() => {
        // token hangus / server tidak bisa dihubungi (mis. 502) → tidak bisa
        // divalidasi; sama seperti aplikasi lama: bersihkan sesi, gerbang tampil
        if (batal) return;
        expire(false);
      });
    return () => {
      batal = true;
    };
  }, [tokenKey, adminOnly, clear, expire]);

  const login = React.useCallback(
    async (username: string, password: string) => {
      setNotice('');
      const data = await apiLogin(username, password);
      const me: User = { username: data.username, nama: data.nama, peran: data.peran };
      if (adminOnly && me.peran !== 'admin') {
        // panel DJ admin-only: token tidak disimpan, gerbang menampilkan pesan
        setNotice(
          `Kamu masuk sebagai ${me.nama}, tapi panel DJ hanya untuk admin. Request lagu lewat halaman tamu ya.`,
        );
        throw new ApiError('Panel DJ hanya untuk admin.', 403);
      }
      sessionStorage.setItem(tokenKey, data.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(me));
      setToken(data.token);
      setUser(me);
      setStatus('authed');
      toast(welcome ? welcome(me) : `Halo ${me.username}! Kamu bisa request lagu sekarang.`);
    },
    [adminOnly, tokenKey, toast, welcome],
  );

  const logout = React.useCallback(() => {
    clear();
    setNotice('');
    toast(logoutMessage);
  }, [clear, toast, logoutMessage]);

  const gantiPassword = React.useCallback(
    async (lama: string, baru: string) => {
      try {
        const data = await changePassword(token, lama, baru);
        sessionStorage.setItem(tokenKey, data.token);
        setToken(data.token);
        toast('Password diganti.');
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          expire();
          return;
        }
        throw err;
      }
    },
    [token, tokenKey, toast, expire],
  );

  const value = React.useMemo<SessionValue>(
    () => ({ status, user, token, notice, login, logout, expire, changePassword: gantiPassword }),
    [status, user, token, notice, login, logout, expire, gantiPassword],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession harus dipakai di dalam SessionProvider');
  return ctx;
}

export { SessionProvider, useSession };
