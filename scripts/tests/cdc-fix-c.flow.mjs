// Test réel des correctifs « argent » du cahier (tâche cdc-fix-c), sur la base golink-9f16d :
// priorité de commission et mode de facturation, promotions sans code et ciblage, libération à
// l'annulation, portefeuille dépensable, cycle de vie des abonnements (facture mensuelle,
// compensation, impayés, restrictions, renouvellement), espèces des livreurs salariés, parrainage
// entre commerces, fidélité, comptes de paiement et virement manuel (pays sans Stripe), KPI.
//
// Le script joue le rôle du client (compte de test créé pour l'occasion), des membres du commerce
// (comptes de test existants) et de l'équipe GoLink. Les planificateurs sont appelés directement
// (code des fonctions, identifiants CLI en ADC). Toutes les données créées portent `test: true`
// et l'identifiant `cdcc-…` ; elles sont supprimées à la fin.
//
//   ADC : GOOGLE_APPLICATION_CREDENTIALS=<authorized_user.json> GOOGLE_CLOUD_PROJECT=golink-9f16d
//   npx tsx scripts/tests/cdc-fix-c.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const RES = 'cdcc-resto';
const CITY = 'cdcc-ville';
const CLIENT = 'cdcc-client';
const DRIVER = 'cdcc-driver';
const OWNER_UID = 'test-owner-haddad';
const OWNER_EMAIL = 'mina.haddad@golink.test';
const MIN = 60_000;
const DAY = 86_400_000;
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
const only = process.argv.slice(2);
const created = { orders: new Set(), restaurants: new Set(), authUsers: new Set(), docs: [] };

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
async function accountSession(email) {
  if (sessions.has(email)) return sessions.get(email);
  const token = await loginPassword(email, passwordOf(email));
  sessions.set(email, token);
  return token;
}
/** Compte de test créé par le script : mot de passe aléatoire, jamais affiché. */
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
    // Quota de processeurs de la région saturé (autres déploiements) : 429, 503 ou 500 sans détail applicatif → nouvelle tentative.
    const transient = status === 'UNAVAILABLE' || res.status === 503 || res.status === 429 || (res.status === 500 && !body.error);
    if (attempt < 10 && transient) {
      await sleep(8000 + attempt * 4000);
      continue;
    }
    const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
    error.status = status;
    error.http = res.status;
    throw error;
  }
}
async function expectError(name, promise, status, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = (!status || error.status === status) && (!fragment || String(error.message).includes(fragment));
    record(name, ok, `${error.status} : ${error.message}`);
  }
}

// ------------------------------------------------------------------ Décor de test

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
}

async function setupBase() {
  // Ville de test (barème propre), commerce de test (livré par ses propres livreurs), produits, membres, formule, abonnement.
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test C', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test C Resto', slug: 'test-c-resto', groupId: null, cityId: CITY, planCode: 'cdcc-plan', ownerId: OWNER_UID, status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'restaurant', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-1 * DAY), createdAt: at(-30 * DAY),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'cdcc-plan', subscriptionId: 'cdcc-sub', subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791364', managerPhone: '+33 6 99 00 00 01', managerEmail: 'cdcc-resto@golink.test', test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: false, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  await clone(`restaurants/mina-kitchen/members/${OWNER_UID}`, `restaurants/${RES}/members/${OWNER_UID}`, { restaurantId: RES, groupId: null, test: true });
  const products = db.collection('restaurants').doc(RES).collection('products');
  const base = { sectionId: null, description: null, vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system' };
  await products.doc('cdcc-p1').set({ ...base, name: 'Test plat C', priceCents: 2000 });
  await products.doc('cdcc-p2').set({ ...base, name: 'Test dessert C', priceCents: 1500 });
  await db.doc('plans/pro').get().then((s) => db.doc('plans/cdcc-plan').set({ ...s.data(), code: 'cdcc-plan', name: 'Formule test C', monthlyPriceHtCents: 4900, commission: { platformDeliveryBps: 2222, restaurantDeliveryBps: 1333, pickupBps: 1234 }, commissionInherit: false, billingMode: 'commission', features: [], limits: { maxProducts: null, maxStaff: null, maxPromotions: null }, gracePeriodDays: 0, trialDays: 0, test: true }));
  await db.doc('subscriptions/cdcc-sub').set({
    subscriberType: 'restaurant', subscriberId: RES, restaurantIds: [RES], planCode: 'pro', status: 'active', billingCycle: 'monthly', priceHtCents: 4900, trialEndsAt: null,
    currentPeriodStart: at(-10 * DAY), currentPeriodEnd: at(20 * DAY), cancelAtPeriodEnd: false, specialOffer: null, dunning: { attempts: 0, log: [] }, history: [],
    countryId: 'FR', cityId: CITY, createdAt: at(-60 * DAY), updatedAt: at(0), createdBy: 'system', updatedBy: 'system', test: false, seedcdcc: true,
  });
  // Client de test (profil clonant un client de simulation).
  await testUserSession(CLIENT, 'cdcc-client@golink.test');
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'cdcc-client@golink.test', firstName: 'Cdcc', lastName: 'Client', displayName: 'Cdcc Client', referralCode: 'CDCCREF1', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  // Livreur salarié du commerce.
  await clone('drivers/seed-driver-029', `drivers/${DRIVER}`, { restaurantIds: [RES], cityId: CITY, displayName: 'Livreur Test C', firstName: 'Livreur', lastName: 'Test C', email: 'cdcc-driver@exemple.test', status: 'active', availability: 'online', acceptsCash: true, activeOrderIds: [], test: true, seed: true });
  await db.doc(`driverPrivate/${DRIVER}`).set({ cashBalanceCents: 0, cashLimitCents: 15_000, payoutsBlocked: false, vatExempt: true, dac7Complete: true, birthDate: '1990-01-01', nationality: 'FR', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR' }, stripeAccountStatus: 'enabled', updatedAt: at(0), test: true });
  await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).set({ driverId: DRIVER, displayName: 'Livreur Test C', relation: 'own', status: 'active', deliveriesCount: 0, zoneIds: [], updatedAt: at(0), updatedBy: 'system', test: true });
}

/** Réinitialise la configuration de commission du décor. */
async function baseline() {
  await db.doc('plans/cdcc-plan').update({ commission: { platformDeliveryBps: 2222, restaurantDeliveryBps: 1333, pickupBps: 1234 }, commissionInherit: false, billingMode: 'commission', features: [], limits: { maxProducts: null, maxStaff: null, maxPromotions: null } });
  await db.doc(`restaurants/${RES}/private/commercial`).update({ negotiatedCommission: null, billingMode: null, specialOffer: null, subscriptionStatus: 'active' });
  await db.doc(`cities/${CITY}`).update({ pricing: null, commissionOverrideBps: null });
  await db.doc(`restaurants/${RES}`).update({ groupId: null });
  for (const d of (await db.collection('commissionRules').where('scopeId', '==', 'cdcc-group').get()).docs) await d.ref.delete();
}

const CLIENT_TOKEN = () => sessions.get(CLIENT);
let seq = 0;
async function place(extra = {}) {
  const clientRequestId = `cdcc${Date.now().toString(36)}${(seq += 1)}${randomBytes(3).toString('hex')}`;
  const result = await call(CLIENT_TOKEN(), 'placeOrder', { restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcc-p1', quantity: 2 }], paymentMethod: 'card', useWallet: true, clientRequestId, ...extra });
  created.orders.add(result.orderId);
  return result;
}
const getOrder = async (id) => (await db.collection('orders').doc(id).get()).data();
const cancel = (orderId) => call(CLIENT_TOKEN(), 'cancelOrder', { orderId, reason: 'customer_request', details: 'Test cdcc : annulation' });
async function setWallet(cents) {
  await db.doc(`users/${CLIENT}`).update({ walletBalanceCents: cents });
}
const wallet = async () => (await db.doc(`users/${CLIENT}`).get()).get('walletBalanceCents');

function promo(id, fields) {
  return db.doc(`promotions/${id}`).set({
    scope: 'platform', countryId: 'FR', cityIds: [], restaurantId: null, restaurantIds: [RES], title: { fr: `Test ${id}` }, description: null, code: null, kind: 'percentage', value: 1000, maxDiscountCents: null,
    minSubtotalCents: 0, funding: 'platform', restaurantShareBps: null, target: 'everyone', inactiveDays: null, modes: [], totalUsageLimit: null, perCustomerLimit: 1, startsAt: at(-DAY), endsAt: null, status: 'active',
    showcase: false, stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 }, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system', test: true, seed: true, ...fields,
  });
}

// ------------------------------------------------------------------ Scénarios

const scenarios = {};

scenarios.commission = async () => {
  await setWallet(1_000_000);
  const variants = [];
  const run = async (label, expected, prepare) => {
    await baseline();
    await prepare();
    const r = await place();
    const o = await getOrder(r.orderId);
    check(`Commission — ${label}`, o.commission?.bps === expected.bps && o.commission?.source === expected.source && (!expected.mode || o.commission?.billingMode === expected.mode), `${o.commission?.bps} bps, source ${o.commission?.source}, mode ${o.commission?.billingMode}`);
    variants.push(r.orderId);
    await cancel(r.orderId);
  };
  await run('formule (taux propres)', { bps: 1234, source: 'plan', mode: 'commission' }, async () => {});
  await run('formule qui hérite du pays', { bps: 1200, source: 'market' }, () => db.doc('plans/cdcc-plan').update({ commissionInherit: true }));
  await run('barème de la ville prioritaire sur la formule', { bps: 1111, source: 'city' }, () => db.doc(`cities/${CITY}`).update({ pricing: { commission: { pickupBps: 1111 } } }));
  await run('barème du groupe (avant ville et formule)', { bps: 950, source: 'group' }, async () => {
    await db.doc(`cities/${CITY}`).update({ pricing: { commission: { pickupBps: 1111 } } });
    await db.doc(`restaurants/${RES}`).update({ groupId: 'cdcc-group' });
    await db.collection('commissionRules').doc('cdcc-rule-group').set({ scope: 'group', scopeId: 'cdcc-group', countryId: 'FR', platformDeliveryBps: 900, restaurantDeliveryBps: 900, pickupBps: 950, validFrom: at(-DAY), validTo: null, reason: 'test', supersedesId: null, createdAt: at(0), updatedAt: at(0), test: true });
  });
  await run('taux négocié (avant tout)', { bps: 900, source: 'negotiated' }, async () => {
    await db.doc(`cities/${CITY}`).update({ pricing: { commission: { pickupBps: 1111 } } });
    await db.doc(`restaurants/${RES}/private/commercial`).update({ negotiatedCommission: { pickupBps: 900, reason: 'test', validUntil: at(30 * DAY) } });
  });
  await run('négocié échu : retour à la formule', { bps: 1234, source: 'plan' }, () => db.doc(`restaurants/${RES}/private/commercial`).update({ negotiatedCommission: { pickupBps: 900, reason: 'test', validUntil: at(-DAY) } }));
  await run('offre spéciale retirée du taux', { bps: 1034, source: 'plan' }, () => db.doc(`restaurants/${RES}/private/commercial`).update({ specialOffer: { commissionReductionBps: 200, subscriptionFreeUntil: null, reason: 'test', endsAt: at(10 * DAY) } }));
  await run('mode abonnement : aucune commission sur les ventes', { bps: 0, source: 'subscription', mode: 'subscription' }, () => db.doc(`restaurants/${RES}/private/commercial`).update({ billingMode: 'subscription' }));
  await run('mode « les deux » : commission de la formule', { bps: 1234, source: 'plan', mode: 'hybrid' }, () => db.doc('plans/cdcc-plan').update({ billingMode: 'hybrid' }));
  await run('mode du commerce prioritaire sur celui de la formule', { bps: 1234, source: 'plan', mode: 'commission' }, async () => {
    await db.doc('plans/cdcc-plan').update({ billingMode: 'subscription' });
    await db.doc(`restaurants/${RES}/private/commercial`).update({ billingMode: 'commission' });
  });
  await baseline();
};

scenarios.promotions = async () => {
  await baseline();
  await setWallet(1_000_000);
  for (const d of (await db.collection('promotions').where('test', '==', true).get()).docs) await d.ref.delete();

  // Offre automatique (sans code).
  await promo('cdcc-auto', { kind: 'percentage', value: 1000 });
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 0, 'stats.lastOrderAt': null });
  const first = await place();
  const o1 = await getOrder(first.orderId);
  check('Offre sans code appliquée automatiquement', o1.promotionId === 'cdcc-auto' && o1.amounts.discount.totalCents === 400 && o1.promoCode === null, `remise ${o1.amounts.discount.totalCents} c`);
  const red = (await db.doc(`promotionRedemptions/${first.orderId}`).get()).data();
  check('Utilisation enregistrée (financement plateforme)', red?.status === 'applied' && red.platformFundedCents === 400 && red.restaurantFundedCents === 0);
  check('Compteurs de l’offre incrémentés', (await db.doc('promotions/cdcc-auto').get()).get('stats.redemptions') === 1);
  const second = await place();
  const o2 = await getOrder(second.orderId);
  check('Limite par client respectée : plus d’offre sur la commande suivante', o2.promotionId === null && o2.amounts.discount.totalCents === 0);
  await cancel(second.orderId);

  // Libération à l'annulation.
  await cancel(first.orderId);
  const released = await until(async () => (await db.doc(`promotionRedemptions/${first.orderId}`).get()).get('status') === 'reversed', 60_000);
  check('Annulation : utilisation libérée', released);
  const stats = (await db.doc('promotions/cdcc-auto').get()).get('stats');
  check('Annulation : compteurs de l’offre décrémentés', stats.redemptions === 0 && stats.discountCents === 0 && stats.ordersSubtotalCents === 0, JSON.stringify(stats));
  const again = await place();
  check('Quota du client rendu : l’offre s’applique à nouveau', (await getOrder(again.orderId)).promotionId === 'cdcc-auto');
  await cancel(again.orderId);
  await until(async () => (await db.doc('promotions/cdcc-auto').get()).get('stats.redemptions') === 0, 60_000);

  // Concurrence : deux commandes simultanées, une seule utilisation autorisée.
  const parallel = await Promise.allSettled([place(), place()]);
  const okOrders = parallel.filter((p) => p.status === 'fulfilled').map((p) => p.value.orderId);
  const withPromo = (await Promise.all(okOrders.map(getOrder))).filter((o) => o.promotionId === 'cdcc-auto').length;
  check('Deux commandes simultanées : l’offre n’est utilisée qu’une fois', withPromo <= 1 && (await db.doc('promotions/cdcc-auto').get()).get('stats.redemptions') <= 1, `${okOrders.length} acceptée(s), ${withPromo} avec l’offre, ${parallel.filter((p) => p.status === 'rejected').length} refusée(s)`);
  for (const id of okOrders) await cancel(id).catch(() => undefined);
  await until(async () => (await db.doc('promotions/cdcc-auto').get()).get('stats.redemptions') === 0, 60_000);

  // Ciblage : clients inactifs depuis X jours.
  await db.doc('promotions/cdcc-auto').update({ status: 'paused' });
  await promo('cdcc-inactive', { kind: 'fixed', value: 500, target: 'inactive_customers', inactiveDays: 30 });
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 3, 'stats.lastOrderAt': at(-5 * DAY) });
  const recent = await place();
  check('Ciblage « inactifs » : client récent exclu', (await getOrder(recent.orderId)).promotionId === null);
  await cancel(recent.orderId);
  await db.doc(`users/${CLIENT}`).update({ 'stats.lastOrderAt': at(-45 * DAY) });
  const inactive = await place();
  const oi = await getOrder(inactive.orderId);
  check('Ciblage « inactifs » : client sans commande depuis 45 jours servi', oi.promotionId === 'cdcc-inactive' && oi.amounts.discount.totalCents === 500);
  await cancel(inactive.orderId);
  await until(async () => (await db.doc('promotions/cdcc-inactive').get()).get('stats.redemptions') === 0, 60_000);
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 0, 'stats.lastOrderAt': null });
  const never = await place();
  check('Ciblage « inactifs » : un nouveau client n’est pas « inactif »', (await getOrder(never.orderId)).promotionId === null);
  await cancel(never.orderId);

  // Ciblage : clients fidèles (seuil réglable).
  await db.doc('promotions/cdcc-inactive').update({ status: 'paused' });
  await promo('cdcc-loyal', { kind: 'fixed', value: 600, target: 'loyal_customers' });
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 2, 'stats.lastOrderAt': at(-2 * DAY) });
  const few = await place();
  check('Ciblage « fidèles » : 2 commandes, exclu', (await getOrder(few.orderId)).promotionId === null);
  await cancel(few.orderId);
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 6 });
  const loyal = await place();
  check('Ciblage « fidèles » : 6 commandes, servi', (await getOrder(loyal.orderId)).promotionId === 'cdcc-loyal');
  await cancel(loyal.orderId);
  await until(async () => (await db.doc('promotions/cdcc-loyal').get()).get('stats.redemptions') === 0, 60_000);
  const settingsRef = db.doc('settings/promotions');
  const before = (await settingsRef.get()).data();
  try {
    await settingsRef.update({ loyalOrdersThreshold: 10 });
    const strict = await place();
    check('Seuil « fidèle » réglable (10 commandes) : 6 commandes ne suffisent plus', (await getOrder(strict.orderId)).promotionId === null);
    await cancel(strict.orderId);
  } finally {
    await settingsRef.set(before);
  }

  // Meilleure offre choisie parmi plusieurs.
  await db.doc('promotions/cdcc-auto').update({ status: 'active' });
  await db.doc('promotions/cdcc-loyal').update({ status: 'active' });
  const best = await place();
  check('Plusieurs offres : la plus avantageuse est retenue (600 c > 400 c)', (await getOrder(best.orderId)).promotionId === 'cdcc-loyal');
  await cancel(best.orderId);
  await until(async () => (await db.doc('promotions/cdcc-loyal').get()).get('stats.redemptions') === 0, 60_000);

  // Code saisi : ciblage contrôlé avec un message clair.
  await promo('cdcc-code', { code: 'CDCCNEW', target: 'new_customers', kind: 'fixed', value: 300 });
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 4 });
  await expectError('Code « nouveaux clients » refusé à un client existant', place({ promoCode: 'CDCCNEW' }), 'FAILED_PRECONDITION', 'première commande');
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 0 });
  const withCode = await place({ promoCode: 'CDCCNEW' });
  const oc = await getOrder(withCode.orderId);
  check('Code accepté pour un nouveau client', oc.promoCode === 'CDCCNEW' && oc.promotionId === 'cdcc-code');
  await cancel(withCode.orderId);
  for (const d of (await db.collection('promotions').where('test', '==', true).get()).docs) await d.ref.delete();
  await db.doc(`users/${CLIENT}`).update({ 'stats.ordersCount': 0, 'stats.lastOrderAt': null });
};

scenarios.wallet = async () => {
  await baseline();
  for (const d of (await db.collection('promotions').where('test', '==', true).get()).docs) await d.ref.delete();
  await expectError('Portefeuille vide : refus clair', (async () => { await setWallet(0); return place(); })(), 'FAILED_PRECONDITION', 'solde d’avoirs');
  // Portefeuille couvrant toute la commande.
  await setWallet(100_000);
  const full = await place();
  const o = await getOrder(full.orderId);
  check('Solde suffisant : commande réglée par le portefeuille seul', o.payment.method === 'wallet' && o.payment.status === 'paid' && o.amounts.chargedCents === 0 && o.amounts.walletAppliedCents === o.amounts.totalCents, `${o.amounts.walletAppliedCents} c sur ${o.amounts.totalCents} c`);
  check('Solde du client diminué du montant utilisé', (await wallet()) === 100_000 - o.amounts.totalCents, `${await wallet()}`);
  const debit = (await db.doc(`walletTransactions/wp-${full.orderId}`).get()).data();
  check('Mouvement de débit et écriture au grand livre', debit?.type === 'debit' && debit.reason === 'order_payment' && (await db.doc(`ledgerEntries/wp-${full.orderId}`).get()).get('type') === 'wallet_debit');
  const pay = (await db.doc(`payments/pay-${full.orderId}`).get()).data();
  check('Paiement enregistré : prestataire « wallet », montant 0 encaissé', pay?.provider === 'wallet' && pay.amountCents === 0, `${pay?.provider} ${pay?.amountCents}`);
  await cancel(full.orderId);
  const restored = await until(async () => (await wallet()) === 100_000, 60_000);
  check('Annulation : avoirs rendus au portefeuille', restored, `${await wallet()}`);
  check('Retour tracé (mouvement et grand livre)', (await db.doc(`walletTransactions/wr-${full.orderId}`).get()).get('type') === 'reversal' && (await db.doc(`ledgerEntries/wr-${full.orderId}`).get()).get('amountCents') === o.amounts.totalCents);
  await sleep(3000);
  check('Restitution jamais doublée', (await wallet()) === 100_000);

  // Portefeuille partiel + carte (Stripe test).
  await setWallet(500);
  try {
    const partial = await place({ paymentMethodId: 'pm_card_visa' });
    const op = await getOrder(partial.orderId);
    check('Portefeuille partiel + carte : 5,00 € en avoirs, le reste sur la carte', op.amounts.walletAppliedCents === 500 && op.amounts.chargedCents === op.amounts.totalCents - 500 && op.payment.method === 'card', `avoirs ${op.amounts.walletAppliedCents}, carte ${op.amounts.chargedCents}`);
    check('Solde ramené à zéro', (await wallet()) === 0);
    const payment = (await db.doc(`payments/pay-${partial.orderId}`).get()).data();
    check('Paiement carte du reste seulement', payment?.amountCents === op.amounts.chargedCents && payment.currency === 'EUR');
    await cancel(partial.orderId);
    await until(async () => (await wallet()) === 500, 60_000);
    check('Annulation : avoirs partiels rendus', (await wallet()) === 500);
  } catch (error) {
    record('Portefeuille partiel + carte (Stripe test)', false, `${error.status} : ${error.message}`);
  }
  await setWallet(0);
};

scenarios.payments = async () => {
  await baseline();
  await setWallet(0);
  const settingsRef = db.doc('settings/payments');
  const before = (await settingsRef.get()).data();
  try {
    // Pourboire : réglage plateforme lu par le serveur.
    await settingsRef.set({ ...before, tips: { ...before.tips, maxCents: 300 } });
    await expectError('Pourboire au-delà du plafond de la plateforme refusé', place({ tipCents: 500, useWallet: false, paymentMethodId: 'pm_card_visa' }), 'FAILED_PRECONDITION', 'limité');
    await settingsRef.set({ ...before, tips: { ...before.tips, enabled: false } });
    await expectError('Pourboires désactivés : refus', place({ tipCents: 100, useWallet: false, paymentMethodId: 'pm_card_visa' }), 'FAILED_PRECONDITION', 'pas proposés');
    await settingsRef.set(before);
    // Refus de carte : tracé et limité.
    const uid = CLIENT;
    for (const d of (await db.collection('payments').where('payerId', '==', uid).where('status', '==', 'failed').get()).docs) await d.ref.delete();
    for (const d of (await db.collection('rateLimits').get()).docs.filter((x) => x.id.startsWith(`payfail_${uid}_`))) await d.ref.delete();
    await settingsRef.set({ ...before, failedPaymentRetry: { maxAttempts: 2 } });
    for (let i = 1; i <= 2; i += 1) {
      await expectError(`Carte refusée n° ${i} : message clair`, place({ useWallet: false, paymentMethodId: 'pm_card_chargeDeclined' }), 'FAILED_PRECONDITION', 'refusé');
    }
    const failed = await db.collection('payments').where('payerId', '==', uid).where('status', '==', 'failed').get();
    check('Refus de carte tracés dans les paiements échoués (aucune commande créée)', failed.size === 2 && failed.docs.every((d) => d.get('orderId') === null && d.get('failureCode')), `${failed.size} paiement(s) échoué(s)`);
    await expectError('Nombre de nouvelles tentatives limité (réglage plateforme)', place({ useWallet: false, paymentMethodId: 'pm_card_visa' }), 'FAILED_PRECONDITION', 'Trop de paiements refusés');
    for (const d of failed.docs) await d.ref.delete();
    for (const d of (await db.collection('rateLimits').get()).docs.filter((x) => x.id.startsWith(`payfail_${uid}_`))) await d.ref.delete();
  } finally {
    await settingsRef.set(before);
  }
};

// ------------------------------------------------------------------ Abonnements

async function resetBilling() {
  for (const col of ['ledgerEntries']) {
    for (const d of (await db.collection(col).where('accountId', '==', RES).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection('invoices').where('recipient.id', '==', RES).get()).docs) await d.ref.delete();
  for (const d of (await db.collection('payouts').where('beneficiaryId', '==', RES).get()).docs) await d.ref.delete();
  for (const d of (await db.collection('payoutHolds').where('beneficiaryId', '==', RES).get()).docs) await d.ref.delete();
  await db.doc('subscriptions/cdcc-sub').update({ status: 'active', billingCycle: 'monthly', priceHtCents: 4900, trialEndsAt: null, specialOffer: null, dunning: { attempts: 0, log: [] }, history: [], currentPeriodStart: at(-10 * DAY), currentPeriodEnd: at(20 * DAY), cancelAtPeriodEnd: false });
  await db.doc(`restaurants/${RES}/private/commercial`).update({ subscriptionStatus: 'active', billingMode: null, specialOffer: null, payoutsBlocked: false });
  await db.doc('plans/cdcc-plan').update({ billingMode: 'hybrid', features: [], limits: { maxProducts: null, maxStaff: null, maxPromotions: null }, gracePeriodDays: 0 });
  await db.doc('plans/pro').get(); // lecture : la formule « pro » sert de modèle
  await db.doc('subscriptions/cdcc-sub').update({ planCode: 'cdcc-plan' });
}
const ledgerSale = (id, cents) => db.doc(`ledgerEntries/${id}`).set({ countryId: 'FR', cityId: CITY, accountType: 'restaurant', accountId: RES, type: 'order_revenue', amountCents: cents, currency: 'EUR', vatCents: null, orderId: null, payoutId: null, description: 'Vente de test', bookingDate: new Date().toISOString().slice(0, 10), createdAt: at(0), createdBy: 'system', test: true });

scenarios.subscription = async () => {
  const { runMonthlyInvoices, } = await import('../../functions/src/finance/argent/invoices.ts');
  const { runRenewals, restaurantBalanceCents } = await import('../../functions/src/finance/argent/billing.ts');
  const { runBuildPayouts } = await import('../../functions/src/finance/argent/payouts.ts');
  const { externalFields } = await import('../../functions/src/admin/pilotage/platform-stats.ts');
  const { Timestamp: AdminTimestamp } = await import('../../functions/src/lib/admin.ts');
  const finance = await accountSession('finance@golink.test');
  const owner = await accountSession(OWNER_EMAIL);
  await baseline();
  await resetBilling();
  const notif = async (prefix) => (await db.collection('users').doc(OWNER_UID).collection('notifications').get()).docs.filter((d) => d.id.startsWith(prefix) && d.id.includes('cdcc')).length;
  const notifAny = async (prefix, needle) => (await db.collection('users').doc(OWNER_UID).collection('notifications').get()).docs.filter((d) => d.id.startsWith(prefix) && d.id.includes(needle));

  // A. Facture mensuelle sans solde suffisant : retenue au grand livre, facture à compenser, impayé ouvert.
  const preview = await runMonthlyInvoices({ month: '2026-08', countryId: 'FR', cityIds: [CITY], dryRun: true });
  check('Prévisualisation : une seule facture, celle du commerce de test', preview.restaurantInvoices === 1 && preview.preview[0]?.recipient === 'Test C Resto', JSON.stringify(preview.preview));
  const run = await runMonthlyInvoices({ month: '2026-08', countryId: 'FR', cityIds: [CITY] });
  check('Facture mensuelle émise', run.restaurantInvoices === 1);
  const invId = `fac-${RES}-2026-08`;
  const inv = (await db.doc(`invoices/${invId}`).get()).data();
  const debit = 4900 + Math.round(4900 * 0.2);
  check('Facture : abonnement 49 € HT + TVA, non compensée faute de solde', inv && inv.totalTtcCents === debit && inv.status === 'issued' && inv.compensation?.status === 'pending' && inv.compensation.debitCents === debit, `${inv?.totalTtcCents} c, ${inv?.status}, compensation ${inv?.compensation?.status}`);
  check('Mention légale exacte (pas de « réglé par compensation » abusif)', inv.legalMentions.some((m) => m.includes('à compenser')) && !inv.legalMentions.some((m) => m.startsWith('Montant réglé par compensation')));
  const abo = (await db.doc(`ledgerEntries/${invId}-abo`).get()).data();
  check('Retenue d’abonnement au grand livre du commerce', abo?.type === 'subscription_fee' && abo.amountCents === -debit && abo.payoutId === null && abo.invoiceId === invId);
  const sub1 = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Abonnement passé en impayé, relances programmées', sub1.status === 'past_due' && sub1.dunning.firstFailedAt && sub1.dunning.nextRetryAt && (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('subscriptionStatus') === 'past_due');
  const alert = (await db.collection('platformAlerts').where('kind', '==', 'subscription_unpaid').get()).docs.find((d) => d.get('target.id') === 'cdcc-sub');
  check('Alerte « abonnement impayé » remontée au tableau de bord', alert && alert.get('status') === 'open' && alert.get('queue') === 'todo');
  const sent = await until(async () => (await notifAny('invoice_available', invId)).length && (await notifAny('subscription_payment_due', invId)).length, 60_000);
  check('Facture envoyée au commerce (message « facture disponible ») et relance d’impayé remise', sent, `${(await notifAny('invoice_available', invId)).length} + ${(await notifAny('subscription_payment_due', invId)).length}`);
  const logs = await db.collection('notificationLogs').where('templateKey', '==', 'invoice_available').where('recipientId', '==', OWNER_UID).get();
  check('Envoi de la facture journalisé (simulation)', logs.docs.some((d) => d.get('channel') === 'email'), `${logs.size} entrée(s)`);
  const again = await runMonthlyInvoices({ month: '2026-08', countryId: 'FR', cityIds: [CITY] });
  check('Rejeu de la facturation : aucun doublon', again.restaurantInvoices === 0 && again.skippedExisting === 1 && (await db.collection('ledgerEntries').where('invoiceId', '==', invId).get()).size === 1);

  // B. Relances : tentatives sans compensation, restriction, suspension.
  const retry = () => call(finance, 'manageSubscription', { subscriptionId: 'cdcc-sub', action: 'retry_payment', reason: 'Test cdcc : relance' });
  const r1 = await retry();
  check('Relance 1 : échec explicite (solde insuffisant)', r1.note?.includes('insuffisant'), r1.note);
  await retry();
  let s = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Après 2 échecs : toujours impayé', s.status === 'past_due' && s.dunning.attempts === 2, `${s.status} ${s.dunning.attempts}`);
  await retry();
  s = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('3 échecs : fonctionnalités restreintes', s.status === 'restricted' && s.dunning.restrictedAt, s.status);
  check('Message « fonctions restreintes » remis', (await until(async () => (await notifAny('subscription_restricted', 'cdcc-sub')).length, 40_000)) === 1);
  // Restriction appliquée par le serveur : codes promo coupés.
  await expectError('Restriction appliquée : création d’une promotion refusée', call(owner, 'createPromotion', { restaurantId: RES, title: 'Test restriction', description: null, code: 'CDCCRESTR', kind: 'fixed', value: 200, maxDiscountCents: null, minSubtotalCents: 1000, target: 'everyone', inactiveDays: null, modes: ['pickup'], totalUsageLimit: null, perCustomerLimit: 1, startsAt: Date.now(), endsAt: null, submit: false }), 'FAILED_PRECONDITION', 'restreinte');
  // Les commandes continuent tant que le commerce n'est pas suspendu.
  await setWallet(50_000);
  const stillOk = await place();
  check('Commerce restreint : les commandes continuent', Boolean(stillOk.orderId));
  await cancel(stillOk.orderId);
  await retry();
  s = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Délai de grâce (0 jour) écoulé : abonnement suspendu', s.status === 'suspended' && s.dunning.suspendedAt, s.status);
  await expectError('Abonnement suspendu : plus de nouvelles commandes', place(), 'FAILED_PRECONDITION', 'momentanément indisponible');
  check('Message « abonnement suspendu » remis', (await until(async () => (await notifAny('subscription_suspended', 'cdcc-sub')).length, 40_000)) === 1);

  // C. Les ventes couvrent la retenue : compensation, facture payée, abonnement rétabli.
  await ledgerSale('cdcc-sale-1', 20_000);
  check('Solde à reverser du commerce = ventes − retenue', (await restaurantBalanceCents(RES)) === 20_000 - debit, `${await restaurantBalanceCents(RES)}`);
  const r5 = await retry();
  const paid = (await db.doc(`invoices/${invId}`).get()).data();
  check('Relance réussie : facture compensée et payée', paid.status === 'paid' && paid.compensation.status === 'done' && paid.paidAt, `${paid.status} — ${r5.note}`);
  s = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Abonnement rétabli, compteurs remis à zéro', s.status === 'active' && s.dunning.attempts === 0 && (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('subscriptionStatus') === 'active');
  check('Alerte résolue', (await db.doc(`platformAlerts/${alert.id}`).get()).get('status') === 'resolved');
  check('Message « abonnement rétabli » remis', (await until(async () => (await notifAny('subscription_restored', 'restored')).length >= 1, 40_000)));
  await place().then((r) => cancel(r.orderId)).then(() => record('Commandes de nouveau acceptées', true), (e) => record('Commandes de nouveau acceptées', false, e.message));
  const audit = await db.collection('auditLogs').where('action', '==', 'subscription.restored').where('target.id', '==', RES).get();
  check('Rétablissement audité', audit.size >= 1);

  // D. Compensation par le reversement : facture payée quand le reversement est construit.
  await resetBilling();
  await runMonthlyInvoices({ month: '2026-07', countryId: 'FR', cityIds: [CITY] });
  const invJul = `fac-${RES}-2026-07`;
  check('Nouvelle facture impayée (juillet)', (await db.doc(`invoices/${invJul}`).get()).get('compensation.status') === 'pending' && (await db.doc('subscriptions/cdcc-sub').get()).get('status') === 'past_due');
  await ledgerSale('cdcc-sale-2', 30_000);
  const built = await runBuildPayouts({ type: 'restaurant', until: new Date(Date.now() + DAY).toISOString().slice(0, 10), beneficiaryId: RES, force: true, actorUid: 'cdcc-test' });
  check('Reversement construit avec la retenue d’abonnement', built.created === 1 && built.preview[0]?.netCents === 30_000 - debit, JSON.stringify(built.preview[0]));
  const payout = (await db.collection('payouts').where('beneficiaryId', '==', RES).get()).docs[0]?.data();
  check('Reversement : retenue dans « ajustements et frais », devise et fournisseur posés', payout && payout.adjustmentsCents === -debit && payout.currency === 'EUR' && payout.provider === 'stripe', `${payout?.adjustmentsCents} ${payout?.currency} ${payout?.provider}`);
  const jul = (await db.doc(`invoices/${invJul}`).get()).data();
  check('Facture payée par compensation au reversement, abonnement rétabli', jul.status === 'paid' && jul.compensation.status === 'done' && (await db.doc('subscriptions/cdcc-sub').get()).get('status') === 'active');

  // E. Facture réglée par virement (hors reversement) : la retenue est annulée.
  await resetBilling();
  await runMonthlyInvoices({ month: '2026-06', countryId: 'FR', cityIds: [CITY] });
  const invJun = `fac-${RES}-2026-06`;
  check('Facture de juin à compenser', (await db.doc(`invoices/${invJun}`).get()).get('compensation.status') === 'pending');
  await call(finance, 'markInvoicePaid', { invoiceId: invJun, reason: 'Test cdcc : virement reçu' });
  const jun = (await db.doc(`invoices/${invJun}`).get()).data();
  check('Virement constaté : facture payée', jun.status === 'paid' && jun.compensation.status === 'done' && jun.compensation.method === 'transfer');
  check('Retenue annulée par une écriture inverse (solde du commerce à zéro)', (await restaurantBalanceCents(RES)) === 0, `${await restaurantBalanceCents(RES)}`);
  check('Abonnement rétabli', (await db.doc('subscriptions/cdcc-sub').get()).get('status') === 'active');

  // F. Remise d'une offre spéciale : elle s'éteint à sa fin.
  await resetBilling();
  await db.doc('subscriptions/cdcc-sub').update({ specialOffer: { discountBps: 2000, freeUntil: null, reason: 'Offre test', endsAt: Timestamp.fromDate(new Date('2026-04-30T21:59:59Z')) } });
  await runMonthlyInvoices({ month: '2026-05', countryId: 'FR', cityIds: [CITY] });
  const may = (await db.doc(`invoices/fac-${RES}-2026-05`).get()).data();
  check('Mai (offre échue fin avril) : aucune remise appliquée', may && !may.lines.some((l) => l.label.startsWith('Offre spéciale')) && may.totalHtCents === 4900, `${may?.totalHtCents} c HT`);
  await runMonthlyInvoices({ month: '2026-04', countryId: 'FR', cityIds: [CITY] });
  const apr = (await db.doc(`invoices/fac-${RES}-2026-04`).get()).data();
  check('Avril (offre en cours) : remise de 20 % appliquée', apr && apr.lines.some((l) => l.label.startsWith('Offre spéciale')) && apr.totalHtCents === 4900 - 980, `${apr?.totalHtCents} c HT`);

  // G. Essai gratuit : conversion à son terme ; période renouvelée.
  await resetBilling();
  await db.doc('subscriptions/cdcc-sub').update({ status: 'trialing', trialEndsAt: at(-DAY), currentPeriodEnd: at(-DAY) });
  const t1 = await runRenewals(AdminTimestamp.now(), [RES]);
  const conv = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Fin d’essai : conversion en abonnement actif', t1.converted === 1 && conv.status === 'active' && conv.currentPeriodEnd.toMillis() > Date.now() && conv.history.some((h) => h.event === 'trial_converted'));
  await db.doc('subscriptions/cdcc-sub').update({ currentPeriodStart: at(-40 * DAY), currentPeriodEnd: at(-10 * DAY) });
  const t2 = await runRenewals(AdminTimestamp.now(), [RES]);
  const ren = (await db.doc('subscriptions/cdcc-sub').get()).data();
  check('Période écoulée : renouvellement (rattrapage par périodes entières)', t2.renewed === 1 && ren.currentPeriodEnd.toMillis() > Date.now() && ren.history.some((h) => h.event === 'renewed'), ren.currentPeriodEnd.toDate().toISOString().slice(0, 10));
  const t3 = await runRenewals(AdminTimestamp.now(), [RES]);
  check('Renouvellement rejouable sans effet', t3.renewed === 0 && t3.converted === 0);

  // H. Formule : fonctionnalités et limites appliquées.
  await resetBilling();
  await db.doc('plans/cdcc-plan').update({ features: ['orders', 'menu'] });
  await expectError('Fonction absente de la formule : refus', call(owner, 'createPromotion', { restaurantId: RES, title: 'Test formule', description: null, code: 'CDCCFORM', kind: 'fixed', value: 200, maxDiscountCents: null, minSubtotalCents: 1000, target: 'everyone', inactiveDays: null, modes: ['pickup'], totalUsageLimit: null, perCustomerLimit: 1, startsAt: Date.now(), endsAt: null, submit: false }), 'FAILED_PRECONDITION', 'ne comprend pas');
  await db.doc('plans/cdcc-plan').update({ features: [], limits: { maxProducts: null, maxStaff: null, maxPromotions: 1 } });
  const okPromo = await call(owner, 'createPromotion', { restaurantId: RES, title: 'Test limite 1', description: null, code: 'CDCCLIM1', kind: 'fixed', value: 200, maxDiscountCents: null, minSubtotalCents: 1000, target: 'everyone', inactiveDays: null, modes: ['pickup'], totalUsageLimit: null, perCustomerLimit: 1, startsAt: Date.now(), endsAt: null, submit: true });
  check('Sous la limite de la formule : création acceptée', Boolean(okPromo.promotionId ?? okPromo.id), JSON.stringify(okPromo));
  await expectError('Limite de la formule atteinte (1 offre) : refus', call(owner, 'createPromotion', { restaurantId: RES, title: 'Test limite 2', description: null, code: 'CDCCLIM2', kind: 'fixed', value: 200, maxDiscountCents: null, minSubtotalCents: 1000, target: 'everyone', inactiveDays: null, modes: ['pickup'], totalUsageLimit: null, perCustomerLimit: 1, startsAt: Date.now(), endsAt: null, submit: true }), 'FAILED_PRECONDITION', 'limitée à 1');
  for (const d of (await db.collection('promotions').where('restaurantId', '==', RES).get()).docs) await d.ref.delete();

  // I. Tableau de bord : « Abonnements encaissés » ne compte que les factures payées, à la date du paiement.
  await resetBilling();
  await runMonthlyInvoices({ month: '2026-03', countryId: 'FR', cityIds: [CITY] });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const unpaidKpi = await externalFields(CITY, today);
  check('KPI abonnements encaissés : une facture impayée ne compte pas', (unpaidKpi.revenue?.subscriptionsHtCents ?? -1) === 0, `${unpaidKpi.revenue?.subscriptionsHtCents}`);
  await ledgerSale('cdcc-sale-3', 20_000);
  await call(finance, 'manageSubscription', { subscriptionId: 'cdcc-sub', action: 'retry_payment', reason: 'Test cdcc : KPI' }).catch(() => undefined);
  const paidKpi = await externalFields(CITY, today);
  check('KPI abonnements encaissés : la facture payée compte (49 € HT), le jour du paiement', paidKpi.revenue?.subscriptionsHtCents === 4900, `${paidKpi.revenue?.subscriptionsHtCents}`);
  await resetBilling();
};

// ------------------------------------------------------------------ Espèces

async function cashOrder(id, cents, { driverless = false, ...extra } = {}) {
  const total = cents;
  const subtotal = cents - 299;
  const order = {
    number: `GL-C${id.slice(-4).toUpperCase()}`, countryId: 'FR', cityId: CITY, restaurantId: RES, restaurantName: 'Test C Resto', restaurantGroupId: null,
    customerId: CLIENT, customerName: 'Cdcc C.', customerPhoneMasked: null, status: 'picked_up', fulfillment: 'delivery', itemsCount: 1,
    items: [{ lineId: 'l1', productId: 'cdcc-p1', name: 'Test plat C', imageUrl: null, unitPriceCents: subtotal, quantity: 1, options: [], optionsPriceCents: 0, totalCents: subtotal, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }],
    amounts: { subtotalCents: subtotal, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [{ category: 'food', rateBps: 1000, ttcCents: subtotal, htCents: Math.round(subtotal / 1.1), vatCents: subtotal - Math.round(subtotal / 1.1) }], currency: 'EUR' },
    payment: { method: 'cash', status: 'pending', paymentId: `pay-${id}`, label: null, paidAt: null },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: null, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.5395, longitude: 5.7829 }, zoneId: 'longwy-centre', distanceMeters: 1500, deliveredBy: 'restaurant', driverId: driverless ? null : DRIVER, driverName: driverless ? null : 'Livreur Test C', driverPhoneMasked: null, driverVehicle: 'scooter', promisedFrom: at(-10 * MIN), promisedTo: at(10 * MIN), estimatedArrivalAt: at(5 * MIN), proof: null, handoverCodeRequired: false, dispatchStatus: driverless ? null : 'assigned' },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-40 * MIN), new: at(-40 * MIN), accepted: at(-38 * MIN), preparing: at(-37 * MIN), assigned: at(-30 * MIN), ready: at(-25 * MIN), picked_up: at(-20 * MIN) },
    acceptDeadline: null, cancellation: null, flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_android', appVersion: '1.4.0' }, driverId: driverless ? null : DRIVER, searchKeywords: [id],
    restaurantSettlement: { grossCents: subtotal, discountFundedCents: 0, commissionBaseCents: subtotal, commissionBps: 1200, commissionHtCents: Math.round((subtotal * 0.12) / 1.2), commissionVatCents: Math.round(subtotal * 0.12) - Math.round((subtotal * 0.12) / 1.2), commissionTtcCents: Math.round(subtotal * 0.12), deliveryFeeCents: 299, paymentFeeCents: 0, payoutCents: subtotal - Math.round(subtotal * 0.12) + 299 },
    commission: { bps: 1200, source: 'market', billingMode: 'commission' }, processed: {}, createdAt: at(-40 * MIN), updatedAt: at(-1 * MIN), test: true, seed: true, ...extra,
  };
  await db.doc(`payments/pay-${id}`).set({ countryId: 'FR', cityId: CITY, purpose: 'order', orderId: id, subscriptionId: null, invoiceId: null, payerType: 'client', payerId: CLIENT, restaurantId: RES, method: 'cash', amountCents: total, currency: 'EUR', status: 'pending', provider: 'cash', providerIntentId: null, providerChargeId: null, feeCents: 0, attempts: 1, refundedCents: 0, createdAt: at(-40 * MIN), updatedAt: at(-40 * MIN), test: true, seed: true });
  await db.doc(`orders/${id}`).set(order);
  created.orders.add(id);
  return order;
}

scenarios.cash = async () => {
  const owner = await accountSession(OWNER_EMAIL);
  const finance = await accountSession('finance@golink.test');
  await baseline();
  await db.doc(`driverPrivate/${DRIVER}`).update({ cashBalanceCents: 0, cashLimitCents: 5000 });
  await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).update({ cashHeldCents: 0 });
  for (const d of (await db.collection('cashMovements').where('driverId', '==', DRIVER).get()).docs) await d.ref.delete();

  const id1 = 'cdcc-cash-1';
  await cashOrder(id1, 3049);
  const done = await call(owner, 'completeOrder', { orderId: id1 });
  check('Livraison en espèces clôturée par le commerce (livreur salarié)', done.status === 'delivered');
  const mv = await until(async () => (await db.doc(`cashMovements/cash-${id1}`).get()).data(), 90_000);
  check('Espèces encaissées suivies : mouvement « encaissé » du montant payé', mv && mv.type === 'collected' && mv.amountCents === 3049 && mv.balanceAfterCents === 3049 && mv.restaurantId === RES, JSON.stringify(mv));
  check('Caisse du livreur augmentée', (await db.doc(`driverPrivate/${DRIVER}`).get()).get('cashBalanceCents') === 3049);
  check('Solde reflété sur la fiche livreur du commerce', (await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).get()).get('cashHeldCents') === 3049);
  const fin = await until(async () => (await db.doc(`orderFinancials/${id1}`).get()).exists, 60_000);
  check('Commande comptabilisée : aucune écriture de caisse pour GoLink (l’argent reste au commerce)', fin && !(await db.collection('ledgerEntries').where('orderId', '==', id1).get()).docs.some((d) => d.get('accountType') === 'driver_cash'));
  await sleep(5000);
  check('Rejeu du déclencheur : jamais de double comptage', (await db.doc(`driverPrivate/${DRIVER}`).get()).get('cashBalanceCents') === 3049);

  const id2 = 'cdcc-cash-2';
  await cashOrder(id2, 2500);
  await call(owner, 'completeOrder', { orderId: id2 });
  await until(async () => (await db.doc(`cashMovements/cash-${id2}`).get()).exists, 90_000);
  check('Deuxième livraison : caisse cumulée', (await db.doc(`driverPrivate/${DRIVER}`).get()).get('cashBalanceCents') === 5549);
  const alertNotif = await until(async () => (await db.collection('users').doc(OWNER_UID).collection('notifications').get()).docs.find((d) => d.id.startsWith('cash_limit_reached') && d.id.includes(id2))?.data(), 60_000);
  check('Plafond atteint : alerte remise au commerce', alertNotif && /plafond/i.test(alertNotif.body), alertNotif?.body);

  // Plafond appliqué à l'attribution d'une commande en espèces.
  const id3 = 'cdcc-cash-3';
  await cashOrder(id3, 2000, { status: 'ready', driverless: true });
  await expectError('Plafond atteint : commande en espèces non attribuable au livreur', call(owner, 'assignOwnCourier', { orderId: id3, driverId: DRIVER }), 'FAILED_PRECONDITION', 'détient');
  await db.doc(`drivers/${DRIVER}`).update({ acceptsCash: false });
  await call(owner, 'recordMerchantCashRemittance', { restaurantId: RES, driverId: DRIVER, amountCents: 5549, note: 'Test cdcc : caisse remise' }).then((r) => check('Remise de caisse enregistrée par le commerce', r.cashBalanceCents === 0));
  await expectError('Espèces non autorisées pour ce livreur : refus', call(owner, 'assignOwnCourier', { orderId: id3, driverId: DRIVER }), 'FAILED_PRECONDITION', 'pas autorisé');
  await db.doc(`drivers/${DRIVER}`).update({ acceptsCash: true });
  const assigned = await call(owner, 'assignOwnCourier', { orderId: id3, driverId: DRIVER });
  check('Caisse remise et espèces autorisées : attribution acceptée', Boolean(assigned.driverName));
  check('Fiche livreur du commerce remise à zéro', (await db.doc(`restaurants/${RES}/couriers/${DRIVER}`).get()).get('cashHeldCents') === 0);
  const remitted = (await db.collection('cashMovements').where('driverId', '==', DRIVER).get()).docs.map((d) => d.data()).find((m) => m.type === 'remitted');
  check('Remise tracée (mouvement négatif, solde après)', remitted && remitted.amountCents === -5549 && remitted.balanceAfterCents === 0);
  const aud = await db.collection('auditLogs').where('action', '==', 'driver.cash_remitted').where('target.id', '==', DRIVER).get();
  check('Remise auditée', aud.size >= 1);
  await expectError('Remise supérieure à la caisse refusée', call(owner, 'recordMerchantCashRemittance', { restaurantId: RES, driverId: DRIVER, amountCents: 100 }), 'FAILED_PRECONDITION', 'ne détient');
  await expectError('Remise refusée pour un livreur d’un autre commerce', call(owner, 'recordMerchantCashRemittance', { restaurantId: 'mina-kitchen', driverId: DRIVER, amountCents: 100 }), 'FAILED_PRECONDITION');
  // Administration : remise enregistrée par l'équipe finance.
  await db.doc(`driverPrivate/${DRIVER}`).update({ cashBalanceCents: 1000 });
  const adminRemit = await call(finance, 'recordCashRemittance', { driverId: DRIVER, amountCents: 400, reason: 'Test cdcc : remise déclarée par l’équipe' }).catch((e) => e);
  check('Remise déclarée par l’équipe GoLink (droit finance)', adminRemit?.cashBalanceCents === 600 || adminRemit?.status === 'PERMISSION_DENIED', JSON.stringify(adminRemit?.cashBalanceCents ?? adminRemit?.message));
  // Espèces refusées avec un livreur de la plateforme (décision client).
  const platformDelivery = await call(CLIENT_TOKEN(), 'placeOrder', { restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcc-p1', quantity: 2 }], paymentMethod: 'cash', clientRequestId: `cdcc${Date.now().toString(36)}cash` }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  check('Espèces au retrait refusées (décision client)', !platformDelivery.ok && platformDelivery.e.message.includes('espèces'), platformDelivery.ok ? 'accepté' : platformDelivery.e.message);
  await db.doc(`driverPrivate/${DRIVER}`).update({ cashBalanceCents: 0 });
};

// ------------------------------------------------------------------ Parrainage et fidélité

function luhnSiret() {
  for (;;) {
    const body = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('');
    for (let d = 0; d < 10; d += 1) {
      const n = `${body}${d}`;
      let sum = 0;
      [...n].reverse().forEach((c, i) => { let x = Number(c); if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; } sum += x; });
      if (sum % 10 === 0) return n;
    }
  }
}

scenarios.referral = async () => {
  const owner = await accountSession(OWNER_EMAIL);
  await baseline();
  await db.doc(`restaurants/${RES}/private/commercial`).update({ adCreditCents: 0 });
  const refSettingsRef = db.doc('settings/referral');
  const originalReferral = (await refSettingsRef.get()).data();
  const codeBefore = (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('referralCode');
  try {
    await refSettingsRef.set({ ...originalReferral, restaurant: { enabled: true, rewardCents: 10_000, qualifyingOrders: 0, rewardType: 'ad_credit' }, client: { enabled: true, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 } });
    const link = await call(owner, 'getRestaurantReferralLink', { restaurantId: RES });
    check('Lien et code de parrainage du commerce générés', /^GL-[A-Z2-9]{6}$/.test(link.code) && link.url.endsWith(`?parrain=${link.code}`) && link.rewardCents === 10_000 && link.enabled, `${link.code} · ${link.url}`);
    const link2 = await call(owner, 'getRestaurantReferralLink', { restaurantId: RES });
    check('Le code reste stable', link2.code === link.code);
    await expectError('Lien réservé aux membres du commerce', call(await accountSession('youssef.karim@golink.test'), 'getRestaurantReferralLink', { restaurantId: RES }), 'PERMISSION_DENIED');

    // Inscription d'un commerce avec le code du parrain.
    const email = `cdcc-filleul-${Date.now().toString(36)}@golink.test`;
    const signup = (over = {}, code = link.code) => call(null, 'restaurantSignup', {
      restaurant: { name: 'Filleul Test C', phone: '+33 6 12 34 56 78', address: { line1: '5 rue du Test', postalCode: '54400', city: 'Longwy', countryCode: 'FR' } },
      owner: { firstName: 'Fil', lastName: 'Leul', email, phone: '+33 6 12 34 56 78', password: `${randomBytes(9).toString('base64url')}Aa1` },
      legal: { legalName: 'Filleul SAS', registrationNumber: luhnSiret() },
      acceptTerms: true, referralCode: code, ...over,
    });
    const signed = await signup();
    created.restaurants.add(signed.restaurantId);
    const ownerUidFilleul = (await auth.getUserByEmail(email)).uid;
    created.authUsers.add(ownerUidFilleul);
    check('Inscription avec le code : parrainage enregistré', signed.status === 'pending' && signed.referral?.applied === true && signed.referral.accepted === true, JSON.stringify(signed.referral));
    const referral = (await db.doc(`referrals/rest-${signed.restaurantId}`).get()).data();
    check('Document de parrainage créé (en attente), parrain et filleul renseignés', referral?.status === 'pending' && referral.program === 'restaurant' && referral.referrerId === RES && referral.refereeId === signed.restaurantId && referral.code === link.code && referral.refereeName === 'Filleul Test C', JSON.stringify({ status: referral?.status, referrer: referral?.referrerId }));
    check('Commerce parrainé rattaché à son parrain', (await db.doc(`restaurants/${signed.restaurantId}/private/commercial`).get()).get('referredByRestaurantId') === RES);
    check('Crédit non versé avant la mise en ligne', (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('adCreditCents') === 0);

    // Mise en ligne du commerce parrainé : prime versée au parrain (100 € de budget publicitaire).
    await db.doc(`restaurants/${signed.restaurantId}`).update({ status: 'active', onboardingStatus: 'approved' });
    const rewarded = await until(async () => (await db.doc(`referrals/rest-${signed.restaurantId}`).get()).get('status') === 'rewarded', 90_000);
    check('Commerce validé : parrainage récompensé', rewarded);
    check('Budget publicitaire de 100 € crédité au parrain', (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('adCreditCents') === 10_000);
    const ref2 = (await db.doc(`referrals/rest-${signed.restaurantId}`).get()).data();
    check('Récompense consignée sur le parrainage', ref2.referrerRewardCents === 10_000 && ref2.rewardedAt);
    const notif = await until(async () => (await db.collection('users').doc(OWNER_UID).collection('notifications').get()).docs.find((d) => d.get('title') === 'Parrainage récompensé')?.data(), 40_000);
    check('Parrain prévenu', Boolean(notif));
    await db.doc(`restaurants/${signed.restaurantId}`).update({ status: 'paused' });
    await db.doc(`restaurants/${signed.restaurantId}`).update({ status: 'active' });
    await sleep(8000);
    check('Réactivation : aucune seconde prime', (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('adCreditCents') === 10_000);
    const aud = await db.collection('auditLogs').where('action', '==', 'referral.rewarded').where('target.id', '==', RES).get();
    check('Récompense auditée', aud.size >= 1);
    const parrainList = await db.collection('referrals').where('referrerId', '==', RES).where('program', '==', 'restaurant').where('referrerType', '==', 'restaurant').get();
    check('Parrainages du commerce listables (règles de lecture du commerce)', parrainList.size >= 1);

    // Auto-parrainage : même SIRET que le parrain.
    const dupEmail = `cdcc-doublon-${Date.now().toString(36)}@golink.test`;
    const dup = await call(null, 'restaurantSignup', {
      restaurant: { name: 'Doublon Test C', phone: '+33 6 99 00 00 01', address: { line1: '6 rue du Test', postalCode: '54400', city: 'Longwy', countryCode: 'FR' } },
      owner: { firstName: 'Dou', lastName: 'Blon', email: dupEmail, phone: '+33 6 99 00 00 01', password: `${randomBytes(9).toString('base64url')}Aa1` },
      legal: { legalName: 'Doublon SAS', registrationNumber: '43954771791364' }, acceptTerms: true, referralCode: link.code,
    });
    created.restaurants.add(dup.restaurantId);
    created.authUsers.add((await auth.getUserByEmail(dupEmail)).uid);
    const dupRef = (await db.doc(`referrals/rest-${dup.restaurantId}`).get()).data();
    check('Auto-parrainage (même SIRET, même téléphone) : refusé avec les signaux relevés', dupRef?.status === 'rejected' && dupRef.fraudSignals?.includes('même SIRET') && dupRef.fraudSignals.includes('même téléphone du gérant'), JSON.stringify(dupRef?.fraudSignals));
    await db.doc(`restaurants/${dup.restaurantId}`).update({ status: 'active' });
    await sleep(8000);
    check('Aucune prime pour un auto-parrainage', (await db.doc(`restaurants/${RES}/private/commercial`).get()).get('adCreditCents') === 10_000);
    const unknown = await signup({ restaurant: { name: 'Sans parrain', phone: '+33 6 12 34 56 79', address: { line1: '7 rue du Test', postalCode: '54400', city: 'Longwy', countryCode: 'FR' } }, owner: { firstName: 'S', lastName: 'P', email: `cdcc-sp-${Date.now().toString(36)}@golink.test`, phone: '+33 6 12 34 56 79', password: `${randomBytes(9).toString('base64url')}Aa1` } }, 'GL-ZZZZZZ');
    created.restaurants.add(unknown.restaurantId);
    check('Code inconnu : inscription acceptée sans parrainage', unknown.status === 'pending' && unknown.referral?.applied === false && unknown.referral.reason === 'code_unknown', JSON.stringify(unknown.referral));
    // Code saisi après l'inscription.
    await expectError('Code d’un parrain saisi après coup : refus pour son propre code', call(owner, 'applyRestaurantReferralCode', { restaurantId: RES, code: link.code }), 'FAILED_PRECONDITION', 'propre code');
    const late = await call(owner, 'applyRestaurantReferralCode', { restaurantId: RES, code: 'GL-QQQQQQ' }).catch((e) => e);
    check('Code inexistant saisi après coup : refus', late.status === 'FAILED_PRECONDITION' && /n’existe pas/.test(late.message), late.message);
    // Programme fermé.
    await refSettingsRef.set({ ...originalReferral, restaurant: { ...originalReferral.restaurant, enabled: false } });
    await db.doc(`referralCodes/${link.code}`).get();
    await expectError('Programme fermé : code refusé', call(owner, 'applyRestaurantReferralCode', { restaurantId: RES, code: link.code }), 'FAILED_PRECONDITION');
    await refSettingsRef.set({ ...originalReferral, restaurant: { enabled: true, rewardCents: 10_000, qualifyingOrders: 0, rewardType: 'ad_credit' }, client: { enabled: true, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 } });

    // Parrainage client : code saisi avant la première commande, récompense à la première livraison.
    const token2 = await testUserSession('cdcc-client2', 'cdcc-client2@golink.test');
    await clone(`users/${CLIENT}`, 'users/cdcc-client2', { email: 'cdcc-client2@golink.test', referralCode: 'CDCCREF2', firstName: 'Deux', displayName: 'Deux Client', phone: '+33 6 77 77 77 77', walletBalanceCents: 0, 'stats': { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
    await db.doc(`users/${CLIENT}`).update({ phone: '+33 6 11 11 11 11', walletBalanceCents: 0 });
    await expectError('Client : code inexistant refusé', call(token2, 'applyReferralCode', { code: 'ZZZZZZZZ' }), 'FAILED_PRECONDITION', 'n’existe pas');
    await expectError('Client : son propre code refusé', call(token2, 'applyReferralCode', { code: 'CDCCREF2' }), 'FAILED_PRECONDITION', 'propre code');
    const applied = await call(token2, 'applyReferralCode', { code: 'CDCCREF1' });
    check('Client : code du parrain enregistré', applied.rewardCents === 500 && (await db.doc('users/cdcc-client2').get()).get('referredBy') === CLIENT && (await db.doc('referrals/cli-cdcc-client2').get()).get('status') === 'pending');
    await expectError('Client : un seul code par compte', call(token2, 'applyReferralCode', { code: 'CDCCREF1' }), 'FAILED_PRECONDITION', 'déjà');
    // Première commande livrée (espèces, livreur salarié) : les deux portefeuilles sont crédités.
    const idc = 'cdcc-refcli-1';
    await cashOrder(idc, 3049, { customerId: 'cdcc-client2', flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: true } });
    await call(owner, 'completeOrder', { orderId: idc });
    const both = await until(async () => (await db.doc('referrals/cli-cdcc-client2').get()).get('status') === 'rewarded', 90_000);
    check('Première commande livrée : parrainage client récompensé', both);
    check('Parrain et filleul crédités de 5 € dans leur portefeuille', (await db.doc(`users/${CLIENT}`).get()).get('walletBalanceCents') === 500 && (await db.doc('users/cdcc-client2').get()).get('walletBalanceCents') === 500);
    // Récompense dépensable à la commande.
    const spend = await place({ paymentMethodId: 'pm_card_visa' });
    const os = await getOrder(spend.orderId);
    check('Récompense de parrainage dépensée à la commande', os.amounts.walletAppliedCents === 500, `${os.amounts.walletAppliedCents} c`);
    await cancel(spend.orderId);
    // Une commande qui n'est pas la première ne qualifie pas.
    await db.doc('referrals/cli-cdcc-client2').delete();
    await db.doc('users/cdcc-client2').update({ referredBy: null });
    await refSettingsRef.set({ ...originalReferral, client: { enabled: false, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 } });
    await expectError('Programme client fermé : code refusé', call(token2, 'applyReferralCode', { code: 'CDCCREF1' }), 'FAILED_PRECONDITION', 'pas ouvert');
  } finally {
    await refSettingsRef.set(originalReferral);
    if (codeBefore === undefined) await db.doc(`restaurants/${RES}/private/commercial`).update({ referralCode: null }).catch(() => undefined);
  }
};

scenarios.loyalty = async () => {
  const owner = await accountSession(OWNER_EMAIL);
  await baseline();
  await db.doc(`users/${CLIENT}`).update({ walletBalanceCents: 0, 'stats.ordersCount': 0 });
  const ref = db.doc('settings/loyalty');
  const original = (await ref.get()).data();
  try {
    for (const col of ['loyaltyTransactions']) for (const d of (await db.collection(col).where('userId', '==', CLIENT).get()).docs) await d.ref.delete();
    await db.doc(`loyaltyAccounts/${CLIENT}`).delete().catch(() => undefined);
    await ref.set({ ...original, enabled: false });
    const off = 'cdcc-loy-off';
    await cashOrder(off, 3049);
    await call(owner, 'completeOrder', { orderId: off });
    await sleep(15_000);
    check('Programme éteint (défaut) : aucun point gagné', !(await db.doc(`loyaltyTransactions/earn-${off}`).get()).exists);

    await ref.set({ ...original, enabled: true, pointsPerEuro: 2, welcomePoints: 5, minOrderCents: 0, pointsValidityDays: 365, rewards: [{ points: 50, valueCents: 300 }] });
    const id = 'cdcc-loy-1';
    await cashOrder(id, 3049, { flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: true } });
    await call(owner, 'completeOrder', { orderId: id });
    const earn = await until(async () => (await db.doc(`loyaltyTransactions/earn-${id}`).get()).data(), 90_000);
    const subtotal = 3049 - 299;
    const points = Math.floor((subtotal / 100) * 2);
    check('Livraison : points gagnés (2 par euro de sous-total)', earn && earn.points === points && earn.remaining === points && earn.expiresAt, `${earn?.points} pts (attendu ${points})`);
    const welcome = (await db.doc(`loyaltyTransactions/welcome-${CLIENT}`).get()).data();
    check('Première commande : points de bienvenue', welcome?.points === 5);
    const acc = (await db.doc(`loyaltyAccounts/${CLIENT}`).get()).data();
    check('Compte de fidélité mis à jour', acc?.points === points + 5 && acc.lifetimePoints === points + 5, `${acc?.points}`);
    await sleep(6000);
    check('Rejeu : jamais de double crédit de points', (await db.doc(`loyaltyAccounts/${CLIENT}`).get()).get('points') === points + 5);
    // Échange contre du crédit au portefeuille.
    await expectError('Palier inexistant refusé', call(CLIENT_TOKEN(), 'redeemLoyaltyPoints', { points: 51 }), 'INVALID_ARGUMENT', 'palier');
    const redeemed = await call(CLIENT_TOKEN(), 'redeemLoyaltyPoints', { points: 50 });
    check('Échange de 50 points : 3,00 € ajoutés au portefeuille', redeemed.valueCents === 300 && redeemed.balanceCents === 300 && redeemed.pointsLeft === points + 5 - 50, JSON.stringify(redeemed));
    const walletTx = (await db.collection('walletTransactions').where('userId', '==', CLIENT).where('reason', '==', 'loyalty_reward').get()).docs[0]?.data();
    check('Crédit tracé (motif « récompense de fidélité »)', walletTx?.amountCents === 300);
    await expectError('Solde de points insuffisant', call(CLIENT_TOKEN(), 'redeemLoyaltyPoints', { points: 50 }), 'FAILED_PRECONDITION', 'manque');
    // Expiration : le lot arrivé à échéance est retiré du compte.
    const { expireLoyaltyPoints } = await import('../../functions/src/marketing/platform/loyalty.ts');
    const beforeExpiry = (await db.doc(`loyaltyAccounts/${CLIENT}`).get()).get('points');
    const lotRemaining = (await db.doc(`loyaltyTransactions/earn-${id}`).get()).get('remaining');
    await db.doc(`loyaltyTransactions/earn-${id}`).update({ expiresAt: at(-DAY) });
    const expiry = await expireLoyaltyPoints();
    const remaining = (await db.doc(`loyaltyTransactions/earn-${id}`).get()).get('remaining');
    const acc2 = (await db.doc(`loyaltyAccounts/${CLIENT}`).get()).data();
    check('Expiration : points restants du lot périmé retirés du compte', expiry.points === lotRemaining && remaining === 0 && acc2.points === beforeExpiry - lotRemaining, `expirés ${expiry.points}, compte ${beforeExpiry} → ${acc2?.points}`);
    check('Expiration tracée', (await db.collection('loyaltyTransactions').where('userId', '==', CLIENT).where('type', '==', 'expire').get()).size >= 1);
    const second = await expireLoyaltyPoints();
    check('Expiration rejouable sans effet', second.points === 0 && (await db.doc(`loyaltyAccounts/${CLIENT}`).get()).get('points') === beforeExpiry - lotRemaining);
  } finally {
    await ref.set(original);
  }
};

// ------------------------------------------------------------------ Devises, comptes de paiement et virement manuel

scenarios.providers = async () => {
  const owner = await accountSession(OWNER_EMAIL);
  const finance = await accountSession('finance@golink.test');
  const { runBuildPayouts } = await import('../../functions/src/finance/argent/payouts.ts');
  const DZ = 'cdcc-resto-dz';
  await clone(`restaurants/${RES}`, `restaurants/${DZ}`, { name: 'Test C Algérie', slug: 'test-c-dz', countryId: 'DZ', cityId: CITY, test: true, seed: true });
  created.restaurants.add(DZ);
  await clone(`restaurants/${RES}/private/commercial`, `restaurants/${DZ}/private/commercial`, { payoutAccount: null, test: true });
  await clone(`restaurants/${RES}/members/${OWNER_UID}`, `restaurants/${DZ}/members/${OWNER_UID}`, { restaurantId: DZ, test: true });
  for (const d of (await db.collection('payouts').where('beneficiaryId', '==', DZ).get()).docs) await d.ref.delete();
  for (const d of (await db.collection('ledgerEntries').where('accountId', '==', DZ).get()).docs) await d.ref.delete();
  await db.doc(`ledgerEntries/cdcc-dz-1`).set({ countryId: 'DZ', cityId: CITY, accountType: 'restaurant', accountId: DZ, type: 'order_revenue', amountCents: 250_000, currency: 'DZD', vatCents: null, orderId: null, payoutId: null, description: 'Vente de test (DZD)', bookingDate: new Date().toISOString().slice(0, 10), createdAt: at(0), createdBy: 'system', test: true });

  // Prestataires : lecture, droits, saisie.
  const providers = await db.collection('paymentProviders').get();
  check('Prestataires par pays présents (Stripe + virements locaux)', providers.docs.some((d) => d.id === 'stripe') && ['virement_dz', 'virement_ma', 'virement_tn'].every((id) => providers.docs.some((d) => d.id === id)), providers.docs.map((d) => d.id).join(', '));
  check('Pays reliés à leurs prestataires', (await db.doc('countries/DZ').get()).get('paymentProviderIds')?.includes('virement_dz') && (await db.doc('countries/FR').get()).get('paymentProviderIds')?.includes('stripe'));
  check('Devises des marchés (DZD, MAD, TND, EUR)', (await db.doc('countries/DZ').get()).get('currency') === 'DZD' && (await db.doc('countries/MA').get()).get('currency') === 'MAD' && (await db.doc('countries/TN').get()).get('currency') === 'TND' && (await db.doc('countries/FR').get()).get('currency') === 'EUR');
  await expectError('Prestataire : modification refusée à un commerce', call(owner, 'savePaymentProvider', { code: 'cdcc_test', label: 'Test', countryIds: ['DZ'], currencies: ['DZD'], supports: { collect: false, payout: true }, kinds: ['bank_transfer'], mode: 'manual', enabled: true, reason: 'Test cdcc' }), 'PERMISSION_DENIED');
  await expectError('Pays hors marché du prestataire refusé', call(finance, 'setCountryProviders', { countryId: 'MA', providerIds: ['virement_dz'], reason: 'Test cdcc' }), undefined, undefined);

  // Reversement d'un pays sans Stripe : devise, fournisseur manuel, virement à la main.
  const built = await runBuildPayouts({ type: 'restaurant', until: new Date(Date.now() + DAY).toISOString().slice(0, 10), beneficiaryId: DZ, force: true, actorUid: 'cdcc-test' });
  check('Reversement Algérie construit', built.created === 1 && built.preview[0]?.netCents === 250_000);
  const payout = (await db.collection('payouts').where('beneficiaryId', '==', DZ).get()).docs[0];
  const p = payout.data();
  check('Reversement en dinars algériens, fournisseur « manuel »', p.currency === 'DZD' && p.provider === 'manual', `${p.currency} ${p.provider}`);
  await expectError('« Verser » (Stripe) refusé pour un pays sans Stripe', call(finance, 'executePayout', { payoutId: payout.id }), 'FAILED_PRECONDITION', 'à la main');
  check('Reversement laissé programmé (pas d’échec fictif)', (await payout.ref.get()).get('status') === 'scheduled');
  await expectError('Virement manuel refusé sans compte vérifié', call(finance, 'markPayoutPaidManually', { payoutId: payout.id, reference: 'VIR-DZ-0001', reason: 'Test cdcc' }), 'FAILED_PRECONDITION', 'pas vérifié');
  await expectError('Compte local refusé dans un pays avec Stripe', call(owner, 'setRestaurantPayoutAccount', { restaurantId: RES, account: { provider: 'bank_transfer', holderName: 'Test', accountNumber: '00799999123456789012' } }), 'FAILED_PRECONDITION', 'Stripe');
  const saved = await call(owner, 'setRestaurantPayoutAccount', { restaurantId: DZ, account: { provider: 'bank_transfer', paymentProviderId: 'virement_dz', holderName: 'Test C Algérie SARL', accountNumber: '00799999123456789012' } });
  check('Compte local enregistré, numéro masqué', saved.accountMasked === '0079 •••• 9012' && saved.verified === false, saved.accountMasked);
  const stored = (await db.doc(`restaurants/${DZ}/private/commercial`).get()).get('payoutAccount');
  check('Aucun numéro complet conservé', stored && !JSON.stringify(stored).includes('123456789') && stored.currency === 'DZD');
  await expectError('Virement manuel toujours refusé tant que le compte n’est pas vérifié', call(finance, 'markPayoutPaidManually', { payoutId: payout.id, reference: 'VIR-DZ-0001', reason: 'Test cdcc' }), 'FAILED_PRECONDITION', 'pas vérifié');
  await call(finance, 'verifyPayoutAccount', { beneficiaryType: 'restaurant', beneficiaryId: DZ, verified: true, reason: 'Test cdcc : RIB contrôlé' });
  check('Compte vérifié par l’équipe finance', (await db.doc(`restaurants/${DZ}/private/commercial`).get()).get('payoutAccount.verified') === true);
  const paid = await call(finance, 'markPayoutPaidManually', { payoutId: payout.id, reference: 'VIR-DZ-0001', reason: 'Test cdcc : virement émis' });
  check('Virement manuel enregistré avec sa référence', paid.status === 'paid');
  const after = (await payout.ref.get()).data();
  check('Reversement payé : référence conservée, statut payé', after.status === 'paid' && after.manualReference === 'VIR-DZ-0001' && after.providerTransferId === 'VIR-DZ-0001' && after.paidAt);
  const vir = (await db.doc(`ledgerEntries/${payout.id}-vir`).get()).data();
  check('Écriture de virement au grand livre en dinars', vir?.type === 'payout' && vir.amountCents === -250_000 && vir.currency === 'DZD');
  await expectError('Virement manuel non rejouable', call(finance, 'markPayoutPaidManually', { payoutId: payout.id, reference: 'VIR-DZ-0002', reason: 'Test cdcc' }), 'FAILED_PRECONDITION');
  const msg = await until(async () => (await db.collection('users').doc(OWNER_UID).collection('notifications').get()).docs.find((d) => d.id === `restaurant_payout_paid-${payout.id}`)?.data(), 40_000);
  check('Relevé remis au commerce (message « reversement effectué » détaillé)', msg && msg.body.includes('Référence'), msg?.body?.slice(0, 140));
  const aud = await db.collection('auditLogs').where('action', '==', 'payout.paid').where('target.id', '==', payout.id).get();
  check('Virement audité (avec référence)', aud.size === 1 && aud.docs[0].get('after.manualReference') === 'VIR-DZ-0001');

  // Reversement d'un pays avec Stripe sans compte : échec explicite + alerte « à traiter ».
  for (const d of (await db.collection('ledgerEntries').where('accountId', '==', RES).get()).docs) await d.ref.delete();
  for (const d of (await db.collection('payouts').where('beneficiaryId', '==', RES).get()).docs) await d.ref.delete();
  await ledgerSale('cdcc-sale-eur', 12_000);
  const builtEur = await runBuildPayouts({ type: 'restaurant', until: new Date(Date.now() + DAY).toISOString().slice(0, 10), beneficiaryId: RES, force: true, actorUid: 'cdcc-test' });
  const payoutEur = (await db.collection('payouts').where('beneficiaryId', '==', RES).get()).docs[0];
  check('Reversement France en euros par Stripe', builtEur.created === 1 && payoutEur.get('currency') === 'EUR' && payoutEur.get('provider') === 'stripe');
  await db.doc(`restaurants/${RES}/private/commercial`).update({ stripeAccountId: null });
  const fail = await call(finance, 'executePayout', { payoutId: payoutEur.id });
  check('Sans compte Stripe : échec explicite du reversement', fail.status === 'failed' && /Stripe/.test(fail.failureReason ?? ''), fail.failureReason);
  const alertFail = (await db.collection('platformAlerts').where('kind', '==', 'payout_failed').get()).docs.find((d) => d.get('target.id') === payoutEur.id);
  check('Reversement en échec : alerte dans la file « à traiter »', alertFail && alertFail.get('queue') === 'todo' && alertFail.get('status') === 'open');
  for (const d of (await db.collection('payouts').where('beneficiaryId', '==', RES).get()).docs) await d.ref.delete();
  await alertFail?.ref.delete();
};

scenarios.driverconnect = async () => {
  const uid = 'cdcc-driver-platform';
  const token = await testUserSession(uid, 'cdcc-driver-platform@golink.test');
  await clone('drivers/seed-driver-029', `drivers/${uid}`, { type: 'platform', restaurantIds: [], email: 'cdcc-driver-platform@golink.test', displayName: 'Livreur Plateforme C', test: true, seed: true });
  await db.doc(`driverPrivate/${uid}`).set({ cashBalanceCents: 0, cashLimitCents: 15_000, payoutsBlocked: false, vatExempt: true, dac7Complete: false, birthDate: '1990-01-01', nationality: 'FR', address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR' }, stripeAccountId: null, stripeAccountStatus: null, updatedAt: at(0), test: true });
  await expectError('Livreur salarié : pas de compte de paiement GoLink', call(await testUserSession(DRIVER, 'cdcc-driver@exemple.test'), 'createDriverConnectAccount', {}), 'FAILED_PRECONDITION', 'salariés');
  const account = await call(token, 'createDriverConnectAccount', {}).catch((e) => e);
  if (account instanceof Error) {
    // Limite externe : Stripe Connect n'est pas activé sur le compte Stripe de la plateforme.
    check('Stripe Connect non activé sur le compte de la plateforme : message clair (limite externe)', /Connect n’est pas activé/.test(account.message), account.message);
    return;
  }
  check('Compte de paiement Stripe Connect créé pour le livreur indépendant', /^acct_/.test(account.accountId) && account.created === true && account.status === 'pending', `${account.accountId} ${account.status}`);
  const stored = (await db.doc(`driverPrivate/${uid}`).get()).data();
  check('Identifiant du compte enregistré sur la fiche privée du livreur', stored.stripeAccountId === account.accountId && stored.stripeAccountStatus === 'pending');
  const again = await call(token, 'createDriverConnectAccount', {});
  check('Un seul compte par livreur (rejeu sans doublon)', again.accountId === account.accountId && again.created === false);
  const link = await call(token, 'createDriverConnectAccountLink', {});
  check('Lien d’inscription Stripe remis au livreur', /^https:\/\/connect\.stripe\.com\//.test(link.url) && link.expiresAt > Date.now(), link.url.slice(0, 40));
  const status = await call(token, 'refreshDriverConnectAccountStatus', {});
  check('État du compte relu chez Stripe', ['pending', 'restricted', 'enabled'].includes(status.status), status.status);
  await expectError('Fonction réservée à un livreur connecté', call(null, 'createDriverConnectAccount', {}), 'UNAUTHENTICATED');
};

scenarios.deployed = async () => {
  // Fonctions en échec de déploiement ou en 403 avant correction : elles répondent maintenant (erreur applicative, pas 403/404).
  const finance = await accountSession('finance@golink.test');
  const commercial = await accountSession('commercial@golink.test');
  const metz = await accountSession('metz@golink.test');
  const probes = [
    ['updateCountryVat', finance, {}],
    ['generateTaxReport', finance, {}],
    ['markTaxReportSubmitted', finance, {}],
    ['exportAccounting', finance, {}],
    ['estimatePlatformAudience', metz, { audience: { userType: 'client' } }],
    ['getSalesTeam', commercial, {}],
  ];
  for (const [name, token, data] of probes) {
    try {
      const r = await call(token, name, data);
      check(`Fonction ${name} déployée et joignable`, true, `réponse ${JSON.stringify(r).slice(0, 60)}`);
    } catch (error) {
      const reachable = error.http !== 403 && error.http !== 404 && error.status !== 'NOT_FOUND';
      check(`Fonction ${name} déployée et joignable`, reachable, `${error.http} ${error.status} : ${String(error.message).slice(0, 80)}`);
    }
  }
};

// ------------------------------------------------------------------ Exécution et nettoyage

async function cleanup() {
  const deleteWhere = async (col, field, values) => {
    for (const v of values) for (const d of (await db.collection(col).where(field, '==', v).get()).docs) await d.ref.delete().catch(() => undefined);
  };
  const rids = [RES, ...created.restaurants];
  const rmTree = async (path) => { await db.recursiveDelete(db.doc(path)).catch(() => undefined); };
  for (const rid of rids) {
    await rmTree(`restaurants/${rid}`);
    await deleteWhere('ledgerEntries', 'accountId', [rid]);
    await deleteWhere('invoices', 'recipient.id', [rid]);
    await deleteWhere('payouts', 'beneficiaryId', [rid]);
    await deleteWhere('payoutHolds', 'beneficiaryId', [rid]);
    await deleteWhere('platformAlerts', 'target.id', [rid]);
    await deleteWhere('referrals', 'referrerId', [rid]);
    await deleteWhere('referrals', 'refereeId', [rid]);
    await deleteWhere('cashMovements', 'restaurantId', [rid]);
    await deleteWhere('legalAcceptances', 'restaurantId', [rid]);
    await deleteWhere('auditLogs', 'target.id', [rid]);
  }
  await deleteWhere('platformAlerts', 'target.id', ['cdcc-sub']);
  for (const id of created.orders) {
    await rmTree(`orders/${id}`);
    for (const c of ['payments', 'promotionRedemptions', 'orderFinancials']) await db.collection(c).doc(c === 'payments' ? `pay-${id}` : id).delete().catch(() => undefined);
    await deleteWhere('ledgerEntries', 'orderId', [id]);
    await deleteWhere('walletTransactions', 'orderId', [id]);
    await deleteWhere('refunds', 'orderId', [id]);
    await deleteWhere('invoices', 'orderId', [id]);
    await db.doc(`invoices/rec-${id}`).delete().catch(() => undefined);
  }
  await deleteWhere('payments', 'payerId', [CLIENT, 'cdcc-client2']);
  for (const uid of [CLIENT, 'cdcc-client2', DRIVER, 'cdcc-driver-platform', 'cdcc-dummy-owner']) {
    await rmTree(`users/${uid}`);
    await deleteWhere('loyaltyTransactions', 'userId', [uid]);
    await deleteWhere('walletTransactions', 'userId', [uid]);
    await deleteWhere('referrals', 'referrerId', [uid]);
    await deleteWhere('referrals', 'refereeId', [uid]);
    await db.doc(`loyaltyAccounts/${uid}`).delete().catch(() => undefined);
    await db.doc(`driverPrivate/${uid}`).delete().catch(() => undefined);
    await db.doc(`drivers/${uid}`).delete().catch(() => undefined);
  }
  await deleteWhere('cashMovements', 'driverId', [DRIVER]);
  for (const d of (await db.collection('promotions').where('test', '==', true).get()).docs) await d.ref.delete().catch(() => undefined);
  for (const d of (await db.collection('commissionRules').where('scopeId', '==', 'cdcc-group').get()).docs) await d.ref.delete().catch(() => undefined);
  for (const p of ['plans/cdcc-plan', 'subscriptions/cdcc-sub', `cities/${CITY}`]) await db.doc(p).delete().catch(() => undefined);
  for (const d of (await db.collection('rateLimits').get()).docs) if (d.id.startsWith(`payfail_${CLIENT}`)) await d.ref.delete().catch(() => undefined);
  for (const d of (await db.collection('referralCodes').get()).docs) if (rids.includes(d.get('ownerId'))) await d.ref.delete().catch(() => undefined);
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => undefined);
  // Comptes créés par l'inscription publique.
  for (const d of (await db.collection('prospects').where('createdBy', '==', 'system').get()).docs) if (String(d.get('contactEmail')).startsWith('cdcc-')) await d.ref.delete().catch(() => undefined);
  for (const d of (await db.collection('users').where('email', '>=', 'cdcc-').where('email', '<', 'cdcd').get()).docs) await d.ref.delete().catch(() => undefined);
}

const order = ['commission', 'promotions', 'wallet', 'payments', 'subscription', 'cash', 'referral', 'loyalty', 'providers', 'driverconnect', 'deployed'];
try {
  await setupBase();
  for (const name of order) {
    if (only.length && !only.includes(name)) continue;
    console.log(`\n== ${name} ==`);
    try {
      await scenarios[name]();
    } catch (error) {
      record(`Scénario ${name} interrompu`, false, `${error.status ?? ''} ${error.message}`);
      console.error(error.stack?.split('\n').slice(0, 4).join('\n'));
    }
  }
} finally {
  console.log('\nNettoyage…');
  await cleanup().catch((error) => console.error('Nettoyage incomplet :', error.message));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length) {
  console.log('Échecs :');
  for (const f of failed) console.log(` - ${f.name} — ${f.detail ?? ''}`);
}
process.exit(failed.length ? 1 : 0);
