import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { buttonVariants } from '../lib/button-variants';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Rend l'enfant unique (ex. <a>, <Link>) avec le style du bouton. */
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, loading, leftIcon, rightIcon, disabled, children, type, ...props },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size, block }), loading && 'disabled:opacity-80', className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost: 'text-fg-muted hover:bg-surface-3 hover:text-fg',
        secondary: 'border border-border-strong bg-surface text-fg-muted shadow-xs hover:bg-surface-2 hover:text-fg',
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
        danger: 'text-fg-muted hover:bg-danger-soft hover:text-danger-soft-fg',
      },
      size: {
        xs: 'size-6 rounded-md [&_svg]:size-3.5',
        sm: 'size-8 rounded-lg [&_svg]:size-4',
        md: 'size-9 rounded-lg [&_svg]:size-[18px]',
        lg: 'size-11 rounded-xl [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Libellé accessible obligatoire (le bouton n'affiche qu'une icône). */
  label: string;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, loading, children, type, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
});
