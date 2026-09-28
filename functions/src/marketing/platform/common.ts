// Outils communs aux fonctions de croissance du super admin : réglages et valeurs
// par défaut (tout chiffre reste un paramètre modifiable), envois sans risque.
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type CrmSettings,
  type LoyaltySettings,
  type PromotionSettings,
  type ReferralSettings,
  type UserNotification,
} from '@golink/shared';
import { db, FieldValue } from '../../lib/admin';

export const DAY_MS = 86_400_000;

type Stored<T> = Omit<T, 'updatedAt' | 'updatedBy'>;

export const DEFAULT_PROMOTION_SETTINGS: Stored<PromotionSettings> = {
  capsEnabled: false,
  restaurantMaxPercentBps: 5000,
  restaurantMaxFixedCents: 1500,
  restaurantRequiresReview: false,
  maxActivePerRestaurant: 3,
  loyalOrdersThreshold: 5,
  inactiveDaysDefault: 30,
};

export const DEFAULT_LOYALTY_SETTINGS: Stored<LoyaltySettings> = {
  enabled: false,
  pointsPerEuro: 1,
  welcomePoints: 0,
  rewards: [{ points: 200, valueCents: 300 }],
  pointsValidityDays: 365,
  allowRestaurantPrograms: true,
  minOrderCents: 0,
  maxRedeemBps: 5000,
};

export const DEFAULT_REFERRAL_SETTINGS: Stored<ReferralSettings> = {
  client: { enabled: false, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 },
  restaurant: { enabled: true, rewardCents: 10_000, qualifyingOrders: 0, rewardType: 'ad_credit' },
  driver: { enabled: false, rewardCents: 5000, qualifyingDeliveries: 50 },
};

export const DEFAULT_CRM_SETTINGS: Stored<CrmSettings> = {
  signupBonusCents: 15_000,
  revenueShareBps: 0,
  revenueShareMonths: 0,
  defaultFollowUpDays: 3,
  followUpReminders: true,
};

async function readSettings<T extends object>(id: string, defaults: T): Promise<T> {
  const snap = await db.collection(COLLECTIONS.settings).doc(id).get();
  return { ...defaults, ...((snap.data() as Partial<T> | undefined) ?? {}) };
}

export const loadPromotionSettings = () => readSettings(SETTINGS_DOCS.promotions, DEFAULT_PROMOTION_SETTINGS);
export const loadLoyaltySettings = () => readSettings(SETTINGS_DOCS.loyalty, DEFAULT_LOYALTY_SETTINGS);
export const loadCrmSettings = () => readSettings(SETTINGS_DOCS.crm, DEFAULT_CRM_SETTINGS);

export async function loadReferralSettings(): Promise<Stored<ReferralSettings>> {
  const stored = await readSettings<Partial<Stored<ReferralSettings>>>(SETTINGS_DOCS.referral, {});
  return {
    client: { ...DEFAULT_REFERRAL_SETTINGS.client, ...stored.client },
    restaurant: { ...DEFAULT_REFERRAL_SETTINGS.restaurant, ...stored.restaurant },
    driver: { ...DEFAULT_REFERRAL_SETTINGS.driver, ...stored.driver },
  };
}

/**
 * Envois réels vers Brevo (e-mail, SMS) : uniquement si CAMPAIGNS_LIVE=true dans
 * l'environnement des fonctions, et jamais vers un domaine réservé aux tests.
 * Sinon le message est préparé et journalisé en mode test, sans être transmis.
 */
export function campaignsLive(): boolean {
  return process.env.CAMPAIGNS_LIVE === 'true';
}

export const RESERVED_EMAIL = /\.(test|example|invalid|localhost)$/i;

/** Notification du centre de notifications (app client, livreur ou back-office). */
export async function pushInApp(
  uid: string,
  notification: Pick<UserNotification, 'title' | 'body' | 'category' | 'link'>,
  id?: string,
): Promise<void> {
  if (!uid || uid === 'system') return;
  const col = db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.notifications);
  const payload = { ...notification, link: notification.link ?? null, read: false, readAt: null, createdAt: FieldValue.serverTimestamp() };
  if (id) await col.doc(id).set(payload);
  else await col.add(payload);
}

/** Remplace les variables {{nom}} d'un texte ; une variable inconnue reste vide. */
export function fillVariables(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/** Variables {{nom}} utilisées dans un texte. */
export function usedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1] as string))];
}
