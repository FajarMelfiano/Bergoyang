import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DjApp } from '@/dj/DjApp';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui/toast';
import '@/styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemen #root tidak ditemukan');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider
        tokenKey="requestlagu.dj"
        adminOnly
        welcome={(me) =>
          `Masuk sebagai ${me.nama}. Tekan "Jadikan ini pemutar utama" di device yang akan memutar lagu.`
        }
        expireMessage="Sesi DJ berakhir. Masuk ulang."
        logoutMessage="Kamu sudah keluar dari panel DJ."
      >
        <DjApp />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
