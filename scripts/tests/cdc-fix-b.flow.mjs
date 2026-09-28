// Test réel des automatismes décidés par le client (tâche cdc-fix-b), sur la base golink-9f16d :
// messages automatiques (simulation), avoir de retard, client absent (manuel et automatique),
// produit indisponible (remplacement, retrait, expiration, dernier article), réclamation avec photo,
// validation automatique des commerces, inactivité, fermeture d'urgence, anomalies.
//
// Le script joue le rôle du client et du livreur (comptes de simulation existants, mot de passe
// aléatoire posé par le script) et des agents (comptes de test). Toutes les données créées portent
// `test: true` et l'identifiant `cdcb-…` ; elles sont supprimées à la fin.
//
//   node scripts/tests/cdc-fix-b.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp, FieldValue } from '@google-cloud/firestore';
import { auth, db, storage, STORAGE_BUCKET } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const CLIENT = 'sim-client-longwy-1';
const DRIVER = 'sim-driver-longwy-1';
const RESTAURANT = 'mina-kitchen';
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.now();
const ts = (ms) => Timestamp.fromMillis(Math.round(ms));

const results = [];
const only = process.argv.slice(2);
const created = { orders: [], restaurants: [], users: [], claims: [], tickets: [], files: [], products: [], payments: [] };

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 90_000, everyMs = 2500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(everyMs);
  }
}

// ------------------------------------------------------------------ Sessions et appels

const sessions = new Map();
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
/** Compte de simulation existant : un mot de passe aléatoire est posé (jamais affiché ni conservé). */
async function simSession(uid) {
  if (sessions.has(uid)) return sessions.get(uid);
  const user = await auth.getUser(uid);
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.updateUser(uid, { password });
  const token = await loginPassword(user.email, password);
  sessions.set(uid, token);
  return token;
}
async function accountSession(email) {
  if (sessions.has(email)) return sessions.get(email);
  const token = await loginPassword(email, passwordOf(email));
  sessions.set(email, token);
  return token;
}
async function call(token, name, data) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${FN_BASE}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body.result;
    const status = String(body.error?.status ?? res.status);
    if (attempt < 6 && (status === 'UNAVAILABLE' || res.status === 503 || res.status === 429)) {
      await sleep(6000 + attempt * 3000);
      continue;
    }
    const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
    error.status = status;
    throw error;
  }
}
async function expectError(name, promise, status, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = error.status === status && (!fragment || String(error.message).includes(fragment));
    record(name, ok, `${error.status} : ${error.message}`);
  }
}

// ------------------------------------------------------------------ Fabrique de commandes

const at = (offsetMs) => ts(Date.now() + offsetMs);
async function makePayment(id) {
  await db.collection('payments').doc(`pay-${id}`).set({
    countryId: 'FR', cityId: 'longwy', purpose: 'order', orderId: id, subscriptionId: null, invoiceId: null, payerType: 'client', payerId: CLIENT, restaurantId: RESTAURANT,
    method: 'card', amountCents: 3048, currency: 'EUR', status: 'paid', provider: 'stripe', providerIntentId: 'pi_seed_cdcb', providerChargeId: 'ch_seed_cdcb', feeCents: 0, attempts: 1, refundedCents: 0,
    seed: true, test: true, createdAt: at(0), updatedAt: at(0),
  });
  created.payments.push(`pay-${id}`);
}
function lineOf(lineId, productId, name, unit, qty = 1) {
  return { lineId, productId, name, imageUrl: null, unitPriceCents: unit, quantity: qty, options: [], optionsPriceCents: 0, totalCents: unit * qty, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null };
}
async function makeOrder(id, overrides = {}) {
  const items = overrides.items ?? [lineOf('l1', 'cdcb-p1', 'Test houmous', 750), lineOf('l2', 'cdcb-p2', 'Test kefta', 1750)];
  const subtotal = items.reduce((s, i) => s + i.totalCents, 0);
  const total = subtotal + 49 + 299 + 200;
  const status = overrides.status ?? 'preparing';
  const { timeline: tl, delivery: dl, amounts: am, flags: fl, ...rest } = overrides;
  const order = {
    number: `GL-T${id.slice(-4).toUpperCase()}`, countryId: 'FR', cityId: 'longwy', restaurantId: RESTAURANT, restaurantName: 'Mina Kitchen', restaurantGroupId: 'maison-haddad',
    customerId: CLIENT, customerName: 'Nora A.', customerPhoneMasked: null, status, fulfillment: 'delivery', items, itemsCount: items.length,
    amounts: { subtotalCents: subtotal, serviceFeeCents: 49, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 200, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [{ category: 'food', rateBps: 1000, ttcCents: subtotal, htCents: Math.round(subtotal / 1.1), vatCents: subtotal - Math.round(subtotal / 1.1) }], currency: 'EUR', ...(am ?? {}) },
    payment: { method: 'card', status: 'paid', paymentId: `pay-${id}`, label: null, paidAt: at(-30 * MIN) },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: null, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.5395, longitude: 5.7829 }, zoneId: 'longwy-centre', distanceMeters: 2500, deliveredBy: 'platform', driverId: DRIVER, driverName: 'Test L.', driverPhoneMasked: null, driverVehicle: 'scooter', promisedFrom: at(-30 * MIN), promisedTo: at(-20 * MIN), estimatedArrivalAt: at(-25 * MIN), proof: null, handoverCodeRequired: false, dispatchStatus: 'assigned', ...(dl ?? {}) },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-60 * MIN), new: at(-60 * MIN), accepted: at(-58 * MIN), preparing: at(-57 * MIN), assigned: at(-40 * MIN), ready: at(-35 * MIN), picked_up: at(-30 * MIN), ...(tl ?? {}) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false, ...(fl ?? {}) },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_android', appVersion: '1.4.0' }, driverId: DRIVER, searchKeywords: [id],
    restaurantSettlement: { grossCents: subtotal, discountFundedCents: 0, commissionBaseCents: subtotal, commissionBps: 1500, commissionHtCents: Math.round((subtotal * 0.15) / 1.2), commissionVatCents: Math.round(subtotal * 0.15) - Math.round((subtotal * 0.15) / 1.2), commissionTtcCents: Math.round(subtotal * 0.15), deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: subtotal - Math.round(subtotal * 0.15) },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-60 * MIN), updatedAt: at(-1 * MIN), test: true, seed: true,
    ...rest,
  };
  await makePayment(id);
  await db.collection('orders').doc(id).set(order);
  created.orders.push(id);
  return order;
}
const getOrder = async (id) => (await db.collection('orders').doc(id).get()).data();
async function makeProducts() {
  const products = db.collection('restaurants').doc(RESTAURANT).collection('products');
  const base = { sectionId: null, description: null, vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system' };
  for (const [id, name, price] of [['cdcb-p1', 'Test houmous', 750], ['cdcb-p2', 'Test kefta', 1750], ['cdcb-p3', 'Test chou-fleur', 1200], ['cdcb-p4', 'Test halloumi', 600]]) {
    await products.doc(id).set({ ...base, name, priceCents: price });
    created.products.push(id);
  }
}

// ------------------------------------------------------------------ Scénarios

const scenarios = {};

scenarios.messages = async () => {
  const id = 'cdcb-msg-1';
  await makeOrder(id, { status: 'new', payment: { method: 'card', status: 'authorized', paymentId: `pay-${id}`, label: null, paidAt: null }, timeline: { placedAt: at(-1 * MIN), new: at(-1 * MIN) }, delivery: { driverId: null, driverName: null, dispatchStatus: null }, driverId: null, acceptDeadline: at(10 * MIN) });
  const staff = await until(async () => {
    const s = await db.collection('users').doc('test-manager-mina').collection('notifications').doc(`restaurant_new_order-${id}`).get();
    return s.exists ? s.data() : null;
  }, 60_000);
  check('Message « nouvelle commande » remis à l’équipe du commerce', staff && staff.title === 'Nouvelle commande', staff ? staff.body : 'absent');
  const logs = await db.collection('notificationLogs').where('templateKey', '==', 'restaurant_new_order').where('recipientId', '==', 'test-manager-mina').get();
  check('Envoi journalisé en simulation (push préparé, non transmis)', logs.docs.some((d) => d.get('status') === 'queued' && String(d.get('error')).includes('simulation')), `${logs.size} entrée(s)`);
  await db.collection('orders').doc(id).update({ status: 'preparing', 'timeline.accepted': at(0), 'timeline.preparing': at(0), acceptDeadline: null, updatedAt: at(0) });
  const confirmed = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`order_confirmed-${id}`).get()).exists, 60_000);
  check('Message « commande confirmée » remis au client', confirmed);
  await db.collection('orders').doc(id).update({ status: 'picked_up', 'timeline.picked_up': at(0), 'delivery.driverName': 'Test L.', updatedAt: at(0) });
  const picked = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`order_picked_up-${id}`).get()).data(), 60_000);
  check('Message « livreur en route » avec le nom du livreur', picked && picked.body.includes('Test L.'), picked?.body);
  await db.collection('orders').doc(id).update({ status: 'cancelled', cancellation: { reason: 'restaurant_closed', details: 'test', by: 'restaurant', byUid: null, at: at(0), refundCents: 1200, restaurantChargeCents: 1200 }, updatedAt: at(0) });
  const cancelled = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`order_cancelled-${id}`).get()).data(), 60_000);
  check('Message « commande annulée » avec motif et montant', cancelled && cancelled.body.includes('12,00'), cancelled?.body);
  const emailLog = await db.collection('notificationLogs').where('templateKey', '==', 'order_cancelled').where('recipientId', '==', CLIENT).get();
  check('E-mail d’annulation préparé mais non transmis (adresse .test, simulation)', emailLog.docs.some((d) => d.get('channel') === 'email' && d.get('status') === 'queued'), `${emailLog.size} entrée(s)`);
  // Idempotence : réécrire la même commande ne remet pas le message une seconde fois.
  const before = (await db.collection('notificationLogs').where('templateKey', '==', 'order_cancelled').where('recipientId', '==', CLIENT).get()).size;
  await db.collection('orders').doc(id).update({ 'flags.disputed': true, updatedAt: at(0) });
  await sleep(6000);
  const after = (await db.collection('notificationLogs').where('templateKey', '==', 'order_cancelled').where('recipientId', '==', CLIENT).get()).size;
  check('Aucun doublon de message sur une nouvelle écriture', after === before, `${before} → ${after}`);
};

scenarios.latecredit = async () => {
  const id = 'cdcb-late-1';
  const before = ((await db.collection('users').doc(CLIENT).get()).get('walletBalanceCents') ?? 0);
  await makeOrder(id, { status: 'picked_up', delivery: { promisedFrom: at(-55 * MIN), promisedTo: at(-45 * MIN) } });
  const token = await simSession(DRIVER);
  const done = await call(token, 'completeOrder', { orderId: id });
  check('Livraison en retard clôturée par le livreur', done.status === 'delivered');
  const wallet = await until(async () => (await db.collection('walletTransactions').doc(`lc-${id}`).get()).data(), 60_000);
  const order = await getOrder(id);
  const expected = Math.min(Math.round(((order.amounts.totalCents - order.amounts.tipCents) * 3000) / 10000), 1500);
  check('Avoir de retard crédité au palier réglé', wallet && wallet.amountCents === expected && wallet.reason === 'late_delivery', wallet ? `${wallet.amountCents} c (attendu ${expected} c, retard ${order.flags.lateMinutes} min)` : 'absent');
  const after = (await db.collection('users').doc(CLIENT).get()).get('walletBalanceCents');
  check('Solde du porte-monnaie augmenté', after === before + expected, `${before} → ${after}`);
  const ledgers = await db.collection('ledgerEntries').where('orderId', '==', id).get();
  const charge = ledgers.docs.find((d) => d.id === `lc-${id}-r`);
  check('Avoir imputé au commerce (décision client)', charge && charge.get('amountCents') === -expected, charge ? `${charge.get('amountCents')} c` : 'absent');
  const notif = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`late_credit_issued-${id}`).get()).data(), 30_000);
  check('Message « avoir de retard » remis', notif && notif.body.includes('minutes de retard'), notif?.body);
  const audit = await db.collection('auditLogs').where('action', '==', 'wallet.late_credit_issued').where('target.id', '==', id).get();
  check('Audit système de l’avoir', audit.size === 1 && audit.docs[0].get('actor.type') === 'system');
  const event = (await db.collection('orders').doc(id).collection('events').where('type', '==', 'credit_issued').get()).size;
  check('Événement « avoir accordé » dans la chronologie', event === 1);
  // Rejouer le déclencheur ne double pas l'avoir.
  await db.collection('orders').doc(id).update({ 'flags.disputed': false, updatedAt: at(0) });
  await sleep(5000);
  check('Avoir jamais doublé', (await db.collection('walletTransactions').where('orderId', '==', id).get()).size === 1);
  // Commande peu en retard : aucun avoir.
  const id2 = 'cdcb-late-2';
  await makeOrder(id2, { status: 'picked_up', delivery: { promisedFrom: at(-15 * MIN), promisedTo: at(-5 * MIN) } });
  await call(token, 'completeOrder', { orderId: id2 });
  await sleep(8000);
  check('Petit retard : pas d’avoir', !(await db.collection('walletTransactions').doc(`lc-${id2}`).get()).exists && (await getOrder(id2)).processed?.lateCreditDone === true);
};

scenarios.absent = async () => {
  const token = await simSession(DRIVER);
  const id = 'cdcb-absent-1';
  await makeOrder(id, { status: 'picked_up' });
  const arrived = await call(token, 'markDriverArrived', { orderId: id });
  check('Arrivée signalée : attente de 10 minutes démarrée', arrived.waitUntil - arrived.arrivedAt === 10 * MIN, `${(arrived.waitUntil - arrived.arrivedAt) / MIN} min`);
  await expectError('Clôture refusée tant que l’attente n’est pas écoulée', call(token, 'closeCustomerAbsent', { orderId: id }), 'FAILED_PRECONDITION', 'Patientez');
  await db.collection('orders').doc(id).update({ 'customerAbsence.waitUntil': at(-1 * MIN) });
  await expectError('Clôture refusée sans appel du client', call(token, 'closeCustomerAbsent', { orderId: id }), 'FAILED_PRECONDITION', 'Appelez le client');
  const called = await call(token, 'logCustomerCall', { orderId: id });
  check('Appel du client consigné', called.calls === 1);
  const closed = await call(token, 'closeCustomerAbsent', { orderId: id });
  check('Commande clôturée « client absent » sans remboursement', closed.closedAs === 'customer_absent' && closed.refundedCents === 0);
  const order = await getOrder(id);
  check('Statut, clôture et compteurs posés', order.status === 'delivered' && order.closedAs === 'customer_absent' && order.customerAbsence.closedBy === 'driver' && order.amounts.refundedCents === 0);
  const fin = await until(async () => (await db.collection('orderFinancials').doc(id).get()).exists, 60_000);
  check('Comptabilisation déclenchée (règlement du commerce et du livreur)', fin);
  const ledgers = (await db.collection('ledgerEntries').where('orderId', '==', id).get()).docs.map((d) => `${d.get('accountType')}:${d.get('type')}`);
  check('Commerce et livreur payés normalement', ledgers.includes('restaurant:order_revenue') && ledgers.includes('driver:courier_earning'), ledgers.join(', '));
  check('Aucun remboursement créé', (await db.collection('refunds').where('orderId', '==', id).get()).empty);
  const notif = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`order_customer_absent-${id}`).get()).data(), 60_000);
  check('Message « client absent » remis au client', notif && notif.body.includes('10 minutes'), notif?.body);
  await expectError('Un autre livreur ne peut pas clôturer', call(await simSession('sim-driver-longwy-2'), 'closeCustomerAbsent', { orderId: id }), 'PERMISSION_DENIED');

  // Clôture automatique par la plateforme (livreur inactif au-delà du délai de grâce).
  const id2 = 'cdcb-absent-2';
  await makeOrder(id2, { status: 'picked_up', customerAbsence: { arrivedAt: at(-40 * MIN), waitUntil: at(-30 * MIN), calls: 0, lastCallAt: null, closedAt: null, closedBy: null, payDriver: true, payRestaurant: true } });
  const auto = await until(async () => {
    const o = await getOrder(id2);
    return o.closedAs === 'customer_absent' ? o : null;
  }, 150_000, 5000);
  check('Clôture automatique par la tâche planifiée', auto && auto.customerAbsence.closedBy === 'system', auto ? 'closedBy=system' : 'non clôturée');
};

scenarios.items = async () => {
  const staff = await accountSession('sofia.martin@golink.test');
  const client = await simSession(CLIENT);
  const id = 'cdcb-item-1';
  await makeOrder(id);
  const proposed = await call(staff, 'reportItemUnavailable', { orderId: id, lineId: 'l1', replacementProductId: 'cdcb-p3' });
  check('Remplacement proposé au client', proposed.status === 'proposed' && proposed.expiresAt - Date.now() > 170_000, `expire dans ${Math.round((proposed.expiresAt - Date.now()) / 60_000)} min`);
  const order = await getOrder(id);
  check('Proposition posée sur la commande avec échéance', order.itemProposals?.l1?.status === 'pending' && order.proposalDeadline);
  await expectError('Commande non marquable prête tant que le client n’a pas répondu', call(staff, 'markOrderReady', { orderId: id }), 'FAILED_PRECONDITION', 'remplacement');
  const notif = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`item_replacement_proposed-${id}-l1`).get()).data(), 60_000);
  check('Message de proposition remis au client', notif && notif.body.includes('Test chou-fleur'), notif?.body);
  await expectError('Un autre client ne peut pas répondre', call(await simSession('sim-client-longwy-2'), 'respondToItemProposal', { orderId: id, lineId: 'l1', accept: true }), 'PERMISSION_DENIED');
  const accepted = await call(client, 'respondToItemProposal', { orderId: id, lineId: 'l1', accept: true });
  const afterAccept = await getOrder(id);
  check('Remplacement accepté : prix plafonné à l’article d’origine, sans remboursement', accepted.status === 'replaced' && afterAccept.items[0].finalTotalCents === 750 && accepted.refundCents === 0 && afterAccept.items[0].adjustment.type === 'replaced');

  // Retrait immédiat de la seconde ligne : remboursement partiel.
  const removed = await call(staff, 'reportItemUnavailable', { orderId: id, lineId: 'l2' });
  check('Retrait sans remplacement : article remboursé', removed.status === 'removed' && removed.refundCents === 1750, `${removed.refundCents} c`);
  const refund = (await db.collection('refunds').doc(`rf-${id}-item-l2`).get()).data();
  check('Remboursement partiel automatique imputé au commerce', refund && refund.status === 'processed' && refund.allocation.restaurantCents === 1750 && refund.cause === 'item_unavailable', refund ? `${refund.status}, commerce ${refund.allocation.restaurantCents} c` : 'absent');
  const afterRemoval = await getOrder(id);
  check('Montant remboursé et commission recalculée', afterRemoval.amounts.refundedCents === 1750 && afterRemoval.restaurantSettlement.commissionBaseCents === 750, `commission sur ${afterRemoval.restaurantSettlement.commissionBaseCents} c`);
  const product = (await db.collection('restaurants').doc(RESTAURANT).collection('products').doc('cdcb-p2').get()).data();
  check('Produit retiré de la vente', product.available === false);
  const msg = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`item_removed-${id}-l2`).get()).exists, 60_000);
  check('Message « article retiré » remis', msg);
  await expectError('Article déjà traité refusé', call(staff, 'reportItemUnavailable', { orderId: id, lineId: 'l2' }), 'FAILED_PRECONDITION');

  // Livraison : la part imputée du remboursement est retenue à la comptabilisation (rejeu).
  await db.collection('orders').doc(id).update({ status: 'picked_up', 'timeline.picked_up': at(0), 'delivery.promisedTo': at(20 * MIN), updatedAt: at(0) });
  await call(await simSession(DRIVER), 'completeOrder', { orderId: id });
  const booked = await until(async () => (await db.collection('ledgerEntries').doc(`rf-rf-${id}-item-l2-rb`).get()).data(), 90_000);
  check('Imputation du remboursement rejouée à la comptabilisation de la commande', booked && booked.amountCents === -1750, booked ? `${booked.amountCents} c au commerce` : 'absente');

  // Refus du remplacement par le client.
  const id2 = 'cdcb-item-2';
  await makeOrder(id2);
  await call(staff, 'reportItemUnavailable', { orderId: id2, lineId: 'l1', replacementProductId: 'cdcb-p4' });
  const declined = await call(client, 'respondToItemProposal', { orderId: id2, lineId: 'l1', accept: false });
  check('Remplacement refusé : article retiré et remboursé', declined.status === 'removed' && declined.refundCents === 750);

  // Sans réponse : retrait automatique par la tâche planifiée.
  const id3 = 'cdcb-item-3';
  await makeOrder(id3);
  await call(staff, 'reportItemUnavailable', { orderId: id3, lineId: 'l1', replacementProductId: 'cdcb-p4' });
  await db.collection('orders').doc(id3).update({ 'itemProposals.l1.expiresAt': at(-1 * MIN), proposalDeadline: at(-1 * MIN) });
  const auto = await until(async () => {
    const o = await getOrder(id3);
    return o.items[0].adjustment?.type === 'removed' ? o : null;
  }, 150_000, 5000);
  check('Sans réponse du client : article retiré automatiquement', auto && auto.itemProposals.l1.status === 'declined', auto ? `remboursé ${auto.amounts.refundedCents} c` : 'non traité');

  // Dernier article : la commande est annulée.
  const id4 = 'cdcb-item-4';
  await makeOrder(id4, { items: [lineOf('l1', 'cdcb-p1', 'Test houmous', 750)] });
  const last = await call(staff, 'reportItemUnavailable', { orderId: id4, lineId: 'l1' });
  const o4 = await getOrder(id4);
  check('Dernier article indisponible : commande annulée et remboursée', last.status === 'order_cancelled' && o4.status === 'cancelled' && o4.cancellation.reason === 'item_unavailable', `${o4.status}, ${o4.amounts.refundedCents} c`);
};

function jpeg({ width, height, takenAtMs, salt }) {
  // JPEG minimal (SOI, EXIF avec date de prise de vue, SOF0, EOI) : suffisant pour les contrôles serveur.
  const d = new Date(takenAtMs);
  const p = (n) => String(n).padStart(2, '0');
  const local = new Date(takenAtMs + (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).format(d).match(/GMT([+-]\d+)/)?.[1] ?? 0) * 3_600_000);
  const stamp = `${local.getUTCFullYear()}:${p(local.getUTCMonth() + 1)}:${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}\0`;
  const dateBytes = Buffer.from(stamp, 'latin1');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + dateBytes.length);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // IFD0 : 1 entrée = pointeur EXIF
  tiff.writeUInt16BE(0x8769, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(26, 18);
  tiff.writeUInt32BE(0, 22);
  tiff.writeUInt16BE(1, 26); // IFD EXIF : DateTimeOriginal
  tiff.writeUInt16BE(0x9003, 28);
  tiff.writeUInt16BE(2, 30);
  tiff.writeUInt32BE(dateBytes.length, 32);
  tiff.writeUInt32BE(44, 36);
  tiff.writeUInt32BE(0, 40);
  dateBytes.copy(tiff, 44);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  const salted = Buffer.from(`\xff\xfe\x00${String.fromCharCode(salt.length + 2)}${salt}`, 'latin1');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, salted, sof, Buffer.from([0xff, 0xd9])]);
}
async function upload(name, buffer) {
  const path = `claims/${CLIENT}/${name}`;
  await storage.bucket(STORAGE_BUCKET).file(path).save(buffer, { contentType: 'image/jpeg', resumable: false });
  created.files.push(path);
  return path;
}

scenarios.claims = async () => {
  const client = await simSession(CLIENT);
  const support = await accountSession('support@golink.test');
  const idA = 'cdcb-claim-a';
  const idB = 'cdcb-claim-b';
  const idOld = 'cdcb-claim-old';
  await makeOrder(idA, { status: 'delivered', timeline: { delivered: at(-30 * MIN) } });
  await makeOrder(idB, { status: 'delivered', timeline: { delivered: at(-30 * MIN) } });
  await makeOrder(idOld, { status: 'delivered', timeline: { delivered: at(-60 * 3_600_000) } });

  await expectError('Réclamation sans photo refusée (photo obligatoire)', call(client, 'submitOrderClaim', { orderId: idA, type: 'missing_item', lineIds: ['l1'], description: 'Le houmous manquait dans le sac.', photoPaths: [] }), 'FAILED_PRECONDITION', 'obligatoire');
  const good = await upload('cdcb-good.jpg', jpeg({ width: 1200, height: 900, takenAtMs: Date.now() - 5 * MIN, salt: 'good' }));
  const first = await call(client, 'submitOrderClaim', { orderId: idA, type: 'missing_item', lineIds: ['l1'], description: 'Le houmous manquait dans le sac.', photoPaths: [good] });
  created.claims.push(first.claimId);
  if (first.ticketId) created.tickets.push(first.ticketId);
  check('Réclamation propre : contrôles réussis et ticket ouvert', first.verdict === 'clean' && first.status === 'pending_review' && first.ticketId, `verdict ${first.verdict}, ticket ${first.ticketNumber}`);
  check('Contrôle de la date de prise de vue lu dans la photo', first.checks.some((c) => c.code === 'photo_date' && c.ok && c.detail.includes('cohérente')), first.checks.find((c) => c.code === 'photo_date')?.detail);
  const twice = await call(client, 'submitOrderClaim', { orderId: idA, type: 'missing_item', lineIds: ['l1'], description: 'Toujours pas de houmous.', photoPaths: [await upload('cdcb-good2.jpg', jpeg({ width: 1200, height: 900, takenAtMs: Date.now() - 4 * MIN, salt: 'good2' }))] });
  created.claims.push(twice.claimId);
  check('Même article réclamé deux fois : refus automatique', twice.verdict === 'rejected' && twice.checks.some((c) => c.code === 'already_claimed' && !c.ok), twice.checks.find((c) => c.code === 'already_claimed')?.detail);

  // Même photo réutilisée sur une autre commande : signalée.
  const dup = await call(client, 'submitOrderClaim', { orderId: idB, type: 'damaged_item', lineIds: ['l2'], description: 'Le kefta est arrivé abîmé.', photoPaths: [good] });
  created.claims.push(dup.claimId);
  if (dup.ticketId) created.tickets.push(dup.ticketId);
  check('Photo déjà utilisée ailleurs : dossier signalé « à vérifier »', dup.verdict === 'suspect' && dup.checks.some((c) => c.code === 'photo_duplicate_other' && !c.ok), dup.checks.find((c) => c.code === 'photo_duplicate_other')?.detail);

  // Photo prise avant la livraison.
  const old = await upload('cdcb-old.jpg', jpeg({ width: 1000, height: 800, takenAtMs: Date.now() - 3 * DAY, salt: 'old' }));
  const idC = 'cdcb-claim-c';
  await makeOrder(idC, { status: 'delivered', timeline: { delivered: at(-30 * MIN) } });
  const early = await call(client, 'submitOrderClaim', { orderId: idC, type: 'quality', lineIds: [], description: 'Le plat était froid à la livraison.', photoPaths: [old] });
  created.claims.push(early.claimId);
  if (early.ticketId) created.tickets.push(early.ticketId);
  check('Photo prise avant la livraison : signalée', early.verdict === 'suspect' && early.checks.some((c) => c.code === 'photo_date' && !c.ok), early.checks.find((c) => c.code === 'photo_date')?.detail);

  // Délai dépassé : refus automatique.
  const late = await upload('cdcb-late.jpg', jpeg({ width: 1000, height: 800, takenAtMs: Date.now() - 2 * MIN, salt: 'late' }));
  const expired = await call(client, 'submitOrderClaim', { orderId: idOld, type: 'missing_item', lineIds: ['l1'], description: 'Article manquant signalé trop tard.', photoPaths: [late] });
  created.claims.push(expired.claimId);
  check('Hors délai : refus automatique enregistré', expired.verdict === 'rejected' && expired.status === 'rejected' && !expired.ticketId, expired.checks.find((c) => c.code === 'window')?.detail);

  // Décision de l'agent.
  await expectError('Un client ne peut pas décider', call(client, 'decideOrderClaim', { claimId: first.claimId, decision: 'accept', reason: 'test' }), 'PERMISSION_DENIED');
  await expectError('Un commercial sans droit de remboursement ne peut pas décider', call(await accountSession('commercial@golink.test'), 'decideOrderClaim', { claimId: first.claimId, decision: 'accept', reason: 'test' }), 'PERMISSION_DENIED');
  const accepted = await call(support, 'decideOrderClaim', { claimId: first.claimId, decision: 'accept', reason: 'Photo cohérente avec la commande.' });
  check('Réclamation acceptée par l’agent : remboursement de l’article', accepted.status === 'accepted' && accepted.refundedCents === 750, `${accepted.refundedCents} c`);
  const refund = (await db.collection('refunds').doc(`rf-${idA}-claim-${first.claimId}`).get()).data();
  check('Remboursement imputé au commerce (cause « article manquant »)', refund && refund.cause === 'missing_item' && refund.allocation.restaurantCents === 750 && refund.status === 'processed');
  const ticket = (await db.collection('supportTickets').doc(first.ticketId).get()).data();
  check('Ticket résolu avec le geste consigné', ticket.status === 'resolved' && ticket.compensationCents === 750 && ticket.claimId === first.claimId);
  const rejected = await call(support, 'decideOrderClaim', { claimId: dup.claimId, decision: 'reject', reason: 'La photo a déjà servi pour une autre commande.' });
  check('Réclamation refusée avec motif', rejected.status === 'rejected');
  const decided = await until(async () => (await db.collection('users').doc(CLIENT).collection('notifications').doc(`claim_decided-${dup.claimId}-rejected`.slice(0, 200)).get()).data(), 60_000);
  check('Le client reçoit le motif du refus', decided && decided.body.includes('déjà servi'), decided?.body);
  await expectError('Décision déjà prise refusée', call(support, 'decideOrderClaim', { claimId: first.claimId, decision: 'accept', reason: 'doublon' }), 'FAILED_PRECONDITION');
};

async function seedDemoRestaurant(id, opts = {}) {
  const owner = `cdcb-owner-${id}`;
  await db.collection('users').doc(owner).set({ role: 'restaurant', firstName: 'Test', lastName: 'Gérant', displayName: 'Test Gérant', email: `${owner}@golink.test`, status: 'active', locale: 'fr', seed: true, test: true, createdAt: at(0), updatedAt: at(0) });
  created.users.push(owner);
  const r = db.collection('restaurants').doc(id);
  await r.set({
    name: `Test ${id}`, slug: id, ownerId: owner, countryId: 'FR', cityId: 'metz', zoneIds: [], address: { line1: '1 rue Test', postalCode: '57000', city: 'Metz', countryCode: 'FR' }, phone: '+33 6 00 00 00 00', email: `${owner}@golink.test`,
    cuisineIds: [], tags: [], priceLevel: 2, photos: [], accent: '#000', mark: 'T', status: opts.status ?? 'onboarding', onboardingStatus: opts.onboardingStatus ?? 'pending', isOpen: false, acceptingOrders: false, busyExtraMinutes: 0, fulfillmentModes: ['delivery'], deliveredBy: 'platform', minOrderCents: 0,
    prepMinutes: 15, etaMinutes: { min: 15, max: 25 }, rating: { average: 0, count: 0 }, planCode: 'basic', sponsored: false, rankingScore: 0, qualityScore: 100, allergensComplete: false, sellsAlcohol: false, acceptedPaymentMethods: ['card'], ordersCount: 0, searchKeywords: [id], deletedAt: null,
    seed: true, test: true, createdAt: at(-90 * DAY), updatedAt: at(0), createdBy: 'system', updatedBy: 'system', ...(opts.fields ?? {}),
  });
  await r.collection('members').doc(owner).set({ userId: owner, restaurantId: id, displayName: 'Test Gérant', email: `${owner}@golink.test`, role: 'owner', permissions: [], active: true, seed: true, createdAt: at(0), updatedAt: at(0) });
  await r.collection('private').doc('legal').set({ legalName: 'Test SAS', siret: opts.siret ?? '73282932000074', registeredAddress: { line1: '1 rue Test', postalCode: '57000', city: 'Metz', countryCode: 'FR' }, managerName: 'Test Gérant', managerEmail: `${owner}@golink.test`, managerPhone: '+33600000000', dac7Complete: false, partnerTermsVersion: '2026-06', partnerTermsAcceptedAt: opts.contract === false ? null : at(-1 * DAY), updatedAt: at(0), seed: true });
  created.restaurants.push(id);
  return owner;
}
async function addDocument(restaurantId, type, extra = {}) {
  const path = `restaurants/${restaurantId}/private/documents/${type}-${Date.now()}.pdf`;
  await storage.bucket(STORAGE_BUCKET).file(path).save(Buffer.from('%PDF-1.4 test cdcb'), { contentType: 'application/pdf', resumable: false });
  created.files.push(path);
  const ref = db.collection('partnerDocuments').doc();
  await ref.set({ ownerType: 'restaurant', ownerId: restaurantId, countryId: 'FR', cityId: 'metz', type, file: { path, url: null, contentType: 'application/pdf', size: 18, name: `${type}.pdf`, uploadedAt: at(0), uploadedBy: 'system' }, status: 'pending', number: null, issuedAt: null, expiresAt: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, remindersSent: 0, lastReminderAt: null, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system', seed: true, test: true, ...extra });
  return ref.id;
}
const isoIn = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

scenarios.validation = async () => {
  const metz = await accountSession('metz@golink.test');
  const settingsRef = db.collection('settings').doc('merchantValidation');
  const original = (await settingsRef.get()).data();
  try {
    await settingsRef.set({ ...original, mode: 'auto' });
    // 1. Dossier complet et conforme : validation automatique au dépôt de la dernière pièce.
    const ok = 'cdcb-val-ok';
    await seedDemoRestaurant(ok);
    await addDocument(ok, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(ok, 'manager_id', { expiresAt: isoIn(700) });
    const last = await addDocument(ok, 'bank_details');
    const approved = await until(async () => {
      const s = (await db.collection('restaurants').doc(ok).get()).data();
      return s.onboardingStatus === 'approved' ? s : null;
    }, 90_000);
    check('Dossier conforme : validé et mis en ligne automatiquement', approved && approved.status === 'active' && approved.autoValidation?.decided === true, approved ? `${approved.onboardingStatus}/${approved.status}` : 'non validé');
    const docs = await db.collection('partnerDocuments').where('ownerId', '==', ok).get();
    check('Pièces validées par le système', docs.docs.every((d) => d.get('status') === 'approved' && d.get('reviewedBy') === 'system'));
    const audit = await db.collection('auditLogs').where('action', '==', 'restaurant.auto_approved').where('target.id', '==', ok).get();
    check('Audit système avec le détail des contrôles', audit.size === 1 && audit.docs[0].get('actor.type') === 'system' && String(audit.docs[0].get('reason')).includes('conforme'), audit.docs[0]?.get('reason')?.slice(0, 120));
    const message = await until(async () => (await db.collection('users').doc(`cdcb-owner-${ok}`).collection('notifications').doc(`restaurant_auto_approved-${ok}`).get()).data(), 30_000);
    check('Message « dossier validé » remis au gérant', message && message.body.includes('validé automatiquement'), message?.body);
    void last;

    // 2. Numéro d'immatriculation invalide : reste en validation manuelle, contrôles détaillés.
    const bad = 'cdcb-val-bad';
    await seedDemoRestaurant(bad, { siret: '73282932000075' });
    await addDocument(bad, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(bad, 'manager_id', { expiresAt: isoIn(700) });
    await addDocument(bad, 'bank_details');
    const notEligible = await until(async () => {
      const s = (await db.collection('restaurants').doc(bad).get()).data();
      return s.autoValidation ? s : null;
    }, 90_000);
    check('SIRET à clé incorrecte : pas de validation automatique', notEligible && notEligible.onboardingStatus === 'pending' && notEligible.autoValidation.eligible === false && notEligible.autoValidation.checks.some((c) => c.code === 'registration_number' && !c.ok), notEligible?.autoValidation?.checks.find((c) => !c.ok)?.detail);

    // 3. Pièce qui expire bientôt : refusée par le contrôle de validité.
    const soon = 'cdcb-val-soon';
    await seedDemoRestaurant(soon);
    await addDocument(soon, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(soon, 'manager_id', { expiresAt: isoIn(10) });
    await addDocument(soon, 'bank_details');
    const soonState = await until(async () => {
      const s = (await db.collection('restaurants').doc(soon).get()).data();
      return s.autoValidation ? s : null;
    }, 90_000);
    check('Pièce d’identité expirant sous 30 jours : dossier non validé', soonState && soonState.onboardingStatus === 'pending' && soonState.autoValidation.checks.some((c) => c.code === 'documents_valid' && !c.ok), soonState?.autoValidation?.checks.find((c) => c.code === 'documents_valid')?.detail);

    // 4. Contrat non accepté.
    const noContract = 'cdcb-val-contract';
    await seedDemoRestaurant(noContract, { contract: false });
    await addDocument(noContract, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(noContract, 'manager_id', { expiresAt: isoIn(700) });
    await addDocument(noContract, 'bank_details');
    const noContractState = await until(async () => (await db.collection('restaurants').doc(noContract).get()).data().autoValidation ?? null, 90_000);
    check('Contrat non accepté : dossier non validé', noContractState && noContractState.checks.some((c) => c.code === 'contract_accepted' && !c.ok));

    // 5. Mode « suggestion » : validable en un clic par un agent.
    await settingsRef.set({ ...original, mode: 'suggest' });
    const suggest = 'cdcb-val-suggest';
    await seedDemoRestaurant(suggest);
    await addDocument(suggest, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(suggest, 'manager_id', { expiresAt: isoIn(700) });
    await addDocument(suggest, 'bank_details');
    const suggested = await until(async () => (await db.collection('restaurants').doc(suggest).get()).data().autoValidation ?? null, 90_000);
    check('Mode suggestion : dossier conforme mais non validé seul', suggested && suggested.eligible === true && suggested.decided === false && (await db.collection('restaurants').doc(suggest).get()).get('onboardingStatus') === 'pending');
    const check1 = await call(metz, 'runMerchantValidationCheck', { restaurantId: suggest, apply: false });
    check('« Vérifier maintenant » sans validation en mode suggestion', check1.outcome === 'suggested');
    const applied = await call(metz, 'runMerchantValidationCheck', { restaurantId: suggest, apply: true });
    const afterApply = (await db.collection('restaurants').doc(suggest).get()).data();
    check('« Valider en un clic » par l’agent', applied.outcome === 'approved' && afterApply.onboardingStatus === 'approved');
    const agentAudit = await db.collection('auditLogs').where('action', '==', 'restaurant.auto_approved').where('target.id', '==', suggest).get();
    check('Audit attribué à l’agent', agentAudit.docs[0]?.get('actor.type') === 'admin');

    // 6. Mode désactivé : aucune validation.
    await settingsRef.set({ ...original, mode: 'off' });
    const off = 'cdcb-val-off';
    await seedDemoRestaurant(off);
    await addDocument(off, 'kbis', { issuedAt: isoIn(-20) });
    await addDocument(off, 'manager_id', { expiresAt: isoIn(700) });
    await addDocument(off, 'bank_details');
    await sleep(15_000);
    const offState = (await db.collection('restaurants').doc(off).get()).data();
    check('Règle désactivée : validation manuelle seule', offState.onboardingStatus === 'pending' && !offState.autoValidation);

    // Droits.
    await expectError('Réglage central refusé à un responsable de ville', call(metz, 'updateMerchantValidation', { ...original, mode: 'auto', reason: 'test' }), 'PERMISSION_DENIED');
    await expectError('Envoi réel des messages refusé au support', call(await accountSession('support@golink.test'), 'updateNotificationDelivery', { emailLive: true, smsLive: false, pushLive: false, reason: 'test' }), 'PERMISSION_DENIED');
  } finally {
    await settingsRef.set(original);
  }
};

scenarios.inactivity = async () => {
  const metz = await accountSession('metz@golink.test');
  const old = { launchedAt: at(-90 * DAY), lastOrderAt: at(-20 * DAY), inactivityDemo: true };
  const a = 'cdcb-inact-1';
  await seedDemoRestaurant(a, { status: 'active', onboardingStatus: 'approved', fields: { ...old, isOpen: true, acceptingOrders: true } });
  const r1 = await call(metz, 'runMerchantLifecycleNow', { restaurantId: a });
  const s1 = (await db.collection('restaurants').doc(a).get()).data();
  check('20 jours sans commande : alerte envoyée, retrait programmé', r1.alerted === 1 && s1.inactivityAlertAt && s1.inactivityRemovalDueAt, `alerte le ${s1.inactivityAlertAt?.toDate().toISOString().slice(0, 10)}, retrait le ${s1.inactivityRemovalDueAt?.toDate().toISOString().slice(0, 10)}`);
  const mail = await until(async () => (await db.collection('users').doc(`cdcb-owner-${a}`).collection('notifications').get()).docs.find((d) => d.id.startsWith('restaurant_inactivity_warning'))?.data(), 30_000);
  check('E-mail d’alerte d’inactivité remis (gabarit modifiable)', mail && mail.title.includes('20 jours') && mail.body.includes('retiré de Ciyou Eats'), mail?.body?.slice(0, 160));
  const log = await db.collection('notificationLogs').where('templateKey', '==', 'restaurant_inactivity_warning').where('recipientId', '==', `cdcb-owner-${a}`).get();
  check('Envoi e-mail journalisé en simulation', log.docs.some((d) => d.get('channel') === 'email' && d.get('status') === 'queued'));
  const r2 = await call(metz, 'runMerchantLifecycleNow', { restaurantId: a });
  check('Aucune seconde alerte ni retrait prématuré', r2.alerted === 0 && r2.removed === 0);
  await db.collection('restaurants').doc(a).update({ inactivityAlertAt: at(-31 * DAY), inactivityRemovalDueAt: at(-1 * DAY), lastOrderAt: at(-50 * DAY) });
  const r3 = await call(metz, 'runMerchantLifecycleNow', { restaurantId: a });
  const s3 = (await db.collection('restaurants').doc(a).get()).data();
  check('30 jours après l’alerte : commerce retiré (désactivé, corbeille)', r3.removed === 1 && s3.status === 'closed' && s3.deletedAt && s3.isOpen === false, `${s3.status}`);
  const trash = await db.collection('trash').where('entity.id', '==', a).get();
  check('Copie placée dans la corbeille (restaurable)', trash.size === 1 && trash.docs[0].get('deletedBy') === 'system');
  const audit = await db.collection('auditLogs').where('action', '==', 'restaurant.removed_inactive').where('target.id', '==', a).get();
  check('Audit sensible du retrait avec motif', audit.size === 1 && audit.docs[0].get('sensitive') === true && String(audit.docs[0].get('reason')).includes('jours'));

  // Une commande arrivée depuis l'alerte remet le compteur à zéro.
  const b = 'cdcb-inact-2';
  await seedDemoRestaurant(b, { status: 'active', onboardingStatus: 'approved', fields: { ...old, inactivityAlertAt: at(-10 * DAY), inactivityRemovalDueAt: at(20 * DAY), lastOrderAt: at(-2 * DAY), isOpen: true } });
  const r4 = await call(metz, 'runMerchantLifecycleNow', { restaurantId: b });
  const s4 = (await db.collection('restaurants').doc(b).get()).data();
  check('Commande reçue depuis l’alerte : compteur remis à zéro', r4.reset === 1 && !s4.inactivityAlertAt && s4.status === 'active');

  // Un commerce de démonstration non marqué n'est jamais retiré.
  const c = 'cdcb-inact-3';
  await seedDemoRestaurant(c, { status: 'active', onboardingStatus: 'approved', fields: { launchedAt: at(-90 * DAY), lastOrderAt: at(-60 * DAY), isOpen: true } });
  const r5 = await call(metz, 'runMerchantLifecycleNow', { restaurantId: c });
  check('Commerce de démonstration protégé (jamais alerté ni retiré)', r5.alerted === 0 && r5.removed === 0 && (await db.collection('restaurants').doc(c).get()).get('status') === 'active');
  await expectError('Contrôle global refusé à un responsable de ville', call(metz, 'runMerchantLifecycleNow', {}), 'PERMISSION_DENIED');
};

scenarios.closure = async () => {
  const metz = await accountSession('metz@golink.test');
  const zones = await db.collection('zones').where('cityId', '==', 'metz').where('active', '==', true).limit(1).get();
  const zone = zones.docs[0];
  if (!zone) return record('Zone de Metz introuvable', false);
  const id = 'cdcb-closure-1';
  await makeOrder(id, { cityId: 'metz', customerId: 'sim-client-metz-1', status: 'preparing', delivery: { zoneId: zone.id, driverId: null, driverName: null } });
  const result = await call(metz, 'closeZone', { scope: 'zone', id: zone.id, close: true, reason: 'weather', message: 'Livraison suspendue : intempéries.', messageEn: 'Delivery suspended: bad weather.', messageAr: 'التوصيل متوقف بسبب سوء الأحوال الجوية.', endsAt: Date.now() + 60 * MIN, note: 'Test automatisé des fermetures d’urgence' });
  try {
    const stored = (await db.collection('zones').doc(zone.id).get()).data().emergencyClosure;
    check('Message de fermeture enregistré en français, anglais et arabe', stored.message.fr && stored.message.en && stored.message.ar, JSON.stringify(stored.message).slice(0, 80));
    check('Clients ayant une commande en cours prévenus', result.notified >= 1, `${result.notified} client(s)`);
    const notif = await until(async () => (await db.collection('users').doc('sim-client-metz-1').collection('notifications').get()).docs.find((d) => d.id.startsWith('zone_emergency_closure'))?.data(), 60_000);
    check('Notification de fermeture remise au client', notif && notif.body.includes('intempéries'), notif?.body);
  } finally {
    await call(metz, 'closeZone', { scope: 'zone', id: zone.id, close: false, note: 'Fin du test automatisé' });
  }
  check('Zone rouverte', !(await db.collection('zones').doc(zone.id).get()).data().emergencyClosure);
};

scenarios.anomalies = async () => {
  const support = await accountSession('support@golink.test');
  const result = await call(support, 'getOrderAnomalies', { days: 30 });
  const labels = result.hours.map((h) => h.label);
  check('Anomalies par heure : créneaux lisibles (plus de « NaN h »)', labels.length > 1 && labels.every((l) => !l.includes('NaN')), labels.slice(0, 4).join(' | '));
};

// ------------------------------------------------------------------ Nettoyage

async function deleteCollectionDocs(query) {
  const snap = await query.get();
  for (const d of snap.docs) await db.recursiveDelete(d.ref);
}
async function cleanup() {
  console.log('\nNettoyage des données de test…');
  const clientBefore = (await db.collection('users').doc(CLIENT).get()).data();
  for (const id of created.orders) {
    await db.recursiveDelete(db.collection('orders').doc(id));
    await db.collection('orderFinancials').doc(id).delete().catch(() => undefined);
    await deleteCollectionDocs(db.collection('ledgerEntries').where('orderId', '==', id));
    await deleteCollectionDocs(db.collection('refunds').where('orderId', '==', id));
    await deleteCollectionDocs(db.collection('walletTransactions').where('orderId', '==', id));
    await deleteCollectionDocs(db.collection('invoices').where('orderId', '==', id));
    await deleteCollectionDocs(db.collection('orderClaims').where('orderId', '==', id));
    await deleteCollectionDocs(db.collection('supportTickets').where('orderId', '==', id));
  }
  for (const id of created.payments) await db.collection('payments').doc(id).delete().catch(() => undefined);
  for (const id of created.claims) await db.collection('orderClaims').doc(id).delete().catch(() => undefined);
  for (const id of created.tickets) await db.recursiveDelete(db.collection('supportTickets').doc(id)).catch(() => undefined);
  for (const id of created.products) await db.collection('restaurants').doc(RESTAURANT).collection('products').doc(id).delete().catch(() => undefined);
  for (const id of created.restaurants) {
    await db.recursiveDelete(db.collection('restaurants').doc(id));
    await deleteCollectionDocs(db.collection('partnerDocuments').where('ownerId', '==', id));
    await deleteCollectionDocs(db.collection('trash').where('entity.id', '==', id));
    await deleteCollectionDocs(db.collection('platformAlerts').where('target.id', '==', id));
  }
  for (const id of created.users) await db.recursiveDelete(db.collection('users').doc(id));
  for (const path of created.files) await storage.bucket(STORAGE_BUCKET).file(path).delete().catch(() => undefined);
  // Notifications et journaux d'envoi générés pour les comptes de test pendant l'exécution.
  const since = ts(T0 - 60_000);
  for (const uid of [CLIENT, 'sim-client-metz-1', 'test-manager-mina', 'test-owner-haddad', 'test-employee-mina', 'sim-pilote-mina-kitchen', 'seed-staff-mina-service']) {
    const notifs = await db.collection('users').doc(uid).collection('notifications').where('createdAt', '>=', since).get();
    for (const n of notifs.docs) if (/cdcb|-l[12]$/.test(n.id) || n.id.includes('cdcb')) await n.ref.delete();
  }
  const logs = await db.collection('notificationLogs').where('createdAt', '>=', since).get();
  for (const l of logs.docs) if (String(l.get('recipientId')).startsWith('cdcb-') || (l.get('recipientId') === CLIENT || l.get('recipientId') === 'sim-client-metz-1' || l.get('recipientId') === 'test-manager-mina') && ['order_confirmed', 'order_picked_up', 'order_delivered', 'order_cancelled', 'late_credit_issued', 'order_customer_absent', 'item_replacement_proposed', 'item_removed', 'claim_received', 'claim_decided', 'restaurant_new_order', 'refund_issued', 'zone_emergency_closure'].includes(l.get('templateKey'))) await l.ref.delete();
  // Porte-monnaie du client de simulation : retour à la valeur d'origine.
  await db.collection('users').doc(CLIENT).update({ walletBalanceCents: clientBefore.walletBalanceCents ?? 0, updatedAt: FieldValue.serverTimestamp() });
}

// ------------------------------------------------------------------ Exécution

async function main() {
  await makeProducts();
  const names = only.length ? only : Object.keys(scenarios);
  try {
    for (const name of names) {
      if (!scenarios[name]) {
        record(`Scénario inconnu : ${name}`, false);
        continue;
      }
      console.log(`\n=== ${name} ===`);
      try {
        await scenarios[name]();
      } catch (error) {
        record(`Scénario ${name} interrompu`, false, `${error.status ?? ''} ${error.message}`);
      }
    }
  } finally {
    await cleanup().catch((error) => console.error('Nettoyage incomplet :', error.message));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis.`);
  if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  process.exit(failed.length ? 1 : 0);
}
main();
