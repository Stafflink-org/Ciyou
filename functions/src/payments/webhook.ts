// Point de terminaison des webhooks Stripe. La signature est vérifiée avec le
// secret du point de terminaison (STRIPE_WEBHOOK_SECRET, « whsec_… ») ; tant
// qu'il n'est pas configuré, les appels sont refusés.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  type PaymentStatus,
  type RestaurantCommercial,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import type Stripe from 'stripe';
import { db, Timestamp } from '../lib/admin';
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from '../lib/secrets';
import { getStripe } from '../lib/stripe';
import { accountStatus, payoutUnlock } from './connect';
import { driverAccountStatus } from './driver-connect';
import { handleFinanceEvent } from './finance-events';

async function onAccountUpdated(account: Stripe.Account): Promise<void> {
  const driverId = account.metadata?.driverId;
  if (driverId) {
    await db.collection(COLLECTIONS.driverPrivate).doc(driverId).set({ stripeAccountId: account.id, stripeAccountStatus: driverAccountStatus(account), updatedAt: Timestamp.now() }, { merge: true });
    return;
  }
  const restaurantId = account.metadata?.restaurantId;
  if (!restaurantId) return;
  const ref = db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.private)
    .doc(RESTAURANT_PRIVATE_DOCS.commercial);
  const snap = await ref.get();
  const commercial = snap.exists ? (snap.data() as RestaurantCommercial) : null;
  if (commercial?.stripeAccountId && commercial.stripeAccountId !== account.id) {
    logger.warn('Compte Stripe inattendu pour ce restaurant', { restaurantId, accountId: account.id });
    return;
  }
  const status = accountStatus(account);
  await ref.set(
    { stripeAccountId: account.id, stripeAccountStatus: status, ...payoutUnlock(status, commercial), updatedAt: Timestamp.now(), updatedBy: 'system' },
    { merge: true },
  );
}

/** Met à jour le paiement correspondant à l'intention de paiement, s'il existe. */
async function onPaymentIntent(intent: Stripe.PaymentIntent, status: PaymentStatus): Promise<void> {
  const snap = await db.collection(COLLECTIONS.payments).where('providerIntentId', '==', intent.id).limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return;
  await doc.ref.update({
    status,
    providerChargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge?.id ?? null),
    failureCode: intent.last_payment_error?.code ?? null,
    failureMessage: intent.last_payment_error?.message ?? null,
    updatedAt: Timestamp.now(),
  });
}

export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], cors: false, maxInstances: 3, cpu: 'gcf_gen1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Méthode non autorisée');
      return;
    }
    const secret = STRIPE_WEBHOOK_SECRET.value();
    if (!secret.startsWith('whsec_')) {
      logger.error('Secret du webhook Stripe non configuré');
      res.status(503).send('Webhook non configuré');
      return;
    }
    const signature = req.get('stripe-signature');
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.rawBody, signature ?? '', secret);
    } catch (error) {
      logger.warn('Signature Stripe invalide', { error: error instanceof Error ? error.message : String(error) });
      res.status(400).send('Signature invalide');
      return;
    }

    try {
      switch (event.type) {
        case 'account.updated':
          await onAccountUpdated(event.data.object);
          break;
        case 'payment_intent.succeeded':
          await onPaymentIntent(event.data.object, 'paid');
          break;
        case 'payment_intent.payment_failed':
          await onPaymentIntent(event.data.object, 'failed');
          break;
        case 'payment_intent.canceled':
          await onPaymentIntent(event.data.object, 'cancelled');
          break;
        case 'payment_intent.requires_action':
          await onPaymentIntent(event.data.object, 'requires_action');
          break;
        default:
          if (!(await handleFinanceEvent(event))) logger.info('Évènement Stripe ignoré', { type: event.type });
      }
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error('Traitement du webhook Stripe en échec', { type: event.type, error: error instanceof Error ? error.stack : String(error) });
      // Stripe relance automatiquement les livraisons en échec.
      res.status(500).send('Erreur de traitement');
    }
  },
);
