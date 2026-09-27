// Multi-pays (cahier §23) : identité du marché, langues, devise, fuseau, entité de
// facturation, obligations locales, frais clients et bornes de livraison des commerces.
// Commissions, TVA, moyens de paiement et rémunération des livreurs ont leurs propres
// fonctions (rubriques Argent et Livreurs) ; toutes écrivent dans countries/{id}.
import { COLLECTIONS, CURRENCY_CODES, DEFAULT_PRICING_BY_COUNTRY, FULFILLMENT_MODES, LOCALES, PAYMENT_METHODS, type Country } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { z, zReason } from '../lib/validation';
import { platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

const zMinor = z.number().int().min(0).max(100_000_000);
const zBps = z.number().int().min(0).max(10_000);
const zCountryId = z.string().regex(/^[A-Z]{2}$/, 'Code pays ISO attendu (ex. FR)');

const sectionSchema = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('identity'),
    data: z.object({
      name: z.string().trim().min(2).max(60),
      currency: z.enum(CURRENCY_CODES),
      locales: z.array(z.enum(LOCALES)).min(1),
      defaultLocale: z.enum(LOCALES),
      timezone: z.string().trim().min(3).max(60),
      phonePrefix: z.string().regex(/^\+\d{1,4}$/, 'Indicatif attendu (ex. +33)'),
      stripeAvailable: z.boolean(),
    }),
  }),
  z.object({
    section: z.literal('billingEntity'),
    data: z.object({
      legalName: z.string().trim().min(2).max(120),
      vatNumber: z.string().trim().max(40),
      registrationNumber: z.string().trim().max(60),
      address: z.string().trim().min(5).max(200),
      invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,8}$/, 'Préfixe en majuscules (8 caractères max.)'),
    }),
  }),
  z.object({
    section: z.literal('legal'),
    data: z.object({
      dac7Authority: z.string().trim().min(2).max(80),
      requiresDriverUrssaf: z.boolean(),
      alcoholMinimumAge: z.number().int().min(16).max(25),
      vatNote: z.string().trim().max(500).nullable(),
    }),
  }),
  z.object({
    section: z.literal('fees'),
    data: z.object({
      serviceFee: z.object({ enabled: z.boolean(), rateBps: zBps, minCents: zMinor, maxCents: zMinor, appliesTo: z.array(z.enum(FULFILLMENT_MODES)).max(4) }),
      smallOrderFee: z.object({ enabled: z.boolean(), thresholdCents: zMinor, mode: z.enum(['difference', 'flat']), flatCents: zMinor, maxCents: zMinor, appliesTo: z.array(z.enum(FULFILLMENT_MODES)).max(4) }),
      payment: z.object({ percentBps: z.number().int().min(0).max(1000), fixedCents: zMinor, connectPercentBps: z.number().int().min(0).max(1000), payer: z.enum(['platform', 'restaurant']) }),
    }),
  }),
  z.object({
    section: z.literal('delivery'),
    data: z.object({
      maxDistanceMeters: z.number().int().min(500).max(50_000),
      maxSurgeMultiplierBps: z.number().int().min(10_000).max(30_000),
      merchantDelivery: z.object({
        minFeeCents: zMinor.nullable(),
        maxFeeCents: zMinor.nullable(),
        minOrderFloorCents: zMinor.nullable(),
        minOrderCeilingCents: zMinor.nullable(),
        maxRadiusMeters: z.number().int().min(500).max(50_000).nullable(),
      }),
    }),
  }),
]);

export const updateCountry = platformCallable(
  z.intersection(z.object({ countryId: zCountryId, reason: zReason }), sectionSchema),
  async (input, request) => {
    const { caller } = await requireSecureAdmin(request, 'markets.edit');
    const ref = db.collection(COLLECTIONS.countries).doc(input.countryId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Pays');
    const country = snap.data() as Country;

    let update: Record<string, unknown>;
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    switch (input.section) {
      case 'identity': {
        if (!input.data.locales.includes(input.data.defaultLocale)) throw fail.invalid('La langue par défaut doit faire partie des langues du pays.');
        before = { name: country.name, currency: country.currency, locales: country.locales, defaultLocale: country.defaultLocale, timezone: country.timezone, phonePrefix: country.phonePrefix, stripeAvailable: country.stripeAvailable ?? null };
        after = { ...input.data };
        update = { ...input.data, 'pricing.currency': input.data.currency };
        if (country.currency !== input.data.currency) {
          const orders = await db.collection(COLLECTIONS.orders).where('countryId', '==', input.countryId).limit(1).get();
          if (!orders.empty) throw fail.precondition('Des commandes existent déjà dans ce pays : la devise ne peut plus changer.');
        }
        break;
      }
      case 'billingEntity':
        before = { ...country.billingEntity };
        after = { ...input.data };
        update = { billingEntity: input.data };
        break;
      case 'legal': {
        const { vatNote, ...legal } = input.data;
        before = { ...country.legal, vatNote: country.vatNote ?? null };
        after = { ...input.data };
        update = { legal, vatNote };
        break;
      }
      case 'fees':
        before = { serviceFee: country.pricing.serviceFee, smallOrderFee: country.pricing.smallOrderFee, payment: country.pricing.payment };
        after = { ...input.data };
        update = { 'pricing.serviceFee': input.data.serviceFee, 'pricing.smallOrderFee': input.data.smallOrderFee, 'pricing.payment': input.data.payment };
        break;
      case 'delivery': {
        const m = input.data.merchantDelivery;
        if (m.minFeeCents !== null && m.maxFeeCents !== null && m.minFeeCents > m.maxFeeCents) throw fail.invalid('Les frais minimum dépassent les frais maximum.');
        if (m.minOrderFloorCents !== null && m.minOrderCeilingCents !== null && m.minOrderFloorCents > m.minOrderCeilingCents) throw fail.invalid('Le plancher du minimum de commande dépasse son plafond.');
        before = { maxDistanceMeters: country.pricing.delivery.maxDistanceMeters, maxSurgeMultiplierBps: country.pricing.delivery.maxSurgeMultiplierBps, merchantDelivery: country.pricing.merchantDelivery ?? null };
        after = { ...input.data };
        update = { 'pricing.delivery.maxDistanceMeters': input.data.maxDistanceMeters, 'pricing.delivery.maxSurgeMultiplierBps': input.data.maxSurgeMultiplierBps, 'pricing.merchantDelivery': m };
        break;
      }
    }

    const change = await recordSettingsChange({ docPath: `${COLLECTIONS.countries}/${input.countryId}#${input.section}`, before, after, reason: input.reason, caller });
    if (change.fields.length === 0) return { changedFields: [] };
    await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'country.updated',
      target: { type: 'country', id: `${COLLECTIONS.countries}/${input.countryId}`, label: country.name },
      reason: input.reason,
      before: change.before,
      after: change.after,
      countryId: input.countryId,
      request,
    });
    return { changedFields: change.fields };
  },
);

/** Ouverture ou fermeture d'un marché (les villes gardent leur propre état). */
export const setCountryActive = platformCallable(
  z.object({ countryId: zCountryId, active: z.boolean(), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'markets.edit');
    const ref = db.collection(COLLECTIONS.countries).doc(data.countryId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Pays');
    const country = snap.data() as Country;
    if (country.active === data.active) return { active: data.active };
    if (!data.active) {
      const liveCities = await db.collection(COLLECTIONS.cities).where('countryId', '==', data.countryId).where('active', '==', true).count().get();
      if (liveCities.data().count > 0) throw fail.precondition(`Fermez d’abord les ${liveCities.data().count} ville(s) active(s) de ce pays.`);
    }
    await recordSettingsChange({ docPath: `${COLLECTIONS.countries}/${data.countryId}#identity`, before: { active: country.active }, after: { active: data.active }, reason: data.reason, caller });
    await ref.update({ active: data.active, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.active ? 'country.opened' : 'country.closed',
      target: { type: 'country', id: `${COLLECTIONS.countries}/${data.countryId}`, label: country.name },
      reason: data.reason,
      before: { active: country.active },
      after: { active: data.active },
      countryId: data.countryId,
      sensitive: true,
      request,
    });
    return { active: data.active };
  },
);

// ------------------------------------------------------------------ Création d'un marché

/**
 * Ouverture d'un nouveau pays (« s'ouvrir à d'autres pays » sans intervention d'un développeur).
 * Le marché est créé FERMÉ, avec les tarifs par défaut du modèle le plus proche (FR ou celui du
 * même code s'il existe) et les moyens de paiement du modèle ; tout se règle ensuite dans les
 * sections du marché (identité, entité de facturation, obligations locales, frais, livraison, TVA).
 */
export const createCountry = platformCallable(
  z.object({
    countryId: zCountryId,
    name: z.string().trim().min(2).max(60),
    currency: z.enum(CURRENCY_CODES),
    locales: z.array(z.enum(LOCALES)).min(1),
    defaultLocale: z.enum(LOCALES),
    timezone: z.string().trim().min(3).max(60),
    phonePrefix: z.string().regex(/^\+\d{1,4}$/, 'Indicatif attendu (ex. +33)'),
    stripeAvailable: z.boolean(),
    /** Marché existant dont les tarifs et moyens de paiement servent de point de départ. */
    templateCountryId: zCountryId.nullish(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'markets.edit');
    if (!data.locales.includes(data.defaultLocale)) throw fail.invalid('La langue par défaut doit faire partie des langues du pays.');
    const ref = db.collection(COLLECTIONS.countries).doc(data.countryId);
    if ((await ref.get()).exists) throw fail.alreadyExists('Ce pays existe déjà.');
    const templateId = data.templateCountryId ?? (data.countryId in DEFAULT_PRICING_BY_COUNTRY ? data.countryId : 'FR');
    const template = (await db.collection(COLLECTIONS.countries).doc(templateId).get()).data() as Country | undefined;
    const pricing = { ...(template?.pricing ?? DEFAULT_PRICING_BY_COUNTRY[templateId] ?? DEFAULT_PRICING_BY_COUNTRY.FR!), currency: data.currency };
    const paymentMethods = template?.paymentMethods ?? Object.fromEntries(PAYMENT_METHODS.map((m) => [m, false]));
    const now = FieldValue.serverTimestamp();
    await ref.set({
      code: data.countryId,
      name: data.name,
      active: false,
      currency: data.currency,
      vatValidated: false,
      vatNote: null,
      stripeAvailable: data.stripeAvailable,
      locales: data.locales,
      defaultLocale: data.defaultLocale,
      timezone: data.timezone,
      phonePrefix: data.phonePrefix,
      pricing,
      orderRules: null,
      paymentMethods,
      paymentProviderIds: [],
      billingEntity: { legalName: `GoLink ${data.name}`, vatNumber: '', registrationNumber: '', address: 'À renseigner', invoicePrefix: data.countryId },
      legal: { dac7Authority: 'À renseigner', requiresDriverUrssaf: false, alcoholMinimumAge: 18 },
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    });
    await recordSettingsChange({ docPath: `${COLLECTIONS.countries}/${data.countryId}#identity`, before: null, after: { name: data.name, currency: data.currency, active: false, template: templateId }, reason: data.reason, caller });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'country.created',
      target: { type: 'country', id: `${COLLECTIONS.countries}/${data.countryId}`, label: data.name },
      reason: data.reason,
      after: { name: data.name, currency: data.currency, locales: data.locales, timezone: data.timezone, template: templateId, active: false },
      countryId: data.countryId,
      sensitive: true,
      request,
    });
    return { countryId: data.countryId };
  },
);
