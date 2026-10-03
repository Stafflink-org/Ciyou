// Test réel cdc-pdf-05 (PDF client « Points à corriger », Backoffice resto #8 — e-mail
// récapitulatif de commande) : vérifie qu'à chaque nouvelle commande, un message « email »
// récapitulatif (numéro, infos client, articles, totaux) est bien préparé à la fois pour le
// commerce et pour le client — déposé dans le centre de notifications (toujours réel) et
// tracé comme e-mail « queued » (simulé : comptes de test en domaine .test) dans
// `notificationLogs`, preuve que le contenu a bien été rendu et aurait été transmis.
//
//   npx tsx scripts/tests/cdc-pdf-05-order-summary-email.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcpdf05-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

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

async function main() {
  const RES = 'cdcpdf05-resto';
  const STAFF_UID = 'cdcpdf05-staff';
  const CLIENT = 'cdcpdf05-client';
  const ORDER = 'cdcpdf05-order';

  try {
    await db.doc(`restaurants/${RES}`).set({ name: 'CDCPDF05 Resto', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.5395, longitude: 5.7829 } }, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });
    // `sendPlatformMessage` lit l'e-mail du destinataire sur users/{uid} (pas sur la fiche
    // équipe) : sans ce document, le canal e-mail est silencieusement ignoré (pas d'erreur).
    await db.doc(`users/${CLIENT}`).set({ email: `${CLIENT}@golink.test`, locale: 'fr', test: true, displayName: 'Nadia Example' });
    await db.doc(`users/${STAFF_UID}`).set({ email: `${STAFF_UID}@golink.test`, locale: 'fr', test: true, displayName: 'Test Staff' });
    await db.doc(`restaurants/${RES}/members/${STAFF_UID}`).set({
      uid: STAFF_UID, restaurantId: RES, groupId: null, displayName: 'Test Staff', email: `${STAFF_UID}@golink.test`, role: 'manager', customRoleId: null,
      permissions: ['orders.view'], active: true, onDuty: true, employeeId: null, invitedBy: 'system', invitedAt: at(), joinedAt: at(), lastAccessAt: null, revokedAt: null, revokedBy: null,
    });

    const items = [
      { lineId: 'l1', productId: 'p1', name: 'Burger Signature', imageUrl: null, unitPriceCents: 1200, quantity: 2, options: [], optionsPriceCents: 0, totalCents: 2400, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null },
      { lineId: 'l2', productId: 'p2', name: 'Frites maison', imageUrl: null, unitPriceCents: 450, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 450, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null },
    ];
    const total = 2400 + 450 + 299;
    await db.doc(`orders/${ORDER}`).set({
      number: 'GL-TCDCPDF05', countryId: 'FR', cityId: 'longwy', restaurantId: RES, restaurantName: 'CDCPDF05 Resto', restaurantGroupId: null,
      customerId: CLIENT, customerName: 'Nadia Example', customerPhoneMasked: '06 •• •• •• 12', status: 'new', fulfillment: 'delivery', items, itemsCount: 3,
      amounts: { subtotalCents: 2850, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
      payment: { method: 'card', status: 'paid', paymentId: `pay-${ORDER}`, label: null, paidAt: at() },
      promotionId: null, promoCode: null,
      delivery: { address: { line1: '2 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: { latitude: 49.545, longitude: 5.79 }, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.545, longitude: 5.79 }, zoneId: null, distanceMeters: 1200, deliveredBy: 'platform', driverId: null, driverName: null, driverPhoneMasked: null, driverVehicle: null, promisedFrom: at(), promisedTo: at(20 * 60_000), estimatedArrivalAt: at(15 * 60_000), proof: null, handoverCodeRequired: false, dispatchStatus: null, dispatchAttempts: 0, courierSurgeBonusCents: 0, courierIsPeak: false, dispatchOfferId: null, dispatchRound: 0 },
      pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
      timeline: { placedAt: at(), new: at() },
      acceptDeadline: at(10 * 60_000), cancellation: null,
      flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
      reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: null, searchKeywords: [ORDER],
      restaurantSettlement: { grossCents: 2850, discountFundedCents: 0, commissionBaseCents: 2850, commissionBps: 1500, commissionHtCents: 356, commissionVatCents: 71, commissionTtcCents: 427, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: 2423 },
      commission: { bps: 1500, source: 'market' }, processed: {},
      createdAt: at(), updatedAt: at(), test: true, seed: true,
    });

    const notifClient = await waitForNotification(CLIENT, (n) => n.title?.startsWith('Merci pour votre commande'));
    check('order_summary_client : notification déposée au client', Boolean(notifClient), JSON.stringify(notifClient));
    check('order_summary_client : les 2 articles apparaissent dans le message', Boolean(notifClient?.body?.includes('Burger Signature') && notifClient?.body?.includes('Frites maison')), notifClient?.body);
    check('order_summary_client : le total apparaît dans le message', Boolean(notifClient?.body?.includes('31,49')), notifClient?.body);

    const notifStaff = await waitForNotification(STAFF_UID, (n) => n.title?.startsWith('Récapitulatif de la commande'));
    check('order_summary_restaurant : notification déposée au commerce', Boolean(notifStaff), JSON.stringify(notifStaff));
    check('order_summary_restaurant : le nom du client apparaît dans le message', Boolean(notifStaff?.body?.includes('Nadia Example')), notifStaff?.body);
    check('order_summary_restaurant : l’adresse de livraison apparaît dans le message', Boolean(notifStaff?.body?.includes('2 rue Test')), notifStaff?.body);

    await sleep(3000); // laisse le temps aux écritures de notificationLogs (effet secondaire, pas attendu par waitForNotification).
    const clientLogs = await db.collection('notificationLogs').where('templateKey', '==', 'order_summary_client').get();
    const staffLogs = await db.collection('notificationLogs').where('templateKey', '==', 'order_summary_restaurant').get();
    const clientEmailLog = clientLogs.docs.find((d) => d.get('recipientId') === CLIENT);
    const staffEmailLog = staffLogs.docs.find((d) => d.get('recipientId') === STAFF_UID);
    check('notificationLogs : e-mail client tracé (queued, simulé — compte .test)', Boolean(clientEmailLog), clientEmailLog?.data());
    check('notificationLogs : e-mail commerce tracé (queued, simulé — compte .test)', Boolean(staffEmailLog), staffEmailLog?.data());
  } finally {
    const events = await db.collection(`orders/${ORDER}/events`).get().catch(() => ({ docs: [] }));
    await Promise.all(events.docs.map((d) => d.ref.delete().catch(() => {})));
    for (const uid of [CLIENT, STAFF_UID]) {
      const notifs = await db.collection(`users/${uid}/notifications`).get().catch(() => ({ docs: [] }));
      await Promise.all(notifs.docs.map((d) => d.ref.delete().catch(() => {})));
    }
    const logs = await db.collection('notificationLogs').where('recipientId', 'in', [CLIENT, STAFF_UID]).get().catch(() => ({ docs: [] }));
    await Promise.all(logs.docs.map((d) => d.ref.delete().catch(() => {})));
    await Promise.all([`orders/${ORDER}`, `restaurants/${RES}/members/${STAFF_UID}`, `restaurants/${RES}`].map((p) => db.doc(p).delete().catch(() => {})));
    await Promise.all([CLIENT, STAFF_UID].map((uid) => Promise.all([`users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {}))).then(() => auth.deleteUser(uid).catch(() => {}))));
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
