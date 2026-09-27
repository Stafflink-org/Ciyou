import { useMemo } from 'react';
import { endOfMonth, startOfMonth, startOfYear, subMonths } from 'date-fns';
import { DateRangePicker, SegmentedControl, cn } from '@golink/ui';
import { useAuth, usePersistentState } from '@golink/web';
import { dayKey, parseDay, resolvePeriod, type PeriodValue, type ResolvedPeriod } from '../lib/period';

const QUICK = [
  { value: '7d', label: '7 j' },
  { value: '30d', label: '30 j' },
  { value: '90d', label: '90 j' },
  { value: '12m', label: '12 mois' },
];

const RANGE_PRESETS = [
  { label: 'Mois en cours', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  {
    label: 'Mois précédent',
    range: () => {
      const previous = subMonths(new Date(), 1);
      return { from: startOfMonth(previous), to: endOfMonth(previous) };
    },
  },
  {
    label: 'Trimestre écoulé',
    range: () => ({ from: startOfMonth(subMonths(new Date(), 3)), to: endOfMonth(subMonths(new Date(), 1)) }),
  },
  { label: 'Depuis le 1er janvier', range: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

/** Période d'analyse partagée par les écrans financiers, mémorisée par utilisateur. */
export function usePeriod(scope = 'finances'): [ResolvedPeriod, PeriodValue, (value: PeriodValue) => void] {
  const { user } = useAuth();
  const [value, setValue] = usePersistentState<PeriodValue>(`golink:restaurant:${user?.uid ?? 'anonyme'}:${scope}-periode`, {
    preset: '30d',
  });
  // Recalcul une fois par jour au plus : la période glissante suit la date du jour.
  const today = dayKey(new Date());
  const resolved = useMemo(() => resolvePeriod(value), [value, today]);
  return [resolved, value, setValue];
}

export function PeriodPicker({
  period,
  value,
  onChange,
  className,
}: {
  period: ResolvedPeriod;
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <SegmentedControl
        aria-label="Période d’analyse"
        value={QUICK.some((option) => option.value === value.preset) ? value.preset : ''}
        onValueChange={(preset) => onChange({ preset: preset as PeriodValue['preset'] })}
        options={QUICK}
      />
      <DateRangePicker
        className="min-w-0 max-w-full sm:min-w-56"
        value={{ from: period.start, to: parseDay(period.to) }}
        presets={RANGE_PRESETS}
        onChange={(range) => {
          if (!range?.from) return;
          onChange({ preset: 'custom', from: dayKey(range.from), to: dayKey(range.to ?? range.from) });
        }}
      />
    </div>
  );
}
