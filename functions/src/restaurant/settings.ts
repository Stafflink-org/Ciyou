// Réglages de l'établissement modifiés depuis le back-office restaurant :
// profil, adresse, identité légale, prise de commande, horaires, paiements,
// notifications et pause temporaire. Chaque section est validée ici (limites
// de la plateforme, fonctionnalités activées) puis recopiée sur la fiche publique.
import {
  COLLECTIONS,
  MERCHANT_TYPES,
  RESTAURANT_LABELS,
  RESTAURANT_SETTINGS_DOCS,
  buildSearchKeywords,
  compactIdentifier,
  encodeGeohash,
  isValidSiret,
  isValidVatNumber,
  validateWeeklyHours,
  type PaymentMethod,
  type Restaurant,
  type RestaurantHours,
  type RestaurantLegal,
  type RestaurantNotificationSettings,
  type RestaurantOrderSettings,
  type RestaurantPaymentSettings,
  type Zone,
} from '@golink/shared';
import { GeoPoint } from 'firebase-admin/firestore';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../lib/permissions';
import { monogram, zonesContaining } from '../lib/restaurants';
import { z, zEmail, zId, zPhone } from '../lib/validation';
import {
  allowedPaymentMethods,
  enabledFulfillmentModes,
  diff,
  legalRef,
  loadConfigContext,
  restaurantRef,
  restaurantSubRef,
  type ConfigContext,
  CONFIG_FUNCTION_OPTIONS,
} from './config-context';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Heure invalide');
const slot = z.object({ from: hhmm, to: hhmm });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const profileSchema = z.object({
  section: z.literal('profile'),
  name: z.string().trim().min(2, 'Nom trop court').max(60).optional(),
  description: optionalText(600),
  phone: zPhone,
  email: zEmail,
  merchantType: z.enum(MERCHANT_TYPES).optional(),
  cuisineIds: z.array(zId).min(1, 'Choisissez au moins une cuisine').max(3, 'Trois cuisines au plus'),
  tags: z.array(z.string().trim().min(1).max(24)).max(6, 'Six mots-clés au plus'),
  priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  labels: z.array(z.enum(Object.keys(RESTAURANT_LABELS) as [keyof typeof RESTAURANT_LABELS])).max(9),
  allergenNotice: optionalText(400),
  /** Interrupteur « Visible dans l'application Ciyou Eats » : masque le commerce sans changer son statut. */
  visibleInApp: z.boolean().default(true),
});

const addressSchema = z.object({
  section: z.literal('address'),
  line1: z.string().trim().min(3).max(120),
  line2: optionalText(120),
  postalCode: z.string().trim().min(2).max(12),
  city: z.string().trim().min(1).max(80),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  placeId: optionalText(300),
});

const legalSchema = z.object({
  section: z.literal('legal'),
  legalName: z.string().trim().min(2).max(120),
  legalForm: optionalText(40),
  siret: z.string().trim().min(5).max(20),
  vatNumber: optionalText(20),
  rcsCity: optionalText(60),
  shareCapitalCents: z.number().int().min(0).max(100_000_000_00).nullish(),
  registeredAddress: z.object({
    line1: z.string().trim().min(3).max(120),
    line2: optionalText(120),
    postalCode: z.string().trim().min(2).max(12),
    city: z.string().trim().min(1).max(80),
  }),
  managerName: z.string().trim().min(2).max(80),
  managerEmail: zEmail,
  managerPhone: zPhone,
  managerBirthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')
    .nullish()
    .transform((v) => v ?? null),
  alcoholLicenseNumber: optionalText(40),
  taxIdentificationNumber: optionalText(30),
});

const ordersSchema = z.object({
  section: z.literal('orders'),
  prepMinutes: z.number().int().min(5, 'Au moins 5 minutes').max(90, '90 minutes au plus'),
  maxConcurrentOrders: z.number().int().min(1, 'Au moins une commande').max(100),
  minOrderCents: z.number().int().min(0).max(10_000, '100 € au plus'),
  delivery: z.boolean(),
  pickup: z.boolean(),
  dineIn: z.boolean(),
  autoAccept: z.boolean(),
  autoPrint: z.boolean(),
  scheduledOrders: z.boolean(),
  scheduledLeadMinutes: z.number().int().min(30).max(24 * 60),
  scheduledMaxDays: z.number().int().min(1).max(14),
  pickupInstructions: optionalText(300),
  dineInInstructions: optionalText(300),
  deliveredBy: z.enum(['platform', 'restaurant', 'both']),
});

const hoursSchema = z.object({
  section: z.literal('hours'),
  days: z
    .array(z.object({ day: z.number().int().min(0).max(6), open: z.boolean(), slots: z.array(slot).max(4) }))
    .length(7),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        closed: z.boolean(),
        slots: z.array(slot).max(4).optional(),
        label: optionalText(60),
      }),
    )
    .max(60),
});

const paymentsSchema = z.object({
  section: z.literal('payments'),
  online: z.boolean(),
  onDelivery: z.boolean(),
  onPickup: z.boolean(),
  methods: z.object({
    card: z.boolean(),
    apple_pay: z.boolean(),
    google_pay: z.boolean(),
    cash: z.boolean(),
    meal_voucher: z.boolean(),
  }),
});

const alertSetting = z.object({ inApp: z.boolean(), email: z.boolean() });
const notificationsSchema = z.object({
  section: z.literal('notifications'),
  newOrderSound: z.boolean(),
  sound: z.enum(['chime', 'bell', 'marimba', 'pulse']),
  volume: z.number().int().min(0).max(100),
  repeatUntilAccepted: z.boolean(),
  emailDailySummary: z.boolean(),
  emailWeeklyReport: z.boolean(),
  emailInvoices: z.boolean(),
  emailRecipients: z.array(zEmail).max(5, 'Cinq destinataires au plus'),
  smsOnNewOrder: z.boolean(),
  smsNumbers: z.array(zPhone).max(3, 'Trois numéros au plus'),
  alerts: z.object({
    order_cancelled: alertSetting,
    order_late: alertSetting,
    low_stock: alertSetting,
    new_review: alertSetting,
    new_message: alertSetting,
    document_expiry: alertSetting,
    payout_paid: alertSetting,
  }),
});

const pauseSchema = z.object({
  section: z.literal('pause'),
  /** Durée de la pause en minutes ; null = reprendre maintenant. */
  minutes: z.number().int().min(10).max(7 * 24 * 60).nullable(),
  reason: optionalText(120),
});

const schema = z
  .object({ restaurantId: zId })
  .and(
    z.discriminatedUnion('section', [
      profileSchema,
      addressSchema,
      legalSchema,
      ordersSchema,
      hoursSchema,
      paymentsSchema,
      notificationsSchema,
      pauseSchema,
    ]),
  );

type Input = z.output<typeof schema>;

const SECTION_LABELS: Record<Input['section'], string> = {
  profile: 'profile_updated',
  address: 'address_updated',
  legal: 'legal_updated',
  orders: 'order_settings_updated',
  hours: 'hours_updated',
  payments: 'payment_settings_updated',
  notifications: 'notification_settings_updated',
  pause: 'pause_updated',
};

/** Garde le décalage existant entre préparation et délai annoncé. */
export function etaFor(restaurant: Pick<Restaurant, 'prepMinutes' | 'etaMinutes'>, prepMinutes: number) {
  const extraMin = Math.max(0, (restaurant.etaMinutes?.min ?? restaurant.prepMinutes + 10) - restaurant.prepMinutes);
  const extraMax = Math.max(extraMin, (restaurant.etaMinutes?.max ?? restaurant.prepMinutes + 20) - restaurant.prepMinutes);
  return { min: prepMinutes + extraMin, max: prepMinutes + extraMax };
}

export function fulfillmentModesOf(settings: Pick<RestaurantOrderSettings, 'delivery' | 'pickup' | 'dineIn'>): Restaurant['fulfillmentModes'] {
  const modes: Restaurant['fulfillmentModes'] = [];
  if (settings.delivery) modes.push('delivery');
  if (settings.pickup) modes.push('pickup');
  if (settings.dineIn) modes.push('dine_in');
  return modes;
}

/** Moyens réellement proposés au client : choix du restaurant ∩ autorisations, avoir Ciyou Eats si paiement en ligne. */
export function acceptedMethodsOf(settings: Pick<RestaurantPaymentSettings, 'online' | 'onDelivery' | 'onPickup' | 'methods'>, allowed: PaymentMethod[]): PaymentMethod[] {
  const online: PaymentMethod[] = ['card', 'apple_pay', 'google_pay'];
  const result: PaymentMethod[] = [];
  for (const method of allowed) {
    if (method === 'wallet') {
      if (settings.online) result.push(method);
      continue;
    }
    if (!settings.methods[method]) continue;
    if (online.includes(method) && !settings.online) continue;
    // Espèces : remises au livreur salarié du commerce, jamais au retrait (décision du client).
    if (method === 'cash' && !settings.onDelivery) continue;
    result.push(method);
  }
  return result;
}

function requiredPermission(section: Input['section']) {
  return section === 'pause' ? ('orders.manage' as const) : ('settings.manage' as const);
}

async function assertCuisines(ids: string[]): Promise<void> {
  const snaps = await db.getAll(...ids.map((id) => db.collection(COLLECTIONS.cuisineCategories).doc(id)));
  const unknown = snaps.filter((s) => !s.exists || s.get('active') === false);
  if (unknown.length > 0) throw fail.invalid('Une des cuisines choisies n’est plus proposée par Ciyou Eats.');
}

async function cityZones(cityId: string) {
  const snap = await db.collection(COLLECTIONS.zones).where('cityId', '==', cityId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Zone) }));
}

export const updateRestaurantSettings = callable(
  schema,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, requiredPermission(data.section), 'restaurants.edit');
    const ctx = await loadConfigContext(data.restaurantId);
    const result = await applySection(data, actor, ctx);

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: `restaurant.${SECTION_LABELS[data.section]}`,
      target: { type: 'restaurant', id: data.restaurantId, label: ctx.restaurant.name },
      before: result.before,
      after: result.after,
      countryId: ctx.restaurant.countryId,
      cityId: ctx.restaurant.cityId,
      sensitive: data.section === 'legal' || data.section === 'address',
      request,
    });
    return { section: data.section, changed: result.changed };
  },
  CONFIG_FUNCTION_OPTIONS,
);

type Applied = { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] };

async function applySection(data: Input, actor: RestaurantActor, ctx: ConfigContext): Promise<Applied> {
  const rid = data.restaurantId;
  const uid = actor.caller.uid;
  const now = Timestamp.now();
  const restaurant = ctx.restaurant;
  const rRef = restaurantRef(rid);

  switch (data.section) {
    case 'profile': {
      if (data.name && data.name !== restaurant.name) {
        if (actor.kind === 'member' && actor.member.role !== 'owner') {
          throw fail.forbidden('Seul le propriétaire peut modifier le nom de l’établissement.');
        }
      }
      await assertCuisines(data.cuisineIds);
      const name = data.name ?? restaurant.name;
      const next = {
        name,
        description: data.description,
        phone: data.phone,
        email: data.email,
        merchantType: data.merchantType ?? restaurant.merchantType ?? 'restaurant',
        cuisineIds: data.cuisineIds,
        tags: [...new Set(data.tags)],
        priceLevel: data.priceLevel,
        labels: [...new Set(data.labels)],
        allergenNotice: data.allergenNotice,
        visibleInApp: data.visibleInApp,
      };
      const changes = diff(restaurant as unknown as Record<string, unknown>, next);
      if (changes.changed.length === 0) return changes;
      const extra: Record<string, unknown> = {};
      if (name !== restaurant.name || data.phone !== restaurant.phone || data.email !== restaurant.email) {
        extra.mark = monogram(name);
        extra.searchKeywords = buildSearchKeywords(name, restaurant.address.city, restaurant.address.postalCode, data.email ?? restaurant.email, data.phone ?? restaurant.phone);
      }
      await rRef.update({ ...next, ...extra, updatedAt: now, updatedBy: uid });
      return changes;
    }

    case 'address': {
      const zones = await cityZones(restaurant.cityId);
      const zoneIds = zonesContaining(data.location, zones);
      if (zones.length > 0 && zoneIds.length === 0) {
        throw fail.invalid('Cette adresse est en dehors des zones desservies par Ciyou Eats dans votre ville. Contactez le support pour un déménagement.');
      }
      const address = {
        line1: data.line1,
        line2: data.line2,
        postalCode: data.postalCode,
        city: data.city,
        countryCode: restaurant.address.countryCode || restaurant.countryId,
        geo: new GeoPoint(data.location.lat, data.location.lng),
        geohash: encodeGeohash(data.location),
        placeId: data.placeId,
      };
      const before = {
        address: { ...restaurant.address, geo: restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null },
        zoneIds: restaurant.zoneIds,
      };
      const after = { address: { ...address, geo: data.location }, zoneIds };
      await rRef.update({
        address,
        zoneIds,
        searchKeywords: buildSearchKeywords(restaurant.name, data.city, data.postalCode, restaurant.email, restaurant.phone),
        updatedAt: now,
        updatedBy: uid,
      });
      return { before, after, changed: ['address', 'zoneIds'] };
    }

    case 'legal': {
      const snap = await legalRef(rid).get();
      const current = snap.exists ? (snap.data() as RestaurantLegal) : null;
      const siret = compactIdentifier(data.siret);
      if (siret !== compactIdentifier(current?.siret ?? '') && !isValidSiret(siret, restaurant.countryId)) {
        throw fail.invalid(restaurant.countryId === 'LU' ? 'Numéro RCS invalide (ex. B123456).' : 'SIRET invalide : 14 chiffres attendus, vérifiez la saisie.');
      }
      const vat = data.vatNumber ? compactIdentifier(data.vatNumber) : null;
      if (vat && vat !== compactIdentifier(current?.vatNumber ?? '') && !isValidVatNumber(vat)) {
        throw fail.invalid('Numéro de TVA intracommunautaire invalide.');
      }
      const next = {
        legalName: data.legalName,
        legalForm: data.legalForm,
        siret: siret === compactIdentifier(current?.siret ?? '') ? (current?.siret ?? siret) : siret,
        vatNumber: vat === compactIdentifier(current?.vatNumber ?? '') ? (current?.vatNumber ?? vat) : vat,
        rcsCity: data.rcsCity,
        shareCapitalCents: data.shareCapitalCents ?? null,
        registeredAddress: { ...data.registeredAddress, countryCode: restaurant.countryId },
        managerName: data.managerName,
        managerEmail: data.managerEmail,
        managerPhone: data.managerPhone,
        managerBirthDate: data.managerBirthDate,
        // Vente d'alcool interdite sur Ciyou Eats : aucune licence n'est enregistrée.
        alcoholLicenseNumber: null,
        taxIdentificationNumber: data.taxIdentificationNumber,
      };
      const dac7Complete = Boolean(next.legalName && next.siret && next.taxIdentificationNumber && next.registeredAddress.line1);
      const changes = diff(current as unknown as Record<string, unknown>, next);
      await legalRef(rid).set({ ...next, dac7Complete, updatedAt: now }, { merge: true });
      // Le numéro complet ne va pas au journal : seuls les champs modifiés sont listés.
      return { before: { fields: changes.changed }, after: { fields: changes.changed, dac7Complete }, changed: changes.changed };
    }

    case 'orders': {
      if (data.delivery && !ctx.isEnabled('delivery')) throw fail.precondition('La livraison n’est pas encore ouverte pour votre établissement.');
      if (data.pickup && !ctx.isEnabled('pickup')) throw fail.precondition('Le retrait n’est pas encore ouvert pour votre établissement.');
      if (data.dineIn && !ctx.isEnabled('dine_in')) throw fail.precondition('La commande sur place n’est pas encore disponible sur Ciyou Eats.');
      if (data.scheduledOrders && !ctx.isEnabled('scheduled_orders')) throw fail.precondition('Les commandes programmées ne sont pas disponibles pour votre établissement.');
      if (!data.delivery && !data.pickup && !data.dineIn) throw fail.invalid('Activez au moins un mode de commande.');
      if (data.deliveredBy !== 'platform') {
        if (!ctx.isEnabled('restaurant_own_drivers')) throw fail.precondition('La livraison par vos propres livreurs n’est pas ouverte pour votre établissement.');
        if (data.delivery && data.deliveredBy === 'restaurant') {
          const zones = await restaurantRef(rid).collection('deliveryZones').where('enabled', '==', true).limit(1).get();
          if (zones.empty) throw fail.precondition('Créez et activez au moins une zone de livraison avant de livrer avec vos propres livreurs.');
        }
      }
      const settingsRef = restaurantSubRef(rid, 'settings', RESTAURANT_SETTINGS_DOCS.orders);
      const { section: _section, restaurantId: _rid, deliveredBy, ...fields } = data;
      const beforeSnap = await settingsRef.get();
      const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : null;
      const changes = diff({ ...(before ?? {}), deliveredBy: restaurant.deliveredBy }, { ...fields, deliveredBy });
      // Qui livre conditionne les espèces : moyens proposés recalculés avec le nouveau mode.
      const fulfillmentModes = enabledFulfillmentModes(ctx, fulfillmentModesOf(fields));
      const paymentsSnap = await restaurantSubRef(rid, 'settings', RESTAURANT_SETTINGS_DOCS.payments).get();
      const nextCtx = { ...ctx, restaurant: { ...restaurant, deliveredBy, fulfillmentModes } };
      const acceptedPaymentMethods = paymentsSnap.exists
        ? acceptedMethodsOf(paymentsSnap.data() as RestaurantPaymentSettings, allowedPaymentMethods(nextCtx))
        : (restaurant.acceptedPaymentMethods ?? []).filter((m) => allowedPaymentMethods(nextCtx).includes(m));
      const batch = db.batch();
      batch.set(settingsRef, { ...fields, updatedAt: now, updatedBy: uid }, { merge: true });
      batch.update(restaurantRef(rid), {
        prepMinutes: fields.prepMinutes,
        etaMinutes: etaFor(restaurant, fields.prepMinutes),
        fulfillmentModes,
        acceptedPaymentMethods,
        minOrderCents: fields.minOrderCents,
        deliveredBy,
        updatedAt: now,
        updatedBy: uid,
      });
      await batch.commit();
      return changes;
    }

    case 'hours': {
      const issues = validateWeeklyHours({ days: data.days as RestaurantHours['days'], exceptions: data.exceptions });
      if (issues.length > 0) throw fail.invalid(issues[0]!.message, { issues });
      const days = [...data.days]
        .sort((a, b) => a.day - b.day)
        .map((d) => ({ ...d, slots: [...d.slots].sort((a, b) => a.from.localeCompare(b.from)) })) as RestaurantHours['days'];
      const exceptions = [...data.exceptions]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ date: e.date, closed: e.closed, slots: e.closed ? [] : (e.slots ?? []), label: e.label }));
      const timezone = ctx.country?.timezone ?? restaurant.hoursSummary?.timezone ?? 'Europe/Paris';
      const hours = { days, exceptions, timezone };
      const settingsRef = restaurantSubRef(rid, 'settings', RESTAURANT_SETTINGS_DOCS.hours);
      const batch = db.batch();
      batch.set(settingsRef, { ...hours, updatedAt: now, updatedBy: uid });
      batch.update(restaurantRef(rid), { hoursSummary: hours, updatedAt: now, updatedBy: uid });
      await batch.commit();
      const changes = diff(restaurant.hoursSummary as unknown as Record<string, unknown>, hours);
      return changes;
    }

    case 'payments': {
      const allowed = allowedPaymentMethods(ctx);
      const refused = (Object.keys(data.methods) as Array<keyof typeof data.methods>).filter(
        (method) => data.methods[method] && !allowed.includes(method),
      );
      if (refused.includes('cash')) {
        throw fail.precondition('Les espèces ne sont acceptées que pour les commandes livrées par vos propres livreurs salariés.');
      }
      if (refused.length > 0) throw fail.precondition('Un des moyens de paiement choisis n’est pas autorisé pour votre établissement.');
      // Tout paiement passe par Ciyou Eats : le paiement en ligne reste toujours ouvert.
      if (!data.online) throw fail.invalid('Le paiement en ligne est obligatoire sur Ciyou Eats.');
      const normalized = {
        online: true,
        onDelivery: data.methods.cash,
        onPickup: false,
        methods: { ...data.methods, meal_voucher: false },
      };
      const accepted = acceptedMethodsOf(normalized, allowed);
      if (accepted.filter((m) => m !== 'wallet' && m !== 'cash').length === 0) throw fail.invalid('Activez au moins un moyen de paiement en ligne.');
      const settingsRef = restaurantSubRef(rid, 'settings', RESTAURANT_SETTINGS_DOCS.payments);
      const beforeSnap = await settingsRef.get();
      const next = normalized;
      const changes = diff(beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : null, next);
      const batch = db.batch();
      batch.set(settingsRef, { ...next, updatedAt: now, updatedBy: uid });
      batch.update(restaurantRef(rid), { acceptedPaymentMethods: accepted, updatedAt: now, updatedBy: uid });
      await batch.commit();
      return changes;
    }

    case 'notifications': {
      const settingsRef = restaurantSubRef(rid, 'settings', RESTAURANT_SETTINGS_DOCS.notifications);
      const beforeSnap = await settingsRef.get();
      const { section: _section, restaurantId: _rid, ...fields } = data;
      const next: Omit<RestaurantNotificationSettings, 'updatedAt' | 'updatedBy'> = {
        ...fields,
        emailRecipients: [...new Set(fields.emailRecipients)],
        smsNumbers: [...new Set(fields.smsNumbers)],
      };
      if (next.smsOnNewOrder && next.smsNumbers.length === 0) throw fail.invalid('Ajoutez un numéro pour recevoir les SMS.');
      const wantsEmail = next.emailDailySummary || next.emailWeeklyReport || next.emailInvoices || Object.values(next.alerts ?? {}).some((a) => a?.email);
      if (wantsEmail && next.emailRecipients.length === 0) throw fail.invalid('Ajoutez au moins une adresse e-mail destinataire.');
      const changes = diff(beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : null, next as unknown as Record<string, unknown>);
      await settingsRef.set({ ...next, updatedAt: now, updatedBy: uid });
      return changes;
    }

    case 'pause': {
      if (restaurant.status === 'suspended') throw fail.precondition('Votre établissement est suspendu par Ciyou Eats.');
      const before = { isOpen: restaurant.isOpen, pausedUntil: restaurant.pausedUntil?.toMillis?.() ?? null };
      if (data.minutes === null) {
        await rRef.update({ isOpen: true, pausedUntil: null, pauseReason: null, updatedAt: now, updatedBy: uid });
        return { before, after: { isOpen: true, pausedUntil: null }, changed: ['isOpen', 'pausedUntil'] };
      }
      const until = Timestamp.fromMillis(now.toMillis() + data.minutes * 60_000);
      await rRef.update({ isOpen: false, pausedUntil: until, pauseReason: data.reason, updatedAt: now, updatedBy: uid });
      return { before, after: { isOpen: false, pausedUntil: until.toMillis(), reason: data.reason }, changed: ['isOpen', 'pausedUntil'] };
    }
  }
}
