// Périodes du pilotage : raccourcis, bornes calendaires (AAAA-MM-JJ, heure locale)
// et période de comparaison de même durée juste avant.
import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ar } from 'date-fns/locale/ar';
import { enGB } from 'date-fns/locale/en-GB';
import { fr } from 'date-fns/locale/fr';
import { getLocale, translate } from '@golink/web';

export type PeriodPreset = 'today' | '7d' | '30d' | 'month' | 'prev_month' | '90d' | '12m' | 'custom';

export interface PeriodRange {
  from: string;
  to: string;
}

export interface Period extends PeriodRange {
  preset: PeriodPreset;
  compareFrom: string;
  compareTo: string;
  /** Nombre de jours de la période (bornes incluses). */
  days: number;
  /** Libellé court (« 30 derniers jours »). */
  label: string;
  /** Libellé de la comparaison (« vs 30 jours précédents »). */
  compareLabel: string;
}

export const PERIOD_PRESETS: Array<{ value: Exclude<PeriodPreset, 'custom'>; label: string; short: string }> = [
  { value: 'today', label: 'Aujourd’hui', short: 'Jour' },
  { value: '7d', label: '7 derniers jours', short: '7 j' },
  { value: '30d', label: '30 derniers jours', short: '30 j' },
  { value: 'month', label: 'Mois en cours', short: 'Mois' },
  { value: 'prev_month', label: 'Mois précédent', short: 'M-1' },
  { value: '90d', label: '90 derniers jours', short: '90 j' },
  { value: '12m', label: '12 derniers mois', short: '12 m' },
];

export const MAX_PERIOD_DAYS = 400;

export function isoDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function todayIso(): string {
  return isoDay(new Date());
}

export function parseDay(day: string): Date {
  return parseISO(day);
}

/** Liste des jours entre deux bornes incluses. */
export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  const start = parseDay(from);
  const count = differenceInCalendarDays(parseDay(to), start);
  for (let i = 0; i <= count && i <= MAX_PERIOD_DAYS; i += 1) out.push(isoDay(addDays(start, i)));
  return out;
}

export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): PeriodRange {
  const today = isoDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: isoDay(addDays(now, -6)), to: today };
    case '30d':
      return { from: isoDay(addDays(now, -29)), to: today };
    case 'month':
      return { from: isoDay(startOfMonth(now)), to: today };
    case 'prev_month': {
      const previous = subMonths(now, 1);
      return { from: isoDay(startOfMonth(previous)), to: isoDay(endOfMonth(previous)) };
    }
    case '90d':
      return { from: isoDay(addDays(now, -89)), to: today };
    case '12m':
      return { from: isoDay(addDays(subMonths(now, 12), 1)), to: today };
  }
}

/** Locale date-fns de la langue courante de l'interface. */
const dateLocale = () => ({ fr, en: enGB, ar })[getLocale() as 'fr' | 'en' | 'ar'] ?? fr;

const shortDate = (day: string) => format(parseDay(day), 'd MMM', { locale: dateLocale() });
const longDate = (day: string) => format(parseDay(day), 'd MMM yyyy', { locale: dateLocale() });

export function rangeLabel(range: PeriodRange): string {
  if (range.from === range.to) return longDate(range.from);
  return `${shortDate(range.from)} – ${longDate(range.to)}`;
}

/** Période complète (bornes, comparaison, libellés) à partir d'un raccourci ou de dates. */
export function buildPeriod(preset: PeriodPreset, custom?: PeriodRange | null, now = new Date()): Period {
  const range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? '30d' : preset, now);
  const effectivePreset: PeriodPreset = preset === 'custom' && !custom ? '30d' : preset;
  const days = differenceInCalendarDays(parseDay(range.to), parseDay(range.from)) + 1;
  let compare: PeriodRange;
  if (effectivePreset === 'month' || effectivePreset === 'prev_month') {
    // Mois : même nombre de jours au début du mois précédent (comparaison à date).
    const start = startOfMonth(subMonths(parseDay(range.from), 1));
    const end = addDays(start, days - 1);
    const endCap = endOfMonth(start);
    compare = { from: isoDay(start), to: isoDay(end > endCap ? endCap : end) };
  } else {
    compare = { from: isoDay(addDays(parseDay(range.from), -days)), to: isoDay(addDays(parseDay(range.from), -1)) };
  }
  const presetLabel = effectivePreset === 'custom' ? undefined : translate(`accueil:period.${effectivePreset}`);
  const compareLabel =
    effectivePreset === 'today'
      ? translate('accueil:period.vsYesterday')
      : effectivePreset === 'month'
        ? translate('accueil:period.vsMonthToDate')
        : effectivePreset === 'prev_month'
          ? translate('accueil:period.vsPrevMonth')
          : translate('accueil:period.vsDays', { days });
  return {
    preset: effectivePreset,
    ...range,
    compareFrom: compare.from,
    compareTo: compare.to,
    days,
    label: presetLabel ?? rangeLabel(range),
    compareLabel,
  };
}

/** Variation relative (0,12 = +12 %) ; undefined si la base est nulle. */
export function trend(current: number, previous: number): number | undefined {
  if (!previous) return current ? undefined : 0;
  return (current - previous) / Math.abs(previous);
}

/** Libellé d'axe d'un jour (« 12 sept. ») ou d'un mois (« sept. 26 »). */
export function dayTick(day: string): string {
  return format(parseDay(day), 'd MMM', { locale: dateLocale() });
}

export function monthTick(month: string): string {
  return format(parseDay(`${month}-01`), 'MMM yy', { locale: dateLocale() });
}
