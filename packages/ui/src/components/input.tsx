import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { fieldClasses, fieldHeights } from '../lib/field';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icône ou texte à gauche (ex. <Search />). */
  leading?: ReactNode;
  /** Élément à droite (unité, bouton…). */
  trailing?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, trailing, size = 'md', invalid, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(
        fieldClasses,
        fieldHeights[size],
        'px-3',
        leading ? 'ps-9' : undefined,
        trailing ? 'pe-10' : undefined,
        !leading && !trailing && className,
      )}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && (
        <span className="pointer-events-none absolute start-3 flex items-center text-fg-subtle [&_svg]:size-4">
          {leading}
        </span>
      )}
      {input}
      {trailing && (
        <span className="absolute end-2.5 flex items-center text-xs text-fg-subtle [&_svg]:size-4">{trailing}</span>
      )}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(fieldClasses, 'min-h-20 resize-y px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  );
});
