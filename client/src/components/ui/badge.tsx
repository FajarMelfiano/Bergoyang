import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors [&_svg]:pointer-events-none [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-surface-3 text-foreground',
        secondary: 'border-transparent bg-white/10 text-foreground',
        outline: 'border-white/20 text-muted-foreground',
        brand: 'border-transparent bg-primary/15 text-primary',
        success: 'border-transparent bg-success/15 text-primary',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type BadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants, type BadgeProps };
