// Test réel cdc-fix-residuals-48 (§15 Finance, §18 Promotions — 2 bugs trouvés en auditant ces
// rubriques) :
//
// 1. `placeOrder` (functions/src/orders/place.ts) renvoyait à l'appelant `chargedCents:
//    quote.totalCents` (le total AVANT déduction des avoirs) au lieu de la variable locale
//    `chargedCents` (le montant réellement débité au moyen de paiement après avoirs) — alors que
//    le document `orders/{id}.amounts.chargedCents` stocké, lui, contenait déjà la bonne valeur.
//    Un client réglant partiellement par avoirs recevait donc en retour d'appel un montant
//    « débité » faux (le total complet au lieu du reste à charge).
//    Corrigé : `chargedCents` (la variable) au lieu de `quote.totalCents`.
//
// 2. `createPlatformPromotion` (functions/src/marketing/platform/promotions.ts) laissait changer
//    `funding`/`restaurantShareBps` d'une offre déjà utilisée (`stats.redemptions > 0`), sans
//    aucune garde — alors que `promotionCost()` (apps/admin) répartit `stats.discountCents`
//    CUMULÉ selon le financement ACTUEL de l'offre : changer le financement après coup réécrit
//    rétroactivement le coût affiché sur TOUT l'historique déjà utilisé, en contradiction avec le
//    grand livre (qui fige le partage réel à chaque commande, `platformFundedCents`/
//    `restaurantFundedCents` par commande dans `promotionRedemptions`).
//    Corrigé : une offre déjà utilisée refuse désormais un changement de `funding`/
//    `restaurantShareBps` (même garde que côté restaurant pour les champs matériels).
//
//   npx tsx scripts/tests/cdc-fix-residuals-48.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres48-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

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
async function expectError(name, promise, fragment) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const ok = !fragment || String(error.message).includes(fragment);
    record(name, ok, `${error.status ?? ''} : ${error.message}`);
  }
}

const ADMIN_UID = 'cdcres48-admin';
const CITY = 'cdcres48-ville';
const RES = 'cdcres48-resto';
const CLIENT = 'cdcres48-client';

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
}

async function setupPlaceOrder() {
  const at = (offsetMs = 0) => Timestamp.fromMillis(Date.now() + offsetMs);
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test CDCRES48', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test CDCRES48 Épicerie', slug: 'test-cdcres48', groupId: null, cityId: CITY, planCode: 'pro', ownerId: 'cdcres48-owner', status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-86_400_000), createdAt: at(-30 * 86_400_000),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0, minOrderCents: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 03', managerEmail: 'cdcres48-resto@golink.test', test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: false, minOrderCents: 0, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  await db.collection('restaurants').doc(RES).collection('products').doc('cdcres48-produit').set({
    name: 'Produit test CDCRES48', sectionId: null, description: null, vatCategory: 'grocery', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [],
    allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], priceCents: 1000,
    seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system',
  });

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(CLIENT).catch(() => {});
  await auth.createUser({ uid: CLIENT, email: 'cdcres48-client@golink.test', password, emailVerified: true, displayName: 'CDCRES48 Client' });
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'cdcres48-client@golink.test', firstName: 'Cdcres48', lastName: 'Client', displayName: 'Cdcres48 Client', referralCode: 'CDCRES48REF', referredBy: null, walletBalanceCents: 600, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });
  return password;
}

async function testChargedCents() {
  const password = await setupPlaceOrder();
  const token = await loginPassword('cdcres48-client@golink.test', password);
  const clientRequestId = `cdcres48-${Date.now().toString(36)}`;
  const result = await call(token, 'placeOrder', {
    restaurantId: RES,
    fulfillment: 'pickup',
    lines: [{ productId: 'cdcres48-produit', quantity: 1 }],
    paymentMethod: 'card',
    paymentMethodId: 'pm_card_visa',
    useWallet: true,
    clientRequestId,
  });
  check('commande créée (produit à 10,00 €, 6,00 € d’avoirs disponibles)', Boolean(result?.orderId), JSON.stringify(result));
  if (!result?.orderId) return;
  const expectedCharged = result.totalCents - 600;
  check(
    'chargedCents RENVOYÉ PAR L’APPEL = reste à charge après avoirs (pas le total), correctif attendu',
    result.chargedCents === expectedCharged,
    `totalCents=${result.totalCents} chargedCents_renvoyé=${result.chargedCents} attendu=${expectedCharged}`,
  );
  const stored = (await db.doc(`orders/${result.orderId}`).get()).get('amounts');
  check('non-régression : chargedCents STOCKÉ dans le document était déjà correct', stored?.chargedCents === expectedCharged, `stocké=${stored?.chargedCents}`);
  check('les deux valeurs (renvoyée et stockée) sont désormais identiques', result.chargedCents === stored?.chargedCents, `renvoyée=${result.chargedCents} stockée=${stored?.chargedCents}`);

  await db.doc(`orders/${result.orderId}`).delete().catch(() => {});
  await db.doc(`payments/pay-${result.orderId}`).delete().catch(() => {});
  await db.doc(`walletTransactions/wp-${result.orderId}`).delete().catch(() => {});
  await db.doc(`ledgerEntries/wp-${result.orderId}`).delete().catch(() => {});
}

async function cleanupPlaceOrder() {
  await db.doc(`restaurants/${RES}/private/commercial`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/private/legal`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/orders`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/settings/hours`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}/products/cdcres48-produit`).delete().catch(() => {});
  await db.doc(`restaurants/${RES}`).delete().catch(() => {});
  await db.doc(`cities/${CITY}`).delete().catch(() => {});
  await db.doc(`users/${CLIENT}`).delete().catch(() => {});
  await db.doc(`userPrivate/${CLIENT}`).delete().catch(() => {});
  await auth.deleteUser(CLIENT).catch(() => {});
}

async function testPromotionFundingGuard(adminToken) {
  const base = {
    reason: 'Test cdcres48',
    scope: 'platform',
    countryId: null,
    cityIds: [],
    restaurantIds: ['mina-kitchen'],
    title: 'Offre test CDCRES48',
    description: null,
    code: null,
    kind: 'percentage',
    value: 1000,
    maxDiscountCents: null,
    minSubtotalCents: 0,
    funding: 'shared',
    restaurantShareBps: 5000,
    target: 'everyone',
    inactiveDays: null,
    modes: ['delivery'],
    totalUsageLimit: null,
    perCustomerLimit: 10,
    startsAt: Date.now() - 60_000,
    endsAt: null,
    showcase: false,
    publish: true,
  };
  const created = await call(adminToken, 'createPlatformPromotion', base);
  check('offre test créée (financement partagé 50/50)', Boolean(created?.promotionId), JSON.stringify(created));
  if (!created?.promotionId) return;
  const promotionId = created.promotionId;

  // Non-régression : tant qu'elle n'a jamais été utilisée, changer le financement reste permis.
  const editedBeforeUse = await call(adminToken, 'createPlatformPromotion', { ...base, promotionId, funding: 'platform', restaurantShareBps: null, reason: 'Test cdcres48 edit avant usage' });
  check('non-régression : financement modifiable AVANT toute utilisation (redemptions=0)', editedBeforeUse?.promotionId === promotionId, JSON.stringify(editedBeforeUse));

  // Simule une utilisation réelle (le partage 50/50 d'alors est déjà figé par ailleurs dans
  // `promotionRedemptions`/le grand livre — seul le compteur agrégé est reproduit ici).
  await db.doc(`promotions/${promotionId}`).update({ 'stats.redemptions': 1, 'stats.discountCents': 100, funding: 'shared', restaurantShareBps: 5000 });

  await expectError(
    'offre déjà utilisée : changement de financement REFUSÉ (correctif attendu)',
    call(adminToken, 'createPlatformPromotion', { ...base, promotionId, funding: 'platform', restaurantShareBps: null, reason: 'Test cdcres48 tentative après usage' }),
    'déjà été utilisée',
  );
  await expectError(
    'offre déjà utilisée : changement de restaurantShareBps seul REFUSÉ (correctif attendu)',
    call(adminToken, 'createPlatformPromotion', { ...base, promotionId, funding: 'shared', restaurantShareBps: 3000, reason: 'Test cdcres48 tentative après usage (bps)' }),
    'déjà été utilisée',
  );

  // Non-régression : un champ sans lien avec le financement reste modifiable après usage.
  const editedUnrelated = await call(adminToken, 'createPlatformPromotion', { ...base, promotionId, title: 'Offre test CDCRES48 (renommée)', reason: 'Test cdcres48 renommage après usage' });
  check('non-régression : un champ non lié au financement reste modifiable après usage', editedUnrelated?.promotionId === promotionId, JSON.stringify(editedUnrelated));

  await db.doc(`promotions/${promotionId}`).delete().catch(() => {});
}

async function main() {
  await testChargedCents();
  await cleanupPlaceOrder();

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(ADMIN_UID).catch(() => {});
  await auth.createUser({ uid: ADMIN_UID, email: 'cdcres48-admin@golink.test', password, emailVerified: true, displayName: 'CDCRES48 Admin' });
  await db.doc(`admins/${ADMIN_UID}`).set({ role: 'super_admin', active: true, permissions: [], cityIds: [], countryIds: [], displayName: 'CDCRES48 Admin', email: 'cdcres48-admin@golink.test', test: true, createdAt: new Date(), updatedAt: new Date(), updatedBy: 'system' });
  await syncClaims(ADMIN_UID);
  try {
    const adminToken = await loginPassword('cdcres48-admin@golink.test', password);
    await testPromotionFundingGuard(adminToken);
  } finally {
    await db.doc(`admins/${ADMIN_UID}`).delete().catch(() => {});
    await db.doc(`users/${ADMIN_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${ADMIN_UID}`).delete().catch(() => {});
    await auth.deleteUser(ADMIN_UID).catch(() => {});
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
