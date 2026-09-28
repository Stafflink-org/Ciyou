// Test réel de la vente au poids et à prix variable (tâche weight-based-pricing) sur la base
// golink-9f16d : commande d'un produit au poids avec un poids réel différent du poids par
// défaut (sous-total = prix au kg × poids réel), ajustement à la préparation (remboursement
// automatique si le poids réel est inférieur, jamais de sur-facturation si supérieur), prix
// variable (plafond pré-autorisé puis prix final), et non-régression d'un produit à l'unité.
// Décor isolé (`wbp-*`), supprimé à la fin.
//
//   node scripts/tests/weight-based-pricing.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const RES = 'wbp-resto';
const CITY = 'wbp-ville';
const CLIENT = 'wbp-client';
const OWNER = 'wbp-owner';
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
const only = process.argv.slice(2);
const created = { orders: new Set(), authUsers: new Set() };

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function testUserSession(uid, email) {
  if (sessions.has(uid)) return sessions.get(uid);
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  created.authUsers.add(uid);
  const token = await loginPassword(email, password);
  sessions.set(uid, token);
  return token;
}
async function call(token, name, data) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${FN_BASE}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body.result;
    const status = String(body.error?.status ?? res.status);
    const transient = status === 'UNAVAILABLE' || res.status === 503 || res.status === 429 || (res.status === 500 && !body.error);
    if (attempt < 8 && transient) {
      await sleep(7000 + attempt * 4000);
      continue;
    }
    const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
    error.status = status;
    throw error;
  }
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

// ------------------------------------------------------------------ Décor de test

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
}

async function setupBase() {
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test WBP', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test WBP Épicerie', slug: 'test-wbp-epicerie', groupId: null, cityId: CITY, planCode: 'pro', ownerId: OWNER, status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-1 * 86_400_000), createdAt: at(-30 * 86_400_000),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0, minOrderCents: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 03', managerEmail: 'wbp-resto@golink.test', test: true });
  // autoAccept désactivé : l'encaissement Stripe (capture) n'a lieu qu'à l'acceptation explicite
  // (acceptOrder). Un ajustement de poids/prix doit être testé après un vrai encaissement, sinon
  // le remboursement Stripe échoue faute de montant capturé (pas un défaut de cette tâche).
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: false, minOrderCents: 0, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });

  const products = db.collection('restaurants').doc(RES).collection('products');
  const base = {
    sectionId: null, description: null, vatCategory: 'grocery', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [],
    allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [],
    seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system',
  };
  // Fromage au poids : 24 €/kg, portion par défaut 300 g, entre 100 g et 2 kg.
  await products.doc('wbp-fromage').set({
    ...base, name: 'Fromage de test au poids', priceCents: 720, saleUnit: 'weight', pricePerKgCents: 2400,
    weightStepGrams: 100, minWeightGrams: 100, maxWeightGrams: 2000,
  });
  // Panier de fruits à prix variable : plafond 15 €.
  await products.doc('wbp-panier').set({ ...base, name: 'Panier de fruits test (prix variable)', priceCents: 1200, saleUnit: 'variable', variablePriceMaxCents: 1500 });
  // Produit à l'unité classique : témoin de non-régression.
  await products.doc('wbp-unite').set({ ...base, name: 'Jus de test à l’unité', priceCents: 350 });

  await testUserSession(CLIENT, 'wbp-client@golink.test');
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'wbp-client@golink.test', firstName: 'Wbp', lastName: 'Client', displayName: 'Wbp Client', referralCode: 'WBPREF1', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });

  await testUserSession(OWNER, 'wbp-owner@golink.test');
  await db.collection('restaurants').doc(RES).collection('members').doc(OWNER).set({
    userId: OWNER, restaurantId: RES, displayName: 'Test WBP Gérant', email: 'wbp-owner@golink.test', role: 'owner', permissions: [], active: true, seed: true, test: true, createdAt: at(0), updatedAt: at(0),
  });
}

const CLIENT_TOKEN = () => sessions.get(CLIENT);
const OWNER_TOKEN = () => sessions.get(OWNER);
let seq = 0;
async function place(lines, extra = {}) {
  const clientRequestId = `wbp${Date.now().toString(36)}${(seq += 1)}${randomBytes(3).toString('hex')}`;
  return call(CLIENT_TOKEN(), 'placeOrder', { restaurantId: RES, fulfillment: 'pickup', lines, paymentMethod: 'card', paymentMethodId: 'pm_card_visa', clientRequestId, ...extra });
}
/** Place puis fait accepter la commande par le commerce (encaisse réellement le paiement Stripe :
 * un ajustement de poids/prix ne peut être remboursé qu'après un vrai encaissement). */
async function placeAndAccept(lines, extra = {}) {
  const result = await place(lines, extra);
  if (!result?.orderId) return result;
  await call(OWNER_TOKEN(), 'acceptOrder', { orderId: result.orderId, prepMinutes: 15 });
  return result;
}

// ------------------------------------------------------------------ Scénarios

async function scenarioWeightOrder() {
  // Poids réel demandé (480 g) différent du poids par défaut (300 g).
  const result = await placeAndAccept([{ productId: 'wbp-fromage', quantity: 1, weightGrams: 480 }]);
  check('poids.commande_ok', Boolean(result?.orderId), JSON.stringify(result));
  if (!result?.orderId) return;
  created.orders.add(result.orderId);
  const expected = Math.round((2400 * 480) / 1000); // 1152
  check('poids.total_facture_correct', result.totalCents === expected + 0, `attendu ${expected} obtenu ${result.totalCents}`);

  const order = await db.doc(`orders/${result.orderId}`).get();
  const line = order.get('items')?.[0];
  check('poids.ligne_saleUnit', line?.saleUnit === 'weight');
  check('poids.ligne_poids_reel', line?.weightGrams === 480);
  check('poids.ligne_prix_correct', line?.totalCents === expected, `attendu ${expected} obtenu ${line?.totalCents}`);

  // Ajustement à la préparation : poids réel pesé inférieur (420 g au lieu de 480 g demandés) → remboursement.
  const adjust = await call(OWNER_TOKEN(), 'adjustOrderItemWeight', { orderId: result.orderId, lineId: line.lineId, actualWeightGrams: 420 });
  const expectedFinal = Math.round((2400 * 420) / 1000); // 1008
  check('poids.ajustement_prix_final', adjust?.finalTotalCents === expectedFinal, `attendu ${expectedFinal} obtenu ${adjust?.finalTotalCents}`);
  check('poids.ajustement_remboursement', adjust?.refundCents === expected - expectedFinal, `attendu ${expected - expectedFinal} obtenu ${adjust?.refundCents}`);

  const orderAfter = await db.doc(`orders/${result.orderId}`).get();
  const lineAfter = orderAfter.get('items')?.[0];
  check('poids.ligne_maj_finalTotal', lineAfter?.finalTotalCents === expectedFinal);
  check('poids.ligne_maj_poids_reel', lineAfter?.actualWeightGrams === 420);
  check('poids.commande_montant_rembourse', orderAfter.get('amounts')?.refundedCents === (expected - expectedFinal), `refundedCents=${orderAfter.get('amounts')?.refundedCents}`);

  const refund = await db.doc(`refunds/rf-${result.orderId}-weight-${line.lineId}`).get();
  check('poids.remboursement_journalise', refund.exists && refund.get('cause') === 'weight_adjustment');

  // Un second ajustement de la même ligne doit être refusé (déjà traité).
  await expectError('poids.ajustement_double_refuse', call(OWNER_TOKEN(), 'adjustOrderItemWeight', { orderId: result.orderId, lineId: line.lineId, actualWeightGrams: 400 }), 'déjà');
}

async function scenarioWeightBounds() {
  await expectError('poids.hors_minimum_refuse', place([{ productId: 'wbp-fromage', quantity: 1, weightGrams: 50 }]), 'minimum');
  await expectError('poids.hors_maximum_refuse', place([{ productId: 'wbp-fromage', quantity: 1, weightGrams: 3000 }]), 'maximum');
  // Sans poids fourni : repli sur le poids minimum (portion par défaut).
  const result = await place([{ productId: 'wbp-fromage', quantity: 1 }]);
  check('poids.sans_valeur_repli_minimum', result?.orderId, JSON.stringify(result));
  if (result?.orderId) {
    created.orders.add(result.orderId);
    check('poids.repli_montant', result.totalCents === Math.round((2400 * 100) / 1000));
  }
}

async function scenarioVariablePrice() {
  const result = await placeAndAccept([{ productId: 'wbp-panier', quantity: 1 }]);
  check('variable.commande_plafond_preautorise', result?.totalCents === 1500, `attendu 1500 obtenu ${result?.totalCents}`);
  if (!result?.orderId) return;
  created.orders.add(result.orderId);
  const order = await db.doc(`orders/${result.orderId}`).get();
  const line = order.get('items')?.[0];
  check('variable.ligne_saleUnit', line?.saleUnit === 'variable');

  // Prix final fixé par le commerce, inférieur au plafond.
  const adjust = await call(OWNER_TOKEN(), 'adjustOrderItemWeight', { orderId: result.orderId, lineId: line.lineId, actualPriceCents: 1150 });
  check('variable.ajustement_prix_final', adjust?.finalTotalCents === 1150, JSON.stringify(adjust));
  check('variable.ajustement_remboursement', adjust?.refundCents === 350, `attendu 350 obtenu ${adjust?.refundCents}`);

  // Un second panier : refus si le commerce tente de dépasser le plafond pré-autorisé.
  const result2 = await placeAndAccept([{ productId: 'wbp-panier', quantity: 1 }]);
  created.orders.add(result2.orderId);
  const order2 = await db.doc(`orders/${result2.orderId}`).get();
  const line2 = order2.get('items')?.[0];
  await expectError('variable.depassement_plafond_refuse', call(OWNER_TOKEN(), 'adjustOrderItemWeight', { orderId: result2.orderId, lineId: line2.lineId, actualPriceCents: 1800 }), 'autorisé');
}

async function scenarioUnitNotAffected() {
  const result = await placeAndAccept([{ productId: 'wbp-unite', quantity: 2 }]);
  check('unite.commande_ok', Boolean(result?.orderId), JSON.stringify(result));
  if (!result?.orderId) return;
  created.orders.add(result.orderId);
  check('unite.total_inchange', result.totalCents === 700, `attendu 700 obtenu ${result.totalCents}`);
  const order = await db.doc(`orders/${result.orderId}`).get();
  const line = order.get('items')?.[0];
  check('unite.pas_de_saleUnit', line?.saleUnit === undefined, JSON.stringify(line));
  // Un article à l'unité n'est pas ajustable par adjustOrderItemWeight.
  await expectError('unite.ajustement_refuse', call(OWNER_TOKEN(), 'adjustOrderItemWeight', { orderId: result.orderId, lineId: line.lineId, actualPriceCents: 100 }), 'poids');
}

const SCENARIOS = {
  weightOrder: scenarioWeightOrder,
  weightBounds: scenarioWeightBounds,
  variablePrice: scenarioVariablePrice,
  unitNotAffected: scenarioUnitNotAffected,
};

async function cleanup() {
  for (const id of created.orders) {
    await db.doc(`orders/${id}`).delete().catch(() => {});
    await db.doc(`payments/pay-${id}`).delete().catch(() => {});
    const refunds = await db.collection('refunds').where('orderId', '==', id).get();
    for (const d of refunds.docs) await d.ref.delete().catch(() => {});
  }
  await db.doc(`restaurants/${RES}/private/commercial`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/private/legal`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/orders`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/hours`).delete().catch(() => {});
  for (const p of ['wbp-fromage', 'wbp-panier', 'wbp-unite']) await db.doc(`restaurants/${RES}/products/${p}`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/members/${OWNER}`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}`).delete().catch(() => {});
  await db.doc(`cities/${CITY}`).delete().catch(() => {});
  await db.doc(`users/${CLIENT}`).delete().catch(() => {});
  await db.doc(`userPrivate/${CLIENT}`).delete().catch(() => {});
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => {});
}

async function main() {
  await setupBase();
  const toRun = only.length ? only.filter((s) => SCENARIOS[s]) : Object.keys(SCENARIOS);
  for (const name of toRun) {
    try {
      await SCENARIOS[name]();
    } catch (error) {
      record(`${name}.exception`, false, String(error.stack ?? error));
    }
  }
  if (!process.env.NO_CLEANUP) await cleanup();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    console.log('Échecs :');
    for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
