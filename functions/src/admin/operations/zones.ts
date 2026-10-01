// Zones et villes (cahier §10) : villes activables, zones dessinées sur la carte
// (polygone, distance maximale, tarifs, horaires), fermeture d'urgence avec message
// aux clients, heures de pointe (majoration des frais, bonus livreurs).
import {
  COLLECTIONS,
  EMERGENCY_REASON_LABELS,
  polygonBounds,
  slugify,
  type City,
  type EmergencyClosure,
  type SurgeRule,
  type WeeklyHours,
  type Zone,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { sendPlatformMessage } from '../../notifications/messages';
import { opsCallable, plain, writeSettingsHistory } from './common';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM');
const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const weeklyHours = z.object({
  days: z
    .array(z.object({ day: z.number().int().min(0).max(6), open: z.boolean(), slots: z.array(z.object({ from: hhmm, to: hhmm })).max(4) }))
    .length(7),
  exceptions: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), closed: z.boolean(), slots: z.array(z.object({ from: hhmm, to: hhmm })).max(4).optional(), label: z.string().max(80).nullish() }))
    .max(60),
  timezone: z.string().min(3).max(60),
});
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #RRGGBB');

// ------------------------------------------------------------------ Villes

export const saveCity = opsCallable(
  z.object({
    cityId: zId.nullish(),
    countryId: z.string().regex(/^[A-Z]{2}$/),
    name: z.string().trim().min(2).max(60),
    timezone: z.string().min(3).max(60),
    center: latLng,
    serviceHours: weeklyHours,
    reason: zReason,
  }),
  async (data, request): Promise<{ cityId: string }> => {
    const { caller, admin } = await requireAdmin(request, data.cityId ? 'zones.edit' : 'markets.edit');
    const country = await db.collection(COLLECTIONS.countries).doc(data.countryId).get();
    if (!country.exists) throw fail.notFound('Pays');
    const now = Timestamp.now();
    if (data.cityId) {
      assertAdminCovers(admin, data.cityId);
      const ref = db.collection(COLLECTIONS.cities).doc(data.cityId);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound('Ville');
      const city = snap.data() as City;
      if (city.countryId !== data.countryId) throw fail.invalid('Le pays d’une ville ne peut pas être modifié.');
      const update = { name: data.name, timezone: data.timezone, center: data.center, serviceHours: data.serviceHours as WeeklyHours };
      await ref.update({ ...update, updatedAt: now, updatedBy: caller.uid });
      await writeSettingsHistory({ docPath: `${COLLECTIONS.cities}/${snap.id}`, before: plain({ name: city.name, timezone: city.timezone, center: city.center, serviceHours: city.serviceHours }), after: plain(update), reason: data.reason ?? null, caller, cityId: snap.id });
      await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'city.updated', target: { type: 'city', id: snap.id, label: data.name }, reason: data.reason ?? null, countryId: city.countryId, cityId: snap.id, request });
      return { cityId: snap.id };
    }
    const id = slugify(data.name);
    if (!id) throw fail.invalid('Nom de ville invalide.');
    const ref = db.collection(COLLECTIONS.cities).doc(id);
    const city: City = {
      countryId: data.countryId,
      name: data.name,
      slug: id,
      active: false,
      launchedAt: null,
      timezone: data.timezone,
      center: data.center,
      serviceHours: data.serviceHours as WeeklyHours,
      pricing: null,
      orderRules: null,
      dispatch: null,
      emergencyClosure: null,
      commissionOverrideBps: null,
      managerIds: [],
      stats: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    try {
      await ref.create(city);
    } catch {
      throw fail.alreadyExists('Une ville porte déjà ce nom.');
    }
    // Administrateurs limités à ce pays : la nouvelle ville entre dans leur périmètre.
    const scopedAdmins = await db.collection(COLLECTIONS.admins).where('countryIds', 'array-contains', data.countryId).get();
    for (const doc of scopedAdmins.docs) {
      const a = doc.data() as { role: string; cityIds?: string[] };
      if (a.role !== 'super_admin' && (a.cityIds?.length ?? 0) > 0 && !a.cityIds!.includes(id)) await doc.ref.update({ cityIds: [...a.cityIds!, id], updatedAt: now, updatedBy: caller.uid });
    }
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'city.created', target: { type: 'city', id, label: data.name }, reason: data.reason ?? null, countryId: data.countryId, cityId: id, request });
    return { cityId: id };
  },
);

export const setCityActive = opsCallable(
  z.object({ cityId: zId, active: z.boolean(), reason: zReason }),
  async (data, request): Promise<{ active: boolean }> => {
    const { caller } = await requireAdmin(request, 'markets.edit');
    const ref = db.collection(COLLECTIONS.cities).doc(data.cityId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Ville');
    const city = snap.data() as City;
    if (city.active === data.active) return { active: city.active };
    if (data.active) {
      const zones = await db.collection(COLLECTIONS.zones).where('cityId', '==', data.cityId).where('active', '==', true).limit(1).get();
      if (zones.empty) throw fail.precondition('Activez d’abord au moins une zone de livraison dans cette ville.');
    }
    await ref.update({
      active: data.active,
      ...(data.active && !city.launchedAt ? { launchedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    await writeSettingsHistory({ docPath: `${COLLECTIONS.cities}/${data.cityId}`, before: { active: city.active }, after: { active: data.active }, reason: data.reason, caller, cityId: data.cityId });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.active ? 'city.activated' : 'city.deactivated',
      target: { type: 'city', id: data.cityId, label: city.name },
      reason: data.reason,
      before: { active: city.active },
      after: { active: data.active },
      countryId: city.countryId,
      cityId: data.cityId,
      sensitive: true,
      request,
    });
    return { active: data.active };
  },
);

// ------------------------------------------------------------------ Zones

export const saveZone = opsCallable(
  z.object({
    zoneId: zId.nullish(),
    cityId: zId,
    name: z.string().trim().min(2).max(60),
    color,
    active: z.boolean(),
    polygon: z.array(latLng).min(3, 'Tracez au moins trois points').max(200),
    maxDeliveryDistanceMeters: z.number().int().min(500).max(40_000),
    deliveryTiers: z.array(z.object({ upToMeters: z.number().int().min(100).max(40_000), feeCents: z.number().int().min(0).max(5_000) })).max(10).nullish(),
    minOrderCents: z.number().int().min(0).max(20_000).nullish(),
    serviceHours: weeklyHours.nullish(),
    reason: z.string().trim().max(500).nullish(),
  }),
  async (data, request): Promise<{ zoneId: string }> => {
    const { caller, admin } = await requireAdmin(request, 'zones.edit');
    assertAdminCovers(admin, data.cityId);
    const citySnap = await db.collection(COLLECTIONS.cities).doc(data.cityId).get();
    if (!citySnap.exists) throw fail.notFound('Ville');
    const city = citySnap.data() as City;
    const tiers = data.deliveryTiers ? [...data.deliveryTiers].sort((a, b) => a.upToMeters - b.upToMeters) : null;
    if (tiers && tiers.some((t, i) => i > 0 && t.upToMeters === tiers[i - 1]!.upToMeters)) throw fail.invalid('Deux paliers de frais ont la même distance.');
    const fields = {
      name: data.name,
      color: data.color.toLowerCase(),
      active: data.active,
      polygon: data.polygon,
      bounds: polygonBounds(data.polygon),
      maxDeliveryDistanceMeters: data.maxDeliveryDistanceMeters,
      deliveryTiers: tiers,
      minOrderCents: data.minOrderCents ?? null,
      serviceHours: (data.serviceHours as WeeklyHours | null | undefined) ?? null,
    };
    const now = Timestamp.now();
    if (data.zoneId) {
      const ref = db.collection(COLLECTIONS.zones).doc(data.zoneId);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound('Zone');
      const zone = snap.data() as Zone;
      if (zone.cityId !== data.cityId) throw fail.invalid('Une zone ne peut pas changer de ville.');
      await ref.update({ ...fields, updatedAt: now, updatedBy: caller.uid });
      await writeSettingsHistory({
        docPath: `${COLLECTIONS.zones}/${snap.id}`,
        before: plain({ name: zone.name, color: zone.color, active: zone.active, polygon: zone.polygon, maxDeliveryDistanceMeters: zone.maxDeliveryDistanceMeters, deliveryTiers: zone.deliveryTiers ?? null, minOrderCents: zone.minOrderCents ?? null, serviceHours: zone.serviceHours ?? null }),
        after: plain({ ...fields, bounds: undefined }),
        reason: data.reason ?? null,
        caller,
        cityId: data.cityId,
      });
      await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'zone.updated', target: { type: 'zone', id: snap.id, label: data.name }, reason: data.reason ?? null, countryId: city.countryId, cityId: data.cityId, request });
      return { zoneId: snap.id };
    }
    const base = `${data.cityId}-${slugify(data.name)}`.slice(0, 100);
    let id = base;
    for (let i = 2; (await db.collection(COLLECTIONS.zones).doc(id).get()).exists; i += 1) id = `${base}-${i}`;
    const zone: Zone = {
      countryId: city.countryId,
      cityId: data.cityId,
      ...fields,
      emergencyClosure: null,
      currentSurge: null,
      live: null,
      dispatch: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await db.collection(COLLECTIONS.zones).doc(id).set(zone);
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'zone.created', target: { type: 'zone', id, label: data.name }, reason: data.reason ?? null, countryId: city.countryId, cityId: data.cityId, request });
    return { zoneId: id };
  },
);

/** Fermeture d'urgence d'une ville ou d'une zone (message aux clients), et réouverture. */
export const closeZone = opsCallable(
  z.object({
    scope: z.enum(['city', 'zone']),
    id: zId,
    close: z.boolean(),
    reason: z.enum(['weather', 'event', 'driver_shortage', 'incident', 'other']).nullish(),
    message: z.string().trim().max(280).nullish(),
    /** Message aux clients en anglais et en arabe (décision client : français, anglais, arabe). */
    messageEn: z.string().trim().max(280).nullish(),
    messageAr: z.string().trim().max(280).nullish(),
    endsAt: z.number().int().positive().nullish(),
    note: zReason,
  }),
  async (data, request): Promise<{ closed: boolean; notified: number }> => {
    const { caller, admin } = await requireAdmin(request, 'zones.edit');
    const ref = db.collection(data.scope === 'city' ? COLLECTIONS.cities : COLLECTIONS.zones).doc(data.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound(data.scope === 'city' ? 'Ville' : 'Zone');
    const doc = snap.data() as City | Zone;
    const cityId = data.scope === 'city' ? snap.id : (doc as Zone).cityId;
    assertAdminCovers(admin, cityId);
    let closure: EmergencyClosure | null = null;
    if (data.close) {
      if (!data.reason) throw fail.invalid('Choisissez la cause de la fermeture.');
      if (!data.message || data.message.length < 5) throw fail.invalid('Rédigez le message affiché aux clients.');
      if (data.endsAt && data.endsAt <= Date.now()) throw fail.invalid('La fin prévue doit être dans le futur.');
      closure = {
        active: true,
        reason: data.reason,
        message: { fr: data.message, ...(data.messageEn ? { en: data.messageEn } : {}), ...(data.messageAr ? { ar: data.messageAr } : {}) },
        startedAt: Timestamp.now(),
        endsAt: data.endsAt ? Timestamp.fromMillis(data.endsAt) : null,
        startedBy: caller.uid,
      };
    } else if (!doc.emergencyClosure?.active) {
      throw fail.precondition('Aucune fermeture d’urgence en cours.');
    }
    await ref.update({ emergencyClosure: closure, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const label = (doc as { name: string }).name;
    await writeSettingsHistory({
      docPath: `${ref.parent.id}/${snap.id}#emergencyClosure`,
      before: { emergencyClosure: doc.emergencyClosure?.active ? { reason: doc.emergencyClosure.reason, message: doc.emergencyClosure.message.fr } : null },
      after: { emergencyClosure: closure ? { reason: closure.reason, message: closure.message.fr, endsAt: data.endsAt ?? null } : null },
      reason: data.note,
      caller,
      cityId,
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.close ? `${data.scope}.emergency_closed` : `${data.scope}.reopened`,
      target: { type: data.scope, id: snap.id, label },
      reason: data.note,
      after: closure ? { reason: EMERGENCY_REASON_LABELS[closure.reason], message: data.message, endsAt: data.endsAt ?? null } : { reopened: true },
      countryId: doc.countryId,
      cityId,
      sensitive: true,
      request,
    });
    // Clients concernés (commandes en cours dans la ville ou la zone) : prévenus par le message multilingue.
    let notified = 0;
    if (closure) notified = await notifyClosure({ scope: data.scope, targetId: snap.id, cityId, closure });
    return { closed: data.close, notified };
  },
  { secrets: EMAIL_SECRETS },
);

const OPEN_ORDER_STATUSES = ['scheduled', 'new', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'];

async function notifyClosure(input: { scope: 'city' | 'zone'; targetId: string; cityId: string; closure: EmergencyClosure }): Promise<number> {
  const snap = await db.collection(COLLECTIONS.orders).where('cityId', '==', input.cityId).where('status', 'in', OPEN_ORDER_STATUSES).select('customerId', 'delivery', 'test').limit(500).get();
  const customers = new Map<string, boolean>();
  for (const doc of snap.docs) {
    const zoneId = (doc.get('delivery') as { zoneId?: string | null } | null)?.zoneId;
    if (input.scope === 'zone' && zoneId !== input.targetId) continue;
    customers.set(doc.get('customerId') as string, doc.get('test') === true);
  }
  const { fr, en, ar } = input.closure.message;
  const localizedValues = { fr: { message: fr }, en: { message: en ?? fr }, ar: { message: ar ?? fr } };
  const stamp = input.closure.startedAt.toMillis();
  await Promise.all(
    [...customers].map(([uid, demo]) => sendPlatformMessage('zone_emergency_closure', { uid, type: 'client', demo }, { message: fr }, { dedupeKey: `${input.targetId}-${stamp}`, localizedValues })),
  );
  return customers.size;
}

// ------------------------------------------------------------------ Heures de pointe

export const saveSurgeRule = opsCallable(
  z.object({
    ruleId: zId.nullish(),
    cityId: zId,
    zoneIds: z.array(zId).min(1, 'Choisissez au moins une zone').max(30),
    name: z.string().trim().min(2).max(60),
    active: z.boolean(),
    trigger: z.enum(['manual', 'schedule', 'demand']),
    schedule: weeklyHours.nullish(),
    demandRatio: z.number().min(0.5).max(20).nullish(),
    multiplierBps: z.number().int().min(10_000).max(30_000),
    flatFeeCents: z.number().int().min(0).max(1_000),
    courierBonusCents: z.number().int().min(0).max(2_000),
    reason: z.string().trim().max(500).nullish(),
  }),
  async (data, request): Promise<{ ruleId: string }> => {
    const { caller, admin } = await requireAdmin(request, 'zones.edit');
    assertAdminCovers(admin, data.cityId);
    const city = await db.collection(COLLECTIONS.cities).doc(data.cityId).get();
    if (!city.exists) throw fail.notFound('Ville');
    if (data.trigger === 'schedule' && !data.schedule) throw fail.invalid('Indiquez les créneaux de la majoration planifiée.');
    if (data.trigger === 'demand' && !data.demandRatio) throw fail.invalid('Indiquez le seuil de déclenchement (commandes par livreur disponible).');
    const zones = await db.getAll(...data.zoneIds.map((id) => db.collection(COLLECTIONS.zones).doc(id)));
    if (zones.some((z) => !z.exists || z.get('cityId') !== data.cityId)) throw fail.invalid('Toutes les zones doivent appartenir à la ville.');
    if (data.multiplierBps === 10_000 && data.flatFeeCents === 0 && data.courierBonusCents === 0) throw fail.invalid('Une règle de pointe doit majorer les frais ou verser un bonus.');
    const now = Timestamp.now();
    const fields = {
      countryId: city.get('countryId') as string,
      cityId: data.cityId,
      zoneIds: data.zoneIds,
      name: data.name,
      active: data.active,
      trigger: data.trigger,
      schedule: data.trigger === 'schedule' ? ((data.schedule as WeeklyHours) ?? null) : null,
      demandRatio: data.trigger === 'demand' ? (data.demandRatio ?? null) : null,
      multiplierBps: data.multiplierBps,
      flatFeeCents: data.flatFeeCents,
      courierBonusCents: data.courierBonusCents,
    };
    let id = data.ruleId ?? null;
    let before: Record<string, unknown> | null = null;
    if (id) {
      const ref = db.collection(COLLECTIONS.surgeRules).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound('Règle de pointe');
      if (snap.get('cityId') !== data.cityId) throw fail.invalid('Une règle ne peut pas changer de ville.');
      before = plain(snap.data());
      await ref.update({ ...fields, updatedAt: now, updatedBy: caller.uid });
      // Règle désactivée : la majoration en cours sur ses zones s'arrête.
      if (!data.active) await clearSurge(id);
    } else {
      const ref = db.collection(COLLECTIONS.surgeRules).doc();
      id = ref.id;
      const rule: SurgeRule = { ...fields, startsAt: null, endsAt: null, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid };
      await ref.set(rule);
    }
    await writeSettingsHistory({ docPath: `${COLLECTIONS.surgeRules}/${id}`, before, after: plain(fields), reason: data.reason ?? null, caller, cityId: data.cityId });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: data.ruleId ? 'surge_rule.updated' : 'surge_rule.created', target: { type: 'city', id: data.cityId, label: data.name }, reason: data.reason ?? null, countryId: fields.countryId, cityId: data.cityId, sensitive: true, request });
    return { ruleId: id };
  },
);

/** Retire la majoration posée par une règle sur ses zones. */
export async function clearSurge(ruleId: string): Promise<number> {
  const zones = await db.collection(COLLECTIONS.zones).where('currentSurge.ruleId', '==', ruleId).get();
  await Promise.all(zones.docs.map((z) => z.ref.update({ currentSurge: null })));
  return zones.size;
}

/** Pose la majoration d'une règle sur ses zones jusqu'à `until`. */
export async function setSurge(ruleId: string, rule: SurgeRule, until: Timestamp): Promise<void> {
  const refs = rule.zoneIds.map((id) => db.collection(COLLECTIONS.zones).doc(id));
  await Promise.all(
    refs.map((ref) => ref.update({ currentSurge: { multiplierBps: rule.multiplierBps, courierBonusCents: rule.courierBonusCents, flatFeeCents: rule.flatFeeCents, ruleId, until } })),
  );
}

export const applySurge = opsCallable(
  z.object({ ruleId: zId, on: z.boolean(), durationMinutes: z.number().int().min(15).max(720).nullish(), reason: zReason }),
  async (data, request): Promise<{ on: boolean; until: number | null }> => {
    const { caller, admin } = await requireAdmin(request, 'zones.edit');
    const ref = db.collection(COLLECTIONS.surgeRules).doc(data.ruleId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Règle de pointe');
    const rule = snap.data() as SurgeRule;
    assertAdminCovers(admin, rule.cityId);
    let until: Timestamp | null = null;
    if (data.on) {
      if (!rule.active) throw fail.precondition('Activez d’abord cette règle.');
      until = Timestamp.fromMillis(Date.now() + (data.durationMinutes ?? 60) * 60_000);
      await setSurge(snap.id, rule, until);
      await ref.update({ startsAt: Timestamp.now(), endsAt: until, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    } else {
      await clearSurge(snap.id);
      await ref.update({ endsAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.on ? 'surge.started' : 'surge.stopped',
      target: { type: 'city', id: rule.cityId, label: rule.name },
      reason: data.reason,
      after: { ruleId: snap.id, zones: rule.zoneIds, until: until?.toMillis() ?? null },
      countryId: rule.countryId,
      cityId: rule.cityId,
      sensitive: true,
      request,
    });
    return { on: data.on, until: until?.toMillis() ?? null };
  },
);
