// Test réel cdc-pdf-06 (PDF client « Points à corriger », Backoffice resto #6 — remise à zéro
// de la recette du livreur salarié, 3 moyens) : vérifie que le livreur peut indiquer à la
// remise le moyen réellement encaissé (espèces par défaut, Tickets Restaurant ou carte via son
// terminal), que chaque moyen alimente un solde séparé (driverPrivate), reflété sur la fiche
// livreur du commerce (restaurantCourier), et que la remise à zéro fonctionne indépendamment
// pour chacun des 3 moyens.
//
//   npx tsx scripts/tests/cdc-pdf-06-cash-breakdown.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf06-adc-${process.pid}.json`);
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

/** Attend qu'un champ atteigne la valeur attendue (déclencheur Firestore asynchrone, onOrderSettled). */
async function waitForField(path, field, expected, { timeoutMs = 20_000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db.doc(path).get();
    if (snap.get(field) === expected) return snap.data();
    await sleep(intervalMs);
  }
  return (await db.doc(path).get()).data();
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

function orderDoc({ id, resId, driverId, chargedCents }) {
  const items = [{ lineId: 'l1', productId: 'p1', name: 'Test plat', imageUrl: null, unitPriceCents: chargedCents - 299, quantity: 1, options: [], optionsPriceCents: 0, totalCents: chargedCents - 299, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  return {
    number: `GL-T${id.toUpperCase()}`, countryId: 'FR', cityId: 'longwy', restaurantId: resId, restaurantName: 'CDCPDF06 Resto', restaurantGroupId: null,
    customerId: 'cdcpdf06-client', customerName: 'Cdcpdf06 Client', customerPhoneMasked: null, status: 'picked_up', fulfillment: 'delivery', items, itemsCount: 1,
    amounts: { subtotalCents: chargedCents - 299, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: chargedCents, chargedCents, refundedCents: 0, itemsVat: [], currency: 'EUR' },
    payment: { method: 'cash', status: 'pending', paymentId: null, label: null, paidAt: null },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '2 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.545, longitude: 5.79 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.545, longitude: 5.79 }, zoneId: null, distanceMeters: 1200, deliveredBy: 'restaurant', driverId, driverName: 'Test Livreur Salarié', driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus: 'assigned', dispatchAttempts: 1, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: null, dispatchRound: 1 },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-20 * 60_000), new: at(-20 * 60_000), accepted: at(-18 * 60_000), preparing: at(-17 * 60_000), ready: at(-10 * 60_000), assigned: at(-8 * 60_000), picked_up: at(-3 * 60_000) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId, searchKeywords: [id],
    restaurantSettlement: { grossCents: chargedCents - 299, discountFundedCents: 0, commissionBaseCents: chargedCents - 299, commissionBps: 1500, commissionHtCents: 0, commissionVatCents: 0, commissionTtcCents: 0, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 0 },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-20 * 60_000), updatedAt: at(-3 * 60_000), test: true, seed: true,
  };
}

async function main() {
  const RES = 'cdcpdf06-resto';
  const DRIVER = 'cdcpdf06-driver';
  const STAFF = 'cdcpdf06-staff';
  const ORDER_VOUCHER = 'cdcpdf06-order-voucher';
  const ORDER_CASH = 'cdcpdf06-order-cash';

  try {
    await db.doc(`restaurants/${RES}`).set({ name: 'CDCPDF06 Resto', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 } }, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

    await db.doc(`drivers/${DRIVER}`).set({
      cityId: 'longwy', countryId: 'FR', firstName: 'Test', lastName: 'Salarié', displayName: 'Test Livreur Salarié',
      phone: '+33600000081', email: `${DRIVER}@golink.test`, avatar: null, type: 'restaurant', restaurantIds: [RES],
      vehicle: { type: 'bike', plate: null, model: null, color: null }, zoneIds: [], status: 'active',
      onboardingStatus: 'approved', rejectionReason: null, availability: 'on_delivery', activeOrderIds: [ORDER_VOUCHER],
      acceptsCash: true, rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null, lastIdentityCheckAt: null, lastSeenAt: null, searchKeywords: [DRIVER],
      blocked: null, activeSanctionId: null, reviewedBy: null, reviewedAt: null, missingDocuments: null,
      test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system',
    });
    await db.doc(`driverPrivate/${DRIVER}`).set({
      birthDate: '1990-01-01', nationality: 'FR', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
      vatExempt: true, cashBalanceCents: 0, cashLimitCents: 15000, payoutsBlocked: false, dac7Complete: false, updatedAt: at(),
    });
    await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).set({
      driverId: DRIVER, displayName: 'Test Livreur Salarié', relation: 'own', status: 'active', deliveriesCount: 0, cashHeldCents: 0, cashLimitCents: 15000, updatedAt: at(), updatedBy: 'system',
    });
    await db.doc(`restaurants/${RES}/members/${STAFF}`).set({
      uid: STAFF, restaurantId: RES, groupId: null, displayName: 'Test Staff', email: `${STAFF}@golink.test`, role: 'owner', customRoleId: null,
      permissions: ['couriers.manage', 'finance.adjust', 'orders.view'], active: true, onDuty: true, employeeId: null, invitedBy: 'system', invitedAt: at(), joinedAt: at(), lastAccessAt: null, revokedAt: null, revokedBy: null,
    });

    await db.doc(`orders/${ORDER_VOUCHER}`).set(orderDoc({ id: ORDER_VOUCHER, resId: RES, driverId: DRIVER, chargedCents: 2599 }));
    await db.doc(`orders/${ORDER_CASH}`).set(orderDoc({ id: ORDER_CASH, resId: RES, driverId: DRIVER, chargedCents: 1899 }));

    const driverToken = await testUserSession(DRIVER, `${DRIVER}@golink.test`);
    const staffToken = await testUserSession(STAFF, `${STAFF}@golink.test`);

    // 1) Livraison encaissée en Tickets Restaurant : alimente mealVoucherBalanceCents, pas cashBalanceCents.
    const completeVoucher = await call(driverToken, 'completeOrder', { orderId: ORDER_VOUCHER, collectedAs: 'meal_voucher' });
    check('completeOrder (Tickets Restaurant) : livraison terminée', completeVoucher?.status === 'delivered', JSON.stringify(completeVoucher));

    let priv = await waitForField(`driverPrivate/${DRIVER}`, 'mealVoucherBalanceCents', 2599);
    check('driverPrivate.mealVoucherBalanceCents : crédité du montant encaissé', priv?.mealVoucherBalanceCents === 2599, `mealVoucherBalanceCents=${priv?.mealVoucherBalanceCents}`);
    check('driverPrivate.cashBalanceCents : resté à 0 (moyen différent)', (priv?.cashBalanceCents ?? 0) === 0, `cashBalanceCents=${priv?.cashBalanceCents}`);

    let courier = (await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).get()).data();
    check('restaurantCourier.mealVoucherHeldCents : reflété', courier?.mealVoucherHeldCents === 2599, `mealVoucherHeldCents=${courier?.mealVoucherHeldCents}`);

    const movementsVoucher = await db.collection('cashMovements').where('driverId', '==', DRIVER).where('method', '==', 'meal_voucher').get();
    check('cashMovements : mouvement « collected » tracé avec method=meal_voucher', movementsVoucher.docs.some((d) => d.get('type') === 'collected' && d.get('amountCents') === 2599), JSON.stringify(movementsVoucher.docs.map((d) => d.data())));

    // 2) Livraison encaissée sans précision (défaut rétrocompatible = espèces).
    const completeCash = await call(driverToken, 'completeOrder', { orderId: ORDER_CASH });
    check('completeOrder (sans collectedAs) : livraison terminée', completeCash?.status === 'delivered', JSON.stringify(completeCash));

    priv = await waitForField(`driverPrivate/${DRIVER}`, 'cashBalanceCents', 1899);
    check('driverPrivate.cashBalanceCents : crédité par défaut (espèces)', priv?.cashBalanceCents === 1899, `cashBalanceCents=${priv?.cashBalanceCents}`);
    check('driverPrivate.mealVoucherBalanceCents : inchangé par la 2e commande', priv?.mealVoucherBalanceCents === 2599, `mealVoucherBalanceCents=${priv?.mealVoucherBalanceCents}`);

    // 3) Remise à zéro des Tickets Restaurant uniquement : n'affecte pas les espèces.
    const resetVoucher = await call(staffToken, 'resetDriverCashBalance', { restaurantId: RES, driverId: DRIVER, method: 'meal_voucher' });
    check('resetDriverCashBalance (meal_voucher) : accepté', resetVoucher?.balanceCents === 0, JSON.stringify(resetVoucher));

    priv = (await db.doc(`driverPrivate/${DRIVER}`).get()).data();
    check('driverPrivate.mealVoucherBalanceCents : remis à 0', (priv?.mealVoucherBalanceCents ?? -1) === 0, `mealVoucherBalanceCents=${priv?.mealVoucherBalanceCents}`);
    check('driverPrivate.cashBalanceCents : non affecté par la remise à zéro des tickets', priv?.cashBalanceCents === 1899, `cashBalanceCents=${priv?.cashBalanceCents}`);

    courier = (await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).get()).data();
    check('restaurantCourier.mealVoucherHeldCents : reflété à 0', (courier?.mealVoucherHeldCents ?? -1) === 0, `mealVoucherHeldCents=${courier?.mealVoucherHeldCents}`);

    // 4) Remise à zéro une seconde fois (déjà à 0) : refusée proprement.
    let secondResetBlocked = false;
    try {
      await call(staffToken, 'resetDriverCashBalance', { restaurantId: RES, driverId: DRIVER, method: 'meal_voucher' });
    } catch (err) {
      secondResetBlocked = err.status === 'FAILED_PRECONDITION';
    }
    check('resetDriverCashBalance : refusé si rien à remettre', secondResetBlocked);

    // 5) Remise à zéro des espèces (vérifie le 3e moyen + non-interférence avec les 2 autres).
    const resetCash = await call(staffToken, 'resetDriverCashBalance', { restaurantId: RES, driverId: DRIVER, method: 'cash' });
    check('resetDriverCashBalance (cash) : accepté', resetCash?.balanceCents === 0, JSON.stringify(resetCash));
    priv = (await db.doc(`driverPrivate/${DRIVER}`).get()).data();
    check('driverPrivate.cashBalanceCents : remis à 0', (priv?.cashBalanceCents ?? -1) === 0, `cashBalanceCents=${priv?.cashBalanceCents}`);
    check('driverPrivate.cardTerminalBalanceCents : jamais alimenté, reste à 0', (priv?.cardTerminalBalanceCents ?? 0) === 0, `cardTerminalBalanceCents=${priv?.cardTerminalBalanceCents}`);
  } finally {
    for (const orderId of [ORDER_VOUCHER, ORDER_CASH]) {
      const events = await db.collection(`orders/${orderId}/events`).get().catch(() => ({ docs: [] }));
      await Promise.all(events.docs.map((d) => d.ref.delete().catch(() => {})));
    }
    const movements = await db.collection('cashMovements').where('driverId', '==', DRIVER).get().catch(() => ({ docs: [] }));
    await Promise.all(movements.docs.map((d) => d.ref.delete().catch(() => {})));
    const notifLogs = await db.collection('notificationLogs').where('recipientId', '==', RES).get().catch(() => ({ docs: [] }));
    await Promise.all(notifLogs.docs.map((d) => d.ref.delete().catch(() => {})));
    await Promise.all([
      `orders/${ORDER_VOUCHER}`, `orders/${ORDER_CASH}`,
      `restaurants/${RES}/members/${STAFF}`, `restaurants/${RES}/couriers/${DRIVER}`,
      `driverPrivate/${DRIVER}`, `drivers/${DRIVER}`, `restaurants/${RES}`,
    ].map((p) => db.doc(p).delete().catch(() => {})));
    await Promise.all([DRIVER, STAFF].map((uid) => Promise.all([`users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {}))).then(() => auth.deleteUser(uid).catch(() => {}))));
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
