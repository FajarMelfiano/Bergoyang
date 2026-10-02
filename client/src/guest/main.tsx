import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GuestApp } from '@/guest/GuestApp';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui/toast';
import '@/styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemen #root tidak ditemukan');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <GuestApp />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
