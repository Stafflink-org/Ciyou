// Compte de paiement du livreur indépendant : compte connecté Stripe (Express) pour recevoir
// ses reversements, lien d'onboarding hébergé par Stripe, relecture de l'état du compte.
// Le livreur agit sur son propre compte ; les pays sans Stripe passent par un compte local
// (virement manuel, voir `setPayoutAccount`).
import { COLLECTIONS, type Driver, type DriverPrivate } from '@golink/shared';
import type Stripe from 'stripe';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { APP_URLS } from '../lib/config';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { getStripe } from '../lib/stripe';
import { z } from '../lib/validation';
import { loadCountry } from '../finance/argent/common';

const input = z.object({});

export function driverAccountStatus(account: Stripe.Account): NonNullable<DriverPrivate['stripeAccountStatus']> {
  // Un livreur reçoit seulement des virements : « payouts_enabled » suffit.
  if (account.payouts_enabled) return 'enabled';
  return account.details_submitted ? 'restricted' : 'pending';
}

async function loadDriver(uid: string): Promise<{ driver: Driver; priv: DriverPrivate | null }> {
  const [driverSnap, privSnap] = await Promise.all([db.collection(COLLECTIONS.drivers).doc(uid).get(), db.collection(COLLECTIONS.driverPrivate).doc(uid).get()]);
  if (!driverSnap.exists) throw fail.notFound('Livreur');
  return { driver: driverSnap.data() as Driver, priv: privSnap.exists ? (privSnap.data() as DriverPrivate) : null };
}

/** Renvoie le compte connecté du livreur, en le créant au besoin (un seul par livreur). */
async function ensureDriverAccount(uid: string, email: string | null): Promise<{ accountId: string; created: boolean; status: NonNullable<DriverPrivate['stripeAccountStatus']> }> {
  const { driver, priv } = await loadDriver(uid);
  if (driver.type !== 'platform') throw fail.precondition('Les livreurs salariés d’un commerce sont payés par leur employeur : aucun compte de paiement Ciyou Eats n’est nécessaire.');
  const country = await loadCountry(driver.countryId);
  if (country?.stripeAvailable === false) throw fail.precondition('Stripe n’est pas disponible dans votre pays : enregistrez un compte de paiement local (virement ou portefeuille mobile).');
  if (priv?.stripeAccountId) return { accountId: priv.stripeAccountId, created: false, status: priv.stripeAccountStatus ?? 'pending' };

  const account = await getStripe().accounts.create(
    {
      type: 'express',
      country: driver.countryId,
      email: driver.email ?? email ?? undefined,
      business_type: 'individual',
      capabilities: { transfers: { requested: true } },
      business_profile: { product_description: 'Livraison de commandes pour Ciyou Eats', mcc: '4215' },
      metadata: { driverId: uid, platform: 'golink' },
    },
    { idempotencyKey: `connect-driver-${uid}` },
  ).catch((error: unknown) => {
    // Compte Stripe de la plateforme sans Connect activé : message clair plutôt qu'une erreur interne.
    if (/signed up for Connect/i.test(String((error as Error)?.message))) throw fail.unavailable('Les comptes de paiement des livreurs ne sont pas encore ouverts : Stripe Connect n’est pas activé sur le compte Ciyou Eats.');
    throw error;
  });
  const status = driverAccountStatus(account);
  await db.collection(COLLECTIONS.driverPrivate).doc(uid).set({ stripeAccountId: account.id, stripeAccountStatus: status, updatedAt: Timestamp.now() }, { merge: true });
  return { accountId: account.id, created: true, status };
}

export const createDriverConnectAccount = callable(
  input,
  async (_data, request) => {
    const caller = requireAuth(request);
    const result = await ensureDriverAccount(caller.uid, caller.email ?? null);
    if (result.created) {
      const { driver } = await loadDriver(caller.uid);
      await writeAudit({ actor: actorFromCaller(caller, 'driver'), action: 'driver.stripe_account_created', target: { type: 'driver', id: caller.uid, label: driver.displayName }, after: { stripeAccountId: result.accountId }, countryId: driver.countryId, cityId: driver.cityId, sensitive: true });
    }
    return { accountId: result.accountId, status: result.status, created: result.created };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Lien d'onboarding Stripe du livreur (identité et coordonnées bancaires ; valable quelques minutes). */
export const createDriverConnectAccountLink = callable(
  input,
  async (_data, request) => {
    const caller = requireAuth(request);
    const { accountId } = await ensureDriverAccount(caller.uid, caller.email ?? null);
    const base = `${APP_URLS.driver}/paiement`;
    const link = await getStripe().accountLinks.create({ account: accountId, type: 'account_onboarding', refresh_url: `${base}?stripe=relance`, return_url: `${base}?stripe=retour`, collection_options: { fields: 'eventually_due' } });
    return { url: link.url, expiresAt: link.expires_at * 1000 };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Relit l'état du compte chez Stripe (retour d'onboarding, bouton « actualiser »). */
export const refreshDriverConnectAccountStatus = callable(
  input,
  async (_data, request) => {
    const caller = requireAuth(request);
    const { priv } = await loadDriver(caller.uid);
    if (!priv?.stripeAccountId) return { status: null };
    const account = await getStripe().accounts.retrieve(priv.stripeAccountId);
    const status = driverAccountStatus(account);
    await db.collection(COLLECTIONS.driverPrivate).doc(caller.uid).set({ stripeAccountStatus: status, updatedAt: Timestamp.now() }, { merge: true });
    return { status };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
