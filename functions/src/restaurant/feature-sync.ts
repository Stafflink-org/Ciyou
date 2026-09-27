// Resynchronisation quand un interrupteur de fonctionnalité change (cahier §24) :
// « on allume ou on éteint sans nouvelle version ». Les fiches publiques des commerces
// (modes de commande proposés, moyens de paiement acceptés) sont recalculées à partir de
// leurs réglages et des interrupteurs ; le suivi du livreur est ouvert ou fermé au client
// pour les livraisons en cours. Les réglages saisis par les commerces ne sont jamais
// modifiés : un interrupteur rallumé rétablit tel quel ce que le commerce avait choisi.
import {
  ACTIVE_ORDER_STATUSES,
  COLLECTIONS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type DriverLocation,
  type FeatureFlag,
  type Order,
  type Restaurant,
  type RestaurantOrderSettings,
  type RestaurantPaymentSettings,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, Timestamp } from '../lib/admin';
import { isFeatureOn, loadFeatureFlags } from '../lib/features';
import { allowedPaymentMethods, enabledFulfillmentModes, loadConfigContext } from './config-context';
import { acceptedMethodsOf, fulfillmentModesOf } from './settings';

const SYNCED_KEYS = new Set(['delivery', 'pickup', 'dine_in', 'card_payment', 'cash_payment', 'restaurant_own_drivers', 'driver_tracking']);

const stable = (value: unknown): string => JSON.stringify(value ?? null);

/** Recalcule la fiche publique d'un commerce (modes et moyens de paiement) ; renvoie les champs modifiés. */
export async function resyncRestaurantFromFlags(restaurantId: string, restaurant: Restaurant): Promise<string[]> {
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const [ordersSnap, paymentsSnap, ctx] = await Promise.all([
    ref.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.orders).get(),
    ref.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.payments).get(),
    loadConfigContext(restaurantId, restaurant),
  ]);
  const patch: Record<string, unknown> = {};
  if (ordersSnap.exists) {
    const modes = enabledFulfillmentModes(ctx, fulfillmentModesOf(ordersSnap.data() as RestaurantOrderSettings));
    if (stable(modes) !== stable(restaurant.fulfillmentModes)) patch.fulfillmentModes = modes;
  }
  if (paymentsSnap.exists) {
    const accepted = acceptedMethodsOf(paymentsSnap.data() as RestaurantPaymentSettings, allowedPaymentMethods({ ...ctx, restaurant: { ...restaurant, ...(patch.fulfillmentModes ? { fulfillmentModes: patch.fulfillmentModes as Restaurant['fulfillmentModes'] } : {}) } }));
    if (stable(accepted) !== stable(restaurant.acceptedPaymentMethods)) patch.acceptedPaymentMethods = accepted;
  }
  const fields = Object.keys(patch);
  if (fields.length > 0) await ref.update({ ...patch, updatedAt: Timestamp.now(), updatedBy: 'system' });
  return fields;
}

/** Ouvre ou ferme la position du livreur au client pour les livraisons en cours. */
async function resyncDriverTracking(): Promise<number> {
  const orders = await db.collection(COLLECTIONS.orders).where('status', 'in', [...ACTIVE_ORDER_STATUSES]).limit(1000).get();
  let touched = 0;
  for (const doc of orders.docs) {
    const order = doc.data() as Order;
    const driverId = order.driverId ?? order.delivery?.driverId ?? null;
    if (!driverId) continue;
    const locationRef = db.collection(COLLECTIONS.driverLocations).doc(driverId);
    const location = (await locationRef.get()).data() as DriverLocation | undefined;
    if (!location) continue;
    const visible = new Set(location.visibleTo ?? []);
    const on = await isFeatureOn('driver_tracking', { restaurantId: order.restaurantId, cityId: order.cityId, countryId: order.countryId });
    const has = visible.has(order.customerId);
    if (on && !has) visible.add(order.customerId);
    else if (!on && has) visible.delete(order.customerId);
    else continue;
    await locationRef.update({ visibleTo: [...visible] });
    touched += 1;
  }
  return touched;
}

export const onFeatureFlagWrite = onDocumentWritten(
  { document: `${COLLECTIONS.featureFlags}/{key}`, maxInstances: 1, cpu: 'gcf_gen1', memory: '512MiB', timeoutSeconds: 540 },
  async (event) => {
    const key = event.params.key as string;
    if (!SYNCED_KEYS.has(key)) return;
    const before = event.data?.before.data() as FeatureFlag | undefined;
    const after = event.data?.after.data() as FeatureFlag | undefined;
    if (stable({ e: before?.enabled, o: before?.overrides }) === stable({ e: after?.enabled, o: after?.overrides })) return;
    await loadFeatureFlags(true);

    if (key === 'driver_tracking') {
      const touched = await resyncDriverTracking();
      logger.info('Suivi livreur resynchronisé', { touched });
      return;
    }
    let restaurants = 0;
    let updated = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let query = db.collection(COLLECTIONS.restaurants).orderBy('__name__').limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      for (const doc of page.docs) {
        restaurants += 1;
        try {
          const changed = await resyncRestaurantFromFlags(doc.id, doc.data() as Restaurant);
          if (changed.length > 0) updated += 1;
        } catch (error) {
          logger.error('Resynchronisation d’un commerce impossible', { restaurantId: doc.id, key, error: error instanceof Error ? error.message : String(error) });
        }
      }
      cursor = page.docs[page.docs.length - 1] ?? null;
      if (page.size < 200) break;
    }
    logger.info('Fiches resynchronisées après changement d’interrupteur', { key, restaurants, updated });
  },
);
