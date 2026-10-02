// Test réel cdc-pdf-01 (PDF client « Points à corriger », App client #1 — suivi GPS en direct) :
//
// Le suivi GPS en direct existait déjà côté app client (`OrderTrackingScreen`, `useDriverLocation`)
// mais restait invisible pour trois raisons cumulées, toutes corrigées cette session :
// 1. `driverLocations/{uid}` n'était jamais créé pour un vrai livreur (voir PR #124) ;
// 2. sa disponibilité ne se resynchronisait plus après une reconnexion (voir PR #124) ;
// 3. la carte n'était affichée côté client QUE pendant le trajet commerce→client (statut
//    `picked_up`), jamais pendant le trajet livreur→commerce (statut `assigned`), alors que
//    la course est déjà « démarrée » dès l'attribution.
// Ce test vérifie la partie la plus sensible restante : le droit de lecture du client sur
// `driverLocations/{driverId}` une fois un livreur réellement assigné (gouverné par
// `visibleTo`, lui-même conditionné par l'interrupteur `driver_tracking`).
//
//   npx tsx scripts/tests/cdc-pdf-01-gps-tracking.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf01-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

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
async function restGet(token, path) {
  const res = await fetch(`${FS_BASE}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

async function createAdmin(uid, email, { role = 'super_admin', permissions = [] } = {}) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  await db.doc(`admins/${uid}`).set({ role, active: true, permissions, cityIds: [], countryIds: [], refundLimitCents: null, displayName: uid, email, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });
  await syncClaims(uid);
  return { password, token: await loginPassword(email, password) };
}
async function cleanupAdmin(uid) {
  await Promise.all([`admins/${uid}`, `users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(uid).catch(() => {});
}

async function main() {
  const RES = 'cdcpdf01-resto';
  const DRIVER_UID = 'cdcpdf01-driver';
  const CLIENT = 'cdcpdf01-client';
  const OUTSIDER = 'cdcpdf01-outsider';
  const ORDER_ID = 'cdcpdf01-order';
  const ADMIN_UID = 'cdcpdf01-admin';

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCPDF01 Resto', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 } }, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

  await db.doc(`drivers/${DRIVER_UID}`).set({
    cityId: 'longwy', countryId: 'FR', firstName: 'Test', lastName: 'CDCPDF01', displayName: 'Test CDCPDF01',
    phone: '+33600000077', email: `${DRIVER_UID}@golink.test`, avatar: null, type: 'platform', restaurantIds: [],
    vehicle: { type: 'bike', plate: null, model: null, color: null }, zoneIds: [], status: 'active',
    onboardingStatus: 'approved', rejectionReason: null, availability: 'online', activeOrderIds: [],
    acceptsCash: false, rating: { average: 0, count: 0 },
    stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
    documentsValidUntil: null, lastIdentityCheckAt: null, lastSeenAt: null, searchKeywords: [DRIVER_UID],
    blocked: null, activeSanctionId: null, reviewedBy: null, reviewedAt: null, missingDocuments: null,
    test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system',
  });
  await db.doc(`driverLocations/${DRIVER_UID}`).set({
    position: { latitude: 49.54, longitude: 5.78 }, geohash: 'test', heading: null, speedKmh: null, accuracyMeters: null,
    availability: 'online', cityId: 'longwy', zoneId: null, activeOrderIds: [], visibleTo: [], updatedAt: at(),
  });

  const items = [{ lineId: 'l1', productId: 'cdcpdf01-p1', name: 'Test plat', imageUrl: null, unitPriceCents: 1500, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 1500, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const total = 1500 + 299;
  await db.doc(`orders/${ORDER_ID}`).set({
    number: 'GL-TCDCPDF01', countryId: 'FR', cityId: 'longwy', restaurantId: RES, restaurantName: 'CDCPDF01 Resto', restaurantGroupId: null,
    customerId: CLIENT, customerName: 'Cdcpdf01 Client', customerPhoneMasked: null, status: 'ready', fulfillment: 'delivery', items, itemsCount: 1,
    amounts: { subtotalCents: 1500, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
    payment: { method: 'card', status: 'paid', paymentId: `pay-${ORDER_ID}`, label: null, paidAt: at() },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '2 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.545, longitude: 5.79 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.545, longitude: 5.79 }, zoneId: null, distanceMeters: 1200, deliveredBy: 'platform', driverId: null, driverName: null, driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus: 'searching', dispatchAttempts: 1, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: null, dispatchRound: 1 },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-20 * 60_000), new: at(-20 * 60_000), accepted: at(-18 * 60_000), preparing: at(-17 * 60_000), ready: at(-5 * 60_000) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: null, searchKeywords: [ORDER_ID],
    restaurantSettlement: { grossCents: 1500, discountFundedCents: 0, commissionBaseCents: 1500, commissionBps: 1500, commissionHtCents: 188, commissionVatCents: 38, commissionTtcCents: 226, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 1274 },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-20 * 60_000), updatedAt: at(-5 * 60_000), test: true, seed: true,
  });

  await testUserSession(CLIENT, `${CLIENT}@golink.test`);
  const outsiderToken = await testUserSession(OUTSIDER, `${OUTSIDER}@golink.test`);
  const { token: adminToken } = await createAdmin(ADMIN_UID, `${ADMIN_UID}@golink.test`, { role: 'super_admin', permissions: ['orders.intervene'] });

  const assign = await call(adminToken, 'dispatchOrder', { orderId: ORDER_ID, driverId: DRIVER_UID, reason: 'Test cdcpdf01 : attribution forcée' });
  check('dispatchOrder : attribution forcée du livreur acceptée', assign?.assigned === true, JSON.stringify(assign));

  const orderAfter = await db.doc(`orders/${ORDER_ID}`).get();
  check('orders.status : passé à « assigned » après attribution — condition de la carte en direct', orderAfter.get('status') === 'assigned', `status=${orderAfter.get('status')}`);

  const locAfter = await db.doc(`driverLocations/${DRIVER_UID}`).get();
  check('driverLocations.visibleTo : le client (customerId) y a bien été ajouté', (locAfter.get('visibleTo') ?? []).includes(CLIENT), `visibleTo=${JSON.stringify(locAfter.get('visibleTo'))}`);

  const clientPassword = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.updateUser(CLIENT, { password: clientPassword });
  const clientToken = await loginPassword(`${CLIENT}@golink.test`, clientPassword);

  const readAsClient = await restGet(clientToken, `driverLocations/${DRIVER_UID}`);
  check('driverLocations : le CLIENT de la commande peut lire la position du livreur — correctif attendu (suivi GPS)', allowed(readAsClient), `status=${readAsClient.status}`);

  const readAsOutsider = await restGet(outsiderToken, `driverLocations/${DRIVER_UID}`);
  check('driverLocations : un client SANS rapport avec la commande ne peut PAS lire la position — non-régression (confidentialité)', denied(readAsOutsider), `status=${readAsOutsider.status}`);

  await Promise.all([`orders/${ORDER_ID}`, `driverLocations/${DRIVER_UID}`, `drivers/${DRIVER_UID}`, `restaurants/${RES}`].map((p) => db.doc(p).delete().catch(() => {})));
  await Promise.all([CLIENT, OUTSIDER, DRIVER_UID].map((uid) => auth.deleteUser(uid).catch(() => {})));
  await cleanupAdmin(ADMIN_UID);
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
