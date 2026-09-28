// Configuration d'un établissement : contrôles partagés par le back-office
// restaurant (validation immédiate) et les Cloud Functions (validation qui fait foi).
import type { TimeRange, WeeklyHours } from '../models/common';
import { defaultCurrencyOfCountry, type CurrencyCode } from '../pricing/currency';

// ------------------------------------------------------------------ Devise du commerce

/**
 * Devise à utiliser pour formater les montants de CE commerce : celle fixée sur sa fiche
 * (super admin), sinon celle du pays, sinon EUR. Ne jamais lire `restaurant.currency`
 * directement (absent sur les documents créés avant cette rubrique).
 */
export function resolveRestaurantCurrency(
  restaurant: { currency?: CurrencyCode | null } | null | undefined,
  country?: { currency?: CurrencyCode | null } | null,
  countryId?: string | null,
): CurrencyCode {
  return restaurant?.currency ?? country?.currency ?? defaultCurrencyOfCountry(countryId);
}

// ------------------------------------------------------------------ Mentions de l'établissement

/** Mentions affichables sur la fiche publique (clé stockée → libellé). */
export const RESTAURANT_LABELS = {
  homemade: 'Fait maison',
  halal: 'Halal',
  kosher: 'Casher',
  vegetarian_friendly: 'Options végétariennes',
  vegan_friendly: 'Options véganes',
  gluten_free_options: 'Options sans gluten',
  organic: 'Produits bio',
  local_products: 'Produits locaux',
  eco_packaging: 'Emballages écoresponsables',
} as const;
export type RestaurantLabelKey = keyof typeof RESTAURANT_LABELS;

// ------------------------------------------------------------------ Horaires

export const MAX_SLOTS_PER_DAY = 4;
export const MAX_HOURS_EXCEPTIONS = 60;

/** Noms des jours (0 = lundi, comme WeeklyHours). */
export const WEEKDAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** « 14:30 » → 870 ; null si le format est invalide. « 24:00 » est accepté en fin de créneau. */
export function minutesOfDay(value: string, allowMidnightEnd = false): number | null {
  if (allowMidnightEnd && value === '24:00') return 24 * 60;
  if (!HOUR_MINUTE.test(value)) return null;
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export interface HoursIssue {
  /** Jour concerné (0-6), ou date AAAA-MM-JJ pour une exception. */
  scope: number | string;
  slotIndex?: number;
  message: string;
}

/** Contrôle d'une liste de créneaux : format, fin après le début, pas de chevauchement. */
export function validateSlots(slots: readonly TimeRange[], scope: number | string): HoursIssue[] {
  const issues: HoursIssue[] = [];
  if (slots.length > MAX_SLOTS_PER_DAY) {
    issues.push({ scope, message: `${MAX_SLOTS_PER_DAY} créneaux au maximum par jour.` });
  }
  const ranges: Array<{ from: number; to: number; index: number }> = [];
  slots.forEach((slot, index) => {
    const from = minutesOfDay(slot.from);
    const to = minutesOfDay(slot.to, true);
    if (from === null || to === null) {
      issues.push({ scope, slotIndex: index, message: 'Heure invalide (format HH:MM attendu).' });
      return;
    }
    if (to <= from) {
      issues.push({ scope, slotIndex: index, message: 'L’heure de fin doit être postérieure à l’heure de début.' });
      return;
    }
    if (to - from < 15) {
      issues.push({ scope, slotIndex: index, message: 'Un créneau dure au moins 15 minutes.' });
      return;
    }
    ranges.push({ from, to, index });
  });
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.from < previous.to) {
      issues.push({ scope, slotIndex: current.index, message: 'Ce créneau chevauche un autre créneau de la journée.' });
    }
  }
  return issues;
}

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Contrôle complet des horaires hebdomadaires et des exceptions. */
export function validateWeeklyHours(hours: Pick<WeeklyHours, 'days' | 'exceptions'>): HoursIssue[] {
  const issues: HoursIssue[] = [];
  const seenDays = new Set<number>();
  for (const day of hours.days) {
    if (day.day < 0 || day.day > 6 || seenDays.has(day.day)) {
      issues.push({ scope: day.day, message: 'Jour de la semaine invalide ou en double.' });
      continue;
    }
    seenDays.add(day.day);
    if (!day.open) continue;
    if (day.slots.length === 0) {
      issues.push({ scope: day.day, message: 'Ajoutez au moins un créneau ou fermez ce jour.' });
      continue;
    }
    issues.push(...validateSlots(day.slots, day.day));
  }
  if (seenDays.size !== 7) issues.push({ scope: -1, message: 'Les sept jours de la semaine doivent être renseignés.' });

  if (hours.exceptions.length > MAX_HOURS_EXCEPTIONS) {
    issues.push({ scope: 'exceptions', message: `${MAX_HOURS_EXCEPTIONS} dates exceptionnelles au maximum.` });
  }
  const seenDates = new Set<string>();
  for (const exception of hours.exceptions) {
    if (!ISO_DAY.test(exception.date)) {
      issues.push({ scope: exception.date, message: 'Date invalide.' });
      continue;
    }
    if (seenDates.has(exception.date)) issues.push({ scope: exception.date, message: 'Cette date est déjà renseignée.' });
    seenDates.add(exception.date);
    if ((exception.label ?? '').length > 60) issues.push({ scope: exception.date, message: 'Libellé trop long (60 caractères au plus).' });
    if (!exception.closed) {
      const slots = exception.slots ?? [];
      if (slots.length === 0) issues.push({ scope: exception.date, message: 'Indiquez les horaires de cette journée ou marquez-la fermée.' });
      else issues.push(...validateSlots(slots, exception.date));
    }
  }
  return issues;
}

/** Nombre de minutes d'ouverture sur la semaine type. */
export function weeklyOpenMinutes(hours: Pick<WeeklyHours, 'days'>): number {
  return hours.days.reduce((total, day) => {
    if (!day.open) return total;
    return (
      total +
      day.slots.reduce((sum, slot) => {
        const from = minutesOfDay(slot.from);
        const to = minutesOfDay(slot.to, true);
        return from !== null && to !== null && to > from ? sum + (to - from) : sum;
      }, 0)
    );
  }, 0);
}

// ------------------------------------------------------------------ Jours fériés

/** Dimanche de Pâques (algorithme de Meeus / Jones / Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export interface PublicHoliday {
  date: string;
  label: string;
}

/** Jours fériés légaux d'un pays (FR : métropole ; LU). Liste triée par date. */
export function publicHolidays(countryCode: string, year: number): PublicHoliday[] {
  const easter = easterSunday(year);
  const fixed = (month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const list: PublicHoliday[] = [
    { date: fixed(1, 1), label: 'Jour de l’an' },
    { date: isoOf(shift(easter, 1)), label: 'Lundi de Pâques' },
    { date: fixed(5, 1), label: 'Fête du Travail' },
    { date: isoOf(shift(easter, 39)), label: 'Ascension' },
    { date: isoOf(shift(easter, 50)), label: 'Lundi de Pentecôte' },
    { date: fixed(8, 15), label: 'Assomption' },
    { date: fixed(11, 1), label: 'Toussaint' },
    { date: fixed(12, 25), label: 'Noël' },
  ];
  if (countryCode === 'LU') {
    list.push({ date: fixed(5, 9), label: 'Journée de l’Europe' });
    list.push({ date: fixed(6, 23), label: 'Fête nationale' });
    list.push({ date: fixed(12, 26), label: 'Saint-Étienne' });
  } else {
    list.push({ date: fixed(5, 8), label: 'Victoire 1945' });
    list.push({ date: fixed(7, 14), label: 'Fête nationale' });
    list.push({ date: fixed(11, 11), label: 'Armistice 1918' });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// ------------------------------------------------------------------ Identifiants légaux

/** Retire espaces, points et tirets. */
export function compactIdentifier(value: string): string {
  return value.replace(/[\s.\-]/g, '').toUpperCase();
}

/** Clé de Luhn (SIREN, SIRET). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * SIRET français (14 chiffres, clé de Luhn ; exception La Poste).
 * Les établissements luxembourgeois saisissent leur numéro RCS (B123456).
 */
export function isValidSiret(value: string, countryCode = 'FR'): boolean {
  const compact = compactIdentifier(value);
  if (countryCode === 'LU') return /^[AB]\d{1,6}$/.test(compact) || /^\d{11,13}$/.test(compact);
  if (!/^\d{14}$/.test(compact)) return false;
  if (compact.startsWith('356000000')) return compact.split('').reduce((s, c) => s + Number(c), 0) % 5 === 0;
  return luhnValid(compact);
}

/** Numéro de TVA intracommunautaire (FR : clé contrôlée ; LU : 8 chiffres). */
export function isValidVatNumber(value: string): boolean {
  const compact = compactIdentifier(value);
  if (compact.startsWith('FR')) {
    const body = compact.slice(2);
    if (!/^[0-9A-Z]{2}\d{9}$/.test(body)) return false;
    const key = body.slice(0, 2);
    const siren = body.slice(2);
    if (!/^\d{2}$/.test(key)) return true;
    return Number(key) === (12 + 3 * (Number(siren) % 97)) % 97;
  }
  if (compact.startsWith('LU')) return /^LU\d{8}$/.test(compact);
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(compact);
}

/** Présentation lisible d'un SIRET : « 123 456 789 00012 ». */
export function formatSiret(value: string): string {
  const compact = compactIdentifier(value);
  if (!/^\d{14}$/.test(compact)) return value.trim();
  return `${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(6, 9)} ${compact.slice(9)}`;
}
