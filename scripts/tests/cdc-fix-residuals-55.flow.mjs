// Test réel cdc-fix-residuals-55 (audit étendu « livreurs » — backend + règles + app livreur) :
//
// 1. `driverLocations/{uid}` n'était JAMAIS créé par aucune Cloud Function (la règle interdit la
//    création côté client) — un livreur validé qui passait « En ligne » restait invisible du
//    dispatch (`dispatchOrder`/`advancedDispatchOrder` interrogent cette collection), sans erreur
//    ni message. Corrigé : `reviewDriverApplication` (décision « approve ») crée le document.
//
// 2. Même une fois créé, `driverLocations.availability` n'était ensuite plus JAMAIS synchronisé
//    avec `drivers.availability` (l'app livreur écrit directement et uniquement sur `drivers/{uid}`,
//    la règle `driverLocations` interdit au livreur d'écrire ce champ) — un livreur qui repasse
//    « En ligne » après avoir été hors ligne restait quand même invisible du dispatch. Corrigé :
//    nouveau déclencheur `onDriverAvailabilityChanged`.
//
// 3. `firebase/rules/drivers.rules` : `driverPrivate`/`driverEarnings` utilisaient `isAdmin(perm)`
//    sans vérifier le périmètre ville de l'admin (même motif que ~33 autres corrections cette
//    session). Corrigé (`isAdminIn`).
//
// 4. `expireSanctions` (tâche planifiée) réactivait un livreur (`status: 'active'`) à l'expiration
//    d'une suspension temporaire SANS vérifier s'il avait été désactivé entre-temps par un autre
//    canal (`reviewDriverApplication` rejet, `bulkUpdateDrivers` désactivation) — un livreur banni
//    pouvait repasser actif silencieusement. Corrigé.
//
// 5. `assignDriverInTransaction` (acceptation d'une offre de course, `respondToOffer`) ne
//    revérifiait jamais `maxConcurrentOrdersPerDriver` au moment du commit (seulement à
//    l'évaluation des candidats) — deux offres acceptées à quelques secondes d'intervalle
//    pouvaient dépasser le plafond. Corrigé (relu dans la transaction, sur l'état frais).
//
//   npx tsx scripts/tests/cdc-fix-residuals-55.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres55-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 45_000, everyMs = 2000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(everyMs);
  }
}

async function loginPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Connexion ${email} refusée : ${body.error?.message}`);
  return body.idToken;
}
async function testUserSession(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  return loginPassword(email, password);
}
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.result;
  const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
  error.status = body.error?.status;
  throw error;
}
async function expectError(name, promise, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = !fragment || String(error.message).includes(fragment);
    record(name, ok, `${error.status ?? ''} : ${error.message}`);
  }
}
async function restGet(token, path) {
  const res = await fetch(`${FS_BASE}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';
async function createAdmin(uid, email, { role = 'ops', permissions = [], cityIds = [], countryIds = [] } = {}) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  await db.doc(`admins/${uid}`).set({ role, active: true, permissions, cityIds, countryIds, refundLimitCents: null, displayName: uid, email, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });
  await syncClaims(uid);
  return { password, token: await loginPassword(email, password) };
}
async function cleanupAdmin(uid) {
  await Promise.all([`admins/${uid}`, `users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(uid).catch(() => {});
}

function fullDriver(uid, overrides = {}) {
  return {
    cityId: 'longwy', countryId: 'FR', firstName: 'Test', lastName: 'CDCRES55', displayName: 'Test CDCRES55',
    phone: '+33600000055', email: `${uid}@golink.test`, avatar: null, type: 'platform', restaurantIds: [],
    vehicle: { type: 'bike', plate: null, model: null, color: null }, zoneIds: [], status: 'onboarding',
    onboardingStatus: 'submitted', rejectionReason: null, availability: 'offline', activeOrderIds: [],
    acceptsCash: false, rating: { average: 0, count: 0 },
    stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
    documentsValidUntil: null, lastIdentityCheckAt: null, lastSeenAt: null, searchKeywords: [uid],
    blocked: null, activeSanctionId: null, reviewedBy: null, reviewedAt: null, missingDocuments: null,
    test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system',
    ...overrides,
  };
}

// ------------------------------------------------------------------ 1+2. driverLocations : création + sync disponibilité

async function testDriverLocationsCreationAndSync() {
  const DRIVER_UID = 'cdcres55-driver-loc';
  const ADMIN_UID = 'cdcres55-admin-approve';
  const docTypes = ['identity', 'siret_registration', 'urssaf_certificate', 'insurance'];

  await db.doc(`drivers/${DRIVER_UID}`).set(fullDriver(DRIVER_UID));
  await Promise.all(
    docTypes.map((type, i) =>
      db.doc(`partnerDocuments/cdcres55-doc-${i}`).set({
        ownerType: 'driver', ownerId: DRIVER_UID, countryId: 'FR', cityId: 'longwy', type,
        file: { path: `drivers/${DRIVER_UID}/private/${type}.pdf`, uploadedAt: at(), sizeBytes: 100, contentType: 'application/pdf' },
        status: 'approved', number: null, issuedAt: null, expiresAt: '2099-12-31', reviewedBy: 'system', reviewedAt: at(), rejectionReason: null,
        remindersSent: 0, lastReminderAt: null, test: true, createdAt: at(), updatedAt: at(), createdBy: 'system', updatedBy: 'system',
      }),
    ),
  );
  await testUserSession(DRIVER_UID, `${DRIVER_UID}@golink.test`);
  const { token: adminToken } = await createAdmin(ADMIN_UID, 'cdcres55-admin-approve@golink.test', { role: 'super_admin', permissions: [] });

  try {
    const locBefore = await db.doc(`driverLocations/${DRIVER_UID}`).get();
    check('driverLocations : absent avant validation — état de départ attendu', !locBefore.exists);

    const result = await call(adminToken, 'reviewDriverApplication', { driverId: DRIVER_UID, decision: 'approve', reason: 'Test cdcres55 : dossier complet' });
    check('reviewDriverApplication : validation acceptée', result?.status === 'active', JSON.stringify(result));

    const locAfter = await db.doc(`driverLocations/${DRIVER_UID}`).get();
    check('driverLocations : créé à la validation — correctif attendu', locAfter.exists, `exists=${locAfter.exists}`);
    check('driverLocations : availability initiale = offline (cohérent avec drivers.availability)', locAfter.get('availability') === 'offline', `availability=${locAfter.get('availability')}`);
    check('driverLocations : cityId correct', locAfter.get('cityId') === 'longwy');

    // Le livreur passe « En ligne » : la règle Firestore qui autorise cette écriture directe par
    // le livreur (drivers.rules, inchangée par ce correctif) n'est pas retestée ici — seul le
    // DÉCLENCHEUR (onDriverAvailabilityChanged, le correctif) est vérifié, en écrivant comme le
    // ferait n'importe quel client une fois la règle satisfaite (le déclencheur Firestore réagit à
    // toute écriture sur le document, quel que soit le chemin qui l'a produite).
    await db.doc(`drivers/${DRIVER_UID}`).update({ availability: 'online', updatedAt: Timestamp.now(), updatedBy: DRIVER_UID });

    const synced = await until(async () => {
      const loc = await db.doc(`driverLocations/${DRIVER_UID}`).get();
      return loc.get('availability') === 'online' ? loc : null;
    });
    check('driverLocations.availability : synchronisé sur « online » par le déclencheur — correctif attendu', Boolean(synced), 'délai dépassé, resté désynchronisé');

    // Dispatch réel : le livreur doit maintenant être trouvable par la requête utilisée par dispatchOrder.
    const findable = await db.collection('driverLocations').where('cityId', '==', 'longwy').where('availability', '==', 'online').where('__name__', '==', db.doc(`driverLocations/${DRIVER_UID}`)).get();
    check('driverLocations : trouvable par la requête de dispatch (cityId+availability=online)', !findable.empty);
  } finally {
    await Promise.all(docTypes.map((_, i) => db.doc(`partnerDocuments/cdcres55-doc-${i}`).delete().catch(() => {})));
    await db.doc(`driverLocations/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await auth.deleteUser(DRIVER_UID).catch(() => {});
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 3. drivers.rules : driverPrivate/driverEarnings scope ville

async function testDriverDataScope() {
  const DRIVER_UID = 'cdcres55-driver-scope';
  const ADMIN_IN = 'cdcres55-admin-scope-in';
  const ADMIN_OUT = 'cdcres55-admin-scope-out';
  const CITY_IN = 'cdcres55-ville-in';
  const CITY_OUT = 'cdcres55-ville-out';
  const EARNING_ID = 'cdcres55-earning';

  await db.doc(`drivers/${DRIVER_UID}`).set(fullDriver(DRIVER_UID, { cityId: CITY_IN }));
  await db.doc(`driverPrivate/${DRIVER_UID}`).set({
    birthDate: '1990-01-01', nationality: 'FR', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
    siret: null, vatNumber: null, vatExempt: true, urssafValidUntil: null, workPermitValidUntil: null, ibanMasked: null, stripeAccountId: null,
    stripeAccountStatus: null, payoutAccount: null, cashBalanceCents: 0, cashLimitCents: 15000, cashSinceAt: null, lastCashRemittanceAt: null,
    payoutsBlocked: false, payoutsBlockedReason: null, taxIdentificationNumber: null, dac7Complete: false, partnerTermsVersion: null, test: true,
  });
  await db.doc(`driverEarnings/${EARNING_ID}`).set({
    driverId: DRIVER_UID, cityId: CITY_IN, countryId: 'FR', orderId: null, kind: 'delivery', amountCents: 500, tipCents: 0,
    earnedAt: at(), test: true,
  });

  const { token: adminInToken } = await createAdmin(ADMIN_IN, 'cdcres55-admin-scope-in@golink.test', { permissions: ['personal_data.view', 'finance.view'], cityIds: [CITY_IN], countryIds: ['FR'] });
  const { token: adminOutToken } = await createAdmin(ADMIN_OUT, 'cdcres55-admin-scope-out@golink.test', { permissions: ['personal_data.view', 'finance.view'], cityIds: [CITY_OUT], countryIds: ['FR'] });
  try {
    const privIn = await restGet(adminInToken, `driverPrivate/${DRIVER_UID}`);
    check('driverPrivate : admin DANS le périmètre autorisé — non-régression', allowed(privIn), `status=${privIn.status}`);
    const privOut = await restGet(adminOutToken, `driverPrivate/${DRIVER_UID}`);
    check('driverPrivate : admin HORS périmètre REFUSÉ — correctif attendu', denied(privOut), `status=${privOut.status}`);

    const earnIn = await restGet(adminInToken, `driverEarnings/${EARNING_ID}`);
    check('driverEarnings : admin finance.view DANS le périmètre autorisé — non-régression', allowed(earnIn), `status=${earnIn.status}`);
    const earnOut = await restGet(adminOutToken, `driverEarnings/${EARNING_ID}`);
    check('driverEarnings : admin finance.view HORS périmètre REFUSÉ — correctif attendu', denied(earnOut), `status=${earnOut.status}`);
  } finally {
    await db.doc(`driverEarnings/${EARNING_ID}`).delete().catch(() => {});
    await db.doc(`driverPrivate/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await cleanupAdmin(ADMIN_IN);
    await cleanupAdmin(ADMIN_OUT);
  }
}

// ------------------------------------------------------------------ 4. expireSanctions : pas de réactivation d'un livreur banni entre-temps

async function testExpireSanctionsRespectsLaterDeactivation() {
  const DRIVER_UID = 'cdcres55-driver-sanction';
  const SANCTION_ID = 'cdcres55-sanction';

  await db.doc(`drivers/${DRIVER_UID}`).set(fullDriver(DRIVER_UID, { status: 'deactivated', activeSanctionId: SANCTION_ID, blocked: { reason: 'sanction', since: at(-3 * 86_400_000), details: 'Test cdcres55', documentIds: [] } }));
  await db.doc(`driverSanctions/${SANCTION_ID}`).set({
    driverId: DRIVER_UID, type: 'temporary_suspension', reason: 'Test cdcres55', details: null, status: 'active',
    startsAt: at(-7 * 86_400_000), endsAt: at(-1000), contest: null, cityId: 'longwy', countryId: 'FR', createdByName: 'Test',
    test: true, createdAt: at(-7 * 86_400_000), updatedAt: at(-7 * 86_400_000), createdBy: 'system', updatedBy: 'system',
  });

  try {
    // expireSanctions n'est pas exportée (interne) : on invoque la tâche planifiée complète, qui l'appelle.
    const { computeZoneLive } = await import('../../functions/src/admin/operations/live.ts');
    await computeZoneLive.run();

    const sanctionAfter = await db.doc(`driverSanctions/${SANCTION_ID}`).get();
    check('driverSanctions : suspension expirée marquée (non-régression)', sanctionAfter.get('status') === 'expired', `status=${sanctionAfter.get('status')}`);

    const driverAfter = await db.doc(`drivers/${DRIVER_UID}`).get();
    check(
      'drivers.status : livreur désactivé entre-temps NON réactivé par l’expiration de la sanction — correctif attendu',
      driverAfter.get('status') === 'deactivated',
      `status=${driverAfter.get('status')}`,
    );
    check('drivers.activeSanctionId : nettoyé malgré tout (sanction bien expirée)', driverAfter.get('activeSanctionId') === null, `activeSanctionId=${driverAfter.get('activeSanctionId')}`);
  } finally {
    await db.doc(`driverSanctions/${SANCTION_ID}`).delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
  }
}

// ------------------------------------------------------------------ 5. respondToOffer : plafond de courses simultanées revérifié au commit

async function testConcurrentOrdersCapRecheck() {
  const DRIVER_UID = 'cdcres55-driver-cap';
  const RES = 'cdcres55-resto-cap';
  const ORDER_ID = 'cdcres55-order-cap';
  const OFFER_ID = 'cdcres55-offer-cap';
  const CLIENT = 'cdcres55-client-cap';

  // Plafond par défaut (functions/src/orders/context.ts) : 2 courses simultanées. On met le
  // livreur à 2 courses actives (fictives) AVANT l'offre, pour prouver que l'acceptation est
  // refusée au commit même si l'offre avait été émise plus tôt (candidat alors sous le plafond).
  await db.doc(`drivers/${DRIVER_UID}`).set(fullDriver(DRIVER_UID, { status: 'active', onboardingStatus: 'approved', availability: 'on_delivery', activeOrderIds: ['cdcres55-fake-1', 'cdcres55-fake-2'] }));
  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES55 Cap', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

  const items = [{ lineId: 'l1', productId: 'cdcres55-p1', name: 'Test plat', imageUrl: null, unitPriceCents: 1200, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 1200, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const total = 1200 + 299;
  try {
    await db.doc(`orders/${ORDER_ID}`).set({
      number: 'GL-TCDCRES55', countryId: 'FR', cityId: 'longwy', restaurantId: RES, restaurantName: 'CDCRES55 Cap', restaurantGroupId: null,
      customerId: CLIENT, customerName: 'Cdcres55 Client', customerPhoneMasked: null, status: 'ready', fulfillment: 'delivery', items, itemsCount: 1,
      amounts: { subtotalCents: 1200, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
      payment: { method: 'card', status: 'paid', paymentId: `pay-${ORDER_ID}`, label: null, paidAt: at() },
      promotionId: null, promoCode: null,
      delivery: { address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.5395, longitude: 5.7829 }, zoneId: null, distanceMeters: 1500, deliveredBy: 'platform', driverId: null, driverName: null, driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus: 'searching', dispatchAttempts: 1, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: OFFER_ID, dispatchRound: 1 },
      pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
      timeline: { placedAt: at(-20 * 60_000), new: at(-20 * 60_000), accepted: at(-18 * 60_000), preparing: at(-17 * 60_000), ready: at(-5 * 60_000) },
      acceptDeadline: null, cancellation: null,
      flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
      reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: null, searchKeywords: [ORDER_ID],
      restaurantSettlement: { grossCents: 1200, discountFundedCents: 0, commissionBaseCents: 1200, commissionBps: 1500, commissionHtCents: 150, commissionVatCents: 30, commissionTtcCents: 180, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 1020 },
      commission: { bps: 1500, source: 'market' }, processed: {},
      createdAt: at(-20 * 60_000), updatedAt: at(-5 * 60_000), test: true, seed: true,
    });
    await db.doc(`dispatchOffers/${OFFER_ID}`).set({
      orderId: ORDER_ID, driverId: DRIVER_UID, restaurantId: RES, cityId: 'longwy', zoneId: null, round: 1, status: 'offered',
      distanceToRestaurantMeters: 800, deliveryDistanceMeters: 1500, estimatedPayCents: 450, estimatedMinutes: 12,
      offeredAt: at(-30_000), expiresAt: at(60_000), respondedAt: null, declineReason: null, test: true,
    });

    const driverToken = await testUserSession(DRIVER_UID, `${DRIVER_UID}@golink.test`);
    await expectError(
      'respondToOffer : livreur déjà au plafond de courses simultanées REFUSÉ au commit — correctif attendu',
      call(driverToken, 'respondToOffer', { offerId: OFFER_ID, accept: true }),
      'déjà été attribuée',
    );
    const orderAfter = await db.doc(`orders/${ORDER_ID}`).get();
    check('orders.driverId : toujours non attribué (rejet confirmé, pas d’attribution partielle)', !orderAfter.get('driverId'));
  } finally {
    await db.doc(`dispatchOffers/${OFFER_ID}`).delete().catch(() => {});
    await db.doc(`orders/${ORDER_ID}`).delete().catch(() => {});
    await db.doc(`restaurants/${RES}`).delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await auth.deleteUser(DRIVER_UID).catch(() => {});
  }
}

async function main() {
  await testDriverLocationsCreationAndSync();
  await testDriverDataScope();
  await testExpireSanctionsRespectsLaterDeactivation();
  await testConcurrentOrdersCapRecheck();
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
