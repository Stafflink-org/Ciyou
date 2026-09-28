// Actions groupées sur une sélection de commerces (cahier §5, « tout se fait
// aussi en masse ») : commission, formule, fonctionnalité, message, suspension,
// réactivation, export. Chaque exécution est suivie dans bulkJobs et auditée.
import {
  COLLECTIONS,
  FEATURE_KEYS,
  adminHasPermission,
  type AdminPermission,
  type BulkActionResult,
  type BulkJob,
  type FeatureFlag,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { commercialPatchFor } from './bulk-helpers';
import { ACTEURS_HEAVY_RUNTIME, acteursCallable, adminActor, loadRestaurantFor, notifyRestaurantOwner, type RestaurantWithRef } from './common';
import { applyCommercialPatch } from './commercial';
import { partnerMessageEmail } from './emails';
import { applyReactivation, applySuspension } from './status';

const MAX_SELECTION = 300;
const zBps = z.number().int().min(0).max(10_000).nullish();

const schema = z.object({
  restaurantIds: z.array(zId).min(1).max(MAX_SELECTION),
  action: z.enum(['set_commission', 'set_plan', 'set_feature', 'send_message', 'suspend', 'reactivate', 'export']),
  reason: zReason,
  params: z
    .object({
      platformDeliveryBps: zBps,
      restaurantDeliveryBps: zBps,
      pickupBps: zBps,
      planCode: z.enum(['basic', 'pro', 'premium']).optional(),
      feature: z.enum(FEATURE_KEYS).optional(),
      enabled: z.boolean().optional(),
      subject: z.string().trim().min(3).max(120).optional(),
      message: z.string().trim().min(3).max(3000).optional(),
      until: z.iso.datetime({ offset: true }).nullish(),
      format: z.enum(['csv', 'xlsx']).optional(),
    })
    .default({}),
});

const REQUIRED: Record<z.output<typeof schema>['action'], AdminPermission[]> = {
  set_commission: ['restaurants.bulk', 'restaurants.commercial'],
  set_plan: ['restaurants.bulk', 'restaurants.commercial'],
  set_feature: ['restaurants.bulk', 'features.edit'],
  send_message: ['restaurants.bulk'],
  suspend: ['restaurants.bulk', 'restaurants.suspend'],
  reactivate: ['restaurants.bulk', 'restaurants.suspend'],
  export: ['exports.run'],
};

const JOB_TYPE: Record<z.output<typeof schema>['action'], BulkJob['type']> = {
  set_commission: 'bulk_update_restaurants',
  set_plan: 'bulk_update_restaurants',
  set_feature: 'bulk_update_restaurants',
  send_message: 'bulk_message',
  suspend: 'bulk_update_restaurants',
  reactivate: 'bulk_update_restaurants',
  export: 'export',
};

export const bulkRestaurantAction = acteursCallable(
  schema,
  async (data, request): Promise<BulkActionResult> => {
    const { caller, admin } = await requireAdmin(request);
    const missing = REQUIRED[data.action].filter((p) => !adminHasPermission(admin, p));
    if (missing.length > 0) throw fail.forbidden();
    const ids = [...new Set(data.restaurantIds)];
    const p = data.params;
    if (data.action === 'set_plan' && !p.planCode) throw fail.invalid('Choisissez la formule à appliquer.');
    if (data.action === 'set_feature' && (!p.feature || p.enabled === undefined)) throw fail.invalid('Choisissez la fonctionnalité et son état.');
    if (data.action === 'send_message' && (!p.subject || !p.message)) throw fail.invalid('Saisissez l’objet et le message.');
    let until: Date | null = null;
    if (data.action === 'suspend' && p.until) {
      until = new Date(p.until);
      if (until.getTime() <= Date.now()) throw fail.invalid('La fin de suspension doit être dans le futur.');
    }

    const now = Timestamp.now();
    const jobRef = db.collection(COLLECTIONS.bulkJobs).doc();
    const job: BulkJob = {
      type: JOB_TYPE[data.action],
      entity: 'restaurants',
      params: { action: data.action, ...p, restaurantIds: ids },
      input: null,
      format: data.action === 'export' ? (p.format ?? 'xlsx') : null,
      status: 'running',
      total: ids.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      output: null,
      reason: data.reason,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await jobRef.set(job);

    const errors: Array<{ id: string; message: string }> = [];
    let succeeded = 0;

    try {
      await runBulkAction();
    } catch (error) {
      // Une erreur non rattrapée (ex. transaction set_feature) ne doit jamais laisser le job
      // bloqué à 'running' : on le clôture en échec et on trace l'audit avant de relancer l'erreur.
      const message = error instanceof Error ? error.message : 'Échec';
      await jobRef.update({
        status: 'failed',
        processed: ids.length,
        succeeded,
        failed: ids.length - succeeded,
        errors: [{ id: '*', row: null, message }],
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit({
        actor: adminActor(caller),
        action: data.action === 'export' ? 'restaurants.exported' : `restaurants.bulk_${data.action}`,
        target: { type: 'other', id: jobRef.id, label: `${ids.length} commerces` },
        reason: data.reason,
        after: { action: data.action, count: ids.length, succeeded, failed: ids.length - succeeded, error: message, ...p },
        sensitive: true,
        request,
      });
      throw error;
    }

    await jobRef.update({
      status: errors.length === ids.length ? 'failed' : 'completed',
      processed: ids.length,
      succeeded,
      failed: errors.length,
      errors: errors.slice(0, 100).map((e) => ({ id: e.id, row: null, message: e.message })),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({
      actor: adminActor(caller),
      action: data.action === 'export' ? 'restaurants.exported' : `restaurants.bulk_${data.action}`,
      target: { type: 'other', id: jobRef.id, label: `${ids.length} commerces` },
      reason: data.reason,
      after: { action: data.action, count: ids.length, succeeded, failed: errors.length, ...p },
      sensitive: data.action !== 'send_message',
      request,
    });
    return { jobId: jobRef.id, succeeded, failed: errors.length, errors };

    async function runBulkAction(): Promise<void> {
    if (data.action === 'set_feature') {
      // Une seule écriture du drapeau : surcharges « restaurant » remplacées pour la sélection.
      const flagRef = db.collection(COLLECTIONS.featureFlags).doc(p.feature!);
      const restaurants: RestaurantWithRef[] = [];
      for (const id of ids) {
        try {
          restaurants.push(await loadRestaurantFor(admin, id));
        } catch (error) {
          errors.push({ id, message: error instanceof Error ? error.message : 'Commerce inaccessible' });
        }
      }
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(flagRef);
        if (!snap.exists) throw fail.notFound('Fonctionnalité');
        const flag = snap.data() as FeatureFlag;
        if (flag.locked) throw fail.precondition('Cette fonctionnalité est verrouillée par décision de la plateforme.');
        const selected = new Set(restaurants.map((r) => r.id));
        const overrides = flag.overrides.filter((o) => !(o.scope === 'restaurant' && selected.has(o.scopeId)));
        restaurants.forEach((r) => overrides.push({ scope: 'restaurant', scopeId: r.id, enabled: p.enabled! }));
        tx.update(flagRef, { overrides, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      });
      succeeded = restaurants.length;
    } else if (data.action === 'export') {
      succeeded = ids.length;
    } else {
      for (const [index, id] of ids.entries()) {
        try {
          const restaurant = await loadRestaurantFor(admin, id);
          switch (data.action) {
            case 'set_commission':
            case 'set_plan':
              await applyCommercialPatch(caller, restaurant, commercialPatchFor(data.action, p), data.reason);
              break;
            case 'send_message':
              await notifyRestaurantOwner(restaurant, {
                title: p.subject!,
                body: p.message!,
                category: 'announcement',
                email: partnerMessageEmail({ restaurantName: restaurant.data.name, subject: p.subject!, message: p.message! }),
                templateKey: 'restaurant_bulk_message',
              });
              break;
            case 'suspend':
              if (restaurant.data.status === 'suspended' || restaurant.data.status === 'closed') throw fail.precondition('Déjà suspendu.');
              await applySuspension(caller, restaurant, { kind: 'temporary', until, reason: data.reason, message: p.message ?? null }, { auditExtra: { bulkJobId: jobRef.id } });
              break;
            case 'reactivate':
              await applyReactivation(caller, restaurant, data.reason);
              break;
          }
          succeeded += 1;
        } catch (error) {
          errors.push({ id, message: error instanceof Error ? error.message : 'Échec' });
        }
        if ((index + 1) % 10 === 0) await jobRef.update({ processed: index + 1, succeeded, failed: errors.length, updatedAt: FieldValue.serverTimestamp() });
      }
    }
    }
  },
  { ...ACTEURS_HEAVY_RUNTIME, secrets: EMAIL_SECRETS },
);
