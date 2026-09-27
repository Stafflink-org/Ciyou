// Stripe Connect des restaurants : compte connecté (Express), lien
// d'onboarding hébergé par Stripe et session des composants intégrés.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type Restaurant,
  type RestaurantCommercial,
  type RestaurantLegal,
} from '@golink/shared';
import type Stripe from 'stripe';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { APP_URLS } from '../lib/config';
import { fail } from '../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../lib/permissions';
import { STRIPE_PENDING_REASON } from '../lib/restaurants';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { getStripe } from '../lib/stripe';
import { z, zId } from '../lib/validation';

/** Code MCC Stripe « Restaurants et lieux de restauration ». */
const RESTAURANT_MCC = '5812';

export function accountStatus(account: Stripe.Account): NonNullable<RestaurantCommercial['stripeAccountStatus']> {
  if (account.charges_enabled && account.payouts_enabled) return 'enabled';
  if (account.details_submitted) return 'restricted';
  return 'pending';
}

async function loadRestaurant(restaurantId: string) {
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const privateCol = ref.collection(SUBCOLLECTIONS.restaurants.private);
  const [restaurant, commercial, legal] = await Promise.all([
    ref.get(),
    privateCol.doc(RESTAURANT_PRIVATE_DOCS.commercial).get(),
    privateCol.doc(RESTAURANT_PRIVATE_DOCS.legal).get(),
  ]);
  if (!restaurant.exists) throw fail.notFound('Restaurant');
  return {
    restaurant: restaurant.data() as Restaurant,
    commercialRef: privateCol.doc(RESTAURANT_PRIVATE_DOCS.commercial),
    commercial: commercial.exists ? (commercial.data() as RestaurantCommercial) : null,
    legal: legal.exists ? (legal.data() as RestaurantLegal) : null,
  };
}

/** Renvoie le compte connecté du restaurant, en le créant au besoin. */
async function ensureConnectAccount(restaurantId: string, actor: RestaurantActor): Promise<{ accountId: string; created: boolean }> {
  const { restaurant, commercial, commercialRef, legal } = await loadRestaurant(restaurantId);
  if (commercial?.stripeAccountId) return { accountId: commercial.stripeAccountId, created: false };

  const account = await getStripe().accounts.create(
    {
      type: 'express',
      country: restaurant.countryId,
      email: legal?.managerEmail ?? restaurant.email ?? undefined,
      business_type: 'company',
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: {
        name: restaurant.name,
        mcc: RESTAURANT_MCC,
        product_description: 'Vente de repas livrés et à emporter via GoLink',
        support_phone: restaurant.phone ?? undefined,
      },
      company: legal ? { name: legal.legalName } : undefined,
      metadata: { restaurantId, platform: 'golink' },
    },
    // Évite deux comptes si l'appel est rejoué.
    { idempotencyKey: `connect-account-${restaurantId}` },
  );

  await commercialRef.set(
    {
      stripeAccountId: account.id,
      stripeAccountStatus: accountStatus(account),
      updatedAt: Timestamp.now(),
      updatedBy: actor.caller.uid,
    },
    { merge: true },
  );
  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: 'restaurant.stripe_account_created',
    target: { type: 'restaurant', id: restaurantId, label: restaurant.name },
    after: { stripeAccountId: account.id },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    sensitive: true,
  });
  return { accountId: account.id, created: true };
}

const restaurantInput = z.object({ restaurantId: zId });

export const createConnectAccount = callable(
  restaurantInput,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage', 'restaurants.commercial');
    return ensureConnectAccount(data.restaurantId, actor);
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Lien d'onboarding Stripe (valable quelques minutes, à ouvrir immédiatement). */
export const createConnectAccountLink = callable(
  restaurantInput,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage', 'restaurants.commercial');
    const { accountId } = await ensureConnectAccount(data.restaurantId, actor);
    const base = `${APP_URLS.restaurant}/finances/paiements`;
    const link = await getStripe().accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${base}?stripe=relance`,
      return_url: `${base}?stripe=retour`,
      collection_options: { fields: 'eventually_due' },
    });
    return { url: link.url, expiresAt: link.expires_at * 1000 };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Session pour les composants Stripe Connect intégrés au back-office. */
export const createConnectAccountSession = callable(
  restaurantInput,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'finance.view', 'restaurants.commercial');
    const { accountId } = await ensureConnectAccount(data.restaurantId, actor);
    const session = await getStripe().accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        payouts: { enabled: true, features: { instant_payouts: false, standard_payouts: true, edit_payout_schedule: false } },
        payments: { enabled: true, features: { refund_management: false, dispute_management: false } },
        notification_banner: { enabled: true },
      },
    });
    return { clientSecret: session.client_secret, expiresAt: session.expires_at * 1000 };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Relit l'état du compte chez Stripe (retour d'onboarding, bouton « actualiser »). */
export const refreshConnectAccountStatus = callable(
  restaurantInput,
  async (data, request) => {
    await requireRestaurantAccess(request, data.restaurantId, 'finance.view', 'restaurants.commercial');
    const { commercial, commercialRef } = await loadRestaurant(data.restaurantId);
    if (!commercial?.stripeAccountId) return { status: null };
    const account = await getStripe().accounts.retrieve(commercial.stripeAccountId);
    const status = accountStatus(account);
    await commercialRef.set(
      { stripeAccountStatus: status, ...payoutUnlock(status, commercial), updatedAt: Timestamp.now(), updatedBy: 'system' },
      { merge: true },
    );
    return { status };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/**
 * Lève le blocage des reversements posé à l'inscription quand le compte est
 * activé ; un blocage posé pour une autre raison (fraude, litige) est conservé.
 */
export function payoutUnlock(
  status: NonNullable<RestaurantCommercial['stripeAccountStatus']>,
  commercial: Pick<RestaurantCommercial, 'payoutsBlocked' | 'payoutsBlockedReason'> | null,
): Partial<RestaurantCommercial> {
  if (status !== 'enabled' || !commercial?.payoutsBlocked) return {};
  if (commercial.payoutsBlockedReason !== STRIPE_PENDING_REASON) return {};
  return { payoutsBlocked: false, payoutsBlockedReason: null };
}
