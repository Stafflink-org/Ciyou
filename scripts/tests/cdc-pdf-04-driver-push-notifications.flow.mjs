// Test réel cdc-pdf-04 (PDF client « Points à corriger », App livreur #2 — 3 notifications
// push) : vérifie que les 3 messages automatiques sont bien déclenchés et déposés dans le
// centre de notifications du client (`users/{uid}/notifications`), canal garanti même quand
// aucun jeton d'appareil n'est enregistré (push réel hors périmètre de ce test — voir le
// commentaire de livraison dans le rapport de la tâche).
//
//   npx tsx scripts/tests/cdc-pdf-04-driver-push-notifications.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf04-adc-${process.pid}.json`);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Attend qu'un document de notification apparaisse (déclencheur Firestore asynchrone). */
async function waitForNotification(uid, predicate, { timeoutMs = 20_000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db.collection(`users/${uid}/notifications`).get();
    const found = snap.docs.find((d) => predicate(d.data()));
    if (found) return found.data();
    await sleep(intervalMs);
  }
  return null;
}

function baseOrder({ id, resId, customerId, status, fulfillment = 'delivery' }) {
  const items = [{ lineId: 'l1', productId: 'cdcpdf04-p1', name: 'Test plat', imageUrl: null, unitPriceCents: 1200, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 1200, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const total = 1200 + 299;
  return {
    number: `GL-T${id.toUpperCase()}`, countryId: 'FR', cityId: 'longwy', restaurantId: resId, restaurantName: 'CDCPDF04 Resto', restaurantGroupId: null,
    customerId, customerName: 'Cdcpdf04 Client', customerPhoneMasked: null, status, fulfillment, items, itemsCount: 1,
    amounts: { subtotalCents: 1200, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
    payment: { method: 'card', status: 'paid', paymentId: `pay-${id}`, label: null, paidAt: at() },
    promotionId: null, promoCode: null,
    delivery: fulfillment === 'delivery' ? { address: { line1: '2 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.545, longitude: 5.79 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.545, longitude: 5.79 }, zoneId: null, distanceMeters: 1200, deliveredBy: 'platform', driverId: null, driverName: null, driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus: null, dispatchAttempts: 0, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: null, dispatchRound: 0 } : null,
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-20 * 60_000), new: at(-20 * 60_000), accepted: at(-18 * 60_000), preparing: at(-17 * 60_000), ready: at(-10 * 60_000) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: null, searchKeywords: [id],
    restaurantSettlement: { grossCents: 1200, discountFundedCents: 0, commissionBaseCents: 1200, commissionBps: 1500, commissionHtCents: 150, commissionVatCents: 30, commissionTtcCents: 180, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 1020 },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-20 * 60_000), updatedAt: at(-10 * 60_000), test: true, seed: true,
  };
}

async function main() {
  const RES = 'cdcpdf04-resto';
  const DRIVER_UID = 'cdcpdf04-driver';
  const CLIENT = 'cdcpdf04-client';
  const ORDER_A = 'cdcpdf04-order-assign'; // notification 1 : livreur accepte
  const ORDER_B = 'cdcpdf04-order-arrival'; // notification 2 : arrivée imminente
  const ORDER_C = 'cdcpdf04-order-handover'; // notification 3 : rappel du code

  try {
    await db.doc(`restaurants/${RES}`).set({ name: 'CDCPDF04 Resto', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 } }, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

    await db.doc(`drivers/${DRIVER_UID}`).set({
      cityId: 'longwy', countryId: 'FR', firstName: 'Test', lastName: 'Cdcpdf04', displayName: 'Test Cdcpdf04',
      phone: '+33600000079', email: `${DRIVER_UID}@golink.test`, avatar: null, type: 'platform', restaurantIds: [],
      vehicle: { type: 'bike', plate: null, model: null, color: null }, zoneIds: [], status: 'active',
      onboardingStatus: 'approved', rejectionReason: null, availability: 'on_delivery', activeOrderIds: [ORDER_C],
      acceptsCash: false, rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null, lastIdentityCheckAt: null, lastSeenAt: null, searchKeywords: [DRIVER_UID],
      blocked: null, activeSanctionId: null, reviewedBy: null, reviewedAt: null, missingDocuments: null,
      test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system',
    });
    const driverToken = await testUserSession(DRIVER_UID, `${DRIVER_UID}@golink.test`);
    await testUserSession(CLIENT, `${CLIENT}@golink.test`);

    // --- 1) Notification « un livreur a accepté votre commande » ---
    await db.doc(`orders/${ORDER_A}`).set(baseOrder({ id: ORDER_A, resId: RES, customerId: CLIENT, status: 'ready' }));
    await sleep(2000); // laisse le déclencheur traiter l'écriture initiale avant la transition.
    await db.doc(`orders/${ORDER_A}`).update({
      status: 'assigned', driverId: DRIVER_UID,
      'delivery.driverId': DRIVER_UID, 'delivery.driverName': 'Test Cdcpdf04', 'delivery.dispatchStatus': 'assigned',
      updatedAt: at(),
    });
    const notifA = await waitForNotification(CLIENT, (n) => n.title === 'Un livreur a accepté votre commande' || (n.body ?? '').includes('Test Cdcpdf04'));
    check('order_driver_assigned : notification déposée au client', Boolean(notifA), JSON.stringify(notifA));
    check('order_driver_assigned : le nom du livreur apparaît dans le message', Boolean(notifA?.body?.includes('Test Cdcpdf04')), notifA?.body);

    // --- 2) Notification « votre livreur arrive dans environ 1 minute » ---
    // Déclenchée par la tâche planifiée réelle (`enforceAcceptanceTimeout`, chaque minute) : on
    // positionne une ETA à 30 s et on attend son passage naturel, sans forcer son exécution.
    await db.doc(`orders/${ORDER_B}`).set({
      ...baseOrder({ id: ORDER_B, resId: RES, customerId: CLIENT, status: 'picked_up' }),
      driverId: DRIVER_UID,
      delivery: { ...baseOrder({ id: ORDER_B, resId: RES, customerId: CLIENT, status: 'picked_up' }).delivery, driverId: DRIVER_UID, driverName: 'Test Cdcpdf04', dispatchStatus: 'assigned', estimatedArrivalAt: at(30_000), arrivalReminderSentAt: null },
    });
    const notifB = await waitForNotification(CLIENT, (n) => n.title === 'Votre livreur arrive', { timeoutMs: 90_000, intervalMs: 5000 });
    check('order_arrival_soon : notification déposée au client (tâche planifiée réelle)', Boolean(notifB), JSON.stringify(notifB));
    const orderBAfter = await db.doc(`orders/${ORDER_B}`).get();
    check('orders.delivery.arrivalReminderSentAt : posé pour éviter un doublon', Boolean(orderBAfter.get('delivery.arrivalReminderSentAt')), `arrivalReminderSentAt=${orderBAfter.get('delivery.arrivalReminderSentAt')}`);

    // --- 3) Notification « rappel du code de remise » à l'arrivée du livreur ---
    await db.doc(`orders/${ORDER_C}`).set({
      ...baseOrder({ id: ORDER_C, resId: RES, customerId: CLIENT, status: 'picked_up' }),
      driverId: DRIVER_UID, pickupCode: '7421',
      delivery: { ...baseOrder({ id: ORDER_C, resId: RES, customerId: CLIENT, status: 'picked_up' }).delivery, driverId: DRIVER_UID, driverName: 'Test Cdcpdf04', dispatchStatus: 'assigned', handoverCodeRequired: true },
    });
    await sleep(2000);
    const arrived = await call(driverToken, 'markDriverArrived', { orderId: ORDER_C });
    check('markDriverArrived : accepté pour le livreur attribué', Boolean(arrived?.arrivedAt), JSON.stringify(arrived));
    const notifC = await waitForNotification(CLIENT, (n) => n.title === 'Votre livreur est arrivé');
    check('order_handover_code_reminder : notification déposée au client', Boolean(notifC), JSON.stringify(notifC));
    check('order_handover_code_reminder : le code figure dans le message', Boolean(notifC?.body?.includes('7421')), notifC?.body);
  } finally {
    for (const orderId of [ORDER_A, ORDER_B, ORDER_C]) {
      const events = await db.collection(`orders/${orderId}/events`).get().catch(() => ({ docs: [] }));
      await Promise.all(events.docs.map((d) => d.ref.delete().catch(() => {})));
    }
    const notifs = await db.collection(`users/${CLIENT}/notifications`).get().catch(() => ({ docs: [] }));
    await Promise.all(notifs.docs.map((d) => d.ref.delete().catch(() => {})));
    const logs = await db.collection('notificationLogs').where('recipientId', '==', CLIENT).get().catch(() => ({ docs: [] }));
    await Promise.all(logs.docs.map((d) => d.ref.delete().catch(() => {})));
    await Promise.all([`orders/${ORDER_A}`, `orders/${ORDER_B}`, `orders/${ORDER_C}`, `drivers/${DRIVER_UID}`, `restaurants/${RES}`].map((p) => db.doc(p).delete().catch(() => {})));
    await Promise.all([DRIVER_UID, CLIENT].map((uid) => Promise.all([`users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {}))).then(() => auth.deleteUser(uid).catch(() => {}))));
  }
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
