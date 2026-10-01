// Moyens de paiement enregistrés du client (ajout d'une carte, Stripe SetupIntent). Jusqu'ici
// `apps/client/src/features/profile/PaymentMethodsScreen.tsx` ne faisait que lire
// `users/{uid}/paymentMethods` (cartes masquées) : aucune fonction serveur n'existait pour en
// enregistrer une (la saisie de carte au moment de payer, elle, existe déjà — voir
// `functions/src/orders/payment.ts::authorizePayment` — mais sans jamais être rattachée à un
// client Stripe ni réutilisable depuis le profil).
import { COLLECTIONS, type SavedPaymentMethod, type UserPrivate, type UserProfile } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { getStripe } from '../lib/stripe';
import { z, zId } from '../lib/validation';

/** Client Stripe du compte, créé au premier besoin (jamais alimenté avant ce module). */
async function ensureStripeCustomer(uid: string): Promise<string> {
  const privateRef = db.collection(COLLECTIONS.userPrivate).doc(uid);
  const [privateSnap, userSnap] = await Promise.all([privateRef.get(), db.collection(COLLECTIONS.users).doc(uid).get()]);
  const existing = (privateSnap.data() as UserPrivate | undefined)?.stripeCustomerId;
  if (existing) return existing;
  const email = (userSnap.data() as UserProfile | undefined)?.email ?? undefined;
  const customer = await getStripe().customers.create({ email, metadata: { uid } });
  await privateRef.set({ stripeCustomerId: customer.id, updatedAt: Timestamp.now() }, { merge: true });
  return customer.id;
}

/** Prépare l'enregistrement d'une carte : le client confirme ensuite ce `clientSecret` avec `CardField`/`CardElement`. */
export const createSetupIntent = callable(
  z.object({}),
  async (_data, request) => {
    const caller = requireAuth(request);
    const customerId = await ensureStripeCustomer(caller.uid);
    const intent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });
    if (!intent.client_secret) throw fail.unavailable();
    return { clientSecret: intent.client_secret };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Après confirmation côté client : relit la carte sur Stripe et l'enregistre (marque/4 derniers chiffres seulement). */
export const savePaymentMethod = callable(
  z.object({ setupIntentId: zId }),
  async (data, request) => {
    const caller = requireAuth(request);
    const intent = await getStripe().setupIntents.retrieve(data.setupIntentId);
    if (intent.status !== 'succeeded' || typeof intent.payment_method !== 'string') {
      throw fail.precondition('Carte non confirmée.');
    }
    const pm = await getStripe().paymentMethods.retrieve(intent.payment_method);
    if (pm.customer !== (await ensureStripeCustomer(caller.uid))) throw fail.forbidden();
    const card = pm.card;
    if (!card) throw fail.invalid('Moyen de paiement invalide.');
    const col = db.collection(COLLECTIONS.users).doc(caller.uid).collection('paymentMethods');
    const isFirst = (await col.limit(1).get()).empty;
    const method: SavedPaymentMethod = {
      provider: 'stripe',
      providerMethodId: pm.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      wallet: null,
      isDefault: isFirst,
      createdAt: Timestamp.now(),
    };
    await col.doc(pm.id).set(method);
    return { id: pm.id };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
