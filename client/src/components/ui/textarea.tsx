import * as React from 'react';
import { cn } from '@/lib/utils';

type TextareaProps = React.ComponentProps<'textarea'>;

function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full rounded-lg border border-white/12 bg-surface-3 px-4 py-3 text-base text-foreground shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'hover:border-white/25',
        'focus-visible:border-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea, type TextareaProps };
