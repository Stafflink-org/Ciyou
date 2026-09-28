import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { fieldClasses, fieldHeights } from '../lib/field';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Mots-clés supplémentaires pris en compte par la recherche. */
  keywords?: string[];
}

interface BaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export interface ComboboxProps extends BaseProps {
  value?: string;
  onChange: (value: string | undefined) => void;
}

export interface MultiComboboxProps extends BaseProps {
  value: string[];
  onChange: (value: string[]) => void;
  multiple: true;
}

/** Liste déroulante avec recherche (sélection simple ou multiple). */
export function Combobox(props: ComboboxProps | MultiComboboxProps) {
  const {
    options,
    placeholder = 'Sélectionner…',
    searchPlaceholder = 'Rechercher…',
    emptyText = 'Aucun résultat.',
    disabled,
    className,
    id,
  } = props;
  const [open, setOpen] = useState(false);
  const multiple = 'multiple' in props;
  const selected: string[] = multiple ? props.value : props.value ? [props.value] : [];

  const selectedLabels = options.filter((option) => selected.includes(option.value)).map((option) => option.label);
  const display =
    selectedLabels.length === 0
      ? null
      : multiple && selectedLabels.length > 2
        ? `${selectedLabels.length} sélectionnés`
        : selectedLabels.join(', ');

  function toggle(value: string) {
    if ('multiple' in props) {
      props.onChange(props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
    } else {
      props.onChange(props.value === value ? undefined : value);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={props['aria-label']}
          data-empty={!display}
          className={cn(
            fieldClasses,
            fieldHeights.md,
            'flex items-center justify-between gap-2 px-3 text-start data-[empty=true]:text-fg-subtle',
            className,
          )}
        >
          <span className="truncate">{display ?? placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command className="flex flex-col" loop>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" />
            <Command.Input
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-subtle">{emptyText}</Command.Empty>
            {options.map((option) => {
              const isSelected = selected.includes(option.value);
              return (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  onSelect={() => toggle(option.value)}
                  className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-surface-3 [&_svg]:size-4"
                >
                  {multiple ? (
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded border',
                        isSelected ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
                      )}
                    >
                      {isSelected && <Check className="size-3! stroke-3" />}
                    </span>
                  ) : null}
                  {option.icon && <span className="text-fg-subtle">{option.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && <span className="block truncate text-xs text-fg-subtle">{option.description}</span>}
                  </span>
                  {!multiple && isSelected && <Check className="text-primary" />}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
