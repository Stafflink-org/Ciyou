import { cloneElement, isValidElement, useId, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';
import { Label as LabelPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export interface LabelProps extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  required?: boolean;
}

export function Label({ className, children, required, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn('inline-flex items-center gap-1 text-sm font-medium text-fg', className)}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="text-primary">
          *
        </span>
      )}
    </LabelPrimitive.Root>
  );
}

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  invalid?: boolean;
}

export interface FormFieldProps {
  label?: ReactNode;
  /** Texte d'aide affiché sous le champ. */
  hint?: ReactNode;
  /** Message d'erreur : remplace l'aide et marque le champ invalide. */
  error?: ReactNode;
  required?: boolean;
  /** Élément placé à droite du libellé (compteur, lien…). */
  aside?: ReactNode;
  className?: string;
  /** Contrôle unique : reçoit id, aria-describedby et aria-invalid. */
  children: ReactElement<ControlProps>;
}

/** Enveloppe libellé + contrôle + aide/erreur, câblée pour l'accessibilité. */
export function FormField({ label, hint, error, required, aside, className, children }: FormFieldProps) {
  const autoId = useId();
  const controlId = (isValidElement(children) && children.props.id) || autoId;
  const messageId = `${controlId}-message`;
  const message = error ?? hint;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': message ? messageId : undefined,
        invalid: error ? true : children.props.invalid,
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-3">
          {label && (
            <Label htmlFor={controlId} required={required}>
              {label}
            </Label>
          )}
          {aside && <div className="text-xs text-fg-subtle">{aside}</div>}
        </div>
      )}
      {control}
      {message && (
        <p id={messageId} className={cn('text-xs', error ? 'text-danger-soft-fg' : 'text-fg-subtle')}>
          {message}
        </p>
      )}
    </div>
  );
}
