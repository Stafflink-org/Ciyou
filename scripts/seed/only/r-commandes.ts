// Données complémentaires « Commandes » (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/r-commandes.ts
// - motif de ticket « Problème sur une commande » (signalements du restaurant) ;
// - clients de démonstration (comptes Auth sans mot de passe, profils, adresses)
//   utilisés par le simulateur `npm run simulate:orders` ;
// - livreurs Ciyou Eats de démonstration (profil actif, hors ligne, position).
// Tous ces documents portent `seed: true` et `test: true` (le simulateur peut
// ainsi commander hors des horaires d'ouverture). Aucun mot de passe n'est stocké.
import {
  COLLECTIONS,
  ORDER_ISSUE_TICKET_REASON_ID,
  SUBCOLLECTIONS,
  buildSearchKeywords,
  encodeGeohash,
  type Driver,
  type DriverLocation,
  type DriverPrivate,
  type LatLng,
  type TicketReason,
  type UserAddress,
  type UserProfile,
  type VehicleType,
} from '@golink/shared';
import { auth, db } from '../../lib/admin.mjs';
import { CITIES, STREETS } from '../catalog';
import { GeoPoint, offsetPoint, Timestamp } from '../lib';

export const SIM_CITIES = ['longwy', 'metz', 'luxembourg'] as const;
export type SimCity = (typeof SIM_CITIES)[number];

const CLIENTS: Array<{ first: string; last: string }> = [
  { first: 'Nora', last: 'Adam' },
  { first: 'Léo', last: 'Garnier' },
  { first: 'Inès', last: 'Brunet' },
  { first: 'Hugo', last: 'Lambert' },
  { first: 'Sarah', last: 'Klein' },
  { first: 'Yanis', last: 'Weber' },
];

const DRIVERS: Array<{ first: string; last: string; vehicle: VehicleType }> = [
  { first: 'Nils', last: 'Bauer', vehicle: 'e_bike' },
  { first: 'Maya', last: 'Roche', vehicle: 'scooter' },
  { first: 'Jonas', last: 'Muller', vehicle: 'bike' },
];

export function simClientUid(city: SimCity, index: number): string {
  return `sim-client-${city}-${index + 1}`;
}

export function simDriverUid(city: SimCity, index: number): string {
  return `sim-driver-${city}-${index + 1}`;
}

export const SIM_CLIENTS_PER_CITY = CLIENTS.length;
export const SIM_DRIVERS_PER_CITY = DRIVERS.length;

/** Crée le compte Auth s'il n'existe pas (sans mot de passe : le simulateur en pose un à chaque exécution). */
async function ensureAuthUser(uid: string, email: string, displayName: string, role: 'client' | 'driver'): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email, displayName, emailVerified: true, disabled: false });
  }
  await auth.setCustomUserClaims(uid, { role });
}

function profile(first: string, last: string, email: string, role: 'client' | 'driver', city: (typeof CITIES)[number], now: Timestamp): UserProfile & { seed: true; test: true } {
  return {
    role,
    firstName: first,
    lastName: last,
    displayName: `${first} ${last}`,
    email,
    emailVerified: true,
    phone: city.countryId === 'LU' ? '+352 621 00 00 00' : '+33 6 00 00 00 00',
    phoneVerified: false,
    avatar: null,
    locale: 'fr',
    status: 'active',
    defaultAddressId: role === 'client' ? 'domicile' : null,
    consents: {},
    notificationPrefs: { orderUpdates: true, promotions: false, newsletter: false },
    walletBalanceCents: 0,
    referralCode: `SIM${email.slice(4, 9).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
    referredBy: null,
    stats: { ordersCount: 3, totalSpentCents: 0, lastOrderAt: null, firstOrderAt: null, cancelledCount: 0, refundsCount: 0 },
    acceptedLegal: {},
    countryId: city.countryId,
    cityId: city.id,
    searchKeywords: buildSearchKeywords(`${first} ${last}`, email),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: now,
    createdBy: 'system',
    updatedAt: now,
    updatedBy: 'system',
    seed: true,
    test: true,
  } as UserProfile & { seed: true; test: true };
}

function address(label: string, line1: string, city: (typeof CITIES)[number], point: LatLng, now: Timestamp, uid: string): UserAddress & { seed: true } {
  return {
    label,
    line1,
    line2: null,
    postalCode: city.postalCode,
    city: city.name,
    countryCode: city.countryId,
    geo: new GeoPoint(point.lat, point.lng),
    geohash: encodeGeohash(point),
    placeId: null,
    details: null,
    instructions: label === 'Travail' ? 'Accueil au rez-de-chaussée.' : null,
    floor: label === 'Domicile' ? '2' : null,
    doorCode: null,
    isDefault: label === 'Domicile',
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
    updatedBy: uid,
    seed: true,
  };
}

async function main(): Promise<void> {
  const now = Timestamp.now();
  const batch = db.batch();

  // Motif de ticket des signalements de commande.
  const reason: TicketReason & { seed: true } = {
    label: { fr: 'Problème sur une commande' },
    audience: ['restaurant'],
    defaultPriority: 'high',
    requiresOrder: true,
    order: 1,
    active: true,
    seed: true,
  } as TicketReason & { seed: true };
  batch.set(db.collection(COLLECTIONS.ticketReasons).doc(ORDER_ISSUE_TICKET_REASON_ID), reason, { merge: true });

  let clients = 0;
  let drivers = 0;
  for (const cityId of SIM_CITIES) {
    const city = CITIES.find((c) => c.id === cityId);
    if (!city) throw new Error(`Ville inconnue : ${cityId}`);
    const streets = STREETS[cityId] ?? ['Rue Principale'];

    for (const [index, c] of CLIENTS.entries()) {
      const uid = simClientUid(cityId, index);
      const email = `sim.client.${cityId}.${index + 1}@golink.test`;
      batch.set(db.collection(COLLECTIONS.users).doc(uid), profile(c.first, c.last, email, 'client', city, now));
      const home = offsetPoint(city.center, 450 + index * 260, (index * 67 + 20) % 360);
      const work = offsetPoint(city.center, 900 + index * 180, (index * 97 + 200) % 360);
      batch.set(db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.addresses).doc('domicile'), address('Domicile', `${12 + index * 7} ${streets[index % streets.length]}`, city, home, now, uid));
      batch.set(db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.addresses).doc('travail'), address('Travail', `${3 + index * 5} ${streets[(index + 2) % streets.length]}`, city, work, now, uid));
      clients += 1;
    }

    for (const [index, d] of DRIVERS.entries()) {
      const uid = simDriverUid(cityId, index);
      const email = `sim.livreur.${cityId}.${index + 1}@golink.test`;
      batch.set(db.collection(COLLECTIONS.users).doc(uid), profile(d.first, d.last, email, 'driver', city, now));
      const driver: Driver & { seed: true; test: true } = {
        countryId: city.countryId,
        cityId,
        firstName: d.first,
        lastName: d.last,
        displayName: `${d.first} ${d.last}`,
        phone: city.countryId === 'LU' ? `+352 621 55 00 ${10 + index}` : `+33 6 55 00 00 ${10 + index}`,
        email,
        avatar: null,
        type: 'platform',
        restaurantIds: [],
        vehicle: { type: d.vehicle, plate: null, model: null, color: null },
        zoneIds: [`${cityId}-centre`],
        status: 'active',
        onboardingStatus: 'approved',
        rejectionReason: null,
        availability: 'offline',
        activeOrderIds: [],
        acceptsCash: true,
        rating: { average: 4.8, count: 40 + index * 7 },
        stats: { deliveries: 120 + index * 30, acceptanceRate: 0.94, cancellationRate: 0.01, onTimeRate: 0.93, averageDeliveryMinutes: 17 },
        documentsValidUntil: '2027-06-30',
        lastIdentityCheckAt: null,
        lastSeenAt: now,
        searchKeywords: buildSearchKeywords(`${d.first} ${d.last}`, email),
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        createdAt: now,
        createdBy: 'system',
        updatedAt: now,
        updatedBy: 'system',
        seed: true,
        test: true,
      };
      // Profil opérationnel : on ne remet pas à zéro une course en cours.
      const existing = await db.collection(COLLECTIONS.drivers).doc(uid).get();
      if (!existing.exists || ((existing.get('activeOrderIds') as string[] | undefined) ?? []).length === 0) {
        batch.set(db.collection(COLLECTIONS.drivers).doc(uid), driver);
        const point = offsetPoint(city.center, 700 + index * 300, index * 120);
        const location: DriverLocation & { seed: true; test: true } = {
          position: new GeoPoint(point.lat, point.lng),
          geohash: encodeGeohash(point),
          heading: 0,
          speedKmh: 0,
          accuracyMeters: 8,
          availability: 'offline',
          cityId,
          zoneId: `${cityId}-centre`,
          activeOrderIds: [],
          visibleTo: [],
          updatedAt: now,
          seed: true,
          test: true,
        };
        batch.set(db.collection(COLLECTIONS.driverLocations).doc(uid), location);
      }
      const priv: Partial<DriverPrivate> & { seed: true } = {
        birthDate: '1996-04-12',
        nationality: city.countryId,
        vatExempt: true,
        cashBalanceCents: 0,
        cashLimitCents: 15000,
        payoutsBlocked: false,
        payoutsBlockedReason: null,
        dac7Complete: true,
        updatedAt: now,
        seed: true,
      };
      batch.set(db.collection(COLLECTIONS.driverPrivate).doc(uid), priv, { merge: true });
      drivers += 1;
    }
  }
  await batch.commit();

  // Comptes Auth après les profils (le trigger de création ne les écrase pas).
  for (const cityId of SIM_CITIES) {
    for (const [index, c] of CLIENTS.entries()) {
      await ensureAuthUser(simClientUid(cityId, index), `sim.client.${cityId}.${index + 1}@golink.test`, `${c.first} ${c.last}`, 'client');
    }
    for (const [index, d] of DRIVERS.entries()) {
      await ensureAuthUser(simDriverUid(cityId, index), `sim.livreur.${cityId}.${index + 1}@golink.test`, `${d.first} ${d.last}`, 'driver');
    }
  }
  // Répartition horaire des agrégats quotidiens (30 derniers jours), recalculée depuis les commandes.
  const since = Timestamp.fromMillis(Date.now() - 30 * 86_400_000);
  const ordersSnap = await db.collection(COLLECTIONS.orders).where('createdAt', '>=', since).select('restaurantId', 'createdAt').get();
  const hours = new Map<string, number[]>();
  const hourFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });
  const dayFormat = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const doc of ordersSnap.docs) {
    const at = (doc.get('createdAt') as Timestamp).toDate();
    const key = `${doc.get('restaurantId') as string}/${dayFormat.format(at).replace(/-/g, '')}`;
    const list = hours.get(key) ?? Array.from({ length: 24 }, () => 0);
    const hour = Number(hourFormat.format(at));
    list[hour] = (list[hour] ?? 0) + 1;
    hours.set(key, list);
  }
  const writer = db.bulkWriter();
  for (const [key, byHour] of hours) {
    const [rid, day] = key.split('/') as [string, string];
    const ref = db.collection(COLLECTIONS.restaurants).doc(rid).collection(SUBCOLLECTIONS.restaurants.dailyStats).doc(day);
    void writer.update(ref, { byHour }).catch(() => undefined);
  }
  await writer.close();
  console.log(`Agrégats horaires recalculés : ${hours.size} journées.`);
  console.log(`Commandes : motif de ticket, ${clients} clients et ${drivers} livreurs de démonstration prêts.`);
}

// Exécution directe uniquement (le simulateur importe les identifiants).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed/only/r-commandes.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
