// Tâches automatiques de l'exploitation :
// - chaque minute : indicateurs temps réel des zones (livreurs en ligne, disponibles,
//   en course ; commandes en attente de livreur), heures de pointe planifiées ou
//   déclenchées par la demande, fin des fermetures d'urgence et des suspensions ;
// - chaque jour : expiration des documents (relances J-30 / J-7 puis blocage
//   automatique), contrôles d'identité aléatoires, contrôles non réalisés ;
// - à chaque déplacement d'un livreur : zone courante (point dans le polygone).
import {
  ACTIVE_ORDER_STATUSES,
  COLLECTIONS,
  PARTNER_DOCUMENT_LABELS,
  isPointInPolygon,
  type City,
  type Driver,
  type DriverLocation,
  type DriverSanction,
  type Order,
  type PartnerDocument,
  type SurgeRule,
  type Zone,
} from '@golink/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { isOpenAt } from '../../orders/context';
import { addDays, notifyDriver, OPS_SCHEDULE_RUNTIME, parisDay, TIMEZONE } from './common';
import { applyDocumentState, evaluateDriverDocuments } from './compliance';
import { driverDocumentExpiredEmail } from './emails';
import { clearSurge, setSurge } from './zones';

type ZoneLive = NonNullable<Zone['live']>;

/** Zone contenant un point (boîte englobante puis polygone). */
export function zoneOf(point: { lat: number; lng: number }, zones: Array<{ id: string; zone: Zone }>): string | null {
  for (const { id, zone } of zones) {
    const b = zone.bounds;
    if (b && (point.lat > b.north || point.lat < b.south || point.lng > b.east || point.lng < b.west)) continue;
    if (isPointInPolygon(point, zone.polygon)) return id;
  }
  return null;
}

async function computeLive(now: Timestamp): Promise<{ zones: number; written: number }> {
  const [zonesSnap, locationsSnap, ordersSnap] = await Promise.all([
    db.collection(COLLECTIONS.zones).get(),
    db.collection(COLLECTIONS.driverLocations).where('availability', 'in', ['online', 'on_delivery', 'paused']).get(),
    db.collection(COLLECTIONS.orders).where('status', 'in', [...ACTIVE_ORDER_STATUSES]).get(),
  ]);
  const zones = zonesSnap.docs.map((d) => ({ id: d.id, zone: d.data() as Zone }));
  const live = new Map<string, ZoneLive & { driversOnDelivery: number; ordersInProgress: number }>();
  for (const { id } of zones) live.set(id, { driversOnline: 0, driversAvailable: 0, driversOnDelivery: 0, ordersWaiting: 0, ordersInProgress: 0, updatedAt: now });

  for (const doc of locationsSnap.docs) {
    const l = doc.data() as DriverLocation;
    const zoneId = l.zoneId ?? zoneOf({ lat: l.position.latitude, lng: l.position.longitude }, zones);
    const entry = zoneId ? live.get(zoneId) : undefined;
    if (!entry) continue;
    entry.driversOnline += 1;
    if (l.availability === 'online') entry.driversAvailable += 1;
    if (l.availability === 'on_delivery') entry.driversOnDelivery += 1;
  }
  for (const doc of ordersSnap.docs) {
    const o = doc.data() as Order;
    if (o.fulfillment !== 'delivery' || o.delivery?.deliveredBy !== 'platform') continue;
    const entry = o.delivery.zoneId ? live.get(o.delivery.zoneId) : undefined;
    if (!entry) continue;
    entry.ordersInProgress += 1;
    if (!o.driverId && ['accepted', 'preparing', 'ready'].includes(o.status)) entry.ordersWaiting += 1;
  }

  // Écriture seulement si les chiffres changent (ou toutes les 10 minutes, pour la fraîcheur).
  let written = 0;
  const batch = db.batch();
  for (const { id, zone } of zones) {
    const next = live.get(id)!;
    const prev = zone.live;
    const same =
      prev &&
      prev.driversOnline === next.driversOnline &&
      prev.driversAvailable === next.driversAvailable &&
      prev.ordersWaiting === next.ordersWaiting &&
      (prev.driversOnDelivery ?? 0) === next.driversOnDelivery &&
      (prev.ordersInProgress ?? 0) === next.ordersInProgress &&
      now.toMillis() - prev.updatedAt.toMillis() < 10 * 60_000;
    if (same) continue;
    batch.update(db.collection(COLLECTIONS.zones).doc(id), { live: next });
    zone.live = next;
    written += 1;
  }
  if (written > 0) await batch.commit();
  await applySurgeAutomation(now, zones);
  return { zones: zones.length, written };
}

/** Majorations planifiées (créneaux) et automatiques (demande), fin des majorations échues. */
async function applySurgeAutomation(now: Timestamp, zones: Array<{ id: string; zone: Zone }>): Promise<void> {
  const byId = new Map(zones.map((z) => [z.id, z.zone]));
  // Majorations échues.
  for (const { id, zone } of zones) {
    if (zone.currentSurge && zone.currentSurge.until.toMillis() <= now.toMillis()) {
      await db.collection(COLLECTIONS.zones).doc(id).update({ currentSurge: null });
      zone.currentSurge = null;
    }
  }
  const rules = await db.collection(COLLECTIONS.surgeRules).where('active', '==', true).get();
  for (const doc of rules.docs) {
    const rule = doc.data() as SurgeRule;
    if (rule.trigger === 'manual') continue;
    let on = false;
    if (rule.trigger === 'schedule') on = Boolean(rule.schedule && isOpenAt(rule.schedule, now.toDate()));
    else if (rule.demandRatio) {
      on = rule.zoneIds.some((zid) => {
        const l = byId.get(zid)?.live;
        return Boolean(l && l.ordersWaiting > 0 && l.ordersWaiting / Math.max(1, l.driversAvailable) >= (rule.demandRatio ?? Infinity));
      });
    }
    const running = rule.zoneIds.some((zid) => byId.get(zid)?.currentSurge?.ruleId === doc.id);
    if (on) await setSurge(doc.id, rule, Timestamp.fromMillis(now.toMillis() + 15 * 60_000));
    else if (running) await clearSurge(doc.id);
  }
}

/** Fermetures d'urgence arrivées à échéance : réouverture automatique. */
async function expireClosures(now: Timestamp): Promise<number> {
  let reopened = 0;
  for (const collection of [COLLECTIONS.cities, COLLECTIONS.zones]) {
    const snap = await db.collection(collection).where('emergencyClosure.active', '==', true).get();
    for (const doc of snap.docs) {
      const closure = (doc.data() as City | Zone).emergencyClosure;
      if (!closure?.endsAt || closure.endsAt.toMillis() > now.toMillis()) continue;
      await doc.ref.update({ emergencyClosure: null, updatedAt: now, updatedBy: 'system' });
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: `${collection === COLLECTIONS.cities ? 'city' : 'zone'}.reopened`,
        target: { type: collection === COLLECTIONS.cities ? 'city' : 'zone', id: doc.id, label: (doc.get('name') as string) ?? doc.id },
        reason: 'Fin prévue de la fermeture d’urgence',
        cityId: collection === COLLECTIONS.cities ? doc.id : (doc.get('cityId') as string),
        countryId: doc.get('countryId') as string,
      });
      reopened += 1;
    }
  }
  return reopened;
}

/** Suspensions temporaires échues : sanction expirée, compte réactivé (sauf autre blocage). */
async function expireSanctions(now: Timestamp): Promise<number> {
  const snap = await db.collection(COLLECTIONS.driverSanctions).where('status', 'in', ['active', 'contested', 'upheld']).where('endsAt', '<=', now).limit(100).get();
  let lifted = 0;
  for (const doc of snap.docs) {
    const sanction = doc.data() as DriverSanction;
    // Une contestation en attente n'empêche pas la fin de la suspension.
    const driverRef = db.collection(COLLECTIONS.drivers).doc(sanction.driverId);
    await db.runTransaction(async (tx) => {
      const driverSnap = await tx.get(driverRef);
      const driver = driverSnap.data() as Driver | undefined;
      tx.update(doc.ref, { status: sanction.status === 'contested' ? 'contested' : 'expired', updatedAt: now, updatedBy: 'system', expiredAt: now });
      if (driver && driver.activeSanctionId === doc.id && sanction.type === 'temporary_suspension') {
        const otherBlock = driver.blocked && driver.blocked.reason !== 'sanction';
        tx.update(driverRef, { activeSanctionId: null, ...(otherBlock ? {} : { status: 'active', blocked: null }), updatedAt: now, updatedBy: 'system' });
        lifted += 1;
      }
    });
  }
  return lifted;
}

export const computeZoneLive = onSchedule({ schedule: 'every 1 minutes', timeZone: TIMEZONE, ...OPS_SCHEDULE_RUNTIME }, async () => {
  const now = Timestamp.now();
  const [live, reopened, lifted] = await Promise.allSettled([computeLive(now), expireClosures(now), expireSanctions(now)]);
  for (const result of [live, reopened, lifted]) {
    if (result.status === 'rejected') logger.error('Exploitation : tâche en échec', { error: result.reason instanceof Error ? result.reason.stack : String(result.reason) });
  }
  if (reopened.status === 'fulfilled' && reopened.value > 0) logger.info('Fermetures d’urgence levées', { reopened: reopened.value });
  if (lifted.status === 'fulfilled' && lifted.value > 0) logger.info('Suspensions levées', { lifted: lifted.value });
});

// ------------------------------------------------------------------ Conformité quotidienne

async function documentExpiry(today: string): Promise<{ reminded: number; expired: number; blocked: number }> {
  const horizon = addDays(today, 30);
  const snap = await db.collection(COLLECTIONS.partnerDocuments).where('status', '==', 'approved').where('expiresAt', '<=', horizon).get();
  let reminded = 0;
  let expired = 0;
  const touchedDrivers = new Set<string>();
  for (const doc of snap.docs) {
    const d = doc.data() as PartnerDocument;
    if (d.ownerType !== 'driver' || !d.expiresAt) continue;
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(d.ownerId).get();
    if (!driverSnap.exists) continue;
    const driver = { id: driverSnap.id, data: driverSnap.data() as Driver };
    if (d.expiresAt < today) {
      await doc.ref.update({ status: 'expired', updatedAt: FieldValue.serverTimestamp(), updatedBy: 'system' });
      touchedDrivers.add(d.ownerId);
      expired += 1;
      continue;
    }
    const daysLeft = Math.round((Date.parse(d.expiresAt) - Date.parse(today)) / 86_400_000);
    const due = (daysLeft <= 7 && d.remindersSent < 2) || (daysLeft <= 30 && d.remindersSent < 1);
    if (!due) continue;
    await notifyDriver(driver, {
      title: `${PARTNER_DOCUMENT_LABELS[d.type]} : expiration dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
      body: 'Déposez une version à jour depuis l’application pour continuer à recevoir des courses.',
      category: 'document',
      templateKey: 'driver_document_reminder',
    });
    await doc.ref.update({ remindersSent: daysLeft <= 7 ? 2 : 1, lastReminderAt: FieldValue.serverTimestamp() });
    reminded += 1;
  }
  let blocked = 0;
  for (const driverId of touchedDrivers) {
    const snapDriver = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
    const driver = snapDriver.data() as Driver;
    const state = await evaluateDriverDocuments(driverId, driver, today);
    const applied = await applyDocumentState(driverId, driver, state);
    if (applied.blocked) {
      blocked += 1;
      await notifyDriver({ id: driverId, data: driver }, {
        title: 'Document expiré : compte en pause',
        body: 'Déposez un document à jour : vos courses reprendront dès sa validation.',
        category: 'document',
        email: driverDocumentExpiredEmail(driver.firstName, state.expired),
        templateKey: 'driver_document_expired',
      });
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'driver.blocked_documents_expired',
        target: { type: 'driver', id: driverId, label: driver.displayName },
        reason: `Pièces expirées : ${state.expired.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ')}`,
        countryId: driver.countryId,
        cityId: driver.cityId,
      });
    }
  }
  return { reminded, expired, blocked };
}

/** Contrôles d'identité aléatoires (5 % des livreurs actifs non contrôlés depuis 30 jours) et contrôles expirés. */
async function identityChecks(now: Timestamp): Promise<{ requested: number; expired: number }> {
  const stale = await db.collection(COLLECTIONS.identityChecks).where('status', '==', 'requested').where('requestedAt', '<=', Timestamp.fromMillis(now.toMillis() - 48 * 3_600_000)).get();
  // Contrôle resté sans réponse 48 h : suspension automatique (même conséquence qu'un contrôle non conforme), motif visible sur la fiche.
  await Promise.all(
    stale.docs.map(async (d) => {
      await d.ref.update({ status: 'expired', updatedAt: now });
      const driverId = d.get('driverId') as string;
      const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
      const driverSnap = await driverRef.get();
      if (!driverSnap.exists || driverSnap.get('status') !== 'active') return;
      await driverRef.update({
        status: 'suspended',
        blocked: { reason: 'identity_check_expired', since: now, details: 'Vérification d’identité demandée, restée sans réponse 48 h.', documentIds: [] },
        updatedAt: now,
        updatedBy: 'system',
      });
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'driver.blocked_identity_check_expired',
        target: { type: 'driver', id: driverId, label: (driverSnap.data() as Driver).displayName },
        reason: 'Contrôle d’identité resté sans réponse 48 h.',
        countryId: null,
        cityId: (driverSnap.data() as Driver).cityId,
      });
      await notifyDriver({ id: driverId, data: driverSnap.data() as Driver }, { title: 'Compte suspendu', body: 'Votre vérification d’identité est restée sans réponse : votre compte est suspendu. Contactez le support Ciyou Eats.', category: 'account', templateKey: 'driver_identity_check_expired' });
    }),
  );
  const drivers = await db.collection(COLLECTIONS.drivers).where('status', '==', 'active').where('type', '==', 'platform').get();
  const cutoff = now.toMillis() - 30 * 86_400_000;
  const pending = new Set((await db.collection(COLLECTIONS.identityChecks).where('status', 'in', ['requested', 'submitted']).get()).docs.map((d) => d.get('driverId') as string));
  let requested = 0;
  for (const doc of drivers.docs) {
    const driver = doc.data() as Driver;
    if (pending.has(doc.id)) continue;
    if ((driver.lastIdentityCheckAt?.toMillis() ?? 0) > cutoff || Math.random() > 0.05) continue;
    await db.collection(COLLECTIONS.identityChecks).add({ driverId: doc.id, cityId: driver.cityId, requestedAt: now, trigger: 'random', selfie: null, status: 'requested', matchScore: null, reviewedBy: null, reviewedAt: null });
    await notifyDriver({ id: doc.id, data: driver }, { title: 'Vérification d’identité', body: 'Prenez un selfie depuis l’application avant votre prochaine course.', category: 'account', templateKey: 'driver_identity_requested' });
    requested += 1;
  }
  return { requested, expired: stale.size };
}

export const runDriverCompliance = onSchedule(
  { schedule: 'every day 06:10', timeZone: TIMEZONE, ...OPS_SCHEDULE_RUNTIME, timeoutSeconds: 300, secrets: EMAIL_SECRETS },
  async () => {
    const now = Timestamp.now();
    const [docs, checks] = await Promise.allSettled([documentExpiry(parisDay()), identityChecks(now)]);
    logger.info('Conformité des livreurs', {
      documents: docs.status === 'fulfilled' ? docs.value : String(docs.reason),
      identity: checks.status === 'fulfilled' ? checks.value : String(checks.reason),
    });
  },
);

// ------------------------------------------------------------------ Position des livreurs

let zoneCache: { at: number; zones: Array<{ id: string; zone: Zone }> } | null = null;

async function activeZones(): Promise<Array<{ id: string; zone: Zone }>> {
  if (zoneCache && Date.now() - zoneCache.at < 5 * 60_000) return zoneCache.zones;
  const snap = await db.collection(COLLECTIONS.zones).get();
  zoneCache = { at: Date.now(), zones: snap.docs.map((d) => ({ id: d.id, zone: d.data() as Zone })) };
  return zoneCache.zones;
}

/** Zone courante du livreur, recalculée quand il se déplace (écriture seulement si elle change). */
export const onDriverLocationWritten = onDocumentWritten(
  { document: `${COLLECTIONS.driverLocations}/{driverId}`, maxInstances: 3, cpu: 'gcf_gen1' },
  async (event) => {
    const after = event.data?.after.data() as DriverLocation | undefined;
    if (!after?.position) return;
    const before = event.data?.before.data() as DriverLocation | undefined;
    if (before?.position && before.position.latitude === after.position.latitude && before.position.longitude === after.position.longitude && before.zoneId !== undefined) return;
    const zones = (await activeZones()).filter((z) => z.zone.cityId === after.cityId);
    const zoneId = zoneOf({ lat: after.position.latitude, lng: after.position.longitude }, zones);
    if ((after.zoneId ?? null) === zoneId) return;
    await event.data!.after.ref.update({ zoneId });
  },
);
