import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { DropdownMenu as MenuPrimitive, Popover as PopoverPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

const floatingPanel =
  'z-50 rounded-xl border border-border bg-elevated text-fg shadow-lg outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

/* ---------------------------------------------------------------- Popover */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(floatingPanel, 'w-72 p-4', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ---------------------------------------------------------------- Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Désactive l'infobulle sans changer l'arbre (ex. sidebar dépliée). */
  disabled?: boolean;
  delayDuration?: number;
}

/** Infobulle simple ; l'enfant doit pouvoir recevoir une ref (bouton, lien…). */
export function Tooltip({ content, children, side = 'top', align = 'center', disabled, delayDuration }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 max-w-xs rounded-md bg-contrast px-2 py-1 text-xs font-medium text-contrast-fg shadow-md',
            'data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ----------------------------------------------------------- DropdownMenu */

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(floatingPanel, 'min-w-48 p-1', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClasses = cn(
  'relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none',
  'data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle',
);

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
}

export function DropdownMenuItem({ className, icon, shortcut, destructive, children, ...props }: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        itemClasses,
        destructive && 'text-danger-soft-fg data-highlighted:bg-danger-soft [&_svg]:text-current',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <kbd className="font-mono text-2xs text-fg-subtle">{shortcut}</kbd>}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClasses, 'ps-8', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute start-2 flex items-center">
        <Check className="text-primary!" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClasses, 'ps-8', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute start-2.5 flex items-center">
        <span className="size-2 rounded-full bg-primary" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn('eyebrow px-2 pb-1 pt-2', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  icon,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger> & { icon?: ReactNode }) {
  return (
    <MenuPrimitive.SubTrigger className={cn(itemClasses, 'data-[state=open]:bg-surface-3', className)} {...props}>
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight className="rtl:-scale-x-100" />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent className={cn(floatingPanel, 'min-w-44 p-1', className)} {...props} />
    </MenuPrimitive.Portal>
  );
}
