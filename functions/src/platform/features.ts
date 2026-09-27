// Activation des fonctionnalités (cahier §24) : valeur plateforme et surcharges par
// pays, ville, formule ou commerce (la plus spécifique l'emporte). Les fonctionnalités
// verrouillées par décision du client (vente d'alcool) ne peuvent pas être activées.
import { COLLECTIONS, FEATURE_KEYS, FEATURE_LABELS, type FeatureFlag } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { z, zId, zReason } from '../lib/validation';
import { platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

const overrideSchema = z.object({
  scope: z.enum(['country', 'city', 'plan', 'restaurant']),
  scopeId: zId,
  enabled: z.boolean(),
});

async function assertScopeExists(scope: z.infer<typeof overrideSchema>['scope'], scopeId: string): Promise<void> {
  const collection = scope === 'country' ? COLLECTIONS.countries : scope === 'city' ? COLLECTIONS.cities : scope === 'plan' ? COLLECTIONS.plans : COLLECTIONS.restaurants;
  const snap = await db.collection(collection).doc(scopeId).get();
  if (!snap.exists) throw fail.invalid(`Portée inconnue : ${scopeId}.`);
}

export const setFeatureFlag = platformCallable(
  z.object({
    key: z.enum(FEATURE_KEYS),
    enabled: z.boolean(),
    overrides: z.array(overrideSchema).max(200),
    description: z.string().trim().max(300).optional(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'features.edit');
    const ref = db.collection(COLLECTIONS.featureFlags).doc(data.key);
    const snap = await ref.get();
    const before = (snap.data() ?? null) as FeatureFlag | null;
    if (before?.locked) {
      throw fail.precondition(`« ${FEATURE_LABELS[data.key]} » est verrouillée par décision de la direction : elle ne peut pas être modifiée.`);
    }
    const seen = new Set<string>();
    for (const o of data.overrides) {
      const k = `${o.scope}:${o.scopeId}`;
      if (seen.has(k)) throw fail.invalid('Une même portée apparaît deux fois.');
      seen.add(k);
    }
    const added = data.overrides.filter((o) => !before?.overrides.some((b) => b.scope === o.scope && b.scopeId === o.scopeId));
    await Promise.all(added.map((o) => assertScopeExists(o.scope, o.scopeId)));

    const next = { enabled: data.enabled, overrides: data.overrides, ...(data.description !== undefined ? { description: data.description } : {}) };
    const change = await recordSettingsChange({
      docPath: `${COLLECTIONS.featureFlags}/${data.key}`,
      before: before ? { enabled: before.enabled, overrides: before.overrides, ...(data.description !== undefined ? { description: before.description } : {}) } : null,
      after: next,
      reason: data.reason,
      caller,
    });
    if (change.fields.length === 0) return { changedFields: [] };
    await ref.set(
      {
        key: data.key,
        description: data.description ?? before?.description ?? FEATURE_LABELS[data.key],
        locked: false,
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      },
      { merge: true },
    );
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'feature.updated',
      target: { type: 'setting', id: `${COLLECTIONS.featureFlags}/${data.key}`, label: FEATURE_LABELS[data.key] },
      reason: data.reason,
      before: change.before,
      after: change.after,
      request,
    });
    return { changedFields: change.fields };
  },
);
