import * as React from 'react';
import { cn } from '@/lib/utils';

type ToastTone = 'ok' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = React.useState<ToastItem | null>(null);
  const timerRef = React.useRef<number | undefined>(undefined);

  const toast = React.useCallback((message: string, tone: ToastTone = 'ok') => {
    window.clearTimeout(timerRef.current);
    setItem({ id: nextId++, message, tone });
    timerRef.current = window.setTimeout(() => setItem(null), 3400);
  }, []);

  React.useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      >
        {item && (
          <div
            key={item.id}
            role="status"
            data-tone={item.tone}
            className={cn(
              'pointer-events-auto max-w-[min(92vw,28rem)] rounded-full border px-5 py-3 text-sm font-semibold shadow-2xl shadow-black/50',
              'animate-in fade-in-0 slide-in-from-bottom-4 duration-300',
              item.tone === 'ok'
                ? 'border-white/10 bg-surface-3 text-foreground'
                : 'border-destructive/40 bg-destructive text-destructive-foreground',
            )}
          >
            {item.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus dipakai di dalam ToastProvider');
  return ctx;
}

export { ToastProvider, useToast };
