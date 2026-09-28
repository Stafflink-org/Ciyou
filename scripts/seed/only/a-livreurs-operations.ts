// Données complémentaires « Livreurs, commandes, règles, zones » du super admin
// (exécution seule, idempotente, identifiants stables, `seed: true`) :
//   npx tsx scripts/seed/only/a-livreurs-operations.ts            (écrit)
//   npx tsx scripts/seed/only/a-livreurs-operations.ts --dry-run  (affiche sans écrire)
//
// 1. Réglages d'attribution : mode, moteur, note minimale (sans écraser l'existant).
// 2. Candidats livreurs en attente de validation, avec pièces déposées (dont à vérifier).
// 3. Échéances de documents (expirent sous 30 jours) et un livreur bloqué (pièce expirée).
// 4. Contrôles d'identité par selfie à examiner (selfie + photo de référence dans Storage).
// 5. Sanctions : contestations à trancher, suspension en cours, avertissement.
// 6. Propositions de course des 7 derniers jours (acceptées, refusées, sans réponse).
// 7. Historique des réglages et journal d'actions de démonstration.
import { Timestamp } from '@google-cloud/firestore';
import { buildSearchKeywords, COLLECTIONS, SETTINGS_DOCS, type Order } from '@golink/shared';
import { bucket, db } from '../../lib/admin.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = Date.now();
const DAY = 86_400_000;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const day = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);

interface Write {
  path: string;
  data: Record<string, unknown>;
  merge?: boolean;
}
const writes: Write[] = [];
const put = (path: string, data: Record<string, unknown>, merge = false) => writes.push({ path, data: { ...data, seed: true }, merge });

async function commit(): Promise<void> {
  if (DRY_RUN) {
    for (const w of writes) console.log('  ·', w.path);
    return;
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      if (w.merge) batch.set(db.doc(w.path), w.data, { merge: true });
      else batch.set(db.doc(w.path), w.data);
    }
    await batch.commit();
  }
}

// ------------------------------------------------------------------ Photos (SVG)

const SKIN = ['#e8c4a8', '#c69476', '#8d5b3e', '#f1d3bf', '#a8714f'];
const HAIR = ['#2b1d16', '#5a3a22', '#1b1b1b', '#8a5a2b', '#3b2a20'];

/** Portrait stylisé (démonstration) : visage, cheveux, fond. */
function portrait(seed: number, variant: 'selfie' | 'id', shift = 0): string {
  const skin = SKIN[(seed + shift) % SKIN.length];
  const hair = HAIR[(seed * 3 + shift) % HAIR.length];
  const bg = variant === 'id' ? '#dfe6e8' : ['#2e4b50', '#3a5d62', '#243f44'][seed % 3];
  const tilt = variant === 'selfie' ? (seed % 2 ? -4 : 5) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
<rect width="300" height="400" fill="${bg}"/>
<g transform="rotate(${tilt} 150 200)">
<rect x="70" y="300" width="160" height="140" rx="70" fill="${variant === 'id' ? '#4a7fbb' : '#e8784b'}"/>
<rect x="128" y="250" width="44" height="60" fill="${skin}"/>
<ellipse cx="150" cy="190" rx="72" ry="88" fill="${skin}"/>
<path d="M78 180 C78 100 222 100 222 180 C215 140 190 125 150 125 C110 125 85 140 78 180Z" fill="${hair}"/>
<ellipse cx="122" cy="195" rx="7" ry="5" fill="#1f1f1f"/><ellipse cx="178" cy="195" rx="7" ry="5" fill="#1f1f1f"/>
<path d="M130 240 Q150 ${variant === 'selfie' ? 256 : 248} 170 240" stroke="#7a3b2e" stroke-width="4" fill="none" stroke-linecap="round"/>
</g>
${variant === 'id' ? '<rect x="12" y="12" width="276" height="376" fill="none" stroke="#9aa9ab" stroke-width="3" stroke-dasharray="8 6"/>' : ''}
</svg>`;
}

async function upload(path: string, svg: string): Promise<{ path: string; url: null; contentType: string; size: number; name: string; uploadedAt: Timestamp; uploadedBy: string }> {
  if (!DRY_RUN) await bucket.file(path).save(Buffer.from(svg, 'utf8'), { contentType: 'image/svg+xml', resumable: false, metadata: { cacheControl: 'private, max-age=3600' } });
  return { path, url: null, contentType: 'image/svg+xml', size: svg.length, name: path.split('/').pop()!, uploadedAt: ts(NOW - DAY), uploadedBy: path.split('/')[1]! };
}

function fileRef(ownerId: string, name: string, at: number) {
  return { path: `drivers/${ownerId}/private/${name}.pdf`, url: null, contentType: 'application/pdf', size: 1200, name: `${name}.pdf`, uploadedAt: ts(at), uploadedBy: ownerId };
}

// ------------------------------------------------------------------ Candidats

interface Applicant {
  id: string;
  firstName: string;
  lastName: string;
  cityId: string;
  countryId: string;
  vehicle: 'bike' | 'e_bike' | 'scooter' | 'car';
  plate?: string;
  daysAgo: number;
  /** Pièces déposées : état. */
  docs: Record<string, 'pending' | 'approved' | 'rejected'>;
  onboardingStatus: 'pending' | 'documents_missing' | 'draft';
  phone: string;
}

const APPLICANTS: Applicant[] = [
  { id: 'ops-applicant-01', firstName: 'Inès', lastName: 'Belkacem', cityId: 'metz', countryId: 'FR', vehicle: 'scooter', plate: 'GH-417-KL', daysAgo: 2, onboardingStatus: 'pending', phone: '+33 6 12 48 77 20', docs: { identity: 'approved', siret_registration: 'approved', urssaf_certificate: 'pending', insurance: 'pending', driving_license: 'approved', vehicle_registration: 'pending' } },
  { id: 'ops-applicant-02', firstName: 'Lucas', lastName: 'Weber', cityId: 'luxembourg', countryId: 'LU', vehicle: 'e_bike', daysAgo: 1, onboardingStatus: 'pending', phone: '+352 621 450 118', docs: { identity: 'approved', siret_registration: 'approved', urssaf_certificate: 'approved', insurance: 'approved' } },
  { id: 'ops-applicant-03', firstName: 'Samir', lastName: 'Haddou', cityId: 'longwy', countryId: 'FR', vehicle: 'car', plate: 'FT-209-QA', daysAgo: 4, onboardingStatus: 'pending', phone: '+33 7 81 22 64 09', docs: { identity: 'pending', siret_registration: 'pending', urssaf_certificate: 'pending', insurance: 'pending', driving_license: 'pending', vehicle_registration: 'pending' } },
  { id: 'ops-applicant-04', firstName: 'Clara', lastName: 'Morel', cityId: 'metz', countryId: 'FR', vehicle: 'bike', daysAgo: 6, onboardingStatus: 'documents_missing', phone: '+33 6 45 90 13 57', docs: { identity: 'approved', siret_registration: 'rejected', urssaf_certificate: 'approved' } },
  { id: 'ops-applicant-05', firstName: 'Yanis', lastName: 'Rahmani', cityId: 'thionville', countryId: 'FR', vehicle: 'e_bike', daysAgo: 0, onboardingStatus: 'pending', phone: '+33 6 07 33 81 26', docs: { identity: 'pending', siret_registration: 'approved', urssaf_certificate: 'approved', insurance: 'approved' } },
];

const EXPIRING_TYPES = new Set(['identity', 'urssaf_certificate', 'insurance', 'residence_permit', 'work_permit']);

function applicants(): void {
  APPLICANTS.forEach((a, index) => {
    const created = NOW - a.daysAgo * DAY - (index + 1) * 3_600_000;
    const displayName = `${a.firstName} ${a.lastName.charAt(0)}.`;
    put(`${COLLECTIONS.drivers}/${a.id}`, {
      countryId: a.countryId,
      cityId: a.cityId,
      locale: 'fr',
      firstName: a.firstName,
      lastName: a.lastName,
      displayName,
      phone: a.phone,
      email: `${a.firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${a.lastName.toLowerCase()}@exemple.test`,
      avatar: null,
      type: 'platform',
      restaurantIds: [],
      employeeId: null,
      maxDistanceMeters: a.vehicle === 'bike' ? 5000 : null,
      vehicle: { type: a.vehicle, plate: a.plate ?? null, model: null, color: null },
      zoneIds: [],
      status: 'onboarding',
      onboardingStatus: a.onboardingStatus,
      rejectionReason: a.onboardingStatus === 'documents_missing' ? 'L’avis de situation SIRET est illisible : merci d’en déposer une version nette.' : null,
      missingDocuments: a.onboardingStatus === 'documents_missing' ? ['siret_registration', 'insurance'] : [],
      availability: 'offline',
      activeOrderIds: [],
      acceptsCash: false,
      rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null,
      lastIdentityCheckAt: null,
      lastSeenAt: ts(created + 3_600_000),
      blocked: null,
      searchKeywords: buildSearchKeywords(`${a.firstName} ${a.lastName}`, a.phone),
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      createdAt: ts(created),
      createdBy: a.id,
      updatedAt: ts(created),
      updatedBy: a.id,
    });
    put(`${COLLECTIONS.driverPrivate}/${a.id}`, {
      birthDate: `199${index}-0${(index % 8) + 1}-1${index}`,
      nationality: index === 1 ? 'Luxembourgeoise' : 'Française',
      address: { line1: `${12 + index} rue de la Gare`, postalCode: a.cityId === 'luxembourg' ? '1611' : '57000', city: a.cityId === 'luxembourg' ? 'Luxembourg' : a.cityId.charAt(0).toUpperCase() + a.cityId.slice(1), countryCode: a.countryId },
      siret: `8${index}2 431 978 000${index}${index}`,
      vatNumber: null,
      vatExempt: true,
      urssafValidUntil: day(150),
      workPermitValidUntil: null,
      ibanMasked: `FR76 •••• •••• •••• 40${index}8`,
      stripeAccountId: null,
      stripeAccountStatus: 'pending',
      cashBalanceCents: 0,
      cashLimitCents: 15_000,
      payoutsBlocked: false,
      taxIdentificationNumber: null,
      dac7Complete: index !== 2,
      updatedAt: ts(created),
    });
    for (const [type, status] of Object.entries(a.docs)) {
      const at = created + 20 * 60_000;
      put(`${COLLECTIONS.partnerDocuments}/ops-doc-${a.id}-${type}`, {
        ownerType: 'driver',
        ownerId: a.id,
        countryId: a.countryId,
        cityId: a.cityId,
        type,
        file: fileRef(a.id, type, at),
        status,
        number: null,
        issuedAt: day(-200),
        expiresAt: EXPIRING_TYPES.has(type) ? day(type === 'urssaf_certificate' ? 170 : 900) : null,
        reviewedBy: status === 'pending' ? null : 'test-super-admin',
        reviewedAt: status === 'pending' ? null : ts(at + 3_600_000),
        rejectionReason: status === 'rejected' ? 'Document illisible, merci d’en déposer une version nette.' : null,
        remindersSent: 0,
        lastReminderAt: null,
        createdAt: ts(at),
        createdBy: a.id,
        updatedAt: ts(at),
        updatedBy: a.id,
      });
    }
  });
}

// ------------------------------------------------------------------ Échéances et blocage

async function expiries(): Promise<void> {
  // Pièces d'identité et assurances de livreurs actifs qui arrivent à échéance.
  const expiring = [
    { driver: 'seed-driver-004', type: 'insurance', in: 6, reminders: 2 },
    { driver: 'seed-driver-011', type: 'urssaf_certificate', in: 12, reminders: 1 },
    { driver: 'seed-driver-015', type: 'identity', in: 24, reminders: 1 },
    { driver: 'seed-driver-022', type: 'insurance', in: 28, reminders: 1 },
  ];
  for (const e of expiring) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(e.driver).get();
    if (!snap.exists) continue;
    put(`${COLLECTIONS.partnerDocuments}/ops-doc-${e.driver}-${e.type}`, {
      ownerType: 'driver',
      ownerId: e.driver,
      countryId: snap.get('countryId'),
      cityId: snap.get('cityId'),
      type: e.type,
      file: fileRef(e.driver, `${e.type}-2025`, NOW - 330 * DAY),
      status: 'approved',
      number: null,
      issuedAt: day(-335),
      expiresAt: day(e.in),
      reviewedBy: 'test-super-admin',
      reviewedAt: ts(NOW - 330 * DAY),
      rejectionReason: null,
      remindersSent: e.reminders,
      lastReminderAt: ts(NOW - 2 * DAY),
      createdAt: ts(NOW - 330 * DAY),
      createdBy: e.driver,
      updatedAt: ts(NOW - 2 * DAY),
      updatedBy: 'system',
    });
  }
  // Un livreur bloqué automatiquement : attestation d'assurance expirée.
  const blocked = 'seed-driver-027';
  const snap = await db.collection(COLLECTIONS.drivers).doc(blocked).get();
  if (snap.exists && snap.get('status') !== 'deactivated') {
    put(`${COLLECTIONS.partnerDocuments}/ops-doc-${blocked}-insurance`, {
      ownerType: 'driver',
      ownerId: blocked,
      countryId: snap.get('countryId'),
      cityId: snap.get('cityId'),
      type: 'insurance',
      file: fileRef(blocked, 'insurance-2025', NOW - 370 * DAY),
      status: 'expired',
      number: null,
      issuedAt: day(-372),
      expiresAt: day(-3),
      reviewedBy: 'test-super-admin',
      reviewedAt: ts(NOW - 370 * DAY),
      rejectionReason: null,
      remindersSent: 2,
      lastReminderAt: ts(NOW - 10 * DAY),
      createdAt: ts(NOW - 370 * DAY),
      createdBy: blocked,
      updatedAt: ts(NOW - 3 * DAY),
      updatedBy: 'system',
    });
    put(
      `${COLLECTIONS.drivers}/${blocked}`,
      {
        status: 'suspended',
        availability: 'offline',
        blocked: { reason: 'documents_expired', since: ts(NOW - 2 * DAY), details: 'Pièces expirées : insurance', documentIds: [`ops-doc-${blocked}-insurance`] },
        documentsValidUntil: day(-3),
        updatedAt: ts(NOW - 2 * DAY),
        updatedBy: 'system',
      },
      true,
    );
    if ((await db.collection(COLLECTIONS.driverLocations).doc(blocked).get()).exists) put(`${COLLECTIONS.driverLocations}/${blocked}`, { availability: 'offline' }, true);
  }
}

// ------------------------------------------------------------------ Selfies

async function identityChecks(): Promise<void> {
  const checks = [
    { driver: 'seed-driver-003', score: 0.94, hoursAgo: 3, trigger: 'random', sameFace: true },
    { driver: 'seed-driver-016', score: 0.88, hoursAgo: 7, trigger: 'manual', sameFace: true },
    { driver: 'seed-driver-021', score: 0.41, hoursAgo: 1, trigger: 'fraud_signal', sameFace: false },
  ];
  for (const [i, c] of checks.entries()) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(c.driver).get();
    if (!snap.exists) continue;
    const selfie = await upload(`drivers/${c.driver}/private/selfie-${day(0)}.svg`, portrait(i + 4, 'selfie', c.sameFace ? 0 : 2));
    const reference = await upload(`drivers/${c.driver}/private/identity-photo.svg`, portrait(i + 4, 'id'));
    put(`${COLLECTIONS.identityChecks}/ops-selfie-${c.driver}`, {
      driverId: c.driver,
      cityId: snap.get('cityId'),
      requestedAt: ts(NOW - (c.hoursAgo + 5) * 3_600_000),
      submittedAt: ts(NOW - c.hoursAgo * 3_600_000),
      trigger: c.trigger,
      selfie,
      referencePhoto: reference,
      status: 'submitted',
      matchScore: c.score,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    });
  }
  put(`${COLLECTIONS.identityChecks}/ops-selfie-history-008`, {
    driverId: 'seed-driver-008',
    cityId: 'longwy',
    requestedAt: ts(NOW - 12 * DAY),
    submittedAt: ts(NOW - 12 * DAY + 3_600_000),
    trigger: 'random',
    selfie: null,
    referencePhoto: null,
    status: 'failed',
    matchScore: 0.38,
    reviewedBy: 'test-super-admin',
    reviewedAt: ts(NOW - 11 * DAY),
    reviewNote: 'Selfie d’une autre personne que le titulaire ; échange téléphonique puis réactivation.',
  });
}

// ------------------------------------------------------------------ Sanctions

async function sanctions(): Promise<void> {
  const list = [
    {
      id: 'ops-sanction-contest-014',
      driverId: 'seed-driver-014',
      cityId: 'metz',
      type: 'temporary_suspension',
      reason: 'Commandes non livrées',
      details: 'Deux commandes marquées livrées sans remise au client (GL-12411, GL-12598).',
      status: 'contested',
      start: NOW - 2 * DAY,
      end: NOW + 5 * DAY,
      contest: { message: 'Le client ne répondait pas et j’ai laissé la commande au gardien comme indiqué dans les instructions. J’ai la photo de dépôt.', submittedAt: ts(NOW - DAY) },
    },
    {
      id: 'ops-sanction-contest-020',
      driverId: 'seed-driver-020',
      cityId: 'luxembourg',
      type: 'warning',
      reason: 'Retards répétés à la récupération',
      details: 'Temps d’arrivée au commerce supérieur de 12 min en moyenne sur la semaine.',
      status: 'contested',
      start: NOW - 3 * DAY,
      end: NOW + 27 * DAY,
      contest: { message: 'Les travaux sur le boulevard Royal bloquaient l’accès, je n’y étais pour rien.', submittedAt: ts(NOW - 2 * DAY) },
    },
    { id: 'ops-sanction-active-005', driverId: 'seed-driver-005', cityId: 'longwy', type: 'warning', reason: 'Annulations abusives', details: null, status: 'active', start: NOW - 6 * DAY, end: NOW + 24 * DAY, contest: null },
  ];
  for (const s of list) {
    put(`${COLLECTIONS.driverSanctions}/${s.id}`, {
      driverId: s.driverId,
      cityId: s.cityId,
      type: s.type,
      reason: s.reason,
      details: s.details,
      status: s.status,
      startsAt: ts(s.start),
      endsAt: ts(s.end),
      contest: s.contest ? { ...s.contest, decision: null, decidedBy: null, decidedAt: null, decisionNote: null } : null,
      createdAt: ts(s.start),
      createdBy: 'test-super-admin',
      createdByName: 'Équipe opérations',
      updatedAt: ts(s.contest ? s.contest.submittedAt.toMillis() : s.start),
      updatedBy: s.driverId,
    });
  }
  // La suspension contestée suspend effectivement le compte.
  put(
    `${COLLECTIONS.drivers}/seed-driver-014`,
    { status: 'suspended', availability: 'offline', activeSanctionId: 'ops-sanction-contest-014', blocked: { reason: 'sanction', since: ts(NOW - 2 * DAY), details: 'Commandes non livrées', documentIds: [] }, updatedAt: ts(NOW - 2 * DAY), updatedBy: 'test-super-admin' },
    true,
  );
  if ((await db.collection(COLLECTIONS.driverLocations).doc('seed-driver-014').get()).exists) put(`${COLLECTIONS.driverLocations}/seed-driver-014`, { availability: 'offline' }, true);
}

// ------------------------------------------------------------------ Propositions de course

async function offers(): Promise<void> {
  const orders = await db.collection(COLLECTIONS.orders).where('createdAt', '>=', ts(NOW - 7 * DAY)).orderBy('createdAt', 'desc').limit(400).get();
  let n = 0;
  for (const doc of orders.docs) {
    const o = doc.data() as Order;
    if (o.fulfillment !== 'delivery' || o.delivery?.deliveredBy !== 'platform' || !o.driverId) continue;
    const at = o.createdAt.toMillis() + (o.prepMinutes - 6) * 60_000;
    const rnd = (n * 37) % 100;
    const base = { orderId: doc.id, restaurantId: o.restaurantId, cityId: o.cityId, zoneId: o.delivery.zoneId ?? null, deliveryDistanceMeters: o.delivery.distanceMeters, estimatedPayCents: 0, seed: true };
    // Une partie des courses a d'abord été refusée ou laissée sans réponse par un autre livreur.
    if (rnd < 22) {
      const status = rnd < 12 ? 'declined' : 'expired';
      put(`${COLLECTIONS.dispatchOffers}/ops-offer-${doc.id}-1`, {
        ...base,
        driverId: `seed-driver-0${String(10 + (n % 20)).padStart(2, '0')}`,
        round: 1,
        status,
        distanceToRestaurantMeters: 600 + ((n * 131) % 1400),
        estimatedMinutes: 12,
        offeredAt: ts(at),
        expiresAt: ts(at + 45_000),
        respondedAt: status === 'declined' ? ts(at + 9_000 + (n % 20) * 1000) : ts(at + 45_000),
        declineReason: status === 'declined' ? 'Trop loin de ma position' : null,
      });
    }
    put(`${COLLECTIONS.dispatchOffers}/ops-offer-${doc.id}-2`, {
      ...base,
      driverId: o.driverId,
      round: rnd < 22 ? 2 : 1,
      status: 'accepted',
      distanceToRestaurantMeters: 400 + ((n * 97) % 1800),
      estimatedMinutes: 14,
      offeredAt: ts(at + (rnd < 22 ? 50_000 : 0)),
      expiresAt: ts(at + (rnd < 22 ? 95_000 : 45_000)),
      respondedAt: ts(at + (rnd < 22 ? 62_000 : 8_000 + (n % 25) * 1000)),
      declineReason: null,
    });
    n += 1;
    if (n >= 120) break;
  }
  console.log(`   ${n} courses avec propositions`);
}

// ------------------------------------------------------------------ Réglages et historique

async function settingsAndHistory(): Promise<void> {
  const dispatch = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dispatch).get();
  const current = dispatch.data() ?? {};
  put(
    `${COLLECTIONS.settings}/${SETTINGS_DOCS.dispatch}`,
    { mode: current.mode ?? 'auto_assign', engine: current.engine ?? 'advanced', minDriverRating: current.minDriverRating ?? null },
    true,
  );
  const history = [
    { id: 'ops-history-order-rules-1', docPath: 'settings/orderRules', changedFields: ['acceptanceTimeoutSeconds'], before: { acceptanceTimeoutSeconds: 420 }, after: { acceptanceTimeoutSeconds: 300 }, reason: 'Décision client : 5 minutes pour accepter, puis annulation et remboursement.', at: NOW - 20 * DAY },
    { id: 'ops-history-order-rules-2', docPath: 'settings/orderRules', changedFields: ['refundLiability'], before: { refundLiability: 'selon la cause' }, after: { refundLiability: 'tout au commerce' }, reason: 'Décision client : le commerce paie tous les remboursements.', at: NOW - 20 * DAY + 600_000 },
    { id: 'ops-history-dispatch-1', docPath: 'settings/dispatch#dispatch', changedFields: ['strategy'], before: { strategy: 'nearest' }, after: { strategy: 'nearest_with_rating' }, reason: 'Favoriser les livreurs les mieux notés à distance égale.', at: NOW - 9 * DAY },
    { id: 'ops-history-courier-fr', docPath: 'countries/FR#courier', changedFields: ['model', 'flatAmountCents'], before: { model: 'pickup_dropoff_per_km', flatAmountCents: null }, after: { model: 'flat_then_per_km', flatAmountCents: 400 }, reason: 'Nouveau barème : forfait sous 2 km puis au kilomètre.', at: NOW - 18 * DAY },
    { id: 'ops-history-metz-zone', docPath: 'zones/metz-centre', changedFields: ['maxDeliveryDistanceMeters'], before: { maxDeliveryDistanceMeters: 6000 }, after: { maxDeliveryDistanceMeters: 7000 }, reason: 'Extension vers Montigny-lès-Metz.', at: NOW - 5 * DAY },
  ];
  for (const h of history) {
    put(`${COLLECTIONS.settingsHistory}/${h.id}`, { docPath: h.docPath, changedFields: h.changedFields, before: h.before, after: h.after, reason: h.reason, changedBy: 'test-super-admin', changedByName: 'Super administrateur', changedAt: ts(h.at) });
  }
  const audits = [
    { id: 'ops-audit-driver-003-approved', driver: 'seed-driver-003', city: 'longwy', action: 'driver.application_approved', reason: null, at: NOW - 60 * DAY },
    { id: 'ops-audit-driver-005-warning', driver: 'seed-driver-005', city: 'longwy', action: 'driver.sanction_warning', reason: 'Annulations abusives', at: NOW - 6 * DAY },
    { id: 'ops-audit-driver-014-suspension', driver: 'seed-driver-014', city: 'metz', action: 'driver.sanction_temporary_suspension', reason: 'Commandes non livrées', at: NOW - 2 * DAY },
    { id: 'ops-audit-driver-027-blocked', driver: 'seed-driver-027', city: null, action: 'driver.blocked_documents_expired', reason: 'Pièces expirées : Attestation d’assurance', at: NOW - 2 * DAY },
  ];
  for (const a of audits) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(a.driver).get();
    if (!snap.exists) continue;
    put(`${COLLECTIONS.auditLogs}/${a.id}`, {
      actor: a.action.includes('blocked') ? { uid: 'system', type: 'system', role: null, name: 'GoLink (automatique)' } : { uid: 'test-super-admin', type: 'admin', role: 'super_admin', name: 'Super administrateur' },
      action: a.action,
      target: { type: 'driver', id: a.driver, label: snap.get('displayName') },
      countryId: snap.get('countryId'),
      cityId: snap.get('cityId'),
      reason: a.reason,
      before: null,
      after: null,
      impersonationSessionId: null,
      ipHash: null,
      userAgent: null,
      sensitive: a.action.includes('suspension'),
      at: ts(a.at),
    });
  }
}

async function main(): Promise<void> {
  console.log(`Exploitation (livreurs, commandes, règles, zones)${DRY_RUN ? ' — simulation' : ''}`);
  console.log('1. Réglages et historique…');
  await settingsAndHistory();
  console.log('2. Candidats…');
  applicants();
  console.log('3. Échéances et blocage…');
  await expiries();
  console.log('4. Selfies…');
  await identityChecks();
  console.log('5. Sanctions…');
  await sanctions();
  console.log('6. Propositions de course…');
  await offers();
  console.log(`Écriture de ${writes.length} documents…`);
  await commit();
  console.log('Terminé.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
