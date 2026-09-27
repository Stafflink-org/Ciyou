import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
} from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '../lib/cn';

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
}

/** Case à cocher, avec libellé optionnel ; gère l'état indéterminé. */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={controlId}
      className={cn(
        'peer grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-border-strong bg-surface shadow-xs',
        'transition-colors duration-150 hover:border-fg-subtle',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
        !label && className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group grid place-items-center">
        <Check className="size-3.5 stroke-3 group-data-[state=indeterminate]:hidden" />
        <Minus className="hidden size-3.5 stroke-3 group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <div className="pt-px">{box}</div>
      <label htmlFor={controlId} className="cursor-pointer select-none text-sm leading-5">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </label>
    </div>
  );
});

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md';
}

/** Interrupteur on/off, libellé optionnel à gauche. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, label, description, id, size = 'md', ...props },
  ref,
) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={controlId}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full bg-border-strong transition-colors duration-200',
        'data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-[22px] w-[38px]' : 'h-[18px] w-[30px]',
        !label && className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out',
          size === 'md'
            ? 'size-[18px] translate-x-0.5 data-[state=checked]:translate-x-[18px] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[18px]'
            : 'size-3.5 translate-x-0.5 data-[state=checked]:translate-x-3.5 rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <label htmlFor={controlId} className="cursor-pointer select-none text-sm leading-5">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </label>
      {control}
    </div>
  );
});

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps
  extends Omit<ComponentPropsWithoutRef<typeof RadioPrimitive.Root>, 'children'> {
  options: RadioOption[];
  /** « cards » : options présentées en tuiles sélectionnables. */
  variant?: 'default' | 'cards';
}

export function RadioGroup({ options, variant = 'default', className, ...props }: RadioGroupProps) {
  const baseId = useId();
  return (
    <RadioPrimitive.Root
      className={cn(variant === 'cards' ? 'grid gap-2.5 sm:grid-cols-2' : 'flex flex-col gap-2.5', className)}
      {...props}
    >
      {options.map((option) => {
        const id = `${baseId}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 text-sm',
              variant === 'cards' &&
                'rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-border-strong has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft/50',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <RadioPrimitive.Item
              id={id}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                'mt-px grid size-[18px] shrink-0 place-items-center rounded-full border border-border-strong bg-surface shadow-xs',
                'data-[state=checked]:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <RadioPrimitive.Indicator className="size-2 rounded-full bg-primary" />
            </RadioPrimitive.Item>
            <span className="leading-5">
              <span className="font-medium text-fg">{option.label}</span>
              {option.description && <span className="block text-xs text-fg-subtle">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </RadioPrimitive.Root>
  );
}

export interface SliderProps extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Formate la valeur affichée au survol du curseur (et lue par les lecteurs d'écran). */
  formatValue?: (value: number) => string;
}

export function Slider({ className, formatValue, value, defaultValue, ...props }: SliderProps) {
  const values = value ?? defaultValue ?? [0];
  return (
    <SliderPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      className={cn('relative flex h-5 w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((current, index) => (
        <SliderPrimitive.Thumb
          key={index}
          aria-valuetext={formatValue ? formatValue(current) : undefined}
          className={cn(
            'group relative block size-[18px] rounded-full border-2 border-primary bg-white shadow-sm transition-transform',
            'hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25',
          )}
        >
          {formatValue && (
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-contrast px-1.5 py-0.5 font-mono text-2xs text-contrast-fg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {formatValue(current)}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  );
}
