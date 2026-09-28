import { cn } from './cn';

/** Classes communes aux champs de saisie (réutilisées par Select, DatePicker…). */
export const fieldClasses = cn(
  'w-full min-w-0 rounded-lg border border-border-strong bg-surface text-sm text-fg shadow-xs',
  'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150',
  'hover:border-fg-subtle/50',
  'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20',
);

export const fieldHeights = { sm: 'h-8', md: 'h-9', lg: 'h-11 text-base' } as const;
