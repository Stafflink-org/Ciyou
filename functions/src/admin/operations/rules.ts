// Réglages de l'exploitation modifiables sans développeur, historisés et audités :
// règles automatiques des commandes (cahier §9), attribution des courses (§6) et
// rémunération des livreurs (§6, décision client : forfait < 2 km puis au km, par ville).
import {
  COLLECTIONS,
  DEFAULT_ORDER_RULES,
  DEFAULT_PRICING_BY_COUNTRY,
  REFUND_CAUSES,
  SETTINGS_DOCS,
  resolveDispatchRules,
  type City,
  type Country,
  type DispatchRules,
  type Zone,
} from '@golink/shared';
import { db, FieldValue } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { opsCallable, plain, writeSettingsHistory } from './common';

const bps = z.number().int().min(0).max(10_000);
const cents = z.number().int().min(0).max(1_000_000);

// ------------------------------------------------------------------ Attribution des courses

const dispatchSchema = z
  .object({
    strategy: z.enum(['nearest', 'nearest_with_rating', 'batched']),
    mode: z.enum(['auto_assign', 'offers']),
    engine: z.enum(['advanced', 'simple']),
    offerTimeoutSeconds: z.number().int().min(10).max(300),
    initialRadiusMeters: z.number().int().min(200).max(20_000),
    radiusStepMeters: z.number().int().min(100).max(10_000),
    maxRadiusMeters: z.number().int().min(500).max(40_000),
    maxRounds: z.number().int().min(1).max(10),
    dispatchLeadMinutes: z.number().int().min(0).max(60),
    maxConcurrentOrdersPerDriver: z.number().int().min(1).max(5),
    shortageRatioAlert: z.number().min(0.05).max(10),
    minDriverRating: z.number().min(1).max(5).nullable(),
  })
  .partial();

export const updateDispatchRules = opsCallable(
  z.object({ scope: z.enum(['platform', 'city', 'zone']), scopeId: zId.nullish(), rules: dispatchSchema.nullable(), reason: zReason }),
  async (data, request): Promise<{ rules: DispatchRules }> => {
    const { caller, admin } = await requireAdmin(request, data.scope === 'platform' ? 'order_rules.edit' : 'zones.edit');
    const platformRef = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dispatch);
    const platformSnap = await platformRef.get();
    const platform = platformSnap.exists ? (platformSnap.data() as Partial<DispatchRules>) : null;
    let docPath: string;
    let before: Record<string, unknown> | null;
    let after: Record<string, unknown> | null;
    let effective: DispatchRules;
    let cityId: string | null = null;
    let countryId: string | null = null;

    if (data.scope === 'platform') {
      if (!data.rules) throw fail.invalid('Les règles de la plateforme ne peuvent pas être supprimées.');
      effective = resolveDispatchRules(platform, data.rules);
      validateDispatch(effective);
      docPath = `${COLLECTIONS.settings}/${SETTINGS_DOCS.dispatch}`;
      before = plain(platform);
      after = { ...before, ...data.rules };
      await platformRef.set({ ...data.rules, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    } else {
      if (!data.scopeId) throw fail.invalid('Choisissez la ville ou la zone.');
      const collection = data.scope === 'city' ? COLLECTIONS.cities : COLLECTIONS.zones;
      const ref = db.collection(collection).doc(data.scopeId);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound(data.scope === 'city' ? 'Ville' : 'Zone');
      const doc = snap.data() as City | Zone;
      cityId = data.scope === 'city' ? snap.id : (doc as Zone).cityId;
      countryId = doc.countryId;
      assertAdminCovers(admin, cityId);
      let cityOverride: Partial<DispatchRules> | null = null;
      if (data.scope === 'zone') cityOverride = ((await db.collection(COLLECTIONS.cities).doc(cityId).get()).get('dispatch') as Partial<DispatchRules> | null) ?? null;
      const override = data.rules && Object.keys(data.rules).length > 0 ? data.rules : null;
      effective = data.scope === 'city' ? resolveDispatchRules(platform, override) : resolveDispatchRules(platform, cityOverride, override);
      validateDispatch(effective);
      docPath = `${collection}/${snap.id}`;
      before = plain(doc.dispatch ?? null);
      after = override ? { ...override } : null;
      await ref.update({ dispatch: override, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    }
    await writeSettingsHistory({ docPath: `${docPath}#dispatch`, before, after, reason: data.reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.rules ? 'dispatch_rules.updated' : 'dispatch_rules.reset',
      target: data.scope === 'platform' ? { type: 'other', id: 'dispatch', label: 'Attribution des courses' } : { type: data.scope, id: data.scopeId!, label: data.scopeId! },
      reason: data.reason,
      before,
      after,
      countryId,
      cityId,
      request,
    });
    return { rules: effective };
  },
);

function validateDispatch(rules: DispatchRules): void {
  if (rules.initialRadiusMeters > rules.maxRadiusMeters) throw fail.invalid('Le rayon initial doit être inférieur ou égal au rayon maximal.');
}

// ------------------------------------------------------------------ Règles automatiques des commandes

const stage = bps.nullable();
const orderRulesSchema = z
  .object({
    acceptanceTimeoutSeconds: z.number().int().min(60).max(1800),
    autoPause: z.object({ enabled: z.boolean(), missedOrdersInARow: z.number().int().min(1).max(20) }),
    merchantInactivity: z.object({ enabled: z.boolean(), alertAfterDays: z.number().int().min(1).max(120), removeAfterAlertDays: z.number().int().min(1).max(365) }),
    defaultPrepMinutes: z.number().int().min(5).max(120),
    maxPrepExtensionMinutes: z.number().int().min(0).max(120),
    customerCancellation: z.object({ pending: stage, accepted: stage, preparing: stage, ready: stage, picked_up: stage }),
    refundLiability: z.record(
      z.enum(REFUND_CAUSES as [string, ...string[]]),
      z.object({ restaurant: bps.optional(), courier: bps.optional(), platform: bps.optional() }),
    ),
    customerAbsent: z.object({
      driverWaitMinutes: z.number().int().min(1).max(60),
      payDriver: z.boolean(),
      refundCustomer: z.boolean(),
      payRestaurant: z.boolean(),
      callViaApp: z.boolean(),
      autoCloseGraceMinutes: z.number().int().min(0).max(120).optional(),
    }),
    itemUnavailable: z.object({ allowReplacement: z.boolean(), replacementTimeoutSeconds: z.number().int().min(30).max(1800) }),
    lateCredit: z.object({
      enabled: z.boolean(),
      tiers: z.array(z.object({ fromMinutes: z.number().int().min(1).max(240), rateBps: bps, maxCents: cents })).max(6),
      creditValidityDays: z.number().int().min(1).max(730),
    }),
    scheduledOrders: z.object({ enabled: z.boolean(), minLeadMinutes: z.number().int().min(10).max(1440), maxDaysAhead: z.number().int().min(1).max(60) }),
    claimWindowHours: z.number().int().min(1).max(720),
    lateToleranceMinutes: z.number().int().min(0).max(60),
    claims: z.object({
      photoRequired: z.boolean(),
      minPhotos: z.number().int().min(0).max(4),
      maxPhotos: z.number().int().min(1).max(8),
      checkPhotoDate: z.boolean(),
      checkDuplicates: z.boolean(),
      repeatThreshold30d: z.number().int().min(1).max(20),
      autoAcceptMaxCents: cents,
    }),
  })
  .partial();

export const updateOrderRules = opsCallable(
  z.object({ scope: z.enum(['platform', 'country', 'city']), scopeId: zId.nullish(), rules: orderRulesSchema.nullable(), reason: zReason }),
  async (data, request): Promise<{ updatedFields: string[] }> => {
    const { caller, admin } = await requireAdmin(request, 'order_rules.edit');
    const rules = data.rules ? { ...data.rules } : null;
    if (rules?.refundLiability) {
      for (const [cause, split] of Object.entries(rules.refundLiability)) {
        const total = (split.restaurant ?? 0) + (split.courier ?? 0) + (split.platform ?? 0);
        if (total !== 10_000) throw fail.invalid(`Imputation « ${cause} » : la répartition doit totaliser 100 %.`);
      }
    }
    if (rules?.lateCredit?.tiers) rules.lateCredit.tiers = [...rules.lateCredit.tiers].sort((a, b) => a.fromMinutes - b.fromMinutes);
    let docPath: string;
    let before: Record<string, unknown> | null;
    let after: Record<string, unknown> | null;
    let cityId: string | null = null;
    let countryId: string | null = null;

    if (data.scope === 'platform') {
      if (!rules) throw fail.invalid('Les règles de la plateforme ne peuvent pas être supprimées.');
      const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.orderRules);
      const snap = await ref.get();
      before = plain(snap.exists ? snap.data() : DEFAULT_ORDER_RULES);
      after = { ...before, ...rules };
      // Vente d'alcool : interdite et verrouillée (décision du client), quelle que soit la saisie.
      await ref.set(
        { ...rules, alcohol: { ...DEFAULT_ORDER_RULES.alcohol, enabled: false, locked: true }, acceptanceTimeoutAction: 'cancel_and_refund', updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid },
        { merge: true },
      );
      docPath = `${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`;
    } else {
      if (!data.scopeId) throw fail.invalid('Choisissez le pays ou la ville.');
      if (data.scope === 'country' && admin.role !== 'super_admin' && admin.cityIds.length > 0) throw fail.forbidden('Les règles d’un pays relèvent de l’équipe centrale.');
      const collection = data.scope === 'country' ? COLLECTIONS.countries : COLLECTIONS.cities;
      const ref = db.collection(collection).doc(data.scopeId);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound(data.scope === 'country' ? 'Pays' : 'Ville');
      const doc = snap.data() as Country | City;
      if (data.scope === 'city') {
        cityId = snap.id;
        countryId = (doc as City).countryId;
        assertAdminCovers(admin, cityId);
      } else countryId = snap.id;
      before = plain(doc.orderRules ?? null);
      after = rules && Object.keys(rules).length > 0 ? (JSON.parse(JSON.stringify(rules)) as Record<string, unknown>) : null;
      await ref.update({ orderRules: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      docPath = `${collection}/${snap.id}`;
    }
    const fields = await writeSettingsHistory({ docPath: data.scope === 'platform' ? docPath : `${docPath}#orderRules`, before, after, reason: data.reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: rules ? 'order_rules.updated' : 'order_rules.reset',
      target: data.scope === 'platform' ? { type: 'other', id: 'orderRules', label: 'Règles des commandes' } : { type: data.scope === 'city' ? 'city' : 'other', id: data.scopeId!, label: data.scopeId! },
      reason: data.reason,
      before,
      after,
      countryId,
      cityId,
      sensitive: true,
      request,
    });
    return { updatedFields: fields };
  },
);

// ------------------------------------------------------------------ Rémunération des livreurs

const courierSchema = z.object({
  model: z.enum(['flat_then_per_km', 'pickup_dropoff_per_km']),
  flatDistanceThresholdMeters: z.number().int().min(0).max(20_000),
  flatAmountCents: cents,
  perKmCents: cents,
  perKmMode: z.enum(['beyond_threshold', 'full_distance']),
  peakBonusCents: cents,
  peakHours: z.array(z.number().int().min(0).max(23)).max(24),
  freeWaitMinutes: z.number().int().min(0).max(60),
  waitingPerMinuteCents: cents,
  minimumPerOrderCents: cents,
  hourlyGuaranteeEnabled: z.boolean(),
  hourlyGuaranteeCents: cents,
});

export const updateCourierPay = opsCallable(
  z.object({ scope: z.enum(['country', 'city']), scopeId: zId, courier: courierSchema.nullable(), reason: zReason }),
  async (data, request): Promise<{ updatedFields: string[] }> => {
    const { caller, admin } = await requireAdmin(request, 'drivers.pay_rules');
    const collection = data.scope === 'country' ? COLLECTIONS.countries : COLLECTIONS.cities;
    const ref = db.collection(collection).doc(data.scopeId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound(data.scope === 'country' ? 'Pays' : 'Ville');
    const doc = snap.data() as Country | City;
    const cityId = data.scope === 'city' ? snap.id : null;
    const countryId = data.scope === 'city' ? (doc as City).countryId : snap.id;
    if (cityId) assertAdminCovers(admin, cityId);
    else if (admin.role !== 'super_admin' && admin.cityIds.length > 0) throw fail.forbidden('Le barème d’un pays relève de l’équipe centrale.');

    let before: Record<string, unknown> | null;
    let after: Record<string, unknown> | null;
    if (data.scope === 'country') {
      if (!data.courier) throw fail.invalid('Le barème du pays ne peut pas être supprimé.');
      const country = doc as Country;
      const base = country.pricing ?? DEFAULT_PRICING_BY_COUNTRY[snap.id];
      if (!base) throw fail.precondition('La tarification de ce pays n’est pas configurée.');
      before = plain(base.courier);
      after = { ...before, ...data.courier };
      await ref.update({ pricing: { ...base, courier: after }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    } else {
      const city = doc as City;
      before = plain(city.pricing?.courier ?? null);
      after = data.courier ? { ...data.courier } : null;
      const pricing = { ...(city.pricing ?? {}) } as Record<string, unknown>;
      if (after) pricing.courier = after;
      else delete pricing.courier;
      await ref.update({ pricing: Object.keys(pricing).length ? pricing : null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    }
    const fields = await writeSettingsHistory({ docPath: `${collection}/${snap.id}#courier`, before, after, reason: data.reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.courier ? 'courier_pay.updated' : 'courier_pay.reset',
      target: data.scope === 'city' ? { type: 'city', id: snap.id, label: (doc as City).name } : { type: 'other', id: snap.id, label: (doc as Country).name },
      reason: data.reason,
      before,
      after,
      countryId,
      cityId,
      sensitive: true,
      request,
    });
    return { updatedFields: fields };
  },
);

