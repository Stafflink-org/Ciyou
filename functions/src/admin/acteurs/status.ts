// Suspension temporaire ou définitive d'un commerce (motif, message, audit) et
// réactivation, manuelle ou automatique à la fin d'une suspension temporaire.
import { COLLECTIONS, type Restaurant, type RestaurantStatus } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin, type Caller } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import {
  ACTEURS_SCHEDULE_RUNTIME,
  TIMEZONE,
  acteursCallable,
  auditRestaurant,
  loadRestaurantFor,
  notifyRestaurantOwner,
  type RestaurantWithRef,
} from './common';
import { reactivationEmail, suspensionEmail } from './emails';

const MAX_SUSPENSION_DAYS = 365;

function formatUntil(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, dateStyle: 'long', timeStyle: 'short' }).format(date);
}

/** Suspend un commerce déjà chargé (utilisé aussi par les actions groupées). */
export async function applySuspension(
  caller: Caller,
  restaurant: RestaurantWithRef,
  input: { kind: 'temporary' | 'permanent'; until: Date | null; reason: string; message?: string | null },
  options: { notify?: boolean; auditExtra?: Record<string, unknown> } = {},
): Promise<{ status: RestaurantStatus }> {
  const current = restaurant.data.status;
  if (current === 'closed' && input.kind === 'permanent') throw fail.precondition('Ce commerce est déjà fermé définitivement.');
  const status: RestaurantStatus = input.kind === 'permanent' ? 'closed' : 'suspended';
  const previousStatus = restaurant.data.suspension?.previousStatus ?? (current === 'suspended' || current === 'closed' ? 'active' : current);
  await restaurant.ref.update({
    status,
    isOpen: false,
    acceptingOrders: false,
    suspension: {
      reason: input.reason,
      until: input.until ? Timestamp.fromDate(input.until) : null,
      at: Timestamp.now(),
      by: caller.uid,
      kind: input.kind,
      previousStatus,
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  await auditRestaurant(caller, restaurant, input.kind === 'permanent' ? 'restaurant.closed' : 'restaurant.suspended', {
    reason: input.reason,
    before: { status: current },
    after: { status, until: input.until?.toISOString() ?? null, ...options.auditExtra },
    sensitive: true,
  });
  if (options.notify !== false) {
    await notifyRestaurantOwner(restaurant, {
      title: input.kind === 'permanent' ? 'Établissement retiré de Ciyou Eats' : 'Établissement suspendu',
      body: `Motif : ${input.reason}`,
      category: 'account',
      email: suspensionEmail({
        restaurantName: restaurant.data.name,
        reason: input.reason,
        until: input.until ? formatUntil(input.until) : null,
        permanent: input.kind === 'permanent',
        message: input.message,
      }),
      templateKey: input.kind === 'permanent' ? 'restaurant_closed' : 'restaurant_suspended',
    });
  }
  return { status };
}

/** Réactive un commerce suspendu ou fermé. */
export async function applyReactivation(
  caller: Caller | null,
  restaurant: RestaurantWithRef,
  reason: string,
  options: { notify?: boolean } = {},
): Promise<{ status: RestaurantStatus }> {
  const current = restaurant.data.status;
  if (current !== 'suspended' && current !== 'closed') throw fail.precondition('Ce commerce n’est pas suspendu.');
  const previous = restaurant.data.suspension?.previousStatus;
  const status: RestaurantStatus =
    restaurant.data.onboardingStatus !== 'approved' ? 'onboarding' : previous === 'paused' ? 'paused' : 'active';
  await restaurant.ref.update({
    status,
    suspension: null,
    documentsBlockedAt: null,
    documentsBlockedTypes: [],
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller?.uid ?? 'system',
  });
  const audit = { reason, before: { status: current, suspension: restaurant.data.suspension?.reason ?? null }, after: { status }, sensitive: true };
  if (caller) await auditRestaurant(caller, restaurant, 'restaurant.reactivated', audit);
  else
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: 'restaurant.reactivated',
      target: { type: 'restaurant', id: restaurant.id, label: restaurant.data.name },
      ...audit,
      countryId: restaurant.data.countryId,
      cityId: restaurant.data.cityId,
    });
  if (options.notify !== false) {
    await notifyRestaurantOwner(restaurant, {
      title: 'Établissement réactivé',
      body: 'Vous pouvez de nouveau recevoir des commandes.',
      category: 'account',
      email: reactivationEmail({ restaurantName: restaurant.data.name }),
      templateKey: 'restaurant_reactivated',
    });
  }
  return { status };
}

const suspendSchema = z
  .object({
    restaurantId: zId,
    kind: z.enum(['temporary', 'permanent']),
    until: z.iso.datetime({ offset: true }).nullish(),
    reason: zReason,
    message: z.string().trim().max(1000).nullish(),
  })
  .refine((d) => d.kind === 'permanent' || Boolean(d.until), { message: 'Indiquez la date de fin de suspension', path: ['until'] });

export const suspendRestaurant = acteursCallable(
  suspendSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.suspend');
    const restaurant = await loadRestaurantFor(admin, data.restaurantId);
    let until: Date | null = null;
    if (data.kind === 'temporary' && data.until) {
      until = new Date(data.until);
      const now = Date.now();
      if (until.getTime() <= now + 5 * 60_000) throw fail.invalid('La fin de suspension doit être dans le futur.');
      if (until.getTime() > now + MAX_SUSPENSION_DAYS * 86_400_000) throw fail.invalid('Une suspension temporaire ne peut pas dépasser un an.');
    }
    return applySuspension(caller, restaurant, { kind: data.kind, until, reason: data.reason, message: data.message });
  },
  { secrets: EMAIL_SECRETS },
);

export const reactivateRestaurant = acteursCallable(
  z.object({ restaurantId: zId, reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.suspend');
    const restaurant = await loadRestaurantFor(admin, data.restaurantId);
    return applyReactivation(caller, restaurant, data.reason);
  },
  { secrets: EMAIL_SECRETS },
);

/** Fin des suspensions temporaires arrivées à échéance (toutes les heures). */
export const liftExpiredSuspensions = onSchedule(
  { schedule: 'every 60 minutes', timeZone: TIMEZONE, ...ACTEURS_SCHEDULE_RUNTIME, secrets: EMAIL_SECRETS },
  async () => {
    const snap = await db.collection(COLLECTIONS.restaurants).where('status', '==', 'suspended').get();
    const now = Date.now();
    let lifted = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as Restaurant;
      const until = data.suspension?.until?.toMillis();
      if (data.suspension?.kind !== 'temporary' || !until || until > now) continue;
      await applyReactivation(null, { id: doc.id, data, ref: doc.ref }, 'Fin de la suspension temporaire');
      lifted += 1;
    }
    logger.info('Suspensions temporaires levées', { lifted });
  },
);
