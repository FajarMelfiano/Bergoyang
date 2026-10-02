import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-brand-hover active:bg-brand-active',
        secondary: 'bg-surface-3 text-foreground hover:bg-surface-4',
        outline:
          'border border-white/25 text-foreground hover:border-white/40 hover:bg-white/10',
        ghost: 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-4 text-xs',
        md: 'h-10 px-6',
        lg: 'h-12 px-8 text-base',
        icon: 'size-10 p-0',
        'icon-sm': 'size-8 p-0',
        'icon-lg': 'size-14 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
