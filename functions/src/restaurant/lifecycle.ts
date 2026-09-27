// Cycle de vie automatique des commerces : validation automatique des dossiers complets et
// inactivité (décision client n° 18) : e-mail d'alerte après N jours sans commande, puis retrait
// de la plateforme N jours après l'alerte (désactivation + corbeille, données légales conservées).
// Toutes les durées viennent des règles de commande (plateforme, pays ou ville) du super admin.
import {
  ACTIVE_ORDER_STATUSES,
  COLLECTIONS,
  DEFAULT_ORDER_RULES,
  SETTINGS_DOCS,
  merchantInactivityAction,
  type Restaurant,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z } from '../lib/validation';
import { fail } from '../lib/errors';
import { requireAdmin } from '../lib/permissions';
import { OPS_RUNTIME } from '../admin/operations/common';
import { loadMarket, loadOrderRules } from '../orders/context';
import { sendPlatformMessage } from '../notifications/messages';
import { restaurantStaffTargets } from '../notifications/order-messages';
import { moveToTrash } from '../platform/backups';
import { tryAutoValidateRestaurant } from './auto-validation';

const DAY_MS = 86_400_000;

export interface LifecycleReport {
  validated: number;
  suggested: number;
  alerted: number;
  removed: number;
  reset: number;
  examined: number;
}

/**
 * Données de démonstration protégées : la plateforme ne retire jamais un commerce de test ou
 * de démonstration, sauf s'il est explicitement marqué `inactivityDemo` (jeu d'essai de la règle).
 */
function protectedFromRemoval(data: Restaurant & { seed?: boolean; test?: boolean; inactivityDemo?: boolean }): boolean {
  return (data.seed === true || data.test === true) && data.inactivityDemo !== true;
}

async function trashRetentionDays(): Promise<number> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.retention).get();
  return (snap.get('trashRetentionDays') as number | undefined) ?? 30;
}

function frDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));
}

export async function runMerchantLifecycle(options: { restaurantId?: string | null; nowMs?: number } = {}): Promise<LifecycleReport> {
  const report: LifecycleReport = { validated: 0, suggested: 0, alerted: 0, removed: 0, reset: 0, examined: 0 };
  const nowMs = options.nowMs ?? Date.now();

  // 1. Dossiers complets en attente : validation automatique (règle activable).
  const pending = options.restaurantId
    ? [await db.collection(COLLECTIONS.restaurants).doc(options.restaurantId).get()].filter((s) => s.exists)
    : (await db.collection(COLLECTIONS.restaurants).where('status', '==', 'onboarding').where('onboardingStatus', '==', 'pending').limit(100).get()).docs;
  for (const doc of pending) {
    const data = doc.data() as Restaurant;
    if (data.status !== 'onboarding' || data.onboardingStatus !== 'pending') continue;
    const result = await tryAutoValidateRestaurant(doc.id, 'sweep').catch((error: unknown) => {
      logger.error('Validation automatique en échec', { restaurantId: doc.id, error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (result?.outcome === 'approved') report.validated += 1;
    if (result?.outcome === 'suggested') report.suggested += 1;
  }

  // 2. Inactivité des commerces en ligne.
  const actives = options.restaurantId
    ? [await db.collection(COLLECTIONS.restaurants).doc(options.restaurantId).get()].filter((s) => s.exists)
    : (await db.collection(COLLECTIONS.restaurants).where('status', '==', 'active').limit(1000).get()).docs;
  const rulesByCity = new Map<string, Awaited<ReturnType<typeof loadOrderRules>>>();
  const retention = await trashRetentionDays();

  for (const doc of actives) {
    const restaurant = doc.data() as Restaurant & { seed?: boolean; test?: boolean; inactivityDemo?: boolean };
    if (restaurant.status !== 'active' || restaurant.deletedAt) continue;
    report.examined += 1;
    const cityKey = `${restaurant.countryId}/${restaurant.cityId}`;
    if (!rulesByCity.has(cityKey)) rulesByCity.set(cityKey, await loadOrderRules(await loadMarket(restaurant.countryId, restaurant.cityId)));
    const rules = rulesByCity.get(cityKey) ?? DEFAULT_ORDER_RULES;
    const policy = rules.merchantInactivity;
    if (!policy?.enabled) continue;
    const demo = restaurant.seed === true || restaurant.test === true;

    const lastOrderMs = restaurant.lastOrderAt?.toMillis() ?? 0;
    const startedMs = restaurant.launchedAt?.toMillis() ?? restaurant.createdAt?.toMillis?.() ?? nowMs;
    const referenceMs = Math.max(lastOrderMs, startedMs);
    const alertMs = restaurant.inactivityAlertAt?.toMillis() ?? null;

    // Une commande est arrivée depuis l'alerte : le compteur repart de zéro.
    if (alertMs && lastOrderMs > alertMs) {
      await doc.ref.update({ inactivityAlertAt: null, inactivityRemovalDueAt: null, updatedAt: Timestamp.now(), updatedBy: 'system' });
      report.reset += 1;
      continue;
    }

    const daysWithout = Math.floor((nowMs - referenceMs) / DAY_MS);
    if (!alertMs) {
      if (merchantInactivityAction(daysWithout, { inactivityAlertDays: policy.alertAfterDays, inactivityRemovalDaysAfterAlert: policy.removeAfterAlertDays }) === 'none') continue;
      if (protectedFromRemoval(restaurant)) continue;
      const removalDue = nowMs + policy.removeAfterAlertDays * DAY_MS;
      await doc.ref.update({ inactivityAlertAt: Timestamp.fromMillis(nowMs), inactivityRemovalDueAt: Timestamp.fromMillis(removalDue), updatedAt: Timestamp.now(), updatedBy: 'system' });
      const targets = await restaurantStaffTargets(doc.id, demo);
      await Promise.all(
        targets.map((t) => sendPlatformMessage('restaurant_inactivity_warning', t, { restaurantName: restaurant.name, date: frDate(referenceMs), days: daysWithout, removalDate: frDate(removalDue) }, { dedupeKey: `${doc.id}-${nowMs}`, link: { type: 'page', target: '/' } })),
      );
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'restaurant.inactivity_alert',
        target: { type: 'restaurant', id: doc.id, label: restaurant.name },
        reason: `${daysWithout} jours sans commande (seuil ${policy.alertAfterDays} jours) : e-mail d’alerte envoyé, retrait prévu le ${frDate(removalDue)}.`,
        after: { inactivityAlertAt: new Date(nowMs).toISOString(), removalDueAt: new Date(removalDue).toISOString() },
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
      });
      report.alerted += 1;
      continue;
    }

    const removalDueMs = restaurant.inactivityRemovalDueAt?.toMillis() ?? alertMs + policy.removeAfterAlertDays * DAY_MS;
    if (nowMs < removalDueMs || protectedFromRemoval(restaurant)) continue;
    // Une commande encore en cours retarde le retrait d'un passage.
    const open = await db.collection(COLLECTIONS.orders).where('restaurantId', '==', doc.id).where('status', 'in', [...ACTIVE_ORDER_STATUSES]).limit(1).get();
    if (!open.empty) continue;

    const removedAt = Timestamp.fromMillis(nowMs);
    await moveToTrash({
      entity: { type: 'restaurant', id: doc.id, label: restaurant.name },
      path: `${COLLECTIONS.restaurants}/${doc.id}`,
      snapshot: { ...restaurant } as unknown as Record<string, unknown>,
      restaurantId: doc.id,
      deletedBy: 'system',
      reason: `Inactivité : aucune commande depuis ${daysWithout} jours`,
      retentionDays: retention,
    });
    await doc.ref.update({
      status: 'closed',
      isOpen: false,
      acceptingOrders: false,
      deletedAt: removedAt,
      removedForInactivityAt: removedAt,
      suspension: { reason: `Retrait pour inactivité (${daysWithout} jours sans commande)`, until: null, at: removedAt, by: 'system', kind: 'permanent', previousStatus: 'active' },
      updatedAt: removedAt,
      updatedBy: 'system',
    });
    const targets = await restaurantStaffTargets(doc.id, demo);
    await Promise.all(targets.map((t) => sendPlatformMessage('restaurant_removed_inactive', t, { restaurantName: restaurant.name, days: daysWithout }, { dedupeKey: `${doc.id}-${nowMs}` })));
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: 'restaurant.removed_inactive',
      target: { type: 'restaurant', id: doc.id, label: restaurant.name },
      reason: `Aucune commande depuis ${daysWithout} jours malgré l’alerte du ${frDate(alertMs)} : retrait de la plateforme (corbeille, données légales conservées).`,
      before: { status: 'active', lastOrderAt: restaurant.lastOrderAt ? restaurant.lastOrderAt.toDate().toISOString() : null },
      after: { status: 'closed', deletedAt: removedAt.toDate().toISOString() },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      sensitive: true,
    });
    report.removed += 1;
  }
  return report;
}

export const runMerchantAutomations = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Europe/Paris', maxInstances: 1, memory: '512MiB', timeoutSeconds: 540, retryCount: 0, cpu: 'gcf_gen1', secrets: EMAIL_SECRETS },
  async () => {
    const report = await runMerchantLifecycle();
    if (report.validated + report.alerted + report.removed + report.reset > 0) logger.info('Cycle de vie des commerces', { ...report });
  },
);

/** « Contrôler maintenant » : rejoue le cycle (validation automatique, inactivité) et le consigne. */
export const runMerchantLifecycleNow = callable(
  z.object({ restaurantId: z.string().trim().min(1).max(128).nullish() }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.validate');
    if (admin.role !== 'super_admin' && admin.cityIds.length > 0) {
      if (!data.restaurantId) throw fail.forbidden('Le contrôle de tous les commerces est réservé à l’équipe centrale.');
      const city = (await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get()).get('cityId') as string | undefined;
      if (!city || !admin.cityIds.includes(city)) throw fail.forbidden('Ce commerce est hors de votre périmètre.');
    }
    const report = await runMerchantLifecycle({ restaurantId: data.restaurantId ?? null });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'merchant_lifecycle.run',
      target: { type: 'other', id: data.restaurantId ?? 'restaurants', label: 'Contrôle des commerces' },
      after: { ...report },
      request,
    });
    return report;
  },
  { ...OPS_RUNTIME, secrets: EMAIL_SECRETS, timeoutSeconds: 300 },
);
