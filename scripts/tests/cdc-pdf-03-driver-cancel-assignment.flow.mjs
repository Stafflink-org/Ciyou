// Test réel cdc-pdf-03 (PDF client « Points à corriger », App livreur #1 — flux complet
// d'acceptation/livraison) : vérifie la nouvelle fonction `cancelDriverAssignment`, qui permet
// au livreur d'annuler sa propre acceptation depuis l'écran de détail de la course, avant de
// l'avoir récupérée au commerce (3e étape attendue du flux décrit dans le document).
//
//   npx tsx scripts/tests/cdc-pdf-03-driver-cancel-assignment.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf03-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
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

function orderDoc({ id, resId, driverUid, status, dispatchStatus }) {
  const items = [{ lineId: 'l1', productId: 'cdcpdf03-p1', name: 'Test plat', imageUrl: null, unitPriceCents: 1500, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 1500, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const total = 1500 + 299;
  return {
    number: `GL-T${id.toUpperCase()}`, countryId: 'FR', cityId: 'longwy', restaurantId: resId, restaurantName: 'CDCPDF03 Resto', restaurantGroupId: null,
    customerId: 'cdcpdf03-client', customerName: 'Cdcpdf03 Client', customerPhoneMasked: null, status, fulfillment: 'delivery', items, itemsCount: 1,
    amounts: { subtotalCents: 1500, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
    payment: { method: 'card', status: 'paid', paymentId: `pay-${id}`, label: null, paidAt: at() },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '2 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.545, longitude: 5.79 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.545, longitude: 5.79 }, zoneId: null, distanceMeters: 1200, deliveredBy: 'platform', driverId: driverUid, driverName: driverUid ? 'Test Cdcpdf03' : null, driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus, dispatchAttempts: 1, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: null, dispatchRound: 1 },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-20 * 60_000), new: at(-20 * 60_000), accepted: at(-18 * 60_000), preparing: at(-17 * 60_000), ready: at(-10 * 60_000), ...(status !== 'ready' ? { assigned: at(-5 * 60_000) } : {}) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: driverUid, searchKeywords: [id],
    restaurantSettlement: { grossCents: 1500, discountFundedCents: 0, commissionBaseCents: 1500, commissionBps: 1500, commissionHtCents: 188, commissionVatCents: 38, commissionTtcCents: 226, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 1274 },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-20 * 60_000), updatedAt: at(-5 * 60_000), test: true, seed: true,
  };
}

async function main() {
  const RES = 'cdcpdf03-resto';
  const DRIVER_UID = 'cdcpdf03-driver';
  const OTHER_DRIVER_UID = 'cdcpdf03-driver-other';
  const CLIENT = 'cdcpdf03-client';
  const ORDER_ASSIGNED = 'cdcpdf03-order-assigned';
  const ORDER_PICKED_UP = 'cdcpdf03-order-pickedup';

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCPDF03 Resto', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 } }, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

  const driverDoc = (uid) => ({
    cityId: 'longwy', countryId: 'FR', firstName: 'Test', lastName: 'Cdcpdf03', displayName: 'Test Cdcpdf03',
    phone: '+33600000078', email: `${uid}@golink.test`, avatar: null, type: 'platform', restaurantIds: [],
    vehicle: { type: 'bike', plate: null, model: null, color: null }, zoneIds: [], status: 'active',
    onboardingStatus: 'approved', rejectionReason: null, availability: 'on_delivery', activeOrderIds: [ORDER_ASSIGNED],
    acceptsCash: false, rating: { average: 0, count: 0 },
    stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
    documentsValidUntil: null, lastIdentityCheckAt: null, lastSeenAt: null, searchKeywords: [uid],
    blocked: null, activeSanctionId: null, reviewedBy: null, reviewedAt: null, missingDocuments: null,
    test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system',
  });
  await db.doc(`drivers/${DRIVER_UID}`).set(driverDoc(DRIVER_UID));
  await db.doc(`driverLocations/${DRIVER_UID}`).set({
    position: { latitude: 49.54, longitude: 5.78 }, geohash: 'test', heading: null, speedKmh: null, accuracyMeters: null,
    availability: 'on_delivery', cityId: 'longwy', zoneId: null, activeOrderIds: [ORDER_ASSIGNED], visibleTo: [CLIENT], updatedAt: at(),
  });

  await db.doc(`orders/${ORDER_ASSIGNED}`).set(orderDoc({ id: ORDER_ASSIGNED, resId: RES, driverUid: DRIVER_UID, status: 'assigned', dispatchStatus: 'assigned' }));
  await db.doc(`orders/${ORDER_PICKED_UP}`).set(orderDoc({ id: ORDER_PICKED_UP, resId: RES, driverUid: DRIVER_UID, status: 'picked_up', dispatchStatus: 'assigned' }));

  const driverToken = await testUserSession(DRIVER_UID, `${DRIVER_UID}@golink.test`);
  const otherDriverToken = await testUserSession(OTHER_DRIVER_UID, `${OTHER_DRIVER_UID}@golink.test`);
  await testUserSession(CLIENT, `${CLIENT}@golink.test`);

  try {
    await runChecks({ DRIVER_UID, OTHER_DRIVER_UID, ORDER_ASSIGNED, ORDER_PICKED_UP, driverToken, otherDriverToken });
  } finally {
    // Nettoyage garanti (même en cas d'échec d'une vérification) : si le moteur de dispatch a
    // réattribué un livreur RÉEL (hors fixtures de ce test) à la commande, on le libère avant
    // de tout supprimer — sans quoi il resterait bloqué « en course » sur une commande qui va
    // disparaître (observé une fois en développement avec un livreur seed de démonstration).
    const orderNow = await db.doc(`orders/${ORDER_ASSIGNED}`).get().catch(() => null);
    const reassignedTo = orderNow?.exists ? orderNow.get('driverId') : null;
    if (reassignedTo && reassignedTo !== DRIVER_UID && reassignedTo !== OTHER_DRIVER_UID) {
      await db.doc(`drivers/${reassignedTo}`).update({ activeOrderIds: [], availability: 'online' }).catch(() => {});
      await db.doc(`driverLocations/${reassignedTo}`).update({ activeOrderIds: [], visibleTo: [], availability: 'online' }).catch(() => {});
    }
    for (const orderId of [ORDER_ASSIGNED, ORDER_PICKED_UP]) {
      const offers = await db.collection('dispatchOffers').where('orderId', '==', orderId).get().catch(() => ({ docs: [] }));
      await Promise.all(offers.docs.map((d) => d.ref.delete().catch(() => {})));
      const events = await db.collection(`orders/${orderId}/events`).get().catch(() => ({ docs: [] }));
      await Promise.all(events.docs.map((d) => d.ref.delete().catch(() => {})));
    }
    await Promise.all([`orders/${ORDER_ASSIGNED}`, `orders/${ORDER_PICKED_UP}`, `driverLocations/${DRIVER_UID}`, `drivers/${DRIVER_UID}`, `restaurants/${RES}`].map((p) => db.doc(p).delete().catch(() => {})));
    await Promise.all([DRIVER_UID, OTHER_DRIVER_UID, CLIENT].map((uid) => Promise.all([`users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {}))).then(() => auth.deleteUser(uid).catch(() => {}))));
  }
}

async function runChecks({ DRIVER_UID, OTHER_DRIVER_UID, ORDER_ASSIGNED, ORDER_PICKED_UP, driverToken, otherDriverToken }) {
  // 1) Un livreur tiers (non attribué) ne peut pas annuler l'acceptation d'un autre.
  let outsiderDenied = false;
  try {
    await call(otherDriverToken, 'cancelDriverAssignment', { orderId: ORDER_ASSIGNED });
  } catch (err) {
    outsiderDenied = err.status === 'PERMISSION_DENIED';
  }
  check('cancelDriverAssignment : refusé à un livreur tiers non attribué', outsiderDenied);

  // 2) Impossible d'annuler une course déjà récupérée (picked_up).
  let pickedUpBlocked = false;
  try {
    await call(driverToken, 'cancelDriverAssignment', { orderId: ORDER_PICKED_UP });
  } catch (err) {
    pickedUpBlocked = err.status === 'FAILED_PRECONDITION';
  }
  check('cancelDriverAssignment : refusé une fois la commande récupérée (picked_up)', pickedUpBlocked, 'garde-fou attendu une fois la course démarrée');

  // 3) Le livreur attribué annule son acceptation : succès, le LIVREUR qui annule n'est
  // plus sur la commande. Le moteur avancé relance ensuite la recherche (comme après un
  // refus d'offre) : si un autre livreur réel est disponible dans la ville de test, il peut
  // être attribué à sa place — c'est le comportement attendu (point PDF : « la commande sera
  // proposée à un autre livreur »), pas un échec du test.
  const cancelResult = await call(driverToken, 'cancelDriverAssignment', { orderId: ORDER_ASSIGNED });
  check('cancelDriverAssignment : annulation acceptée pour le livreur attribué', cancelResult?.status === 'ready', JSON.stringify(cancelResult));

  const orderAfter = await db.doc(`orders/${ORDER_ASSIGNED}`).get();
  const reassignedTo = orderAfter.get('driverId');
  check('orders.driverId : le livreur qui a annulé n’est plus sur la commande', reassignedTo !== DRIVER_UID, `driverId=${reassignedTo}`);
  record('orders.driverId (information) : relance du dispatch après annulation', true, reassignedTo ? `réattribuée à ${reassignedTo}` : 'aucun autre livreur disponible dans la ville de test, commande repassée « ready »');

  const offersAfter = await db.collection('dispatchOffers').where('orderId', '==', ORDER_ASSIGNED).where('driverId', '==', DRIVER_UID).get();
  check('dispatchOffers : l’offre du livreur annulant est marquée « cancelled » (exclusion de la relance immédiate)', offersAfter.docs.every((d) => d.get('status') === 'cancelled'), JSON.stringify(offersAfter.docs.map((d) => d.get('status'))));

  const driverAfter = await db.doc(`drivers/${DRIVER_UID}`).get();
  check('drivers.activeOrderIds : la course annulée en a été retirée', !(driverAfter.get('activeOrderIds') ?? []).includes(ORDER_ASSIGNED), `activeOrderIds=${JSON.stringify(driverAfter.get('activeOrderIds'))}`);
  check('drivers.availability : redevenu « online » (plus aucune course active)', driverAfter.get('availability') === 'online', `availability=${driverAfter.get('availability')}`);

  const locAfter = await db.doc(`driverLocations/${DRIVER_UID}`).get();
  check('driverLocations.visibleTo : vidé après annulation (plus de client à notifier)', (locAfter.get('visibleTo') ?? []).length === 0, `visibleTo=${JSON.stringify(locAfter.get('visibleTo'))}`);

  // 4) Annuler une seconde fois la même course (déjà libérée) échoue proprement.
  let secondCancelBlocked = false;
  try {
    await call(driverToken, 'cancelDriverAssignment', { orderId: ORDER_ASSIGNED });
  } catch (err) {
    secondCancelBlocked = err.status === 'PERMISSION_DENIED' || err.status === 'FAILED_PRECONDITION';
  }
  check('cancelDriverAssignment : refusé une seconde fois (livreur déjà libéré)', secondCancelBlocked);
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
