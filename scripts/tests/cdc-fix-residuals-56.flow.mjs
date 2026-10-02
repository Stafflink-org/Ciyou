// Test réel cdc-fix-residuals-56 (audit étendu « app client » — checkout) :
//
// 1. `placeOrder` refusait systématiquement toute commande avec remise réelle (code promo
//    OU promotion automatique sans code) : le panier client ne prévisualise jamais de remise
//    (le client ne peut pas lire une promotion par son code, règle Firestore), donc
//    `expectedTotalCents` envoyé par l'app est toujours le total SANS remise — alors que le
//    serveur comparait ce total envoyé au total APRÈS remise, déclenchant à tort le refus
//    « Le total de votre commande a changé » dès qu'une remise s'appliquait réellement.
//    Corrigé : comparaison contre le devis SANS promotion/offre (ce que le client a réellement
//    pu prévisualiser), pas le total déjà remisé.
//
// 2. Le paiement en espèces au retrait était proposé par l'app (si le commerce accepte les
//    espèces) mais `allowOnPickup` (le paramètre qui autorise ce cas dans `isCashAllowed`)
//    n'était jamais renseigné nulle part dans tout le code — donc toujours refusé côté serveur.
//    Corrigé.
//
//   npx tsx scripts/tests/cdc-fix-residuals-56.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres56-adc-${process.pid}.json`);
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

const CITY = 'cdcres56-ville';
const RES = 'cdcres56-resto';
const CLIENT = 'cdcres56-client';
const created = { orders: new Set() };

async function clone(path, target, override = {}) {
  const snap = await db.doc(path).get();
  if (!snap.exists) throw new Error(`Modèle introuvable : ${path}`);
  await db.doc(target).set({ ...snap.data(), ...override });
}

async function setup() {
  await clone('cities/longwy', `cities/${CITY}`, { name: 'Ville test CDCRES56', slug: CITY, pricing: null, commissionOverrideBps: null, test: true, seed: true, managerIds: [] });
  await clone('restaurants/mina-kitchen', `restaurants/${RES}`, {
    name: 'Test CDCRES56 Épicerie', slug: 'test-cdcres56', groupId: null, cityId: CITY, planCode: 'pro', ownerId: 'cdcres56-owner', status: 'active', onboardingStatus: 'approved', isOpen: true, acceptingOrders: true,
    fulfillmentModes: ['pickup'], deliveredBy: 'platform', acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], sponsored: false, test: true, seed: true, lastOrderAt: at(-86_400_000), createdAt: at(-30 * 86_400_000),
    metrics30d: null, missedOrdersInARow: 0, ordersCount: 0, minOrderCents: 0,
  });
  await clone('restaurants/mina-kitchen/private/commercial', `restaurants/${RES}/private/commercial`, { planCode: 'pro', subscriptionId: null, subscriptionStatus: 'active', negotiatedCommission: null, specialOffer: null, billingMode: null, allowedPaymentMethods: ['card', 'apple_pay', 'google_pay', 'cash'], payoutsBlocked: false, stripeAccountId: null, stripeAccountStatus: 'enabled', adCreditCents: 0, test: true, seed: true });
  await clone('restaurants/mina-kitchen/private/legal', `restaurants/${RES}/private/legal`, { siret: '43954771791365', managerPhone: '+33 6 99 00 00 04', managerEmail: 'cdcres56-resto@golink.test', test: true });
  await clone('restaurants/mina-kitchen/settings/orders', `restaurants/${RES}/settings/orders`, { autoAccept: false, minOrderCents: 0, test: true });
  await clone('restaurants/mina-kitchen/settings/hours', `restaurants/${RES}/settings/hours`, { test: true });
  await db.collection('restaurants').doc(RES).collection('products').doc('cdcres56-produit').set({
    name: 'Produit test CDCRES56', sectionId: null, description: null, vatCategory: 'grocery', available: true, stock: null, lowStockThreshold: 0, optionGroupIds: [],
    allergens: [], allergensDeclared: true, dietary: [], containsAlcohol: false, featured: false, order: 999, salesCount: 0, searchKeywords: [], priceCents: 2000,
    seed: true, test: true, createdAt: at(0), updatedAt: at(0), createdBy: 'system', updatedBy: 'system',
  });

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(CLIENT).catch(() => {});
  await auth.createUser({ uid: CLIENT, email: 'cdcres56-client@golink.test', password, emailVerified: true, displayName: 'CDCRES56 Client' });
  await clone('users/sim-client-longwy-1', `users/${CLIENT}`, { email: 'cdcres56-client@golink.test', firstName: 'Cdcres56', lastName: 'Client', displayName: 'Cdcres56 Client', referralCode: 'CDCRES56REF', referredBy: null, walletBalanceCents: 0, cityId: CITY, test: true, seed: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });
  await db.doc(`userPrivate/${CLIENT}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: at(0) });
  return loginPassword('cdcres56-client@golink.test', password);
}

async function cleanupOrder(orderId) {
  await Promise.all([`orders/${orderId}`, `payments/pay-${orderId}`].map((p) => db.doc(p).delete().catch(() => {})));
}

async function main() {
  const token = await setup();

  // ------------------------------------------------------------------ 1. Promotion réelle : commande acceptée

  // Sonde AVANT la création de la promotion : c'est exactement le total que le client aurait
  // prévisualisé dans son panier (aucune promotion active à ce moment — previewQuote ne peut de
  // toute façon jamais en tenir compte, règle Firestore). Commande annulée aussitôt après.
  const clientRequestId1 = `cdcres56-promo-${Date.now().toString(36)}`;
  const previewOnly = await call(token, 'placeOrder', {
    restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcres56-produit', quantity: 1 }],
    paymentMethod: 'card', paymentMethodId: 'pm_card_visa', clientRequestId: `${clientRequestId1}-probe`,
  }).catch((e) => ({ probeError: e }));
  if (previewOnly?.orderId) { created.orders.add(previewOnly.orderId); await cleanupOrder(previewOnly.orderId); }
  const clientPreviewTotal = previewOnly?.totalCents;
  check('sonde : commande de référence sans remise créée pour connaître le total prévisualisé par le client', Boolean(clientPreviewTotal), JSON.stringify(previewOnly));

  const PROMO_ID = 'cdcres56-promo';
  await db.doc(`promotions/${PROMO_ID}`).set({
    scope: 'platform', countryId: null, cityIds: [], restaurantId: null, restaurantIds: [],
    title: { fr: 'Test CDCRES56' }, description: null, code: null, kind: 'percentage', value: 1000, // 10%
    maxDiscountCents: null, minSubtotalCents: 0, funding: 'platform', restaurantShareBps: null,
    target: 'everyone', inactiveDays: null, modes: [], totalUsageLimit: null, perCustomerLimit: 100,
    startsAt: at(-3600_000), endsAt: null, status: 'active', reviewNote: null, showcase: false, accent: null,
    stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 },
    submittedAt: null, approvedAt: null, pausedAt: null, endedAt: null, test: true,
    createdAt: at(), updatedAt: at(), createdBy: 'system', updatedBy: 'system',
  });
  try {
    const result = await call(token, 'placeOrder', {
      restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcres56-produit', quantity: 1 }],
      paymentMethod: 'card', paymentMethodId: 'pm_card_visa', clientRequestId: clientRequestId1,
      expectedTotalCents: clientPreviewTotal, // ce que le client a réellement affiché (sans remise)
    });
    check('placeOrder : commande avec promotion automatique réelle ACCEPTÉE (expectedTotalCents = devis SANS remise, comme l’app) — correctif attendu', Boolean(result?.orderId), JSON.stringify(result));
    if (result?.orderId) {
      created.orders.add(result.orderId);
      check('placeOrder : la remise a bien été appliquée (total < devis sans remise)', result.totalCents < clientPreviewTotal, `totalCents=${result.totalCents} sansRemise=${clientPreviewTotal}`);
      await cleanupOrder(result.orderId);
    }

    // Non-régression : la revalidation protège toujours contre un total réellement périmé (rien à voir avec la promo).
    await expectError(
      'placeOrder : expectedTotalCents franchement faux (rien à voir avec la remise) toujours REFUSÉ — non-régression',
      call(token, 'placeOrder', {
        restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcres56-produit', quantity: 1 }],
        paymentMethod: 'card', paymentMethodId: 'pm_card_visa', clientRequestId: `${clientRequestId1}-stale`,
        expectedTotalCents: 1,
      }),
      'total de votre commande a changé',
    );
  } finally {
    await db.doc(`promotions/${PROMO_ID}`).delete().catch(() => {});
  }

  // ------------------------------------------------------------------ 2. Espèces au retrait : commande acceptée

  const clientRequestId2 = `cdcres56-cash-${Date.now().toString(36)}`;
  const cashResult = await call(token, 'placeOrder', {
    restaurantId: RES, fulfillment: 'pickup', lines: [{ productId: 'cdcres56-produit', quantity: 1 }],
    paymentMethod: 'cash', clientRequestId: clientRequestId2,
  });
  check('placeOrder : paiement espèces au retrait ACCEPTÉ (commerce acceptant les espèces) — correctif attendu', Boolean(cashResult?.orderId), JSON.stringify(cashResult));
  if (cashResult?.orderId) {
    created.orders.add(cashResult.orderId);
    check('orders.payment.method : bien « cash »', (await db.doc(`orders/${cashResult.orderId}`).get()).get('payment')?.method === 'cash');
    await cleanupOrder(cashResult.orderId);
  }

  // Non-régression : espèces en LIVRAISON (deliveredBy=platform) toujours refusées (décision client inchangée).
  await expectError(
    'placeOrder : espèces en LIVRAISON (livreur plateforme) toujours REFUSÉES — non-régression',
    call(token, 'placeOrder', {
      restaurantId: RES, fulfillment: 'delivery', addressId: null, lines: [{ productId: 'cdcres56-produit', quantity: 1 }],
      paymentMethod: 'cash', clientRequestId: `${clientRequestId2}-delivery`,
    }),
    undefined,
  );
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    await Promise.all([...created.orders].map((id) => cleanupOrder(id)));
    await db.doc(`restaurants/${RES}/products/cdcres56-produit`).delete().catch(() => {});
    await Promise.all(['', '/private/commercial', '/private/legal', '/settings/orders', '/settings/hours'].map((p) => db.doc(`restaurants/${RES}${p}`).delete().catch(() => {})));
    await db.doc(`cities/${CITY}`).delete().catch(() => {});
    await Promise.all([`users/${CLIENT}`, `userPrivate/${CLIENT}`].map((p) => db.doc(p).delete().catch(() => {})));
    await auth.deleteUser(CLIENT).catch(() => {});
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
