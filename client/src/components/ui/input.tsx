import * as React from 'react';
import { cn } from '@/lib/utils';

type InputProps = React.ComponentProps<'input'>;

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full min-w-0 rounded-lg border border-white/12 bg-surface-3 px-4 text-base text-foreground shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'hover:border-white/25',
        'focus-visible:border-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export { Input, type InputProps };
