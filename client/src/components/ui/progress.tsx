import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
};

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-white/15',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'h-full w-full flex-1 rounded-full bg-primary transition-transform duration-150',
          indicatorClassName,
        )}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress, type ProgressProps };
