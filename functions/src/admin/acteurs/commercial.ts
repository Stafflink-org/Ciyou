// Conditions commerciales d'un commerce (commission par défaut ou négociée,
// formule, mode de facturation, offre spéciale, moyens de paiement, reversements),
// fiche modifiée par l'équipe et groupes (chaînes, conditions communes).
import {
  BILLING_MODES,
  adminHasPermission,
  COLLECTIONS,
  CURRENCY_CODES,
  DEFAULT_PLANS,
  DISABLED_PAYMENT_METHODS,
  MERCHANT_TYPES,
  PAYMENT_METHODS,
  buildSearchKeywords,
  isMerchantCourier,
  type CommissionRule,
  type PaymentMethod,
  type Plan,
  type PlanCode,
  type RestaurantCommercial,
  type RestaurantGroup,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertFeatureOn } from '../../lib/features';
import { requireAdmin, type Caller } from '../../lib/permissions';
import { z, zId, zPhone, zReason } from '../../lib/validation';
import { acteursCallable, adminActor, auditRestaurant, loadRestaurantFor, type RestaurantWithRef } from './common';

const zBps = z.number().int().min(0).max(10_000);
const zCents = z.number().int().min(0).max(100_000_00);
const zPlan = z.enum(['basic', 'pro', 'premium']);
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');

function endOfDay(day: string): Timestamp {
  return Timestamp.fromDate(new Date(`${day}T23:59:59+02:00`));
}

type Rates = { platformDeliveryBps: number; restaurantDeliveryBps: number; pickupBps: number };

async function planCommission(code: PlanCode): Promise<Rates> {
  const snap = await db.collection(COLLECTIONS.plans).doc(code).get();
  const plan = snap.exists ? (snap.data() as Plan) : null;
  const fallback = DEFAULT_PLANS.find((p) => p.code === code) ?? DEFAULT_PLANS[0];
  return plan?.commission ?? fallback!.commission;
}

/** Nouvelle version du barème de commission du commerce (historique conservé). */
async function recordCommissionRule(
  caller: Caller,
  restaurant: RestaurantWithRef,
  rates: { platformDeliveryBps: number; restaurantDeliveryBps: number; pickupBps: number },
  reason: string,
  validTo: Timestamp | null,
): Promise<string> {
  const previous = await db
    .collection(COLLECTIONS.commissionRules)
    .where('scope', '==', 'restaurant')
    .where('scopeId', '==', restaurant.id)
    .orderBy('validFrom', 'desc')
    .limit(1)
    .get();
  const now = Timestamp.now();
  const ref = db.collection(COLLECTIONS.commissionRules).doc();
  const rule: CommissionRule = {
    scope: 'restaurant',
    scopeId: restaurant.id,
    countryId: restaurant.data.countryId,
    ...rates,
    validFrom: now,
    validTo,
    reason,
    supersedesId: previous.docs[0]?.id ?? null,
    createdAt: now,
    createdBy: caller.uid,
    updatedAt: now,
    updatedBy: caller.uid,
  };
  const batch = db.batch();
  batch.set(ref, rule);
  const last = previous.docs[0];
  if (last && !last.get('validTo')) batch.update(last.ref, { validTo: now, updatedAt: now, updatedBy: caller.uid });
  await batch.commit();
  return ref.id;
}

/** Contrôle et normalisation des moyens de paiement (décisions client). */
function checkPaymentMethods(methods: readonly PaymentMethod[], deliveredBy: string): PaymentMethod[] {
  const unique = [...new Set(methods)];
  const disabled = unique.filter((m) => DISABLED_PAYMENT_METHODS.includes(m));
  if (disabled.length > 0) throw fail.invalid('Les titres-restaurant ne sont pas acceptés sur Ciyou Eats.');
  if (unique.includes('wallet')) throw fail.invalid('Les avoirs Ciyou Eats sont toujours acceptés : ne les ajoutez pas ici.');
  if (unique.includes('cash') && !isMerchantCourier(deliveredBy === 'platform' ? 'platform' : 'restaurant')) {
    throw fail.invalid('Les espèces ne sont possibles que si le commerce livre avec ses propres livreurs salariés.');
  }
  if (!unique.some((m) => m === 'card' || m === 'apple_pay' || m === 'google_pay')) {
    throw fail.invalid('Autorisez au moins un moyen de paiement en ligne.');
  }
  return unique;
}

const termsSchema = z.object({
  restaurantId: zId,
  planCode: zPlan,
  billingMode: z.enum(BILLING_MODES as unknown as ['commission', 'subscription', 'hybrid']).nullable(),
  negotiatedCommission: z
    .object({
      platformDeliveryBps: zBps.nullable(),
      restaurantDeliveryBps: zBps.nullable(),
      pickupBps: zBps.nullable(),
      validUntil: zDay.nullable(),
    })
    .nullable(),
  specialOffer: z
    .object({ commissionReductionBps: zBps.min(1), endsAt: zDay, reason: z.string().trim().min(3).max(200) })
    .nullable(),
  allowedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).max(PAYMENT_METHODS.length),
  deliveryFeeOverrideCents: zCents.nullable(),
  minOrderOverrideCents: zCents.nullable(),
  payoutFrequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable(),
  reason: zReason,
});

export const updateCommercialTerms = acteursCallable(termsSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'restaurants.commercial');
  const restaurant = await loadRestaurantFor(admin, data.restaurantId);
  const commercialRef = restaurant.ref.collection('private').doc('commercial');
  const today = new Date().toISOString().slice(0, 10);
  if (data.negotiatedCommission?.validUntil && data.negotiatedCommission.validUntil < today) throw fail.invalid('La fin de validité des taux négociés est dépassée.');
  if (data.specialOffer && data.specialOffer.endsAt < today) throw fail.invalid('L’offre spéciale doit se terminer dans le futur.');
  const methods = checkPaymentMethods(data.allowedPaymentMethods, restaurant.data.deliveredBy);

  const negotiated =
    data.negotiatedCommission &&
    [data.negotiatedCommission.platformDeliveryBps, data.negotiatedCommission.restaurantDeliveryBps, data.negotiatedCommission.pickupBps].some((v) => v != null)
      ? {
          platformDeliveryBps: data.negotiatedCommission.platformDeliveryBps,
          restaurantDeliveryBps: data.negotiatedCommission.restaurantDeliveryBps,
          pickupBps: data.negotiatedCommission.pickupBps,
          reason: data.reason,
          validUntil: data.negotiatedCommission.validUntil ? endOfDay(data.negotiatedCommission.validUntil) : null,
        }
      : null;

  let before: RestaurantCommercial | null = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(commercialRef);
    before = snap.exists ? (snap.data() as RestaurantCommercial) : null;
    const next: Partial<RestaurantCommercial> = {
      planCode: data.planCode,
      billingMode: data.billingMode,
      negotiatedCommission: negotiated,
      specialOffer: data.specialOffer
        ? { commissionReductionBps: data.specialOffer.commissionReductionBps, reason: data.specialOffer.reason, endsAt: endOfDay(data.specialOffer.endsAt), subscriptionFreeUntil: null }
        : null,
      allowedPaymentMethods: methods,
      deliveryFeeOverrideCents: data.deliveryFeeOverrideCents,
      minOrderOverrideCents: data.minOrderOverrideCents,
      payoutFrequency: data.payoutFrequency,
      updatedAt: Timestamp.now(),
      updatedBy: caller.uid,
    };
    tx.set(commercialRef, next, { merge: true });
    tx.update(restaurant.ref, {
      planCode: data.planCode,
      acceptedPaymentMethods: restaurant.data.acceptedPaymentMethods.filter((m) => methods.includes(m)),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
  });

  const previous = before as RestaurantCommercial | null;
  const commissionChanged = JSON.stringify(previous?.negotiatedCommission ?? null, ['platformDeliveryBps', 'restaurantDeliveryBps', 'pickupBps']) !==
    JSON.stringify(negotiated, ['platformDeliveryBps', 'restaurantDeliveryBps', 'pickupBps']) || previous?.planCode !== data.planCode;
  let ruleId: string | null = null;
  if (commissionChanged) {
    const base = await planCommission(data.planCode);
    ruleId = await recordCommissionRule(
      caller,
      restaurant,
      {
        platformDeliveryBps: negotiated?.platformDeliveryBps ?? base.platformDeliveryBps,
        restaurantDeliveryBps: negotiated?.restaurantDeliveryBps ?? base.restaurantDeliveryBps,
        pickupBps: negotiated?.pickupBps ?? base.pickupBps,
      },
      data.reason,
      negotiated?.validUntil ?? null,
    );
  }
  await auditRestaurant(caller, restaurant, 'restaurant.commercial_updated', {
    reason: data.reason,
    before: previous
      ? {
          planCode: previous.planCode,
          billingMode: previous.billingMode ?? null,
          negotiatedCommission: previous.negotiatedCommission
            ? { platformDeliveryBps: previous.negotiatedCommission.platformDeliveryBps ?? null, restaurantDeliveryBps: previous.negotiatedCommission.restaurantDeliveryBps ?? null, pickupBps: previous.negotiatedCommission.pickupBps ?? null }
            : null,
          allowedPaymentMethods: previous.allowedPaymentMethods,
          payoutFrequency: previous.payoutFrequency ?? null,
        }
      : null,
    after: {
      planCode: data.planCode,
      billingMode: data.billingMode,
      negotiatedCommission: data.negotiatedCommission,
      specialOffer: data.specialOffer,
      allowedPaymentMethods: methods,
      deliveryFeeOverrideCents: data.deliveryFeeOverrideCents,
      minOrderOverrideCents: data.minOrderOverrideCents,
      payoutFrequency: data.payoutFrequency,
      commissionRuleId: ruleId,
    },
    sensitive: true,
    request,
  });
  return { commissionRuleId: ruleId };
});

/** Applique une formule ou des taux négociés sans toucher au reste (actions groupées). */
export async function applyCommercialPatch(
  caller: Caller,
  restaurant: RestaurantWithRef,
  patch: { planCode?: PlanCode; rates?: { platformDeliveryBps: number | null; restaurantDeliveryBps: number | null; pickupBps: number | null } },
  reason: string,
): Promise<void> {
  const commercialRef = restaurant.ref.collection('private').doc('commercial');
  const snap = await commercialRef.get();
  const before = snap.exists ? (snap.data() as RestaurantCommercial) : null;
  const next: Record<string, unknown> = { updatedAt: Timestamp.now(), updatedBy: caller.uid };
  if (patch.planCode) next.planCode = patch.planCode;
  if (patch.rates) {
    const any = Object.values(patch.rates).some((v) => v != null);
    next.negotiatedCommission = any ? { ...patch.rates, reason, validUntil: null } : null;
  }
  await commercialRef.set(next, { merge: true });
  if (patch.planCode) await restaurant.ref.update({ planCode: patch.planCode, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  const planCode = patch.planCode ?? before?.planCode ?? restaurant.data.planCode;
  const base = await planCommission(planCode);
  const rates = patch.rates ?? before?.negotiatedCommission ?? null;
  await recordCommissionRule(
    caller,
    restaurant,
    {
      platformDeliveryBps: rates?.platformDeliveryBps ?? base.platformDeliveryBps,
      restaurantDeliveryBps: rates?.restaurantDeliveryBps ?? base.restaurantDeliveryBps,
      pickupBps: rates?.pickupBps ?? base.pickupBps,
    },
    reason,
    null,
  );
  await auditRestaurant(caller, restaurant, 'restaurant.commercial_updated', {
    reason,
    before: { planCode: before?.planCode ?? null, negotiatedCommission: before?.negotiatedCommission ? { ...before.negotiatedCommission, validUntil: null } : null },
    after: { planCode, negotiatedCommission: patch.rates ?? null, bulk: true },
    sensitive: true,
  });
}

// ------------------------------------------------------------------ Fiche modifiée par l'équipe

const profileSchema = z.object({
  restaurantId: zId,
  name: z.string().trim().min(2).max(80),
  merchantType: z.enum(MERCHANT_TYPES),
  description: z.string().trim().max(1000).nullable(),
  phone: zPhone.nullable(),
  email: z.string().trim().toLowerCase().pipe(z.email('Adresse e-mail invalide')).nullable(),
  cuisineIds: z.array(z.string().trim().min(1).max(60)).max(8),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  zoneIds: z.array(zId).max(30),
  fulfillmentModes: z.array(z.enum(['delivery', 'pickup', 'dine_in'])).min(1),
  deliveredBy: z.enum(['platform', 'restaurant', 'both']),
  address: z.object({ line1: z.string().trim().min(3).max(120), line2: z.string().trim().max(120).nullable(), postalCode: z.string().trim().min(4).max(10), city: z.string().trim().min(2).max(80) }),
  /** Devise du compte (ISO 4217) : modifiable après la validation, avec motif et audit (cf. reviewRestaurantApplication pour la valeur initiale). */
  currency: z.enum(CURRENCY_CODES),
  reason: zReason,
});

export const adminUpdateRestaurant = acteursCallable(profileSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'restaurants.edit');
  const restaurant = await loadRestaurantFor(admin, data.restaurantId);
  if (data.zoneIds.length > 0) {
    const zones = await Promise.all(data.zoneIds.map((id) => db.collection(COLLECTIONS.zones).doc(id).get()));
    const foreign = zones.find((z) => !z.exists || z.get('cityId') !== restaurant.data.cityId);
    if (foreign) throw fail.invalid('Une zone sélectionnée n’appartient pas à la ville du commerce.');
  }
  const r = restaurant.data;
  const before = {
    name: r.name,
    merchantType: r.merchantType ?? 'restaurant',
    description: r.description ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    cuisineIds: r.cuisineIds,
    tags: r.tags,
    priceLevel: r.priceLevel,
    zoneIds: r.zoneIds,
    fulfillmentModes: r.fulfillmentModes,
    deliveredBy: r.deliveredBy,
    address: { line1: r.address.line1, line2: r.address.line2 ?? null, postalCode: r.address.postalCode, city: r.address.city },
    currency: r.currency ?? null,
  };
  const after = {
    name: data.name,
    merchantType: data.merchantType,
    description: data.description,
    phone: data.phone,
    email: data.email,
    cuisineIds: data.cuisineIds,
    tags: data.tags,
    priceLevel: data.priceLevel,
    zoneIds: data.zoneIds,
    fulfillmentModes: data.fulfillmentModes,
    deliveredBy: data.deliveredBy,
    address: data.address,
    currency: data.currency,
  };
  const changed = Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof typeof before])));
  if (Object.keys(changed).length === 0) return { changed: [] as string[] };
  const update: Record<string, unknown> = {
    ...changed,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  };
  if (changed.address) update.address = { ...r.address, ...data.address };
  if (changed.name || changed.address) update.searchKeywords = buildSearchKeywords(data.name, data.address.city, data.address.postalCode, r.email, r.phone);
  // Espèces retirées si le commerce ne livre plus lui-même.
  if (changed.deliveredBy && data.deliveredBy === 'platform') update.acceptedPaymentMethods = r.acceptedPaymentMethods.filter((m) => m !== 'cash');
  await restaurant.ref.update(update);
  await auditRestaurant(caller, restaurant, 'restaurant.profile_updated', {
    reason: data.reason,
    before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]])),
    after: changed,
    request,
  });
  return { changed: Object.keys(changed) };
});

// ------------------------------------------------------------------ Groupes et chaînes

const groupSchema = z.object({
  groupId: zId.nullish(),
  name: z.string().trim().min(2).max(80),
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email('Adresse e-mail invalide')),
  countryId: z.string().trim().length(2),
  legalName: z.string().trim().max(120).nullable(),
  siren: z.string().trim().max(20).nullable(),
  vatNumber: z.string().trim().max(20).nullable(),
  restaurantIds: z.array(zId).max(200),
  commissionBps: zBps.nullable(),
  planCode: zPlan.nullable(),
  consolidatedBilling: z.boolean(),
  reason: zReason,
});

export const saveRestaurantGroup = acteursCallable(groupSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'restaurants.edit');
  if (data.restaurantIds.length > 1) await assertFeatureOn('multi_outlet', { countryId: data.countryId }, 'Le multi-boutiques est désactivé par Ciyou Eats : un groupe ne peut pas réunir plusieurs établissements.');
  const canCommercial = adminHasPermission(admin, 'restaurants.commercial');
  const ownerSnap = await db.collection(COLLECTIONS.users).where('email', '==', data.ownerEmail).limit(1).get();
  const owner = ownerSnap.docs[0];
  if (!owner) throw fail.notFound('Compte du propriétaire (e-mail)');
  const restaurants = await Promise.all(data.restaurantIds.map((id) => loadRestaurantFor(admin, id)));
  const foreign = restaurants.find((r) => r.data.countryId !== data.countryId);
  if (foreign) throw fail.invalid(`${foreign.data.name} n’est pas dans le pays du groupe.`);

  const ref = data.groupId ? db.collection(COLLECTIONS.restaurantGroups).doc(data.groupId) : db.collection(COLLECTIONS.restaurantGroups).doc();
  const existingSnap = await ref.get();
  if (data.groupId && !existingSnap.exists) throw fail.notFound('Groupe');
  const existing = existingSnap.exists ? (existingSnap.data() as RestaurantGroup) : null;
  const otherGroup = restaurants.find((r) => r.data.groupId && r.data.groupId !== ref.id);
  if (otherGroup) throw fail.precondition(`${otherGroup.data.name} appartient déjà à un autre groupe.`);
  const commercialChanged =
    (existing?.commercial?.commissionBps ?? null) !== data.commissionBps || (existing?.commercial?.planCode ?? null) !== data.planCode;
  if (commercialChanged && !canCommercial) throw fail.forbidden('Les conditions communes du groupe demandent le droit « conditions commerciales ».');

  const now = Timestamp.now();
  const group: RestaurantGroup = {
    name: data.name,
    ownerId: owner.id,
    countryId: data.countryId,
    legalName: data.legalName,
    siren: data.siren,
    vatNumber: data.vatNumber,
    restaurantIds: data.restaurantIds,
    commercial: { commissionBps: data.commissionBps, planCode: data.planCode, subscriptionId: existing?.commercial?.subscriptionId ?? null },
    consolidatedBilling: data.consolidatedBilling,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? caller.uid,
    updatedAt: now,
    updatedBy: caller.uid,
  };
  const removed = (existing?.restaurantIds ?? []).filter((id) => !data.restaurantIds.includes(id));
  const batch = db.batch();
  batch.set(ref, group);
  restaurants.forEach((r) => batch.update(r.ref, { groupId: ref.id, updatedAt: now, updatedBy: caller.uid }));
  removed.forEach((id) => batch.update(db.collection(COLLECTIONS.restaurants).doc(id), { groupId: null, updatedAt: now, updatedBy: caller.uid }));
  await batch.commit();

  // Conditions communes : formule et commission appliquées à chaque établissement.
  if (commercialChanged && (data.planCode || data.commissionBps != null)) {
    for (const r of restaurants) {
      await applyCommercialPatch(
        caller,
        r,
        {
          planCode: data.planCode ?? undefined,
          rates: data.commissionBps != null ? { platformDeliveryBps: data.commissionBps, restaurantDeliveryBps: null, pickupBps: null } : undefined,
        },
        `Conditions du groupe ${data.name} : ${data.reason}`,
      );
    }
  }
  await writeAudit({
    actor: adminActor(caller),
    action: existing ? 'restaurant_group.updated' : 'restaurant_group.created',
    target: { type: 'restaurant_group', id: ref.id, label: data.name },
    reason: data.reason,
    before: existing ? { name: existing.name, restaurantIds: existing.restaurantIds, commercial: existing.commercial ?? null } : null,
    after: { name: data.name, ownerId: owner.id, restaurantIds: data.restaurantIds, commissionBps: data.commissionBps, planCode: data.planCode },
    countryId: data.countryId,
    request,
  });
  return { groupId: ref.id };
});
