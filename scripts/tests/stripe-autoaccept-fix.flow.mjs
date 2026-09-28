// Test réel du correctif « auto-accept n'encaisse jamais le paiement Stripe » (tâche
// stripe-autoaccept-fix) sur la base golink-9f16d : commande acceptée automatiquement
// (réglage restaurant autoAccept) avec une carte de test valide → le PaymentIntent Stripe
// doit être réellement capturé (succeeded), pas seulement autorisé. Carte refusée en
// auto-accept → la commande n'est pas créée/acceptée. Décor isolé (`saf-*`), supprimé à la fin.
//
//   node scripts/tests/stripe-autoaccept-fix.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

// Clé secrète Stripe de test (mode test uniquement, sk_test_…) : lue localement pour vérifier
// côté API que le paiement est bien capturé (succeeded), pas seulement autorisé.
const STRIPE_SECRET_KEY = (() => {
  const raw = readFileSync(new URL('../../functions/.env.local.secrets', import.meta.url), 'utf8');
  const match = raw.match(/^STRIPE_SECRET_KEY=(.+)$/m);
  if (!match) throw new Error('STRIPE_SECRET_KEY introuvable dans functions/.env.local.secrets');
  return match[1].trim();
})();
async function stripeGetPaymentIntent(intentId) {
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}`, {
    headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe GET payment_intents ${intentId} : ${body.error?.message ?? res.status}`);
  return body;
}

const RES = 'saf-resto';
const CITY = 'saf-ville';
const CLIENT = 'saf-client';
const OWNER = 'saf-owner';
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
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test SAF', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test SAF Épicerie', slug: 'test-saf-epicerie', groupId: null, cityId: CITY, planCode: 'pro', ownerId: OWNER, status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-1 * 86_400_000), createdAt: at(-30 * 86_400_000),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0, minOrderCents: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 04', managerEmail: 'saf-resto@golink.test', test: true });
  // autoAccept ACTIVÉ : c'est le chemin bogué (l'encaissement n'avait jamais lieu). Modifié pendant
  // le scénario de non-régression manuel.
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: true, minOrderCents: 0, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });

  const products = db.collection('restaurants').doc(RES).collection('products');
  await products.doc('saf-plat').set({
    name: 'Plat de test SAF', priceCents: 1290, sectionId: null, description: null, vatCategory: 'restaurant', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [],
    allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [],
    seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system',
  });

  await testUserSession(CLIENT, 'saf-client@golink.test');
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'saf-client@golink.test', firstName: 'Saf', lastName: 'Client', displayName: 'Saf Client', referralCode: 'SAFREF1', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });

  await testUserSession(OWNER, 'saf-owner@golink.test');
  await db.collection('restaurants').doc(RES).collection('members').doc(OWNER).set({
    userId: OWNER, restaurantId: RES, displayName: 'Test SAF Gérant', email: 'saf-owner@golink.test', role: 'owner', permissions: [], active: true, seed: true, test: true, createdAt: at(0), updatedAt: at(0),
  });
}

const CLIENT_TOKEN = () => sessions.get(CLIENT);
let seq = 0;
async function place(paymentMethodId, extra = {}) {
  const clientRequestId = `saf${Date.now().toString(36)}${(seq += 1)}${randomBytes(3).toString('hex')}`;
  return call(CLIENT_TOKEN(), 'placeOrder', {
    restaurantId: RES,
    fulfillment: 'pickup',
    lines: [{ productId: 'saf-plat', quantity: 1 }],
    paymentMethod: 'card',
    paymentMethodId,
    clientRequestId,
    ...extra,
  });
}

// ------------------------------------------------------------------ Scénarios

/** Le cœur du bug : auto-accept + carte valide doit réellement encaisser (capture Stripe). */
async function scenarioAutoAcceptCaptures() {
  const result = await place('pm_card_visa');
  check('autoAccept.commande_creee', Boolean(result?.orderId), JSON.stringify(result));
  if (!result?.orderId) return;
  created.orders.add(result.orderId);

  const order = (await db.doc(`orders/${result.orderId}`).get()).data();
  check('autoAccept.statut_preparing', order?.status === 'preparing', `statut=${order?.status}`);
  check('autoAccept.payment_status_paid', order?.payment?.status === 'paid', `payment.status=${order?.payment?.status}`);
  check('autoAccept.payment_paidAt_pose', Boolean(order?.payment?.paidAt), JSON.stringify(order?.payment));

  const payment = (await db.doc(`payments/pay-${result.orderId}`).get()).data();
  check('autoAccept.doc_payment_status_paid', payment?.status === 'paid', `payments.status=${payment?.status}`);
  check('autoAccept.doc_payment_charge_id', Boolean(payment?.providerChargeId), JSON.stringify(payment));
  check('autoAccept.doc_payment_intent_id', Boolean(payment?.providerIntentId), JSON.stringify(payment));

  if (payment?.providerIntentId) {
    const intent = await stripeGetPaymentIntent(payment.providerIntentId);
    // C'est la vérification décisive du bug : sans le correctif, le PaymentIntent reste
    // « requires_capture » (autorisé, jamais débité) malgré une commande passée en préparation.
    check('autoAccept.stripe_intent_succeeded', intent.status === 'succeeded', `stripe status=${intent.status}`);
    check('autoAccept.stripe_montant_capture', intent.amount_received === 1290, `amount_received=${intent.amount_received}`);
  }
}

/** Non-régression : le chemin manuel (autoAccept désactivé) continue d'encaisser normalement. */
async function scenarioManualStillCaptures() {
  await db.doc(`restaurants/${RES}/settings/orders`).set({ autoAccept: false }, { merge: true });
  try {
    const result = await place('pm_card_visa');
    check('manuel.commande_creee_new', result?.orderId && (await db.doc(`orders/${result.orderId}`).get()).get('status') === 'new', JSON.stringify(result));
    if (!result?.orderId) return;
    created.orders.add(result.orderId);
    const OWNER_TOKEN = sessions.get(OWNER);
    await call(OWNER_TOKEN, 'acceptOrder', { orderId: result.orderId, prepMinutes: 15 });
    const order = (await db.doc(`orders/${result.orderId}`).get()).data();
    check('manuel.payment_status_paid', order?.payment?.status === 'paid', `payment.status=${order?.payment?.status}`);
    const payment = (await db.doc(`payments/pay-${result.orderId}`).get()).data();
    if (payment?.providerIntentId) {
      const intent = await stripeGetPaymentIntent(payment.providerIntentId);
      check('manuel.stripe_intent_succeeded', intent.status === 'succeeded', `stripe status=${intent.status}`);
    }
  } finally {
    await db.doc(`restaurants/${RES}/settings/orders`).set({ autoAccept: true }, { merge: true });
  }
}

/** Carte refusée à l'autorisation en auto-accept : la commande ne doit pas être créée/acceptée. */
async function scenarioAutoAcceptDeclinedCardBlocked() {
  await expectError('autoAccept.carte_refusee_bloquee', place('pm_card_chargeDeclined'), 'refusé');
}

const SCENARIOS = {
  autoAcceptCaptures: scenarioAutoAcceptCaptures,
  manualStillCaptures: scenarioManualStillCaptures,
  autoAcceptDeclinedCardBlocked: scenarioAutoAcceptDeclinedCardBlocked,
};

async function cleanup() {
  for (const id of created.orders) {
    const order = await db.doc(`orders/${id}`).get();
    const events = await db.doc(`orders/${id}`).collection('events').get().catch(() => ({ docs: [] }));
    for (const d of events.docs ?? []) await d.ref.delete().catch(() => {});
    await db.doc(`orders/${id}`).delete().catch(() => {});
    await db.doc(`payments/pay-${id}`).delete().catch(() => {});
    void order;
  }
  await db.doc(`restaurants/${RES}/private/commercial`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/private/legal`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/orders`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/hours`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/products/saf-plat`).delete().catch(() => {});
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
