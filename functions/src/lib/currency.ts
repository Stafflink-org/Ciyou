// Devise d'un marché : lue sur le document du pays (paramètre du super admin), avec
// la devise habituelle du pays en repli. Tous les montants restent des entiers en
// unités mineures de cette devise (centimes, millimes pour le dinar tunisien).
import { COLLECTIONS, isCurrencyCode, type CurrencyCode } from '@golink/shared';
import { db } from './admin';

const DEFAULT_CURRENCY: Readonly<Record<string, CurrencyCode>> = { FR: 'EUR', BE: 'EUR', LU: 'EUR', DZ: 'DZD', MA: 'MAD', TN: 'TND' };

/** Devise habituelle du pays (sans lecture de la base). */
export function defaultCurrency(countryId: string | null | undefined): CurrencyCode {
  return (countryId && DEFAULT_CURRENCY[countryId.toUpperCase()]) || 'EUR';
}

const cache = new Map<string, { at: number; currency: CurrencyCode }>();

/** Devise du pays paramétrée en base (mise en cache une minute). */
export async function currencyOfCountry(countryId: string | null | undefined): Promise<CurrencyCode> {
  const id = (countryId ?? 'FR').toUpperCase();
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < 60_000) return cached.currency;
  const snap = await db.collection(COLLECTIONS.countries).doc(id).get();
  const stored = snap.get('currency') as string | undefined;
  const currency = stored && isCurrencyCode(stored) ? stored : defaultCurrency(id);
  cache.set(id, { at: Date.now(), currency });
  return currency;
}

/** Code devise en minuscules pour Stripe (« eur », « mad »…). */
export const stripeCurrency = (currency: CurrencyCode): string => currency.toLowerCase();
