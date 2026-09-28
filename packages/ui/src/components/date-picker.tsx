import { useState, type ComponentProps } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { fr } from 'react-day-picker/locale';
import { endOfMonth, format, startOfMonth, subDays, subMonths } from 'date-fns';
import { fr as frDateFns } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '../lib/cn';
import { fieldClasses, fieldHeights } from '../lib/field';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';

export type { DateRange };

type CalendarProps = ComponentProps<typeof DayPicker>;

/** Calendrier mensuel en français, semaines commençant le lundi. */
export function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={fr}
      weekStartsOn={1}
      showOutsideDays
      className={cn('p-1', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'space-y-3',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'font-display text-sm font-semibold capitalize tracking-tight text-fg',
        nav: 'absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between',
        button_previous:
          'grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40',
        button_next: 'grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 pb-1 font-mono text-3xs font-medium uppercase tracking-wider text-fg-subtle',
        week: 'mt-0.5 flex w-full',
        day: 'group relative size-9 p-0 text-center text-sm',
        day_button: cn(
          'relative z-10 grid size-9 place-items-center rounded-lg font-medium text-fg transition-colors num',
          'hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-ring',
          'group-data-selected:bg-primary group-data-selected:text-primary-fg group-data-selected:hover:bg-primary-hover',
          'group-[.rdp-range_middle]:rounded-none group-[.rdp-range_middle]:bg-transparent group-[.rdp-range_middle]:text-fg',
        ),
        range_start: 'rdp-range_start bg-primary-soft rounded-s-lg',
        range_middle: 'rdp-range_middle bg-primary-soft',
        range_end: 'rdp-range_end bg-primary-soft rounded-e-lg',
        today: 'font-semibold [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-border-strong',
        outside: 'opacity-40',
        disabled: 'pointer-events-none opacity-30',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <ChevronLeft className="size-4 rtl:-scale-x-100" /> : <ChevronRight className="size-4 rtl:-scale-x-100" />,
      }}
      {...props}
    />
  );
}

const triggerClasses = cn(
  fieldClasses,
  fieldHeights.md,
  'inline-flex items-center gap-2 px-3 text-start data-[empty=true]:text-fg-subtle',
);

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Dates non sélectionnables (ex. { before: new Date() }). */
  disabledDays?: CalendarProps['disabled'];
}

export function DatePicker({ value, onChange, placeholder = 'Choisir une date', disabled, className, id, disabledDays }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" id={id} data-empty={!value} className={cn(triggerClasses, className)}>
          <CalendarDays className="size-4 shrink-0 text-fg-subtle" />
          <span className="truncate">{value ? format(value, 'd MMMM yyyy', { locale: frDateFns }) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <Calendar
          mode="single"
          selected={value}
          disabled={disabledDays}
          defaultMonth={value}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface RangePreset {
  label: string;
  range: () => DateRange;
}

const defaultPresets: RangePreset[] = [
  { label: 'Aujourd’hui', range: () => ({ from: new Date(), to: new Date() }) },
  { label: '7 derniers jours', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: '30 derniers jours', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: 'Ce mois-ci', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  {
    label: 'Mois dernier',
    range: () => {
      const previous = subMonths(new Date(), 1);
      return { from: startOfMonth(previous), to: endOfMonth(previous) };
    },
  },
];

export interface DateRangePickerProps {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  presets?: RangePreset[];
}

function formatRange(range?: DateRange): string | null {
  if (!range?.from) return null;
  const from = format(range.from, 'd MMM yyyy', { locale: frDateFns });
  if (!range.to || range.to.getTime() === range.from.getTime()) return from;
  return `${format(range.from, 'd MMM', { locale: frDateFns })} – ${format(range.to, 'd MMM yyyy', { locale: frDateFns })}`;
}

/** Sélecteur de période avec raccourcis (7 jours, mois en cours…). */
export function DateRangePicker({ value, onChange, placeholder = 'Choisir une période', className, presets = defaultPresets }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const label = formatRange(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-empty={!label} className={cn(triggerClasses, 'w-auto min-w-56', className)}>
          <CalendarDays className="size-4 shrink-0 text-fg-subtle" />
          <span className="truncate">{label ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  onChange(preset.range());
                  setOpen(false);
                }}
                className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-start text-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="p-3">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={value}
              defaultMonth={value?.from ?? subMonths(new Date(), 1)}
              onSelect={onChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface TimeInputProps {
  value?: string;
  onChange: (value: string) => void;
  /** Pas en minutes (15 par défaut pour les créneaux d'ouverture). */
  step?: number;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/** Saisie d'heure « HH:mm » (horaires d'ouverture, créneaux de planning). */
export function TimeInput({ value, onChange, step = 15, min, max, disabled, className, id, ...aria }: TimeInputProps) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Clock className="pointer-events-none absolute start-3 size-4 text-fg-subtle" />
      <input
        id={id}
        type="time"
        value={value ?? ''}
        step={step * 60}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          fieldClasses,
          fieldHeights.md,
          'ps-9 pe-3 num [&::-webkit-calendar-picker-indicator]:hidden',
        )}
        {...aria}
      />
    </div>
  );
}
