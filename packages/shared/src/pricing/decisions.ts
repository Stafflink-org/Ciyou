// Décisions du client (docs/DECISIONS_CLIENT.md, 26/09/2026) traduites en valeurs par
// défaut : marchés de lancement, règles de commande, interrupteurs verrouillés.
// Tout chiffre reste un paramètre du super admin ; ces constantes servent d'amorçage
// et de repli quand un document de paramètres est absent.
import type { Locale } from '../constants/enums';
import type { MerchantDefaults, OrderRules } from '../models/platform';
import type { CurrencyCode } from './currency';
import { DEFAULT_CUSTOMER_CANCELLATION, DEFAULT_LATE_CREDIT_TIERS, DEFAULT_REFUND_LIABILITY } from './policies';

/** Marché de lancement (amorçage de countries/{code}). */
export interface LaunchMarket {
  code: 'FR' | 'BE' | 'LU' | 'DZ' | 'MA' | 'TN';
  name: string;
  currency: CurrencyCode;
  locales: Locale[];
  defaultLocale: Locale;
  timezone: string;
  phonePrefix: string;
  /** Stripe disponible dans le pays ; sinon, moyens de paiement locaux à brancher. */
  stripeAvailable: boolean;
  /** Pays membre de l'UE (DAC7 applicable). */
  eu: boolean;
  dac7Authority: string;
}

export const LAUNCH_MARKETS: readonly LaunchMarket[] = [
  { code: 'FR', name: 'France', currency: 'EUR', locales: ['fr', 'en', 'ar'], defaultLocale: 'fr', timezone: 'Europe/Paris', phonePrefix: '+33', stripeAvailable: true, eu: true, dac7Authority: 'DGFiP' },
  { code: 'BE', name: 'Belgique', currency: 'EUR', locales: ['fr', 'en', 'ar'], defaultLocale: 'fr', timezone: 'Europe/Brussels', phonePrefix: '+32', stripeAvailable: true, eu: true, dac7Authority: 'SPF Finances' },
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', locales: ['fr', 'en', 'ar'], defaultLocale: 'fr', timezone: 'Europe/Luxembourg', phonePrefix: '+352', stripeAvailable: true, eu: true, dac7Authority: 'Administration des contributions directes' },
  { code: 'DZ', name: 'Algérie', currency: 'DZD', locales: ['ar', 'fr', 'en'], defaultLocale: 'fr', timezone: 'Africa/Algiers', phonePrefix: '+213', stripeAvailable: false, eu: false, dac7Authority: 'Non applicable (hors Union européenne)' },
  { code: 'MA', name: 'Maroc', currency: 'MAD', locales: ['ar', 'fr', 'en'], defaultLocale: 'fr', timezone: 'Africa/Casablanca', phonePrefix: '+212', stripeAvailable: false, eu: false, dac7Authority: 'Non applicable (hors Union européenne)' },
  { code: 'TN', name: 'Tunisie', currency: 'TND', locales: ['ar', 'fr', 'en'], defaultLocale: 'fr', timezone: 'Africa/Tunis', phonePrefix: '+216', stripeAvailable: false, eu: false, dac7Authority: 'Non applicable (hors Union européenne)' },
];

/** Décisions fermes du client (non chiffrées ou verrouillées). */
export const CLIENT_DECISIONS = {
  /** Frais d'inscription des commerces : aucun. */
  merchantSignupFeeCents: 0,
  /** Frais de service client par défaut (paramètre). */
  customerServiceFeeCents: 0,
  /** Vente d'alcool interdite et verrouillée. */
  alcoholSalesForbidden: true,
  /** Titres-restaurant désactivés. */
  mealVouchersEnabled: false,
  /** Pourboires activés, reversés à 100 % au livreur. */
  tipsEnabled: true,
  tipsCourierShareBps: 10_000,
  /** Offre entreprises : non. */
  businessOfferEnabled: false,
  /** Boutique propre des commerces : non (uniquement l'app Ciyou Eats). */
  merchantWebshopEnabled: false,
  /** Espèces uniquement avec un livreur salarié du commerce. */
  cashRequiresMerchantCourier: true,
  /** Parrainage commerce → commerce : crédit publicitaire (unités mineures EUR). */
  merchantReferralAdCreditCents: 10_000,
  /** Fidélité non définie au lancement : éteinte. */
  loyaltyEnabled: false,
  /** Promotions des commerces sans limite. */
  merchantPromotionCapsEnabled: false,
} as const;

/**
 * Valeurs initiales des réglages de commande d'un nouveau commerce (repli documenté :
 * appliquées quand la plateforme, le pays et la ville n'ont rien de spécifique — mêmes
 * chiffres que ceux historiquement codés en dur dans `newOrderSettings`/`newRestaurantDoc`).
 */
export const DEFAULT_MERCHANT_DEFAULTS: MerchantDefaults = {
  prepMinutes: 20,
  maxConcurrentOrders: 12,
  minOrderCents: 1000,
  scheduledLeadMinutes: 60,
  scheduledMaxDays: 3,
};

/** Règles de commande par défaut (settings/orderRules). */
export const DEFAULT_ORDER_RULES: OrderRules = {
  acceptanceTimeoutSeconds: 300,
  acceptanceTimeoutAction: 'cancel_and_refund',
  autoPause: { enabled: true, missedOrdersInARow: 3 },
  merchantInactivity: { enabled: true, alertAfterDays: 15, removeAfterAlertDays: 30 },
  defaultPrepMinutes: 20,
  merchantDefaults: DEFAULT_MERCHANT_DEFAULTS,
  maxPrepExtensionMinutes: 30,
  customerCancellation: DEFAULT_CUSTOMER_CANCELLATION,
  refundLiability: DEFAULT_REFUND_LIABILITY,
  customerAbsent: { driverWaitMinutes: 10, payDriver: true, refundCustomer: false, payRestaurant: true, callViaApp: true, autoCloseGraceMinutes: 10 },
  itemUnavailable: { allowReplacement: true, replacementTimeoutSeconds: 180 },
  lateCredit: { enabled: true, tiers: [...DEFAULT_LATE_CREDIT_TIERS], creditValidityDays: 60 },
  alcohol: {
    enabled: false,
    locked: true,
    minimumAge: 18,
    requireAgeConfirmation: true,
    requireIdCheckAtDelivery: true,
    salesHours: null,
  },
  scheduledOrders: { enabled: true, minLeadMinutes: 45, maxDaysAhead: 7 },
  claimWindowHours: 48,
  lateToleranceMinutes: 5,
  claims: { photoRequired: true, minPhotos: 1, maxPhotos: 4, checkPhotoDate: true, checkDuplicates: true, repeatThreshold30d: 3, autoAcceptMaxCents: 0 },
};

/**
 * Valeurs initiales d'un nouveau commerce : plateforme, puis pays, puis ville (la plus
 * précise l'emporte) — même principe que `resolveDispatchRules`. Utilisée à la création
 * d'un commerce (`newOrderSettings`, `newRestaurantDoc`) et par le bouton « Réinitialiser »
 * du back-office restaurant.
 */
export function resolveMerchantDefaults(
  platform?: Partial<OrderRules> | null,
  country?: Partial<OrderRules> | null,
  city?: Partial<OrderRules> | null,
): MerchantDefaults {
  const clean = (value: Partial<OrderRules> | null | undefined) =>
    Object.fromEntries(Object.entries(value?.merchantDefaults ?? {}).filter(([, v]) => v !== undefined)) as Partial<MerchantDefaults>;
  return { ...DEFAULT_MERCHANT_DEFAULTS, ...clean(platform), ...clean(country), ...clean(city) };
}
