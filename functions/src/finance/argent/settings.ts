// Réglages des rubriques « Argent » : moyens de paiement (plateforme, pays, commerce),
// pourboires, espèces, remboursements, calendrier des reversements, relances des
// impayés. Chaque modification est historisée (settingsHistory) et auditée.
import {
  COLLECTIONS,
  DEFAULT_DUNNING_SETTINGS,
  DISABLED_PAYMENT_METHODS,
  PAYMENT_METHODS,
  PLAN_FEATURE_KEYS,
  RESTAURANT_PRIVATE_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  adminHasPermission,
  type AdminPermission,
  type Country,
  type PaymentMethod,
  type Restaurant,
  type RestaurantCommercial,
} from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin, type Caller } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { argentCallable } from './runtime';

const zCents = z.number().int().min(0).max(100_000_000);
const zSchedule = z.object({
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6),
  minimumCents: zCents,
  delayDays: z.number().int().min(0).max(30),
});
const zMethods = z.object(Object.fromEntries(PAYMENT_METHODS.map((m) => [m, z.boolean()])) as Record<PaymentMethod, z.ZodBoolean>);

const settingsSchema = z.discriminatedUnion('doc', [
  z.object({ doc: z.literal('payouts'), reason: zReason, data: z.object({ restaurants: zSchedule, drivers: zSchedule }) }),
  z.object({
    doc: z.literal('payments'),
    reason: zReason,
    data: z.object({
      methods: zMethods,
      tips: z.object({ enabled: z.boolean(), presetsCents: z.array(z.number().int().min(10).max(100_000)).min(1).max(6), maxCents: zCents }),
      cash: z.object({ enabled: z.boolean(), driverCashLimitCents: zCents }),
      failedPaymentRetry: z.object({ maxAttempts: z.number().int().min(0).max(10) }),
    }),
  }),
  z.object({
    doc: z.literal('refunds'),
    reason: zReason,
    data: z.object({ approvalThresholdCents: zCents, defaultMethod: z.enum(['original_payment', 'wallet_credit']), walletCreditValidityDays: z.number().int().min(1).max(3650), maxCreditCents: zCents.min(100).default(50_000) }),
  }),
  z.object({
    doc: z.literal('dunning'),
    reason: zReason,
    data: z.object({
      enabled: z.boolean(),
      retryIntervalDays: z.number().int().min(1).max(30),
      maxAttempts: z.number().int().min(1).max(10),
      emailReminders: z.boolean(),
      restrictedFeatures: z.array(z.enum(PLAN_FEATURE_KEYS)).max(PLAN_FEATURE_KEYS.length),
      holdPayouts: z.boolean(),
    }),
  }),
]);

const PERMISSION_BY_DOC: Record<'payouts' | 'payments' | 'refunds' | 'dunning', AdminPermission> = {
  payouts: 'finance.payouts',
  payments: 'payments.configure',
  refunds: 'payments.configure',
  dunning: 'subscriptions.manage',
};

const LABELS: Record<keyof typeof PERMISSION_BY_DOC, string> = {
  payouts: 'Calendrier des reversements',
  payments: 'Moyens de paiement',
  refunds: 'Remboursements',
  dunning: 'Relances des impayés',
};

function diffKeys(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key]));
}

async function history(caller: Caller, docPath: string, label: string, before: Record<string, unknown> | null, after: Record<string, unknown>, reason: string, request: CallableRequest<unknown>, extra: { countryId?: string | null; cityId?: string | null } = {}) {
  const changedFields = diffKeys(before, after);
  const pick = (obj: Record<string, unknown> | null) => Object.fromEntries(changedFields.map((k) => [k, obj?.[k] ?? null]));
  await db.collection(COLLECTIONS.settingsHistory).add({ docPath, changedFields, before: pick(before), after: pick(after), reason, changedBy: caller.uid, changedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'settings.updated', target: { type: 'setting', id: docPath, label }, reason, before: pick(before), after: pick(after), countryId: extra.countryId ?? null, cityId: extra.cityId ?? null, request, sensitive: true });
  return changedFields;
}

export const updateFinanceSettings = argentCallable(settingsSchema, async (input, request) => {
  const { caller } = await requireAdmin(request, PERMISSION_BY_DOC[input.doc]);
  const docId = input.doc === 'dunning' ? SETTINGS_DOCS.dunning : SETTINGS_DOCS[input.doc];
  const ref = db.collection(COLLECTIONS.settings).doc(docId);
  const snap = await ref.get();
  const before = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  let data: Record<string, unknown> = input.data;
  if (input.doc === 'payments') {
    const methods = { ...input.data.methods };
    // Décisions client : titres-restaurant désactivés, espèces réservées aux livreurs salariés du commerce.
    for (const m of DISABLED_PAYMENT_METHODS) methods[m] = false;
    if (!methods.card && !methods.apple_pay && !methods.google_pay) throw fail.invalid('Gardez au moins un moyen de paiement en ligne actif.');
    if (input.data.tips.presetsCents.some((p) => p > input.data.tips.maxCents)) throw fail.invalid('Les montants proposés doivent rester sous le plafond du pourboire.');
    data = { ...input.data, methods, cash: { ...input.data.cash, merchantDriversOnly: true } };
  }
  if (input.doc === 'dunning') data = { ...DEFAULT_DUNNING_SETTINGS, ...input.data };
  await ref.set({ ...data, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
  const changedFields = await history(caller, `${COLLECTIONS.settings}/${docId}`, LABELS[input.doc], before, data, input.reason, request);
  return { changedFields };
});

export const updateCountryPayments = argentCallable(
  z.object({
    countryId: z.string().length(2),
    methods: zMethods,
    payment: z.object({ percentBps: z.number().int().min(0).max(1000), fixedCents: z.number().int().min(0).max(1000), connectPercentBps: z.number().int().min(0).max(500), payer: z.enum(['platform', 'restaurant']) }),
    tips: z.object({ enabled: z.boolean(), presetsCents: z.array(z.number().int().min(10).max(100_000)).min(1).max(6), maxCents: zCents }),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'payments.configure');
    if (admin.role !== 'super_admin' && admin.countryIds.length > 0 && !admin.countryIds.includes(data.countryId)) throw fail.forbidden('Ce pays est hors de votre périmètre.');
    const ref = db.collection(COLLECTIONS.countries).doc(data.countryId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Pays');
    const country = snap.data() as Country;
    const methods = { ...data.methods };
    for (const m of DISABLED_PAYMENT_METHODS) methods[m] = false;
    if (!methods.card && !methods.apple_pay && !methods.google_pay && country.stripeAvailable !== false) throw fail.invalid('Gardez au moins un moyen de paiement en ligne actif.');
    if (data.tips.presetsCents.some((p) => p > data.tips.maxCents)) throw fail.invalid('Les montants proposés doivent rester sous le plafond du pourboire.');
    await ref.update({
      paymentMethods: methods,
      'pricing.payment.percentBps': data.payment.percentBps,
      'pricing.payment.fixedCents': data.payment.fixedCents,
      'pricing.payment.connectPercentBps': data.payment.connectPercentBps,
      'pricing.payment.payer': data.payment.payer,
      'pricing.tips': data.tips,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    const before = { paymentMethods: country.paymentMethods, payment: country.pricing?.payment ?? null, tips: country.pricing?.tips ?? null };
    const after = { paymentMethods: methods, payment: data.payment, tips: data.tips };
    const changedFields = await history(caller, `${COLLECTIONS.countries}/${data.countryId}`, `Paiements · ${country.name}`, before, after, data.reason, request, { countryId: data.countryId });
    return { changedFields };
  },
);

export const updateRestaurantPayments = argentCallable(
  z.object({
    restaurantId: zId,
    allowedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).max(PAYMENT_METHODS.length),
    payoutFrequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'payments.configure');
    const rRef = db.collection(COLLECTIONS.restaurants).doc(data.restaurantId);
    const cRef = rRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial);
    const [rSnap, cSnap] = await Promise.all([rRef.get(), cRef.get()]);
    if (!rSnap.exists) throw fail.notFound('Commerce');
    const restaurant = rSnap.data() as Restaurant;
    assertAdminCovers(admin, restaurant.cityId);
    const commercial = cSnap.exists ? (cSnap.data() as RestaurantCommercial) : null;
    const methods = [...new Set(data.allowedPaymentMethods)];
    if (methods.some((m) => DISABLED_PAYMENT_METHODS.includes(m))) throw fail.invalid('Les titres-restaurant ne sont pas acceptés sur GoLink.');
    if (methods.includes('cash') && restaurant.deliveredBy === 'platform') throw fail.invalid('Les espèces ne sont possibles que si le commerce livre avec ses propres livreurs salariés.');
    if (!methods.some((m) => m === 'card' || m === 'apple_pay' || m === 'google_pay')) throw fail.invalid('Autorisez au moins un moyen de paiement en ligne.');
    if (data.payoutFrequency !== (commercial?.payoutFrequency ?? null) && !adminHasPermission(admin, 'finance.payouts')) {
      throw fail.forbidden('Modifier le rythme des reversements demande le droit de gérer les reversements.');
    }
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(cRef, { allowedPaymentMethods: methods, payoutFrequency: data.payoutFrequency, updatedAt: now, updatedBy: caller.uid }, { merge: true });
    batch.update(rRef, { acceptedPaymentMethods: restaurant.acceptedPaymentMethods.filter((m) => methods.includes(m)), updatedAt: now, updatedBy: caller.uid });
    await batch.commit();
    const before = { allowedPaymentMethods: commercial?.allowedPaymentMethods ?? null, payoutFrequency: commercial?.payoutFrequency ?? null };
    const after = { allowedPaymentMethods: methods, payoutFrequency: data.payoutFrequency };
    const changedFields = await history(caller, `restaurants/${data.restaurantId}/private/commercial`, `Paiements · ${restaurant.name}`, before, after, data.reason, request, { countryId: restaurant.countryId, cityId: restaurant.cityId });
    return { changedFields };
  },
);

const zRate = z.number().int().min(0).max(5000);

/** Taux de TVA d'un pays (cahier §16). La catégorie « alcool » reste verrouillée (vente interdite). */
export const updateCountryVat = argentCallable(
  z.object({
    countryId: z.string().length(2),
    standardBps: zRate,
    byCategory: z.object({ food: zRate, soft_drink: zRate, grocery: zRate }),
    vatValidated: z.boolean(),
    vatNote: z.string().trim().max(500).nullable(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'tax.reports');
    const ref = db.collection(COLLECTIONS.countries).doc(data.countryId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Pays');
    const country = snap.data() as Country;
    await ref.update({
      'pricing.vat.standardBps': data.standardBps,
      'pricing.vat.byCategory.food': data.byCategory.food,
      'pricing.vat.byCategory.soft_drink': data.byCategory.soft_drink,
      'pricing.vat.byCategory.grocery': data.byCategory.grocery,
      vatValidated: data.vatValidated,
      vatNote: data.vatNote,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    const before = { standardBps: country.pricing?.vat?.standardBps ?? null, byCategory: country.pricing?.vat?.byCategory ?? null, vatValidated: country.vatValidated ?? false, vatNote: country.vatNote ?? null };
    const after = { standardBps: data.standardBps, byCategory: { ...(country.pricing?.vat?.byCategory ?? {}), ...data.byCategory }, vatValidated: data.vatValidated, vatNote: data.vatNote };
    const changedFields = await history(caller, `${COLLECTIONS.countries}/${data.countryId}`, `TVA · ${country.name}`, before, after, data.reason, request, { countryId: data.countryId });
    return { changedFields };
  },
);
