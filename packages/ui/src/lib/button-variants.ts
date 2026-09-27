import { cva } from 'class-variance-authority';

/** Styles de bouton, réutilisables sur un lien ou tout autre élément. */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-primary-hover',
        contrast: 'bg-contrast text-contrast-fg shadow-xs hover:bg-contrast-hover',
        secondary:
          'border border-border-strong bg-surface text-fg shadow-xs hover:border-fg-subtle/60 hover:bg-surface-2',
        soft: 'bg-primary-soft text-primary-soft-fg hover:bg-primary-soft/70',
        ghost: 'text-fg-muted hover:bg-surface-3 hover:text-fg',
        danger: 'bg-danger text-danger-fg shadow-xs hover:bg-danger-hover',
        'danger-soft': 'bg-danger-soft text-danger-soft-fg hover:brightness-95',
        link: 'h-auto! px-0! text-primary-soft-fg underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 rounded-md px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-8 rounded-lg px-3 text-sm [&_svg]:size-4',
        md: 'h-9 rounded-lg px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-11 rounded-xl px-5 text-base [&_svg]:size-[18px]',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
