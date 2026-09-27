// Test réel du volet « fraude, RGPD, conformité, résilience » des correctifs du cahier
// (tâche cdc-fix-e), sur la base golink-9f16d : liste de blocage à la commande (appareil),
// mode maintenance réellement bloquant, acceptation légale + consentement, bonus de pointe
// et gains livreur, statut honnête des rapports programmés, corbeille (index), tunnel de
// commande. Décor isolé (`cdce-*`), supprimé à la fin.
//
//   node scripts/tests/cdc-fix-e.flow.mjs [scénario ...]     (sans argument : tous)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const RES = 'cdce-resto';
const CITY = 'cdce-ville';
const CLIENT = 'cdce-client';
const DRIVER = 'cdce-driver';
const DAY = 86_400_000;
const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);

const results = [];
const only = process.argv.slice(2);
const created = { orders: new Set(), authUsers: new Set(), docs: [] };

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 60_000, everyMs = 2000) {
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
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test E', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test E Resto', slug: 'test-e-resto', groupId: null, cityId: CITY, planCode: 'pro', ownerId: 'test-owner-haddad', status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-1 * DAY), createdAt: at(-30 * DAY),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 02', managerEmail: 'cdce-resto@golink.test', test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: true, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  const products = db.collection('restaurants').doc(RES).collection('products');
  const base = { sectionId: null, description: null, vatCategory: 'food', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [], allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system' };
  await products.doc('cdce-p1').set({ ...base, name: 'Test plat E', priceCents: 1800 });
  await testUserSession(CLIENT, 'cdce-client@golink.test');
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'cdce-client@golink.test', firstName: 'Cdce', lastName: 'Client', displayName: 'Cdce Client', referralCode: 'CDCEREF1', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });
  await clone('drivers/seed-driver-029', `drivers/${DRIVER}`, { restaurantIds: [], type: 'platform', cityId: CITY, displayName: 'Livreur Test E', firstName: 'Livreur', lastName: 'Test E', phone: '+33699000099', email: 'cdce-driver@exemple.test', status: 'active', availability: 'online', acceptsCash: false, activeOrderIds: [], stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 }, test: true, seed: true });
}

const CLIENT_TOKEN = () => sessions.get(CLIENT);
let seq = 0;
async function place(extra = {}) {
  const clientRequestId = `cdce${Date.now().toString(36)}${(seq += 1)}${randomBytes(3).toString('hex')}`;
  return call(CLIENT_TOKEN(), 'placeOrder', { restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdce-p1', quantity: 1 }], paymentMethod: 'card', paymentMethodId: 'pm_card_visa', clientRequestId, ...extra });
}

// ------------------------------------------------------------------ Scénarios

async function scenarioBlocklist() {
  const deviceId = `cdce-device-${randomBytes(6).toString('hex')}`;
  const ok = await place({ deviceId });
  check('blocklist.commande_normale', ok?.orderId, JSON.stringify(ok));
  created.orders.add(ok.orderId);

  const add = await call(await accountSession('superadmin@golink.test'), 'addBlocklistEntry', { type: 'device', value: deviceId, reason: 'Test cdc-fix-e : appareil de test', fraudCaseId: null, expiresAt: null });
  check('blocklist.ajout', add?.id);
  await expectError('blocklist.commande_bloquee', place({ deviceId }), 'ne permet pas');
  await call(await accountSession('superadmin@golink.test'), 'removeBlocklistEntry', { entryId: add.id, reason: 'Fin du test cdc-fix-e' });
  const okAgain = await place({ deviceId });
  check('blocklist.debloque', okAgain?.orderId);
  created.orders.add(okAgain.orderId);
}

async function scenarioMaintenance() {
  const superToken = await accountSession('superadmin@golink.test');
  await call(superToken, 'setMaintenanceMode', { app: 'client', enabled: true, message: 'Test cdc-fix-e', until: null, reason: 'Test cdc-fix-e : vérification du blocage réel' });
  await expectError('maintenance.commande_bloquee', place(), 'Test cdc-fix-e');
  await call(superToken, 'setMaintenanceMode', { app: 'client', enabled: false, message: null, until: null, reason: 'Fin du test cdc-fix-e' });
  const ok = await place();
  check('maintenance.debloque', ok?.orderId);
  created.orders.add(ok.orderId);
}

async function scenarioLegalConsent() {
  const res = await call(CLIENT_TOKEN(), 'acceptLegalDocument', { documentType: 'terms_client', countryId: 'FR' });
  check('legal.acceptation', res?.accepted === true, JSON.stringify(res));
  const user = await db.doc(`users/${CLIENT}`).get();
  check('legal.journal_utilisateur', user.get('acceptedLegal')?.terms_client === res?.version);
  const acceptance = await db.collection('legalAcceptances').where('userId', '==', CLIENT).where('documentType', '==', 'terms_client').limit(1).get();
  check('legal.journal_acceptances', !acceptance.empty);

  const consent = await call(CLIENT_TOKEN(), 'setConsent', { key: 'analytics_cookies', granted: true });
  check('consent.reponse', consent?.granted === true);
  const userAfter = await db.doc(`users/${CLIENT}`).get();
  check('consent.profil', userAfter.get('consents')?.analytics_cookies === true);
  const log = await db.collection(`users/${CLIENT}/consents`).where('key', '==', 'analytics_cookies').limit(1).get();
  check('consent.journal', !log.empty);
}

async function scenarioFraudSettings() {
  const superToken = await accountSession('superadmin@golink.test');
  const before = await db.doc('settings/fraud').get();
  const beforeValue = before.exists ? before.data() : null;
  const res = await call(superToken, 'updateFraudSettings', {
    lookbackDays: 12, clientMinOrders: 4, clientNotReceivedThreshold: 3, clientRepeatedClaimsThreshold: 3, clientCancellationRate: 0.45,
    promoAbuseCodesThreshold: 6, restaurantMinOrders: 10, restaurantRefundRate: 0.3, fakeOrderCancelWithinSeconds: 120, fakeOrderThreshold: 5,
    driverOffAddressMeters: 450, driverOffAddressThreshold: 2, driverCancellationsThreshold: 3,
    scores: { frequentNotReceived: 25, repeatedClaims: 20, abnormalCancellations: 15, promoAbuse: 20, refundRate: 20, fakeOrders: 25, offAddressDelivery: 25, driverCancellations: 15, sharedAccount: 30, linkedAccounts: 30 },
    reason: 'Test cdc-fix-e : seuils réglables',
  });
  check('fraude.seuils_modifies', res?.ok === true);
  const after = await db.doc('settings/fraud').get();
  check('fraude.seuils_persistes', after.get('lookbackDays') === 12 && after.get('driverOffAddressMeters') === 450);
  // Remet la valeur précédente (ou les défauts) pour ne pas perturber les autres tâches.
  if (beforeValue) await db.doc('settings/fraud').set(beforeValue);
  else await db.doc('settings/fraud').delete();
}

async function scenarioDriverEarningsAndPeakBonus() {
  const id = 'cdce-order-peak-1';
  const items = [{ lineId: 'l1', productId: 'cdce-p1', name: 'Test plat E', imageUrl: null, unitPriceCents: 1800, quantity: 1, options: [], optionsPriceCents: 0, totalCents: 1800, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const subtotal = 1800;
  const total = subtotal + 49 + 299;
  await db.doc(`payments/pay-${id}`).set({ countryId: 'FR', cityId: CITY, purpose: 'order', orderId: id, subscriptionId: null, invoiceId: null, payerType: 'client', payerId: CLIENT, restaurantId: RES, method: 'card', amountCents: total, currency: 'EUR', status: 'paid', provider: 'stripe', providerIntentId: 'pi_seed_cdce', providerChargeId: 'ch_seed_cdce', feeCents: 0, attempts: 1, refundedCents: 0, test: true, createdAt: at(-40 * 60_000), updatedAt: at(-40 * 60_000) });
  await db.doc(`orders/${id}`).set({
    number: 'GL-TCDCE', countryId: 'FR', cityId: CITY, restaurantId: RES, restaurantName: 'Test E Resto', restaurantGroupId: null,
    customerId: CLIENT, customerName: 'Cdce Client', customerPhoneMasked: null, status: 'delivered', fulfillment: 'delivery', items, itemsCount: 1,
    amounts: { subtotalCents: subtotal, serviceFeeCents: 49, smallOrderFeeCents: 0, deliveryFeeCents: 299, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
    payment: { method: 'card', status: 'paid', paymentId: `pay-${id}`, label: null, paidAt: at(-40 * 60_000) },
    promotionId: null, promoCode: null,
    delivery: { address: { line1: '1 rue Test', line2: null, postalCode: '54400', city: 'Longwy', countryCode: 'FR', geo: null, geohash: null, placeId: null, label: 'Domicile', details: null, instructions: null }, geo: { latitude: 49.5395, longitude: 5.7829 }, zoneId: null, distanceMeters: 2500, deliveredBy: 'platform', driverId: DRIVER, driverName: 'Livreur Test E', driverPhoneMasked: null, driverVehicle: 'scooter', promisedFrom: at(-40 * 60_000), promisedTo: at(-25 * 60_000), estimatedArrivalAt: at(-30 * 60_000), proof: { type: 'handover', value: null, at: at(-10 * 60_000), geo: { latitude: 49.5395, longitude: 5.7829 } }, handoverCodeRequired: false, dispatchStatus: 'assigned', dispatchAttempts: 0, courierSurgeBonusCents: null, courierIsPeak: true },
    pickupCode: null, pickupVerified: false, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
    timeline: { placedAt: at(-40 * 60_000), new: at(-40 * 60_000), accepted: at(-38 * 60_000), preparing: at(-37 * 60_000), assigned: at(-35 * 60_000), ready: at(-30 * 60_000), picked_up: at(-25 * 60_000), delivered: at(-10 * 60_000) },
    acceptDeadline: null, cancellation: null,
    flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
    reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: DRIVER, searchKeywords: [id],
    restaurantSettlement: { grossCents: subtotal, discountFundedCents: 0, commissionBaseCents: subtotal, commissionBps: 1500, commissionHtCents: Math.round((subtotal * 0.15) / 1.2), commissionVatCents: Math.round(subtotal * 0.15) - Math.round((subtotal * 0.15) / 1.2), commissionTtcCents: Math.round(subtotal * 0.15), deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: subtotal - Math.round(subtotal * 0.15) },
    commission: { bps: 1500, source: 'market' }, processed: {},
    createdAt: at(-40 * 60_000), updatedAt: at(-10 * 60_000), test: true, seed: true,
  });
  created.orders.add(id);

  const financials = await until(async () => (await db.doc(`orderFinancials/${id}`).get()).exists ? (await db.doc(`orderFinancials/${id}`).get()).data() : null);
  check('reglement.orderFinancials_cree', Boolean(financials), 'onOrderSettled n’a pas tourné (délai dépassé)');
  const peakBonus = financials?.settlement?.courier?.peakBonusCents ?? 0;
  check('reglement.bonus_pointe_applique', peakBonus > 0, `peakBonusCents=${peakBonus}`);
  const earning = await until(async () => (await db.doc(`driverEarnings/${id}`).get()).exists ? (await db.doc(`driverEarnings/${id}`).get()).data() : null, 20_000);
  check('reglement.driverEarnings_alimente', Boolean(earning), 'driverEarnings/{orderId} absent');
  const ledger = await db.collection('ledgerEntries').where('orderId', '==', id).where('accountType', '==', 'driver').where('type', '==', 'courier_earning').limit(1).get();
  check('reglement.ledger_courier_earning', !ledger.empty);
}

async function scenarioTrashIndex() {
  // Vérifie l'index composite (restoredAt, deletedAt) : la requête ne doit plus lever
  // « failed-precondition » comme avant la correction de firestore.indexes.json.
  try {
    const snap = await db.collection('trash').where('restoredAt', '==', null).orderBy('deletedAt', 'desc').limit(5).get();
    check('corbeille.index_compose', true, `${snap.size} document(s)`);
  } catch (error) {
    check('corbeille.index_compose', false, String(error.message ?? error));
  }
}

async function scenarioFunnel() {
  const before = await db.doc(`statsDaily/city_${CITY}_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`).get();
  const beforeCount = before.exists ? (before.get('funnel')?.appOpens ?? 0) : 0;
  await call(null, 'trackFunnelEvent', { event: 'app_open', countryId: 'FR', cityId: CITY });
  await call(null, 'trackFunnelEvent', { event: 'restaurant_view', countryId: 'FR', cityId: CITY });
  await call(null, 'trackFunnelEvent', { event: 'add_to_cart', countryId: 'FR', cityId: CITY });
  const after = await until(async () => {
    const snap = await db.doc(`statsDaily/city_${CITY}_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`).get();
    const count = snap.exists ? (snap.get('funnel')?.appOpens ?? 0) : 0;
    return count > beforeCount ? snap : null;
  }, 20_000);
  check('tunnel.appOpens_incremente', Boolean(after), `avant=${beforeCount}`);
  check('tunnel.addToCart_incremente', (after?.get('funnel')?.addToCart ?? 0) > 0);
}

async function scenarioReportsHonestStatus() {
  const reports = await db.collection('scheduledReports').limit(1).get();
  if (reports.empty) {
    check('rapports.statut_honnete', true, 'aucun rapport programmé en base : scénario ignoré');
    return;
  }
  const doc = reports.docs[0];
  const res = await call(await accountSession('superadmin@golink.test'), 'runReportNow', { id: doc.id, dryRun: false, reason: 'Test cdc-fix-e : statut honnête' });
  const after = await db.doc(`scheduledReports/${doc.id}`).get();
  const status = after.get('lastRunStatus');
  const recipients = after.get('recipients') ?? [];
  const allReserved = recipients.every((r) => /\.(test|example|invalid|localhost)$/i.test(r));
  check('rapports.statut_coherent', !allReserved || status === 'skipped', `recipients=${JSON.stringify(recipients)} status=${status} sent=${res?.sent}`);
}

// ------------------------------------------------------------------ Orchestration

const SCENARIOS = {
  blocklist: scenarioBlocklist,
  maintenance: scenarioMaintenance,
  legal: scenarioLegalConsent,
  fraudSettings: scenarioFraudSettings,
  driverEarnings: scenarioDriverEarningsAndPeakBonus,
  trashIndex: scenarioTrashIndex,
  funnel: scenarioFunnel,
  reports: scenarioReportsHonestStatus,
};

async function cleanup() {
  for (const id of created.orders) {
    await db.doc(`orders/${id}`).delete().catch(() => {});
    await db.doc(`orderFinancials/${id}`).delete().catch(() => {});
    await db.doc(`driverEarnings/${id}`).delete().catch(() => {});
    await db.doc(`payments/pay-${id}`).delete().catch(() => {});
    for (const suffix of ['-ca', '-fl', '-com', '-fp', '-liv', '-pb', '-esp', '-pbr', '-espr']) {
      await db.doc(`ledgerEntries/${id}${suffix}`).delete().catch(() => {});
    }
  }
  await db.doc(`restaurants/${RES}/private/commercial`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/private/legal`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/orders`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/hours`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/products/cdce-p1`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}`).delete().catch(() => {});
  await db.doc(`cities/${CITY}`).delete().catch(() => {});
  await db.doc(`drivers/${DRIVER}`).delete().catch(() => {});
  await db.doc(`users/${CLIENT}`).delete().catch(() => {});
  await db.doc(`userPrivate/${CLIENT}`).delete().catch(() => {});
  const acceptances = await db.collection('legalAcceptances').where('userId', '==', CLIENT).get();
  for (const d of acceptances.docs) await d.ref.delete().catch(() => {});
  const consentsSnap = await db.collection(`users/${CLIENT}/consents`).get();
  for (const d of consentsSnap.docs) await d.ref.delete().catch(() => {});
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
