// Test réel du lot B4/B5/B6/H1 (tâche product-offers-finish) sur golink-9f16d : création d'une
// offre « 1 acheté, 1 offert » par le commerce (saveProductOffer), commande qui en bénéficie
// (placeOrder), remise appliquée + financement 100% commerce, compteurs incrémentés, lecture
// admin (collectionGroup, désactivation motivée). Décor isolé (`pof-*`), supprimé à la fin.
//
//   node scripts/tests/product-offers-finish.flow.mjs
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const RES = 'pof-resto';
const CITY = 'pof-ville';
const CLIENT = 'pof-client';
const DAY = 86_400_000;
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
const created = { authUsers: new Set() };
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function readAccounts() {
  const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
  return (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
}
const passwordOf = readAccounts();
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

// ------------------------------------------------------------------ Décor de test

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
}

async function setupBase() {
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test offres', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test Offres Resto', slug: 'test-offres-resto', groupId: null, cityId: CITY, planCode: 'pro', ownerId: 'test-owner-haddad', status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-1 * DAY), createdAt: at(-30 * DAY),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 03', managerEmail: 'pof-resto@golink.test', test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: true, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  const products = db.collection('restaurants').doc(RES).collection('products');
  const base = { sectionId: null, description: 'Description du plat test, assez longue pour la fiche.', vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system' };
  await products.doc('pof-p1').set({ ...base, name: 'Burger test offre', priceCents: 1200 });
  await testUserSession(CLIENT, 'pof-client@golink.test');
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'pof-client@golink.test', firstName: 'Pof', lastName: 'Client', displayName: 'Pof Client', referralCode: 'POFREF1', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });
}

async function teardown() {
  const products = await db.collection('restaurants').doc(RES).collection('products').listDocuments();
  const offers = await db.collection('restaurants').doc(RES).collection('productOffers').listDocuments();
  const orders = await db.collection('orders').where('restaurantId', '==', RES).get();
  const payments = await db.collection('payments').where('restaurantId', '==', RES).get();
  const batch = db.batch();
  for (const ref of products) batch.delete(ref);
  for (const ref of offers) batch.delete(ref);
  for (const doc of orders.docs) batch.delete(doc.ref);
  for (const doc of payments.docs) batch.delete(doc.ref);
  await batch.commit().catch(() => undefined);
  for (const path of [
    `restaurants/${RES}/members/pof-owner`,
    `restaurants/${RES}/private/commercial`,
    `restaurants/${RES}/private/legal`,
    `restaurants/${RES}/settings/orders`,
    `restaurants/${RES}/settings/hours`,
    `restaurants/${RES}`,
    `cities/${CITY}`,
    `userPrivate/${CLIENT}`,
    `users/${CLIENT}`,
  ]) {
    await db.doc(path).delete().catch(() => undefined);
  }
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => undefined);
}

// ------------------------------------------------------------------ Scénario

async function run() {
  console.log('Décor…');
  await setupBase();

  // 1) Le commerce crée une offre « 1 acheté, 1 offert » sur le plat test (gérant du décor, rôle owner).
  const OWNER = 'pof-owner';
  await testUserSession(OWNER, 'pof-owner@golink.test');
  await db.doc(`restaurants/${RES}/members/${OWNER}`).set({
    userId: OWNER, restaurantId: RES, displayName: 'Test Offres Gérant', email: 'pof-owner@golink.test', role: 'owner', permissions: [], active: true, seed: true, test: true, createdAt: at(0), updatedAt: at(0),
  });
  const ownerToken = sessions.get(OWNER);

  const today = new Date();
  const startDay = today.toISOString().slice(0, 10);
  let offerId = null;
  try {
    const saved = await call(ownerToken, 'saveProductOffer', {
      mode: 'create',
      restaurantId: RES,
      productId: 'pof-p1',
      kind: 'bogo',
      title: 'Le burger test, 2e offert',
      message: 'Pour toute commande de 2 burgers test, le second est offert automatiquement.',
      startDay,
      endDay: null,
    });
    offerId = saved.offerId;
    check('offre créée', Boolean(offerId));
  } catch (error) {
    record('offre créée', false, error.message);
  }

  if (!offerId) {
    await teardown();
    return;
  }

  // 2) Le client commande 2 unités du plat : la remise doit s'appliquer automatiquement (bogo = -1 unité).
  const clientToken = sessions.get(CLIENT);
  const clientRequestId = `pof${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  let order = null;
  try {
    const result = await call(clientToken, 'placeOrder', {
      restaurantId: RES,
      fulfillment: 'pickup',
      lines: [{ productId: 'pof-p1', quantity: 2 }],
      paymentMethod: 'card',
      paymentMethodId: 'pm_card_visa',
      clientRequestId,
    });
    check('commande créée', Boolean(result.orderId), `#${result.number}`);
    const snap = await db.doc(`orders/${result.orderId}`).get();
    order = snap.data();
  } catch (error) {
    record('commande créée', false, error.message);
  }

  if (order) {
    check('remise appliquée = prix d’une unité (1200)', order.amounts.discount.totalCents === 1200, `reçu ${order.amounts.discount.totalCents}`);
    check('remise 100% financée par le commerce', order.amounts.discount.restaurantFundedCents === 1200 && order.amounts.discount.platformFundedCents === 0, `restaurant=${order.amounts.discount.restaurantFundedCents} plateforme=${order.amounts.discount.platformFundedCents}`);
    check('total payé = 1200 (2400 - 1200)', order.amounts.totalCents === 1200, `reçu ${order.amounts.totalCents}`);
    check('aucun code promo attribué (offre plat, pas promotion)', order.promotionId === null);

    const offerSnap = await db.doc(`restaurants/${RES}/productOffers/${offerId}`).get();
    const offer = offerSnap.data();
    check('compteur ordersCount incrémenté', offer.ordersCount === 1, `reçu ${offer.ordersCount}`);
    check('compteur discountTotalCents incrémenté (1200)', offer.discountTotalCents === 1200, `reçu ${offer.discountTotalCents}`);
  }

  // 3) Lecture admin : même requête que apps/admin/src/features/affichage/OffresPlatsPage.tsx
  // (collectionGroup + orderBy createdAt, lecture publique), filtrée côté client comme l'écran.
  try {
    const group = await db.collectionGroup('productOffers').orderBy('createdAt', 'desc').limit(500).get();
    const mine = group.docs.filter((d) => d.data().restaurantId === RES);
    check('offre visible en collectionGroup (vue admin)', mine.length === 1, `${mine.length} trouvée(s) sur ${group.size} lues`);
  } catch (error) {
    record('offre visible en collectionGroup (vue admin)', false, error.message);
  }

  // 4) Désactivation admin motivée, puis vérification que le commerce ne peut plus la modifier.
  try {
    const superToken = await accountSession('superadmin@golink.test');
    const disabled = await call(superToken, 'disableProductOffer', { restaurantId: RES, offerId, disabled: true, reason: 'Test réel product-offers-finish' });
    check('désactivation admin', disabled.disabled === true);
    const afterSnap = await db.doc(`restaurants/${RES}/productOffers/${offerId}`).get();
    check('disabledByPlatform posé', Boolean(afterSnap.data()?.disabledByPlatform));
    await expectRestaurantBlocked();
    async function expectRestaurantBlocked() {
      try {
        await call(ownerToken, 'toggleProductOffer', { restaurantId: RES, offerId, active: false });
        record('commerce ne peut plus modifier une offre désactivée', false, 'accepté alors qu’un refus était attendu');
      } catch (error) {
        check('commerce ne peut plus modifier une offre désactivée', String(error.message).includes('désactivée'), error.message);
      }
    }
    // Réactivation, pour laisser une trace propre avant nettoyage.
    await call(superToken, 'disableProductOffer', { restaurantId: RES, offerId, disabled: false, reason: 'Fin de test, réactivation' });
  } catch (error) {
    record('désactivation admin', false, error.message);
  }

  console.log('Nettoyage…');
  await teardown();
}

await run();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} vérifications OK`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
