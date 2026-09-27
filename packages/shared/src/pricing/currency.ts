// Devises des marchés GoLink. Tous les montants du moteur restent des entiers en
// unités mineures de la devise du marché (centimes d'euro, centimes de dirham ou
// de dinar algérien, millimes de dinar tunisien). Le type `Cents` désigne donc
// « unités mineures » : son nom est conservé pour la compatibilité.
import type { Cents } from './money';

export const CURRENCY_CODES = ['EUR', 'DZD', 'MAD', 'TND'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Nombre de décimales de l'unité mineure (TND : 1 dinar = 1 000 millimes). */
export const CURRENCY_MINOR_DIGITS: Readonly<Record<CurrencyCode, number>> = {
  EUR: 2,
  DZD: 2,
  MAD: 2,
  TND: 3,
};

export const CURRENCY_LABELS: Readonly<Record<CurrencyCode, string>> = {
  EUR: 'Euro',
  DZD: 'Dinar algérien',
  MAD: 'Dirham marocain',
  TND: 'Dinar tunisien',
};

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/** Facteur unités mineures par unité (EUR : 100, TND : 1 000). */
export function minorUnitFactor(currency: CurrencyCode): number {
  return 10 ** CURRENCY_MINOR_DIGITS[currency];
}

/** 12,5 (unités) → 1 250 (EUR) ou 12 500 (TND). */
export function toMinorUnits(amount: number, currency: CurrencyCode): Cents {
  return Math.round(amount * minorUnitFactor(currency));
}

/** 1 250 (EUR) → 12,5. */
export function fromMinorUnits(minor: Cents, currency: CurrencyCode): number {
  return minor / minorUnitFactor(currency);
}

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Montant en unités mineures formaté pour la devise et la langue :
 * formatMoney(1250, 'EUR') → « 12,50 € » ; formatMoney(12500, 'TND') → « 12,500 TND ».
 */
export function formatMoney(minor: Cents, currency: CurrencyCode = 'EUR', locale = 'fr-FR'): string {
  const key = `${locale}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const digits = CURRENCY_MINOR_DIGITS[currency];
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(fromMinorUnits(minor, currency));
}
