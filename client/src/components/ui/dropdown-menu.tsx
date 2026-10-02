import * as React from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function DropdownMenu({ ...props }: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Portal>) {
  return <MenuPrimitive.Portal {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-xl border border-white/10 bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/50',
          'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none transition-colors',
        'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none transition-colors',
        'focus:bg-accent data-[highlighted]:bg-accent',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden>
            <path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0Z" />
          </svg>
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioGroup>) {
  return <MenuPrimitive.RadioGroup {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none transition-colors',
        'focus:bg-accent data-[highlighted]:bg-accent',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-2" aria-hidden>
            <circle cx="8" cy="8" r="8" />
          </svg>
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1.5 my-1.5 h-px bg-border', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof MenuPrimitive.Sub>) {
  return <MenuPrimitive.Sub {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        'flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm outline-none',
        'focus:bg-accent data-[highlighted]:bg-accent data-[state=open]:bg-accent',
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {children}
      <svg viewBox="0 0 16 16" className="ml-auto size-4" aria-hidden>
        <path
          d="M6 3l5 5-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </MenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-xl border border-white/10 bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/50',
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
