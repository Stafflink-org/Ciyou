// Périodes d'analyse des écrans financiers : raccourcis, période personnalisée,
// période de comparaison de même durée et découpage (jour, semaine, mois).
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  parseISO,
  startOfDay,
  startOfISOWeek,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';

export type PeriodPreset = '7d' | '30d' | '90d' | '12m' | 'month' | 'last_month' | 'custom';

export interface PeriodValue {
  preset: PeriodPreset;
  /** Période personnalisée, jours calendaires AAAA-MM-JJ inclus. */
  from?: string;
  to?: string;
}

export type Granularity = 'day' | 'week' | 'month';

export interface ResolvedPeriod {
  preset: PeriodPreset;
  /** Premier et dernier jour inclus (AAAA-MM-JJ, heure locale). */
  from: string;
  to: string;
  start: Date;
  /** Fin exclusive (minuit du lendemain du dernier jour). */
  endExclusive: Date;
  days: number;
  label: string;
  granularity: Granularity;
  previous: { from: string; to: string; start: Date; endExclusive: Date; label: string };
}

export const PERIOD_PRESETS: Array<{ value: Exclude<PeriodPreset, 'custom'>; label: string; short: string }> = [
  { value: '7d', label: '7 derniers jours', short: '7 j' },
  { value: '30d', label: '30 derniers jours', short: '30 j' },
  { value: '90d', label: '90 derniers jours', short: '90 j' },
  { value: '12m', label: '12 derniers mois', short: '12 mois' },
  { value: 'month', label: 'Mois en cours', short: 'Ce mois' },
  { value: 'last_month', label: 'Mois précédent', short: 'Mois dernier' },
];

export const dayKey = (date: Date): string => format(date, 'yyyy-MM-dd');
export const parseDay = (day: string): Date => startOfDay(parseISO(day));

function rangeLabel(start: Date, endInclusive: Date): string {
  const sameYear = start.getFullYear() === endInclusive.getFullYear();
  if (dayKey(start) === dayKey(endInclusive)) return format(start, 'd MMMM yyyy', { locale: fr });
  return `${format(start, sameYear ? 'd MMM' : 'd MMM yyyy', { locale: fr })} – ${format(endInclusive, 'd MMM yyyy', { locale: fr })}`;
}

/** Transforme un choix de période en bornes concrètes, avec la période précédente comparable. */
export function resolvePeriod(value: PeriodValue, now: Date = new Date()): ResolvedPeriod {
  const today = startOfDay(now);
  let start: Date;
  let endInclusive = today;
  switch (value.preset) {
    case '7d':
      start = subDays(today, 6);
      break;
    case '90d':
      start = subDays(today, 89);
      break;
    case '12m':
      start = startOfMonth(subMonths(today, 11));
      break;
    case 'month':
      start = startOfMonth(today);
      break;
    case 'last_month':
      start = startOfMonth(subMonths(today, 1));
      endInclusive = startOfDay(endOfMonth(start));
      break;
    case 'custom': {
      const from = value.from ? parseDay(value.from) : subDays(today, 29);
      const to = value.to ? parseDay(value.to) : today;
      start = isAfter(from, to) ? to : from;
      endInclusive = isAfter(from, to) ? from : to;
      break;
    }
    default:
      start = subDays(today, 29);
  }
  const days = differenceInCalendarDays(endInclusive, start) + 1;
  const endExclusive = addDays(endInclusive, 1);

  // Comparaison : mois complets pour les périodes mensuelles, sinon même nombre de jours juste avant.
  let prevStart: Date;
  let prevEndInclusive: Date;
  if (value.preset === '12m') {
    prevStart = subMonths(start, 12);
    prevEndInclusive = subDays(start, 1);
  } else if (value.preset === 'month' || value.preset === 'last_month') {
    prevStart = startOfMonth(subMonths(start, 1));
    prevEndInclusive = value.preset === 'month' ? addDays(prevStart, days - 1) : startOfDay(endOfMonth(prevStart));
  } else {
    prevStart = subDays(start, days);
    prevEndInclusive = subDays(start, 1);
  }

  return {
    preset: value.preset,
    from: dayKey(start),
    to: dayKey(endInclusive),
    start,
    endExclusive,
    days,
    label: rangeLabel(start, endInclusive),
    granularity: days <= 45 ? 'day' : days <= 130 ? 'week' : 'month',
    previous: {
      from: dayKey(prevStart),
      to: dayKey(prevEndInclusive),
      start: prevStart,
      endExclusive: addDays(prevEndInclusive, 1),
      label: rangeLabel(prevStart, prevEndInclusive),
    },
  };
}

export interface Bucket {
  key: string;
  /** Libellé court de l'axe. */
  label: string;
  /** Libellé complet de l'infobulle. */
  fullLabel: string;
  days: string[];
}

/** Découpe [from ; to] en jours, semaines (lundi) ou mois. */
export function buildBuckets(from: string, to: string, granularity: Granularity): Bucket[] {
  const all = eachDayOfInterval({ start: parseDay(from), end: parseDay(to) });
  const buckets = new Map<string, Bucket>();
  for (const date of all) {
    let key: string;
    let label: string;
    let fullLabel: string;
    if (granularity === 'day') {
      key = dayKey(date);
      label = format(date, 'd MMM', { locale: fr });
      fullLabel = format(date, 'EEEE d MMMM yyyy', { locale: fr });
    } else if (granularity === 'week') {
      const monday = startOfISOWeek(date);
      key = dayKey(monday);
      label = format(monday, 'd MMM', { locale: fr });
      fullLabel = `Semaine du ${format(monday, 'd MMMM yyyy', { locale: fr })}`;
    } else {
      const first = startOfMonth(date);
      key = format(first, 'yyyy-MM');
      label = format(first, 'MMM yy', { locale: fr });
      fullLabel = format(first, 'MMMM yyyy', { locale: fr });
    }
    const bucket = buckets.get(key) ?? { key, label, fullLabel, days: [] };
    bucket.days.push(dayKey(date));
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

/** Variation relative (0,12 = +12 %) ; undefined si la base est nulle. */
export function change(current: number, previous: number): number | undefined {
  if (!previous) return undefined;
  return (current - previous) / Math.abs(previous);
}

/** Nom de fichier : « finances-mina-kitchen-2026-09-01_2026-09-26 ». */
export function fileStem(prefix: string, restaurantName: string, period: { from: string; to: string }): string {
  const slug = restaurantName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${slug}-${period.from}_${period.to}`;
}
