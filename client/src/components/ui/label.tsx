import * as React from 'react';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
