// Synchronisation des réglages vers la fiche publique : une écriture directe dans
// restaurants/{rid}/settings (autorisée par les règles) est recopiée sur la fiche
// et les moyens de paiement non autorisés sont retirés. Idempotent : aucune
// écriture si la fiche est déjà à jour.
import {
  COLLECTIONS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type Restaurant,
  type RestaurantHours,
  type RestaurantOrderSettings,
  type RestaurantPaymentSettings,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../lib/admin';
import { allowedPaymentMethods, CONFIG_TRIGGER_OPTIONS, enabledFulfillmentModes, loadConfigContext, restaurantRef } from './config-context';
import { acceptedMethodsOf, etaFor, fulfillmentModesOf } from './settings';

/** Sérialisation à clés triées : l'ordre des champs renvoyé par Firestore n'est pas garanti. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b);

export const onRestaurantSettingsWrite = onDocumentWritten({ document: `${COLLECTIONS.restaurants}/{rid}/${SUBCOLLECTIONS.restaurants.settings}/{docId}`, ...CONFIG_TRIGGER_OPTIONS },
  async (event) => {
    const { rid, docId } = event.params;
    const after = event.data?.after.data();
    if (!after) return;
    const tracked: string[] = [RESTAURANT_SETTINGS_DOCS.orders, RESTAURANT_SETTINGS_DOCS.hours, RESTAURANT_SETTINGS_DOCS.payments];
    if (!tracked.includes(docId)) return;

    const snap = await restaurantRef(rid).get();
    if (!snap.exists) return;
    const restaurant = snap.data() as Restaurant;
    const patch: Record<string, unknown> = {};

    if (docId === RESTAURANT_SETTINGS_DOCS.orders) {
      const settings = after as RestaurantOrderSettings;
      // Interrupteurs de fonctionnalités (§24) : un mode éteint pour ce commerce n'est pas proposé.
      const modes = enabledFulfillmentModes(await loadConfigContext(rid, restaurant), fulfillmentModesOf(settings));
      if (!same(modes, restaurant.fulfillmentModes)) patch.fulfillmentModes = modes;
      if (settings.prepMinutes !== restaurant.prepMinutes) {
        patch.prepMinutes = settings.prepMinutes;
        patch.etaMinutes = etaFor(restaurant, settings.prepMinutes);
      }
      if (settings.minOrderCents !== restaurant.minOrderCents) patch.minOrderCents = settings.minOrderCents;
    }

    if (docId === RESTAURANT_SETTINGS_DOCS.hours) {
      const hours = after as RestaurantHours;
      const summary = { days: hours.days, exceptions: hours.exceptions ?? [], timezone: hours.timezone ?? restaurant.hoursSummary?.timezone ?? 'Europe/Paris' };
      if (!same(summary, restaurant.hoursSummary)) patch.hoursSummary = summary;
    }

    if (docId === RESTAURANT_SETTINGS_DOCS.payments) {
      const ctx = await loadConfigContext(rid, restaurant);
      const allowed = allowedPaymentMethods(ctx);
      const settings = after as RestaurantPaymentSettings;
      const accepted = acceptedMethodsOf(settings, allowed);
      if (!same(accepted, restaurant.acceptedPaymentMethods)) patch.acceptedPaymentMethods = accepted;
      // Moyens activés sans autorisation : retirés du réglage lui-même.
      const cleaned = Object.fromEntries(
        Object.entries(settings.methods ?? {}).map(([method, on]) => [method, Boolean(on) && allowed.includes(method as never)]),
      );
      if (!same(cleaned, settings.methods)) {
        await event.data!.after.ref.update({ methods: cleaned });
      }
    }

    if (Object.keys(patch).length === 0) return;
    await restaurantRef(rid).update({ ...patch, updatedAt: Timestamp.now(), updatedBy: 'system' });
    logger.info('Fiche resynchronisée depuis les réglages', { rid, docId, fields: Object.keys(patch) });
  },
);

/** Fin des pauses temporaires : réouverture automatique à l'heure prévue. */
export const resumePausedRestaurants = onSchedule({ ...CONFIG_TRIGGER_OPTIONS, schedule: 'every 5 minutes', timeZone: 'Europe/Paris' }, async () => {
  const now = Timestamp.now();
  const snap = await db.collection(COLLECTIONS.restaurants).where('pausedUntil', '<=', now).limit(200).get();
  if (snap.empty) return;
  const writer = db.bulkWriter();
  for (const doc of snap.docs) {
    void writer.update(doc.ref, { isOpen: true, pausedUntil: null, pauseReason: null, updatedAt: now, updatedBy: 'system' });
  }
  await writer.close();
  logger.info('Pauses terminées', { count: snap.size });
});
