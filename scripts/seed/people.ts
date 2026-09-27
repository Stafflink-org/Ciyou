// Clients et livreurs de démonstration (sans compte Auth : identifiants « seed-… »).
// Les profils sont écrits après les commandes, avec leurs statistiques.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  buildSearchKeywords,
  encodeGeohash,
  formatCardLabel,
  generateReferralCode,
  maskIban,
  publicDisplayName,
  type Driver,
  type DriverLocation,
  type DriverPrivate,
  type DriverSanction,
  type DriverSession,
  type Favorite,
  type IdentityCheck,
  type LatLng,
  type PartnerDocument,
  type PartnerDocumentType,
  type SavedPaymentMethod,
  type UserAddress,
  type UserPrivate,
  type UserProfile,
  type VehicleType,
} from '@golink/shared';
import { CITIES, FIRST_NAMES, LAST_NAMES, STREETS } from './catalog';
import { tracked, type SeedContext } from './context';
import { addDays, geo, GeoPoint, offsetPoint, parisTime, ts } from './lib';

export interface ClientRuntime {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cityId: string;
  countryId: 'FR' | 'LU';
  addresses: Array<{ id: string; label: string; line1: string; postalCode: string; city: string; countryCode: string; point: LatLng }>;
  /** Poids de fréquence de commande (quelques clients très fidèles). */
  weight: number;
  cardLabel: string;
  createdAt: Date;
  stats: { orders: number; spent: number; cancelled: number; refunds: number; first: Date | null; last: Date | null };
  favorites: Set<string>;
}

export interface DriverRuntime {
  uid: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  cityId: string;
  countryId: 'FR' | 'LU';
  vehicle: VehicleType;
  type: 'platform' | 'restaurant';
  restaurantIds: string[];
  status: Driver['status'];
  onboardingStatus: Driver['onboardingStatus'];
  rating: number;
  createdAt: Date;
  stats: { deliveries: number; earnings: number; tips: number; minutes: number; onTime: number; ratings: number[] };
  /** Minutes de livraison par jour (sessions). */
  days: Map<string, { deliveries: number; minutes: number; earnings: number; first: Date; last: Date }>;
}

const CLIENTS_PER_CITY: Record<string, number> = { longwy: 50, metz: 44, luxembourg: 38 };

function phoneFor(ctx: SeedContext, countryId: 'FR' | 'LU'): string {
  return countryId === 'FR'
    ? `+33 6 ${ctx.rng.digits(2)} ${ctx.rng.digits(2)} ${ctx.rng.digits(2)} ${ctx.rng.digits(2)}`
    : `+352 621 ${ctx.rng.digits(3)} ${ctx.rng.digits(3)}`;
}

function emailFor(first: string, last: string, n: number): string {
  const clean = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return `${clean(first)}.${clean(last)}${n % 7 === 0 ? n : ''}@exemple.test`;
}

export function buildClients(ctx: SeedContext): ClientRuntime[] {
  const { rng } = ctx;
  const clients: ClientRuntime[] = [];
  let n = 0;
  for (const [cityId, count] of Object.entries(CLIENTS_PER_CITY)) {
    const city = CITIES.find((c) => c.id === cityId);
    if (!city) continue;
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const firstName = rng.pick(FIRST_NAMES);
      const lastName = rng.pick(LAST_NAMES);
      const addresses: ClientRuntime['addresses'] = [];
      const home = offsetPoint(city.center, rng.int(300, 4800), rng.int(0, 359));
      addresses.push({ id: 'domicile', label: 'Domicile', line1: `${rng.int(1, 120)} ${rng.pick(STREETS[cityId] ?? ['Rue Principale'])}`, postalCode: city.postalCode, city: city.name, countryCode: city.countryId, point: home });
      if (rng.chance(0.35)) {
        const work = offsetPoint(city.center, rng.int(200, 3000), rng.int(0, 359));
        addresses.push({ id: 'travail', label: 'Travail', line1: `${rng.int(1, 60)} ${rng.pick(STREETS[cityId] ?? ['Rue Principale'])}`, postalCode: city.postalCode, city: city.name, countryCode: city.countryId, point: work });
      }
      const brand = rng.weighted([['Visa', 5], ['Mastercard', 4], ['American Express', 1]] as const);
      clients.push({
        uid: `seed-client-${String(n).padStart(3, '0')}`,
        firstName,
        lastName,
        email: emailFor(firstName, lastName, n),
        phone: phoneFor(ctx, city.countryId),
        cityId,
        countryId: city.countryId,
        addresses,
        weight: rng.weighted([[0.4, 4], [1, 5], [3, 2], [7, 1]] as const),
        cardLabel: formatCardLabel(brand, rng.digits(4)),
        createdAt: parisTime(addDays(ctx.today, -rng.int(5, 200)), rng.int(9 * 60, 22 * 60)),
        stats: { orders: 0, spent: 0, cancelled: 0, refunds: 0, first: null, last: null },
        favorites: new Set(),
      });
    }
  }
  return clients;
}

const DRIVERS_PER_CITY: Record<string, number> = { longwy: 9, metz: 10, luxembourg: 9 };
const VEHICLES: Array<readonly [VehicleType, number]> = [['e_bike', 5], ['scooter', 4], ['bike', 2], ['car', 2], ['cargo_bike', 1], ['motorbike', 1]];

export function buildDrivers(ctx: SeedContext): DriverRuntime[] {
  const { rng } = ctx;
  const drivers: DriverRuntime[] = [];
  let n = 0;
  const make = (cityId: string, extra: Partial<DriverRuntime> = {}): DriverRuntime => {
    n += 1;
    const city = CITIES.find((c) => c.id === cityId);
    if (!city) throw new Error(cityId);
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    return {
      uid: `seed-driver-${String(n).padStart(3, '0')}`,
      firstName,
      lastName,
      phone: phoneFor(ctx, city.countryId),
      email: emailFor(firstName, lastName, n + 400),
      cityId,
      countryId: city.countryId,
      vehicle: rng.weighted(VEHICLES),
      type: 'platform',
      restaurantIds: [],
      status: 'active',
      onboardingStatus: 'approved',
      rating: Math.round(rng.float(4.5, 5) * 100) / 100,
      createdAt: parisTime(addDays(ctx.today, -rng.int(95, 115)), rng.int(9 * 60, 18 * 60)),
      stats: { deliveries: 0, earnings: 0, tips: 0, minutes: 0, onTime: 0, ratings: [] },
      days: new Map(),
      ...extra,
    };
  };
  for (const [cityId, count] of Object.entries(DRIVERS_PER_CITY)) {
    for (let i = 0; i < count; i += 1) drivers.push(make(cityId));
  }
  // Livreurs propres de Casa Arepa.
  drivers.push(make('longwy', { type: 'restaurant', restaurantIds: ['casa-arepa'], vehicle: 'scooter' }));
  drivers.push(make('longwy', { type: 'restaurant', restaurantIds: ['casa-arepa'], vehicle: 'car' }));
  // Candidatures à valider et livreur suspendu.
  drivers.push(make('metz', { status: 'onboarding', onboardingStatus: 'pending', createdAt: parisTime(addDays(ctx.today, -2), 16 * 60) }));
  drivers.push(make('thionville', { status: 'onboarding', onboardingStatus: 'documents_missing', createdAt: parisTime(addDays(ctx.today, -5), 11 * 60) }));
  const suspended = drivers.find((d) => d.cityId === 'metz' && d.status === 'active');
  if (suspended) suspended.status = 'suspended';
  return drivers;
}

// ------------------------------------------------------------------ Écriture

export function writeClients(ctx: SeedContext, clients: ClientRuntime[]): void {
  const { w, rng } = ctx;
  for (const c of clients) {
    const createdAt = ts(c.createdAt);
    const displayName = `${c.firstName} ${c.lastName}`;
    const profile: UserProfile = {
      role: 'client',
      firstName: c.firstName,
      lastName: c.lastName,
      displayName,
      email: c.email,
      emailVerified: true,
      phone: c.phone,
      phoneVerified: true,
      avatar: null,
      locale: 'fr',
      status: c.uid === 'seed-client-017' ? 'blocked' : 'active',
      blockedReason: c.uid === 'seed-client-017' ? 'Réclamations abusives répétées (dossier fraude)' : null,
      blockedAt: c.uid === 'seed-client-017' ? ctx.nowTs : null,
      blockedBy: c.uid === 'seed-client-017' ? ctx.superAdminUid : null,
      defaultAddressId: 'domicile',
      consents: { marketing_email: rng.chance(0.55), marketing_push: rng.chance(0.7), analytics_cookies: true },
      notificationPrefs: { orderUpdates: true, promotions: rng.chance(0.6), newsletter: rng.chance(0.3) },
      walletBalanceCents: c.stats.refunds > 0 ? 500 : 0,
      referralCode: generateReferralCode(() => rng.next()),
      referredBy: null,
      stats: {
        ordersCount: c.stats.orders,
        totalSpentCents: c.stats.spent,
        lastOrderAt: c.stats.last ? ts(c.stats.last) : null,
        firstOrderAt: c.stats.first ? ts(c.stats.first) : null,
        cancelledCount: c.stats.cancelled,
        refundsCount: c.stats.refunds,
      },
      acceptedLegal: { terms_client: '2026-06', privacy_policy: '2026-06' },
      countryId: c.countryId,
      cityId: c.cityId,
      lastLoginAt: c.stats.last ? ts(c.stats.last) : createdAt,
      lastSeenAt: c.stats.last ? ts(c.stats.last) : createdAt,
      searchKeywords: buildSearchKeywords(displayName, c.email, c.phone),
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      ...tracked(createdAt, c.uid),
    };
    w.set(w.doc(`${COLLECTIONS.users}/${c.uid}`), profile);
    const priv: UserPrivate = {
      stripeCustomerId: null,
      riskScore: c.uid === 'seed-client-017' ? 82 : c.stats.refunds > 1 ? 35 : rng.int(0, 12),
      riskFlags: c.uid === 'seed-client-017' ? ['repeated_claims', 'refund_rate'] : [],
      deviceHashes: [],
      cardFingerprints: [],
      phoneHash: null,
      fraudCaseIds: c.uid === 'seed-client-017' ? ['fraude-client-017'] : [],
      updatedAt: ctx.nowTs,
    };
    w.set(w.doc(`${COLLECTIONS.userPrivate}/${c.uid}`), priv);
    for (const a of c.addresses) {
      const address: UserAddress = {
        label: a.label,
        line1: a.line1,
        line2: null,
        postalCode: a.postalCode,
        city: a.city,
        countryCode: a.countryCode,
        placeId: null,
        ...geo(a.point),
        details: rng.chance(0.3) ? `${rng.int(1, 5)}e étage` : null,
        instructions: rng.chance(0.2) ? 'Sonner à l’interphone, nom sur la boîte aux lettres.' : null,
        floor: null,
        doorCode: rng.chance(0.25) ? `${rng.int(1000, 9999)}` : null,
        isDefault: a.id === 'domicile',
        ...tracked(createdAt, c.uid),
      };
      w.set(w.doc(`${COLLECTIONS.users}/${c.uid}/${SUBCOLLECTIONS.users.addresses}/${a.id}`), address);
    }
    const [brand = 'Visa', last4 = '4242'] = c.cardLabel.split(' ···· ');
    const card: SavedPaymentMethod = {
      provider: 'stripe', providerMethodId: `pm_seed_${c.uid}`, brand, last4, expMonth: rng.int(1, 12), expYear: 2027 + rng.int(0, 3), wallet: null, isDefault: true, createdAt,
    };
    w.set(w.doc(`${COLLECTIONS.users}/${c.uid}/${SUBCOLLECTIONS.users.paymentMethods}/carte-1`), card);
    for (const rid of c.favorites) {
      const fav: Favorite = { type: 'restaurant', restaurantId: rid, productId: null, createdAt };
      w.set(w.doc(`${COLLECTIONS.users}/${c.uid}/${SUBCOLLECTIONS.users.favorites}/r_${rid}`), fav);
    }
  }
}

export function writeDrivers(ctx: SeedContext, drivers: DriverRuntime[]): void {
  const { w, rng, nowTs } = ctx;
  for (const [index, d] of drivers.entries()) {
    const createdAt = ts(d.createdAt);
    const city = CITIES.find((c) => c.id === d.cityId);
    if (!city) continue;
    const displayName = publicDisplayName(d.firstName, d.lastName);
    const active = d.status === 'active';
    const availability: Driver['availability'] = !active ? 'offline' : index % 3 === 0 ? 'online' : index % 5 === 0 ? 'on_delivery' : 'offline';
    const zoneIds = [`${d.cityId}-centre`, `${d.cityId}-${rng.pick(['nord', 'sud-est', 'sud-ouest'])}`];
    const deliveries = d.stats.deliveries;
    const driver: Driver = {
      countryId: d.countryId,
      cityId: d.cityId,
      firstName: d.firstName,
      lastName: d.lastName,
      displayName,
      phone: d.phone,
      email: d.email,
      avatar: null,
      type: d.type,
      restaurantIds: d.restaurantIds,
      vehicle: {
        type: d.vehicle,
        plate: d.vehicle === 'car' || d.vehicle === 'scooter' || d.vehicle === 'motorbike' ? `${String.fromCharCode(65 + (index % 26))}${String.fromCharCode(66 + (index % 20))}-${rng.int(100, 999)}-${String.fromCharCode(67 + (index % 18))}${String.fromCharCode(68 + (index % 17))}` : null,
        model: null,
        color: null,
      },
      zoneIds,
      status: d.status,
      onboardingStatus: d.onboardingStatus,
      rejectionReason: null,
      availability,
      activeOrderIds: [],
      acceptsCash: d.type === 'platform' && index % 4 !== 0,
      rating: {
        average: d.stats.ratings.length ? Math.round((d.stats.ratings.reduce((a, b) => a + b, 0) / d.stats.ratings.length) * 100) / 100 : d.rating,
        count: d.stats.ratings.length,
      },
      stats: {
        deliveries,
        acceptanceRate: active ? Math.round(rng.float(0.82, 0.98) * 100) / 100 : 0,
        cancellationRate: active ? Math.round(rng.float(0, 0.04) * 1000) / 1000 : 0,
        onTimeRate: deliveries ? Math.round((d.stats.onTime / deliveries) * 100) / 100 : 0,
        averageDeliveryMinutes: deliveries ? Math.round(d.stats.minutes / deliveries) : 0,
      },
      documentsValidUntil: addDays(ctx.today, index === 3 ? 12 : 240),
      lastIdentityCheckAt: active ? ts(parisTime(addDays(ctx.today, -rng.int(1, 20)), 12 * 60)) : null,
      lastSeenAt: active ? ts(new Date(ctx.now.getTime() - rng.int(2, 1800) * 60_000)) : null,
      searchKeywords: buildSearchKeywords(`${d.firstName} ${d.lastName}`, d.phone, d.email),
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      ...tracked(createdAt, d.uid),
    };
    w.set(w.doc(`${COLLECTIONS.drivers}/${d.uid}`), driver);

    const iban = d.countryId === 'FR' ? `FR76 1027 8060 ${rng.digits(4)} ${rng.digits(4)} ${rng.digits(3)}` : `LU12 0019 ${rng.digits(4)} ${rng.digits(4)}`;
    const cashBalance = d.type === 'platform' && active ? rng.pick([0, 0, 0, 2350, 4870, 16200]) : 0;
    const priv: DriverPrivate = {
      birthDate: `${rng.int(1978, 2004)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      nationality: d.countryId === 'FR' ? rng.pick(['FR', 'FR', 'FR', 'PT', 'MA', 'DZ']) : rng.pick(['LU', 'PT', 'FR', 'BE']),
      address: { line1: `${rng.int(1, 80)} ${rng.pick(STREETS[d.cityId] ?? ['Rue de Paris'])}`, line2: null, postalCode: city.postalCode, city: city.name, countryCode: d.countryId },
      siret: d.countryId === 'FR' && d.type === 'platform' ? `${rng.digits(3)} ${rng.digits(3)} ${rng.digits(3)} ${rng.digits(5)}` : null,
      vatNumber: null,
      vatExempt: true,
      urssafValidUntil: d.countryId === 'FR' ? addDays(ctx.today, index === 5 ? 9 : 150) : null,
      workPermitValidUntil: null,
      ibanMasked: d.onboardingStatus === 'approved' ? maskIban(iban) : null,
      stripeAccountId: null,
      stripeAccountStatus: d.onboardingStatus === 'approved' ? 'enabled' : null,
      cashBalanceCents: cashBalance,
      cashLimitCents: 15000,
      payoutsBlocked: cashBalance > 15000,
      payoutsBlockedReason: cashBalance > 15000 ? 'Plafond d’espèces dépassé : reversement attendu.' : null,
      taxIdentificationNumber: d.onboardingStatus === 'approved' ? rng.digits(13) : null,
      dac7Complete: d.onboardingStatus === 'approved',
      partnerTermsVersion: '2026-06',
      partnerTermsAcceptedAt: createdAt,
      internalRating: null,
      updatedAt: nowTs,
    };
    w.set(w.doc(`${COLLECTIONS.driverPrivate}/${d.uid}`), priv);

    if (availability !== 'offline') {
      const point = offsetPoint(city.center, rng.int(200, 3500), rng.int(0, 359));
      const location: DriverLocation = {
        position: new GeoPoint(point.lat, point.lng),
        geohash: encodeGeohash(point),
        heading: rng.int(0, 359),
        speedKmh: availability === 'on_delivery' ? rng.int(12, 28) : 0,
        accuracyMeters: rng.int(4, 15),
        availability,
        cityId: d.cityId,
        zoneId: zoneIds[0] ?? null,
        activeOrderIds: [],
        visibleTo: [],
        updatedAt: ts(new Date(ctx.now.getTime() - rng.int(3, 50) * 1000)),
      };
      w.set(w.doc(`${COLLECTIONS.driverLocations}/${d.uid}`), location);
    }

    // Sessions en ligne des 14 derniers jours (base de la garantie horaire).
    for (const [day, s] of d.days) {
      if (day < addDays(ctx.today, -14)) continue;
      const session: DriverSession = {
        driverId: d.uid,
        cityId: d.cityId,
        zoneId: zoneIds[0] ?? null,
        startedAt: ts(new Date(s.first.getTime() - 20 * 60_000)),
        endedAt: day === ctx.today ? null : ts(new Date(s.last.getTime() + 25 * 60_000)),
        onlineMinutes: Math.round((s.last.getTime() - s.first.getTime()) / 60_000) + 45,
        activeMinutes: s.minutes + s.deliveries * 6,
        deliveries: s.deliveries,
        earningsCents: s.earnings,
      };
      w.set(w.doc(`${COLLECTIONS.driverSessions}/${d.uid}_${day}`), session);
    }

    // Justificatifs.
    const types: PartnerDocumentType[] = d.countryId === 'FR' ? ['identity', 'siret_registration', 'urssaf_certificate', 'insurance'] : ['identity', 'insurance'];
    if (d.vehicle === 'car' || d.vehicle === 'scooter' || d.vehicle === 'motorbike') types.push('driving_license', 'vehicle_registration');
    types.forEach((type) => {
      if (d.onboardingStatus === 'documents_missing' && type !== 'identity') return;
      const status: PartnerDocument['status'] = d.onboardingStatus === 'approved' ? 'approved' : 'pending';
      const file = ctx.files.storedPdf(`drivers/${d.uid}/private/${type}.pdf`, `${d.firstName} ${d.lastName} · justificatif`, [`Type : ${type}`, `Ville : ${city.name}`], createdAt, d.uid);
      const doc: PartnerDocument = {
        ownerType: 'driver',
        ownerId: d.uid,
        countryId: d.countryId,
        cityId: d.cityId,
        type,
        file,
        status,
        number: null,
        issuedAt: addDays(ctx.today, -400),
        expiresAt: type === 'urssaf_certificate' ? addDays(ctx.today, index === 5 ? 9 : 150) : type === 'insurance' ? addDays(ctx.today, index === 3 ? 12 : 240) : null,
        reviewedBy: status === 'approved' ? ctx.superAdminUid : null,
        reviewedAt: status === 'approved' ? createdAt : null,
        rejectionReason: null,
        remindersSent: 0,
        lastReminderAt: null,
        ...tracked(createdAt, d.uid),
      };
      w.set(w.doc(`${COLLECTIONS.partnerDocuments}/${d.uid}-${type}`), doc);
    });

    if (d.status === 'suspended') {
      const sanction: DriverSanction = {
        driverId: d.uid,
        type: 'temporary_suspension',
        reason: 'Livraisons déclarées sans remise au client (3 signalements)',
        details: 'Suspension de 7 jours dans l’attente des explications du livreur.',
        status: 'contested',
        startsAt: ts(parisTime(addDays(ctx.today, -2), 10 * 60)),
        endsAt: ts(parisTime(addDays(ctx.today, 5), 10 * 60)),
        contest: { message: 'Le client n’était pas joignable, j’ai laissé la commande au gardien comme indiqué.', submittedAt: ts(parisTime(addDays(ctx.today, -1), 18 * 60)), decision: null, decidedBy: null, decidedAt: null, decisionNote: null },
        ...tracked(ts(parisTime(addDays(ctx.today, -2), 10 * 60)), ctx.superAdminUid),
      };
      w.set(w.doc(`${COLLECTIONS.driverSanctions}/sanction-${d.uid}`), sanction);
    }
    if (index === 1) {
      const warning: DriverSanction = {
        driverId: d.uid, type: 'warning', reason: 'Retards répétés à la récupération', details: null, status: 'expired',
        startsAt: ts(parisTime(addDays(ctx.today, -40), 10 * 60)), endsAt: ts(parisTime(addDays(ctx.today, -10), 10 * 60)), contest: null,
        ...tracked(ts(parisTime(addDays(ctx.today, -40), 10 * 60)), ctx.superAdminUid),
      };
      w.set(w.doc(`${COLLECTIONS.driverSanctions}/avertissement-${d.uid}`), warning);
    }
    if (active && index % 6 === 0) {
      const check: IdentityCheck = {
        driverId: d.uid,
        requestedAt: ts(new Date(ctx.now.getTime() - rng.int(1, 30) * 3600_000)),
        trigger: 'random',
        selfie: null,
        status: index % 12 === 0 ? 'requested' : 'passed',
        matchScore: index % 12 === 0 ? null : Math.round(rng.float(0.91, 0.99) * 100) / 100,
        reviewedBy: null,
        reviewedAt: null,
      };
      w.set(w.doc(`${COLLECTIONS.identityChecks}/selfie-${d.uid}`), check);
    }
  }
}

