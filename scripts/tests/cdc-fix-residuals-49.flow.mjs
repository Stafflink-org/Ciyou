// Test réel cdc-fix-residuals-49 (§19 Fidélité et parrainage, §24 Activation des fonctionnalités —
// 4 bugs trouvés en auditant ces rubriques) :
//
// 1. `decideReferral` (functions/src/marketing/platform/referrals.ts) ne vérifiait que la
//    permission `loyalty.edit`, jamais la ville/pays du parrainage (`referral.cityId`) — un admin
//    restreint pouvait décider de n'importe quel parrainage hors de son périmètre. La règle
//    Firestore `/referrals/{id}` avait le même trou. Corrigé : `Referral` porte désormais
//    `cityId`/`countryId` (renseignés à la création), `decideReferral` appelle `assertAdminCovers`,
//    la règle utilise `isAdminIn`.
//
// 2. `redeemLoyaltyPoints` (functions/src/marketing/platform/loyalty.ts) ne vérifiait JAMAIS
//    l'interrupteur « Fidélité » (§24) dans la branche « programme restaurant » (seul
//    `program.enabled`, propre au commerce, était contrôlé), et le vérifiait avec une portée VIDE
//    (`{}`, ignorant tout override ville/pays/commerce) dans la branche « programme plateforme » —
//    alors qu'`earnLoyaltyPoints` le fait déjà correctement avec la portée complète. Un flag
//    désactivé pour un commerce/ville/pays précis n'empêchait donc pas l'échange d'un solde déjà
//    acquis, seulement l'acquisition de nouveaux points. Corrigé.
//
// 3. Les écritures du grand livre de `redeemLoyaltyPoints` imputaient `countryId: 'FR'` en dur,
//    quel que soit le pays réel du commerce/client — alors que le Luxembourg (LU) est un marché
//    actif. Corrigé : pays/ville réels (`geo`).
//
// 4. Le flag « Parrainage » (§24) n'était vérifié ni par `restaurantSignup` (saisie du code à
//    l'inscription, via `linkRestaurantReferral` appelée directement) ni par la branche
//    « activation » de `onRestaurantActivatedReferral` — seules la saisie après coup
//    (`applyRestaurantReferralCode`) et la branche « commande » le vérifiaient. Corrigé : le
//    contrôle est déplacé DANS `linkRestaurantReferral` (commun à tous les appelants, reason
//    `feature_off`) et ajouté dans `onRestaurantActivatedReferral`.
//
//   npx tsx scripts/tests/cdc-fix-residuals-49.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres49-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');
const { linkRestaurantReferral } = await import('../../functions/src/marketing/platform/referral-links.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs = 60_000, stepMs = 2000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(stepMs);
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

const now = () => Timestamp.now();

// ------------------------------------------------------------------ 1. decideReferral (ville)

async function testDecideReferralScope() {
  const CITY_IN = 'cdcres49-ville-in';
  const CITY_OUT = 'cdcres49-ville-out';
  const ADMIN_UID = 'cdcres49-admin-referral';
  await db.doc(`cities/${CITY_IN}`).set({ name: 'Test IN', slug: CITY_IN, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`cities/${CITY_OUT}`).set({ name: 'Test OUT', slug: CITY_OUT, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc('referrals/cdcres49-ref-in').set({ program: 'client', referrerId: 'r1', referrerType: 'client', refereeId: 'r2', refereeType: 'client', code: 'X', status: 'qualified', referrerRewardCents: 0, refereeRewardCents: 0, cityId: CITY_IN, countryId: 'FR', createdAt: now(), test: true });
  await db.doc('referrals/cdcres49-ref-out').set({ program: 'client', referrerId: 'r3', referrerType: 'client', refereeId: 'r4', refereeType: 'client', code: 'Y', status: 'qualified', referrerRewardCents: 0, refereeRewardCents: 0, cityId: CITY_OUT, countryId: 'FR', createdAt: now(), test: true });

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(ADMIN_UID).catch(() => {});
  await auth.createUser({ uid: ADMIN_UID, email: 'cdcres49-admin-referral@golink.test', password, emailVerified: true, displayName: 'CDCRES49 Admin' });
  await db.doc(`admins/${ADMIN_UID}`).set({ role: 'ops', active: true, permissions: ['loyalty.edit'], cityIds: [CITY_IN], countryIds: [], displayName: 'CDCRES49 Admin', email: 'cdcres49-admin-referral@golink.test', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await syncClaims(ADMIN_UID);

  try {
    const token = await loginPassword('cdcres49-admin-referral@golink.test', password);
    const inScope = await call(token, 'decideReferral', { referralId: 'cdcres49-ref-in', decision: 'mark_paid', reason: 'Test cdcres49' });
    check('decideReferral : parrainage DANS le périmètre (ville IN) accepté', Boolean(inScope), JSON.stringify(inScope));
    await expectError(
      'decideReferral : parrainage HORS périmètre (ville OUT) REFUSÉ (correctif attendu)',
      call(token, 'decideReferral', { referralId: 'cdcres49-ref-out', decision: 'mark_paid', reason: 'Test cdcres49' }),
      'périmètre',
    );
  } finally {
    await Promise.all([
      db.doc('referrals/cdcres49-ref-in').delete(), db.doc('referrals/cdcres49-ref-out').delete(),
      db.doc(`cities/${CITY_IN}`).delete(), db.doc(`cities/${CITY_OUT}`).delete(),
      db.doc(`admins/${ADMIN_UID}`).delete(), db.doc(`users/${ADMIN_UID}`).delete(), db.doc(`userPrivate/${ADMIN_UID}`).delete(),
    ].map((p) => p.catch(() => {})));
    await auth.deleteUser(ADMIN_UID).catch(() => {});
  }
}

// ------------------------------------------------------------------ 2+3. redeemLoyaltyPoints (flag + geo)

async function testRedeemLoyaltyFeatureFlagAndGeo() {
  const CITY = 'cdcres49-ville-lu';
  const RES = 'cdcres49-resto-loyalty';
  const CLIENT = 'cdcres49-client-loyalty';

  await db.doc(`cities/${CITY}`).set({ name: 'Test LU', slug: CITY, countryId: 'LU', active: true, test: true, managerIds: [] });
  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES49 Resto', cityId: CITY, countryId: 'LU', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${RES}/settings/loyalty`).set({ enabled: true, earnPoints: 1, everyCents: 100, welcomePoints: 0, thresholdPoints: 100, rewardCents: 500, rewards: [{ points: 100, rewardCents: 500 }], pointsValidityDays: null, test: true });

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(CLIENT).catch(() => {});
  await auth.createUser({ uid: CLIENT, email: 'cdcres49-client-loyalty@golink.test', password, emailVerified: true, displayName: 'CDCRES49 Client' });
  await db.doc(`users/${CLIENT}`).set({
    role: 'client', firstName: 'Cdcres49', lastName: 'Client', displayName: 'Cdcres49 Client', email: 'cdcres49-client-loyalty@golink.test', emailVerified: true, phoneVerified: false,
    locale: 'fr', status: 'active', defaultAddressId: null, walletBalanceCents: 0, referralCode: 'CDCRES49LOY', referredBy: null, cityId: CITY, countryId: 'LU', test: true,
    createdAt: now(), updatedAt: now(), updatedBy: 'system', stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 },
  });
  await syncClaims(CLIENT);

  // Comptes de points suffisants : plateforme (scope:'platform') et restaurant (scope:'restaurant').
  await db.doc(`loyaltyAccounts/${CLIENT}`).set({ userId: CLIENT, scope: 'platform', restaurantId: null, points: 1000, lifetimePoints: 1000, tier: null, updatedAt: now() });
  await db.doc(`loyaltyAccounts/${CLIENT}_${RES}`).set({ userId: CLIENT, scope: 'restaurant', restaurantId: RES, points: 1000, lifetimePoints: 1000, tier: null, updatedAt: now() });
  // Lots de points existants (earn), pour que redeemLoyaltyPoints trouve des lots à consommer.
  await db.collection('loyaltyTransactions').doc('cdcres49-earn-platform').set({ accountId: CLIENT, userId: CLIENT, restaurantId: null, type: 'earn', points: 1000, remaining: 1000, orderId: 'x', valueCents: null, createdAt: now(), createdBy: 'system', expiresAt: null });
  await db.collection('loyaltyTransactions').doc('cdcres49-earn-restaurant').set({ accountId: `${CLIENT}_${RES}`, userId: CLIENT, restaurantId: RES, type: 'earn', points: 1000, remaining: 1000, orderId: 'x', valueCents: null, createdAt: now(), createdBy: 'system', expiresAt: null });

  const settingsRef = db.doc('settings/loyalty');
  const flagRef = db.doc('featureFlags/loyalty');
  const previousSettings = (await settingsRef.get()).data() ?? null;
  const previousFlag = (await flagRef.get()).data() ?? null;
  await settingsRef.set({ enabled: true, pointsPerEuro: 1, welcomePoints: 0, rewards: [{ points: 100, valueCents: 500 }], pointsValidityDays: null, allowRestaurantPrograms: true, updatedAt: now(), updatedBy: 'system' });

  try {
    const token = await loginPassword('cdcres49-client-loyalty@golink.test', password);

    // --- Branche restaurant, flag désactivé spécifiquement pour CE commerce.
    await flagRef.set({ key: 'loyalty', description: 'Fidélité', enabled: true, overrides: [{ scope: 'restaurant', scopeId: RES, enabled: false }], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    await expectError(
      'redeemLoyaltyPoints (programme restaurant) : flag désactivé pour CE commerce → REFUSÉ (correctif attendu)',
      call(token, 'redeemLoyaltyPoints', { points: 100, restaurantId: RES }),
      'pas ouvert',
    );

    // --- Branche restaurant, flag réactivé : non-régression, l'échange réussit et impute LU (pas FR).
    await flagRef.set({ key: 'loyalty', description: 'Fidélité', enabled: true, overrides: [], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    const redeemedRestaurant = await call(token, 'redeemLoyaltyPoints', { points: 100, restaurantId: RES });
    check('non-régression : flag réactivé, échange programme restaurant accepté', Boolean(redeemedRestaurant), JSON.stringify(redeemedRestaurant));
    const costDocR = (await db.collection('ledgerEntries').where('accountType', '==', 'restaurant').where('accountId', '==', RES).orderBy('createdAt', 'desc').limit(1).get()).docs[0]?.data();
    check('grand livre (programme restaurant) : countryId réel du commerce (LU), pas "FR" en dur (correctif attendu)', costDocR?.countryId === 'LU', `countryId=${costDocR?.countryId}`);
    check('grand livre (programme restaurant) : cityId réel renseigné', costDocR?.cityId === CITY, `cityId=${costDocR?.cityId}`);

    // --- Branche plateforme, flag désactivé par VILLE (portée du client) — avant le correctif,
    // assertFeatureOn('loyalty', {}) ignorait cet override.
    await flagRef.set({ key: 'loyalty', description: 'Fidélité', enabled: true, overrides: [{ scope: 'city', scopeId: CITY, enabled: false }], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    await expectError(
      'redeemLoyaltyPoints (programme plateforme) : flag désactivé pour LA VILLE du client → REFUSÉ (correctif attendu)',
      call(token, 'redeemLoyaltyPoints', { points: 100 }),
      'pas ouvert',
    );

    // --- Branche plateforme, flag réactivé : non-régression, échange accepté, grand livre en LU.
    await flagRef.set({ key: 'loyalty', description: 'Fidélité', enabled: true, overrides: [], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    const redeemedPlatform = await call(token, 'redeemLoyaltyPoints', { points: 100 });
    check('non-régression : flag réactivé, échange programme plateforme accepté', Boolean(redeemedPlatform), JSON.stringify(redeemedPlatform));
    const costDocP = (await db.collection('ledgerEntries').where('accountType', '==', 'platform').where('accountId', '==', CLIENT === 'golink' ? 'golink' : 'golink').orderBy('createdAt', 'desc').limit(1).get()).docs[0]?.data();
    check('grand livre (programme plateforme) : countryId réel du client (LU), pas "FR" en dur (correctif attendu)', costDocP?.countryId === 'LU', `countryId=${costDocP?.countryId}`);
  } finally {
    await flagRef.delete().catch(() => {});
    if (previousFlag) await flagRef.set(previousFlag).catch(() => {});
    if (previousSettings) await settingsRef.set(previousSettings).catch(() => {});
    else await settingsRef.delete().catch(() => {});
    const paths = [
      `cities/${CITY}`, `restaurants/${RES}`, `restaurants/${RES}/settings/loyalty`,
      `users/${CLIENT}`, `userPrivate/${CLIENT}`,
      `loyaltyAccounts/${CLIENT}`, `loyaltyAccounts/${CLIENT}_${RES}`,
      'loyaltyTransactions/cdcres49-earn-platform', 'loyaltyTransactions/cdcres49-earn-restaurant',
    ];
    const redeemDocs = await db.collection('loyaltyTransactions').where('userId', '==', CLIENT).where('type', '==', 'redeem').get();
    for (const d of redeemDocs.docs) paths.push(`loyaltyTransactions/${d.id}`);
    const walletTx = await db.collection('walletTransactions').where('userId', '==', CLIENT).get();
    for (const d of walletTx.docs) paths.push(`walletTransactions/${d.id}`);
    const ledgerR = await db.collection('ledgerEntries').where('accountType', '==', 'restaurant').where('accountId', '==', RES).get();
    for (const d of ledgerR.docs) paths.push(`ledgerEntries/${d.id}`);
    const ledgerP = await db.collection('ledgerEntries').where('accountType', '==', 'customer_wallet').where('accountId', '==', CLIENT).get();
    for (const d of ledgerP.docs) paths.push(`ledgerEntries/${d.id}`);
    const ledgerPlat = await db.collection('ledgerEntries').where('accountType', '==', 'platform').where('accountId', '==', 'golink').get();
    for (const d of ledgerPlat.docs) paths.push(`ledgerEntries/${d.id}`);
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
    await auth.deleteUser(CLIENT).catch(() => {});
  }
}

// ------------------------------------------------------------------ 4. linkRestaurantReferral (flag à l'inscription)

async function testLinkRestaurantReferralFlag() {
  const CITY = 'cdcres49-ville-link';
  const REFERRER = 'cdcres49-referrer';
  const REFEREE = 'cdcres49-referee';
  await db.doc(`cities/${CITY}`).set({ name: 'Test link', slug: CITY, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`restaurants/${REFERRER}`).set({ name: 'CDCRES49 Parrain', cityId: CITY, countryId: 'FR', status: 'active', onboardingStatus: 'approved', ownerId: 'cdcres49-owner', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${REFEREE}`).set({ name: 'CDCRES49 Filleul', cityId: CITY, countryId: 'FR', status: 'pending', onboardingStatus: 'pending', ownerId: 'cdcres49-owner-2', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${REFERRER}/private/legal`).set({ siret: '11111111100001', managerPhone: '+33 6 00 00 00 01', managerEmail: 'cdcres49-a@golink.test', test: true });
  await db.doc(`restaurants/${REFEREE}/private/legal`).set({ siret: '22222222200001', managerPhone: '+33 6 00 00 00 02', managerEmail: 'cdcres49-b@golink.test', test: true });
  await db.doc('referralCodes/CDCRES49CODE').set({ kind: 'restaurant', ownerId: REFERRER, countryId: 'FR', createdAt: now(), test: true });

  const flagRef = db.doc('featureFlags/referral');
  const previousFlag = (await flagRef.get()).data() ?? null;
  try {
    await flagRef.set({ key: 'referral', description: 'Parrainage', enabled: true, overrides: [{ scope: 'city', scopeId: CITY, enabled: false }], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    const outcomeOff = await linkRestaurantReferral(REFEREE, 'CDCRES49CODE');
    check(
      'linkRestaurantReferral : flag désactivé pour la ville du filleul → refusé, reason="feature_off" (correctif attendu)',
      outcomeOff.applied === false && outcomeOff.reason === 'feature_off',
      JSON.stringify(outcomeOff),
    );
    const linkedWhileOff = (await db.doc(`restaurants/${REFEREE}/private/commercial`).get()).exists;
    check('non-régression : aucun lien créé pendant que le flag est éteint', !linkedWhileOff || !(await db.doc(`referrals/rest-${REFEREE}`).get()).exists);

    await flagRef.set({ key: 'referral', description: 'Parrainage', enabled: true, overrides: [], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    const outcomeOn = await linkRestaurantReferral(REFEREE, 'CDCRES49CODE');
    check('non-régression : flag réactivé, le lien se crée normalement', outcomeOn.applied === true, JSON.stringify(outcomeOn));
  } finally {
    await flagRef.delete().catch(() => {});
    if (previousFlag) await flagRef.set(previousFlag).catch(() => {});
    const paths = [
      `cities/${CITY}`, `restaurants/${REFERRER}`, `restaurants/${REFEREE}`,
      `restaurants/${REFERRER}/private/legal`, `restaurants/${REFEREE}/private/legal`,
      `restaurants/${REFEREE}/private/commercial`,
      'referralCodes/CDCRES49CODE', `referrals/rest-${REFEREE}`,
    ];
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
  }
}

// ------------------------------------------------------------------ 5. onRestaurantActivatedReferral (flag à l'activation)

async function testActivationTriggerFlag() {
  const CITY = 'cdcres49-ville-activ';
  const REFERRER = 'cdcres49-referrer-activ';
  const REFEREE = 'cdcres49-referee-activ';
  await db.doc(`cities/${CITY}`).set({ name: 'Test activ', slug: CITY, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`restaurants/${REFERRER}`).set({ name: 'CDCRES49 Parrain Activ', cityId: CITY, countryId: 'FR', status: 'active', onboardingStatus: 'approved', ownerId: 'cdcres49-owner-activ', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${REFEREE}`).set({ name: 'CDCRES49 Filleul Activ', cityId: CITY, countryId: 'FR', status: 'pending', onboardingStatus: 'approved', ownerId: 'cdcres49-owner-activ-2', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc('referrals/rest-cdcres49-referee-activ').set({
    program: 'restaurant', referrerId: REFERRER, referrerType: 'restaurant', refereeId: REFEREE, refereeType: 'restaurant', referrerName: 'x', refereeName: 'y',
    code: 'CDCRES49ACTIV', status: 'pending', qualifyingOrderId: null, referrerRewardCents: 0, refereeRewardCents: 0, cityId: CITY, countryId: 'FR', createdAt: now(), qualifiedAt: null, rewardedAt: null, test: true,
  });

  const settingsRef = db.doc('settings/referral');
  const flagRef = db.doc('featureFlags/referral');
  const previousSettings = (await settingsRef.get()).data() ?? null;
  const previousFlag = (await flagRef.get()).data() ?? null;
  try {
    await settingsRef.set({
      client: { enabled: false, referrerRewardCents: 0, refereeRewardCents: 0, minFirstOrderCents: 0 },
      restaurant: { enabled: true, rewardCents: 10000, qualifyingOrders: 0, rewardType: 'ad_credit' },
      driver: { enabled: false, rewardCents: 0, qualifyingDeliveries: 0 },
      updatedAt: now(), updatedBy: 'system',
    });
    await flagRef.set({ key: 'referral', description: 'Parrainage', enabled: true, overrides: [{ scope: 'city', scopeId: CITY, enabled: false }], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel

    await db.doc(`restaurants/${REFEREE}`).update({ status: 'active' });
    const stayedPending = await until(async () => {
      const snap = await db.doc('referrals/rest-cdcres49-referee-activ').get();
      return snap.get('status') === 'pending' ? true : null;
    }, 20_000, 2000);
    await sleep(8000); // marge supplémentaire : laisser le déclencheur réellement s'exécuter s'il devait le faire.
    const afterWait = await db.doc('referrals/rest-cdcres49-referee-activ').get();
    check(
      'onRestaurantActivatedReferral : flag désactivé pour la ville du filleul → PAS de prime versée (correctif attendu)',
      afterWait.get('status') === 'pending',
      `status=${afterWait.get('status')}`,
    );
    void stayedPending;

    // Non-régression : flag réactivé, remettre le commerce en attente puis ré-activer → prime versée.
    await flagRef.set({ key: 'referral', description: 'Parrainage', enabled: true, overrides: [], updatedAt: now(), updatedBy: 'system' });
    await sleep(11000); // laisser expirer le cache 10s de loadFeatureFlags avant le prochain appel
    await db.doc(`restaurants/${REFEREE}`).update({ status: 'pending' });
    await sleep(2000);
    await db.doc(`restaurants/${REFEREE}`).update({ status: 'active' });
    const rewarded = await until(async () => {
      const snap = await db.doc('referrals/rest-cdcres49-referee-activ').get();
      return snap.get('status') === 'rewarded' ? true : null;
    }, 30_000, 2000);
    check('non-régression : flag réactivé, prime versée normalement à l’activation', Boolean(rewarded), `status final=${(await db.doc('referrals/rest-cdcres49-referee-activ').get()).get('status')}`);
  } finally {
    await flagRef.delete().catch(() => {});
    if (previousFlag) await flagRef.set(previousFlag).catch(() => {});
    if (previousSettings) await settingsRef.set(previousSettings).catch(() => {});
    else await settingsRef.delete().catch(() => {});
    const paths = [
      `cities/${CITY}`, `restaurants/${REFERRER}`, `restaurants/${REFEREE}`,
      `restaurants/${REFERRER}/private/commercial`, 'referrals/rest-cdcres49-referee-activ',
    ];
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
  }
}

async function main() {
  await testDecideReferralScope();
  await testRedeemLoyaltyFeatureFlagAndGeo();
  await testLinkRestaurantReferralFlag();
  await testActivationTriggerFlag();
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
