import { forwardRef, type ReactNode } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { fieldClasses, fieldHeights } from '../lib/field';

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Liste déroulante accessible (Radix Select), options passées en tableau. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    defaultValue,
    onValueChange,
    options,
    placeholder = 'Sélectionner…',
    disabled,
    invalid,
    size = 'md',
    className,
    name,
    ...aria
  },
  ref,
) {
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        {...aria}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldClasses,
          fieldHeights[size],
          'flex items-center justify-between gap-2 px-3 text-start data-placeholder:text-fg-subtle [&>span]:truncate',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-fg-subtle" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
            'rounded-xl border border-border bg-elevated p-1 text-fg shadow-lg',
            'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          )}
        >
          <SelectPrimitive.Viewport className="p-0.5">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 ps-2 pe-8 text-sm outline-none',
                  'data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:opacity-50',
                  '[&_svg]:size-4 [&_svg]:text-fg-subtle',
                )}
              >
                {option.icon}
                <div className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description && <p className="text-xs text-fg-subtle">{option.description}</p>}
                </div>
                <SelectPrimitive.ItemIndicator className="absolute end-2 flex items-center">
                  <Check className="text-primary!" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
