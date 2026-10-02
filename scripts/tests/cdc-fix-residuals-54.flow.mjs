// Test réel cdc-fix-residuals-54 (audit étendu du back-office restaurant, suite aux deux
// correctifs déjà livrés en PR #121) :
//
// 1. La « vitrine » (produits mis en avant, page Populaires) limitait le nombre de produits
//    (`MENU_LIMITS.featured`) seulement côté interface (`PopularPage.tsx`) : le bouton « Mettre
//    en avant » écrivait directement en Firestore (`updateProducts`), un chemin autorisé par la
//    règle (`can(rid,'menu.edit')`) qui ne compte jamais les produits déjà en vitrine — la Cloud
//    Function `reorderMenu` (seule à faire respecter le plafond, schéma Zod `max(MENU_LIMITS.featured)`)
//    existait déjà pour le glisser-déposer mais n'était jamais appelée par ce bouton. Corrigé :
//    le bouton passe maintenant par `reorderMenu` comme le glisser-déposer.
//
// 2. La page Finances recalculait la TVA sur commission agrégée avec un taux PAR DÉFAUT codé en
//    dur (`DEFAULT_PRICING_BY_COUNTRY`), alors que le montant réellement appliqué à chaque
//    commande (`order.restaurantSettlement.commissionVatCents`, au taux configuré en base pour
//    le pays/la ville, peut différer du défaut) n'était stocké nulle part dans les agrégats
//    quotidiens (`RestaurantDailyStats` ne gardait que `commissionCents`, le HT). Un admin qui
//    change le taux de TVA d'un pays désynchronisait silencieusement ce chiffre (présenté comme
//    « récupérable dans votre déclaration de TVA ») du vrai montant visible sur chaque commande.
//    Corrigé : nouveau champ `commissionVatCents` sur `RestaurantDailyStats`, alimenté par la
//    somme réelle par commande (`recomputeDailyStats`), la page Finances somme ce champ au lieu
//    de le recalculer.
//
//   npx tsx scripts/tests/cdc-fix-residuals-54.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres54-adc-${process.pid}.json`);
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
async function until(fn, timeoutMs = 60_000, everyMs = 2000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(everyMs);
  }
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

// ------------------------------------------------------------------ 1. reorderMenu('featured') : plafond serveur

async function testFeaturedCap() {
  const RES = 'cdcres54-resto-vitrine';
  const MEMBER_UID = 'cdcres54-membre-vitrine';
  const N = 13; // MENU_LIMITS.featured = 12 ; 13 doit être refusé, 12 accepté.

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES54 Vitrine', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });
  const ids = Array.from({ length: N }, (_, i) => `cdcres54-p${i}`);
  await Promise.all(ids.map((id, order) => db.doc(`restaurants/${RES}/products/${id}`).set({ name: `Test ${id}`, order, priceCents: 500, available: true, vatCategory: 'food', salesCount: 0, featured: false, featuredOrder: null, test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' })));

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(MEMBER_UID).catch(() => {});
  await auth.createUser({ uid: MEMBER_UID, email: 'cdcres54-membre-vitrine@golink.test', password, emailVerified: true, displayName: MEMBER_UID });
  await db.doc(`restaurants/${RES}/members/${MEMBER_UID}`).set({ userId: MEMBER_UID, restaurantId: RES, displayName: 'CDCRES54 Membre', email: 'cdcres54-membre-vitrine@golink.test', role: 'staff', permissions: ['menu.edit'], active: true, test: true, createdAt: at(), updatedAt: at() });
  const token = await loginPassword('cdcres54-membre-vitrine@golink.test', password);

  try {
    await expectError('reorderMenu(featured) : 13 produits (> plafond 12) REFUSÉ côté serveur', call(token, 'reorderMenu', { kind: 'featured', restaurantId: RES, ids }), undefined);
    const accepted = await call(token, 'reorderMenu', { kind: 'featured', restaurantId: RES, ids: ids.slice(0, 12) });
    check('reorderMenu(featured) : 12 produits (= plafond) accepté', accepted?.updated === 12, JSON.stringify(accepted));
    const snaps = await db.getAll(...ids.slice(0, 12).map((id) => db.doc(`restaurants/${RES}/products/${id}`)));
    check('reorderMenu(featured) : les 12 produits sont bien marqués featured=true', snaps.every((s) => s.get('featured') === true));
  } finally {
    await Promise.all(ids.map((id) => db.doc(`restaurants/${RES}/products/${id}`).delete().catch(() => {})));
    await db.doc(`restaurants/${RES}/members/${MEMBER_UID}`).delete().catch(() => {});
    await db.doc(`restaurants/${RES}`).delete().catch(() => {});
    await auth.deleteUser(MEMBER_UID).catch(() => {});
  }
}

// ------------------------------------------------------------------ 2. dailyStats.commissionVatCents : montant réel, pas le taux par défaut

async function testDailyStatsRealVat() {
  const RES = 'cdcres54-resto-tva';
  const CLIENT = 'cdcres54-client-tva';
  const id = 'cdcres54-order-tva';
  const day = new Date().toISOString().slice(0, 10);
  const subtotal = 10_000; // 100,00 €
  // Taux délibérément DIFFÉRENT du défaut codé en dur (20 %) : 8,5 % — si le bug était encore là,
  // dailyStats.commissionVatCents (recalculé à 20 %) ne correspondrait plus à ce qui est réellement
  // stocké sur la commande.
  const commissionHt = Math.round(subtotal * 0.15);
  const commissionVat = Math.round(commissionHt * 0.085);

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES54 TVA', cityId: 'cdcres54-ville-tva', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: at(), updatedAt: at(), updatedBy: 'system' });

  const items = [{ lineId: 'l1', productId: 'cdcres54-p1', name: 'Test plat TVA', imageUrl: null, unitPriceCents: subtotal, quantity: 1, options: [], optionsPriceCents: 0, totalCents: subtotal, vatCategory: 'food', containsAlcohol: false, comment: null, adjustment: null }];
  const total = subtotal + 299;
  try {
    await db.doc(`orders/${id}`).set({
      number: 'GL-TCDCRES54', countryId: 'FR', cityId: 'cdcres54-ville-tva', restaurantId: RES, restaurantName: 'CDCRES54 TVA', restaurantGroupId: null,
      customerId: CLIENT, customerName: 'Cdcres54 Client', customerPhoneMasked: null, status: 'delivered', fulfillment: 'pickup', items, itemsCount: 1,
      amounts: { subtotalCents: subtotal, serviceFeeCents: 0, smallOrderFeeCents: 0, deliveryFeeCents: 0, surgeFeeCents: 0, discount: { totalCents: 0, onItemsCents: 0, onDeliveryCents: 0, platformFundedCents: 0, restaurantFundedCents: 0, restaurantOnItemsCents: 0, restaurantOnDeliveryCents: 0 }, tipCents: 0, walletAppliedCents: 0, totalCents: total, chargedCents: total, refundedCents: 0, itemsVat: [], currency: 'EUR' },
      payment: { method: 'card', status: 'paid', paymentId: `pay-${id}`, label: null, paidAt: at() },
      promotionId: null, promoCode: null,
      delivery: null,
      pickupCode: null, pickupVerified: true, customerNote: null, scheduledFor: null, prepMinutes: 15, prepExtendedMinutes: 0, containsAlcohol: false, ageConfirmed: false,
      timeline: { placedAt: at(-30 * 60_000), new: at(-30 * 60_000), accepted: at(-28 * 60_000), preparing: at(-27 * 60_000), ready: at(-15 * 60_000), delivered: at(-5 * 60_000) },
      acceptDeadline: null, cancellation: null,
      flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: false },
      reviewId: null, ticketIds: [], conversationId: null, source: { app: 'client_web', appVersion: null }, driverId: null, searchKeywords: [id],
      restaurantSettlement: { grossCents: subtotal, discountFundedCents: 0, commissionBaseCents: subtotal, commissionBps: 1500, commissionHtCents: commissionHt, commissionVatCents: commissionVat, commissionTtcCents: commissionHt + commissionVat, deliveryFeeCents: 0, paymentFeeCents: 0, payoutCents: subtotal - commissionHt - commissionVat },
      commission: { bps: 1500, source: 'market' }, processed: {},
      createdAt: at(-30 * 60_000), updatedAt: at(-5 * 60_000), test: true, seed: true,
    });

    const stats = await until(async () => {
      const snap = await db.doc(`restaurants/${RES}/dailyStats/${day.replaceAll('-', '')}`).get();
      return snap.exists ? snap.data() : null;
    }, 30_000);
    check('recomputeDailyStats : dailyStats du jour créé (trigger onOrderWritten exécuté)', Boolean(stats), 'délai dépassé');
    check('dailyStats.commissionVatCents : montant RÉEL de la commande (correctif attendu), pas le taux par défaut', stats?.commissionVatCents === commissionVat, `attendu=${commissionVat} reçu=${stats?.commissionVatCents} (si le bug était encore là : ${Math.round(commissionHt * 0.2)})`);
    check('dailyStats.commissionCents : HT inchangé (non-régression)', stats?.commissionCents === commissionHt, `attendu=${commissionHt} reçu=${stats?.commissionCents}`);
  } finally {
    await db.doc(`orders/${id}`).delete().catch(() => {});
    await db.doc(`restaurants/${RES}/dailyStats/${day.replaceAll('-', '')}`).delete().catch(() => {});
    await db.doc(`restaurants/${RES}`).delete().catch(() => {});
  }
}

async function main() {
  await testFeaturedCap();
  await testDailyStatsRealVat();
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
