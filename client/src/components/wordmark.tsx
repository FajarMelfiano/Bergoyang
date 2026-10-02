interface WordmarkProps {
  className?: string;
}

/**
 * Wordmark teks murni (tanpa logo gambar) — gaya judul aplikasi:
 * skrip Grand Hotel, putih dengan aksen hijau pada kata kedua.
 */
export function Wordmark({ className = '' }: WordmarkProps) {
  return (
    <span
      className={`font-script leading-none tracking-wide select-none ${className}`}
      aria-label="Skarisa Bergoyang"
    >
      <span className="text-foreground">Skarisa</span>{' '}
      <span className="text-brand">Bergoyang</span>
    </span>
  );
}
