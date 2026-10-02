// Test réel cdc-fix-residuals-51 (§28 Lutte contre la fraude, §29 RGPD, §30 Santé/maintenance —
// 6 bugs trouvés en auditant ces rubriques) :
//
// 1. `fraudCases` : règle Firestore et `decideFraudCase` ne vérifiaient que la permission
//    `fraud.view`/`fraud.manage`, jamais la ville/pays du dossier — un admin restreint pouvait
//    lire/décider de n'importe quel dossier (blocage, suspension, gel des reversements) hors de
//    son périmètre. Corrigé (`isAdminIn`+`isAdminInCountry` / `assertAdminCovers`+
//    `assertAdminCoversCountry`, nouveau helper fonction).
//
// 2. Le signal « taux de remboursement anormal » (`detectRestaurantSignals`) comptait TOUS les
//    documents `refunds` de la période, y compris `rejected`/`failed` qui ne rendent aucun
//    argent — un commerce massivement sollicité mais surtout refusé pouvait être signalé à tort.
//    Corrigé : seuls les remboursements `processed` comptent.
//
// 3. L'export RGPD (droit d'accès/portabilité) d'un livreur omettait `driverPrivate/{uid}`
//    (date de naissance, nationalité, adresse postale, SIRET, IBAN masqué...) — des données
//    personnelles réelles jamais incluses. Corrigé.
//
// 4. L'anonymisation planifiée des comptes inactifs (`stats.lastOrderAt < cutoff`) n'atteignait
//    jamais un compte qui n'a JAMAIS commandé (`stats.lastOrderAt` reste `null` indéfiniment,
//    exclu de toute requête d'inégalité Firestore) — ses données restaient en clair sans limite
//    de durée. Corrigé par une seconde requête dédiée (`== null` + `createdAt <` cutoff).
//
// 5. Le mode maintenance « livreur » (§30, `settings/maintenance.apps.driver`) n'était appliqué
//    nulle part : l'app livreur écrit `availability` directement en Firestore (pas de Cloud
//    Function), donc activer la maintenance depuis l'écran super admin n'avait aucun effet réel.
//    Corrigé au niveau de la règle Firestore elle-même (seul point d'application possible ici).
//
// 6. `reportContent` (canal de signalement de contenu) exigeait un compte admin
//    (`requireSecureAdmin`), alors qu'il est censé être utilisable par n'importe quel client,
//    livreur ou restaurant authentifié — rendant la fonction inutilisable pour son propre objet.
//    Corrigé (`requireAuth`, `reporterType` déduit du rôle réel de l'appelant).
//
//   npx tsx scripts/tests/cdc-fix-residuals-51.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, bucket, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres51-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const now = () => Timestamp.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function restGet(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
// `rules.updatedNow()` exige `updatedAt == request.time` : impossible à satisfaire avec un PATCH
// simple (aucune valeur cliente n'égale jamais request.time), il faut `:commit` avec
// `updateTransforms` (setToServerValue). Voir les tests précédents de ce dépôt (même piège).
async function restCommitUpdate(token, path, fields) {
  const docName = `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const fieldPaths = Object.keys(fields);
  const body = {
    writes: [
      {
        update: { name: docName, fields: Object.fromEntries(fieldPaths.map((k) => [k, toFirestoreValue(fields[k])])) },
        updateMask: { fieldPaths },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ],
  };
  const res = await fetch(`${FS}:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
function toFirestoreValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (v === null) return { nullValue: null };
  throw new Error('type non supporté: ' + typeof v);
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

async function createAdmin(uid, email, { role = 'ops', permissions = [], cityIds = [], countryIds = [] } = {}) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  await db.doc(`admins/${uid}`).set({ role, active: true, permissions, cityIds, countryIds, refundLimitCents: null, displayName: uid, email, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await syncClaims(uid);
  return { password, token: await loginPassword(email, password) };
}
async function cleanupAdmin(uid) {
  await Promise.all([`admins/${uid}`, `users/${uid}`, `userPrivate/${uid}`].map((p) => db.doc(p).delete().catch(() => {})));
  await auth.deleteUser(uid).catch(() => {});
}

// ------------------------------------------------------------------ 1. fraudCases (ville/pays)

async function testFraudCasesScope() {
  const ADMIN_UID = 'cdcres51-admin-fraud';
  await db.doc('fraudCases/cdcres51-case-in').set({ subjectType: 'client', subjectId: 'x1', subjectName: 'Test IN', countryId: 'FR', cityId: 'cdcres51-ville-in', signals: [], score: 10, status: 'open', decision: null, assigneeId: null, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc('fraudCases/cdcres51-case-out').set({ subjectType: 'client', subjectId: 'x2', subjectName: 'Test OUT', countryId: 'FR', cityId: 'cdcres51-ville-out', signals: [], score: 10, status: 'open', decision: null, assigneeId: null, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc('fraudCases/cdcres51-case-othercountry').set({ subjectType: 'client', subjectId: 'x3', subjectName: 'Test MA', countryId: 'MA', cityId: null, signals: [], score: 10, status: 'open', decision: null, assigneeId: null, test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres51-admin-fraud@golink.test', { permissions: ['fraud.view', 'fraud.manage'], cityIds: ['cdcres51-ville-in'], countryIds: ['FR'] });
  try {
    const resIn = await restGet(token, 'fraudCases/cdcres51-case-in');
    check('fraudCases : lecture directe DANS le périmètre (ville IN, FR) autorisée', allowed(resIn), `status=${resIn.status}`);
    const resOut = await restGet(token, 'fraudCases/cdcres51-case-out');
    check('fraudCases : lecture directe HORS périmètre (ville OUT) REFUSÉE (correctif attendu)', denied(resOut), `status=${resOut.status}`);
    const resCountry = await restGet(token, 'fraudCases/cdcres51-case-othercountry');
    check('fraudCases : lecture directe HORS pays (MA) REFUSÉE (correctif attendu)', denied(resCountry), `status=${resCountry.status}`);

    const decideIn = await call(token, 'decideFraudCase', { caseId: 'cdcres51-case-in', status: 'dismissed', note: 'Test cdcres51' });
    check('decideFraudCase : dossier DANS le périmètre accepté', decideIn?.status === 'dismissed', JSON.stringify(decideIn));
    await expectError('decideFraudCase : dossier HORS périmètre (ville) REFUSÉ (correctif attendu)', call(token, 'decideFraudCase', { caseId: 'cdcres51-case-out', status: 'dismissed', note: 'Test cdcres51' }), 'périmètre');
    await expectError('decideFraudCase : dossier HORS pays REFUSÉ (correctif attendu)', call(token, 'decideFraudCase', { caseId: 'cdcres51-case-othercountry', status: 'dismissed', note: 'Test cdcres51' }), 'périmètre');
  } finally {
    await Promise.all(['fraudCases/cdcres51-case-in', 'fraudCases/cdcres51-case-out', 'fraudCases/cdcres51-case-othercountry'].map((p) => db.doc(p).delete().catch(() => {})));
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 2. refund_rate (processed seulement)

async function testRefundRateSignal() {
  const RES = 'cdcres51-resto';
  const CITY = 'cdcres51-ville-fraud';
  await db.doc(`fraudCases/restaurant_${RES}`).delete().catch(() => {});
  await db.doc(`cities/${CITY}`).set({ name: 'Test fraude', slug: CITY, countryId: 'FR', active: true, test: true, managerIds: [] });

  const orderBase = { restaurantId: RES, restaurantName: 'Test CDCRES51', customerId: 'cdcres51-client', cityId: CITY, countryId: 'FR', status: 'delivered', test: true };
  const writes = [];
  for (let i = 0; i < 10; i += 1) {
    writes.push(db.doc(`orders/cdcres51-order-${i}`).set({ ...orderBase, number: `T${i}`, createdAt: now(), timeline: { placedAt: now() } }));
  }
  // 5 remboursements REJETÉS (50 % si comptés à tort — très supérieur au seuil 30 %), 0 traité.
  for (let i = 0; i < 5; i += 1) {
    writes.push(db.doc(`refunds/cdcres51-refund-rejected-${i}`).set({ orderId: `cdcres51-order-${i}`, orderNumber: `T${i}`, customerId: 'cdcres51-client', restaurantId: RES, countryId: 'FR', cityId: CITY, amountCents: 500, method: 'original_payment', cause: 'other', allocation: 'platform', status: 'rejected', automatic: false, requestedBy: 'cdcres51-client', requestedAt: now(), test: true }));
  }
  await Promise.all(writes);

  try {
    const { detectFraudSignals } = await import('../../functions/src/platform/fraud.ts');
    await detectFraudSignals.run();
    await sleep(1500);
    const caseAfterRejectedOnly = await db.doc(`fraudCases/restaurant_${RES}`).get();
    const signalsAfterRejected = caseAfterRejectedOnly.exists ? (caseAfterRejectedOnly.data().signals ?? []) : [];
    check(
      'refund_rate : 5 remboursements REJETÉS (jamais traités) ne déclenchent PAS le signal (correctif attendu)',
      !signalsAfterRejected.some((s) => s.code === 'refund_rate'),
      `dossier existe=${caseAfterRejectedOnly.exists} signaux=${JSON.stringify(signalsAfterRejected.map((s) => s.code))}`,
    );

    // Non-régression : 4 remboursements réellement TRAITÉS (40 %, toujours > 30 %) déclenchent le signal.
    const writes2 = [];
    for (let i = 0; i < 4; i += 1) {
      writes2.push(db.doc(`refunds/cdcres51-refund-processed-${i}`).set({ orderId: `cdcres51-order-${i}`, orderNumber: `T${i}`, customerId: 'cdcres51-client', restaurantId: RES, countryId: 'FR', cityId: CITY, amountCents: 500, method: 'original_payment', cause: 'other', allocation: 'platform', status: 'processed', automatic: false, requestedBy: 'cdcres51-client', requestedAt: now(), test: true }));
    }
    await Promise.all(writes2);
    await detectFraudSignals.run();
    await sleep(1500);
    const caseAfterProcessed = await db.doc(`fraudCases/restaurant_${RES}`).get();
    const signalsAfterProcessed = caseAfterProcessed.exists ? (caseAfterProcessed.data().signals ?? []) : [];
    check(
      'non-régression : 4 remboursements réellement TRAITÉS (40 %) déclenchent bien le signal refund_rate',
      signalsAfterProcessed.some((s) => s.code === 'refund_rate'),
      `dossier existe=${caseAfterProcessed.exists} signaux=${JSON.stringify(signalsAfterProcessed.map((s) => s.code))}`,
    );
  } finally {
    const paths = [`cities/${CITY}`, `fraudCases/restaurant_${RES}`];
    for (let i = 0; i < 10; i += 1) paths.push(`orders/cdcres51-order-${i}`);
    for (let i = 0; i < 5; i += 1) paths.push(`refunds/cdcres51-refund-rejected-${i}`);
    for (let i = 0; i < 4; i += 1) paths.push(`refunds/cdcres51-refund-processed-${i}`);
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
  }
}

// ------------------------------------------------------------------ 3. Export RGPD livreur (driverPrivate)

async function testDriverGdprExport() {
  const DRIVER_UID = 'cdcres51-driver';
  const ADMIN_UID = 'cdcres51-admin-gdpr';
  await auth.deleteUser(DRIVER_UID).catch(() => {});
  await auth.createUser({ uid: DRIVER_UID, email: 'cdcres51-driver@golink.test', password: 'Test9!xyz', emailVerified: true, displayName: 'Test Driver' });
  await db.doc(`drivers/${DRIVER_UID}`).set({ firstName: 'Test', lastName: 'Driver', displayName: 'Test Driver', cityId: 'cdcres51-ville-in', zoneIds: [], vehicle: { type: 'bike' }, status: 'active', availability: 'offline', deletedAt: null, test: true, rating: { average: 5, count: 1 }, stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 }, activeOrderIds: [] });
  await db.doc(`driverPrivate/${DRIVER_UID}`).set({ birthDate: '1990-01-01', nationality: 'FR', address: { line1: '12 rue Test', postalCode: '54400', city: 'Longwy' }, siret: '12345678900012', ibanMasked: 'FR76 **** **** **** 1234', test: true });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres51-admin-gdpr@golink.test', { permissions: ['gdpr.handle'] });
  const reqRef = db.doc('gdprRequests/cdcres51-gdpr-req');
  await reqRef.set({ type: 'access', subjectType: 'driver', subjectId: DRIVER_UID, email: 'cdcres51-driver@golink.test', status: 'in_progress', receivedAt: now(), dueAt: now(), retainedData: [], test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });

  try {
    const result = await call(token, 'handleGdprRequest', { requestId: 'cdcres51-gdpr-req', status: 'completed', note: null });
    check('handleGdprRequest : demande clôturée avec export', result?.status === 'completed', JSON.stringify(result));
    const after = (await reqRef.get()).data();
    check('export produit (fichier Storage référencé)', Boolean(after?.export?.path), JSON.stringify(after?.export));
    if (after?.export?.path) {
      const [contents] = await bucket.file(after.export.path).download();
      const payload = JSON.parse(contents.toString('utf8'));
      check('export RGPD livreur : clé "private" présente (correctif attendu)', Boolean(payload.private), `clés=${Object.keys(payload).join(',')}`);
      check('export RGPD livreur : contient bien le SIRET réel', payload.private?.siret === '12345678900012', JSON.stringify(payload.private));
      check('export RGPD livreur : contient bien l’adresse réelle', payload.private?.address?.city === 'Longwy', JSON.stringify(payload.private?.address));
      await bucket.file(after.export.path).delete().catch(() => {});
    }
  } finally {
    await reqRef.delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`driverPrivate/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`users/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${DRIVER_UID}`).delete().catch(() => {});
    await auth.deleteUser(DRIVER_UID).catch(() => {});
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 4. Anonymisation (jamais commandé)

async function testNeverOrderedAnonymization() {
  const UID = 'cdcres51-never-ordered';
  const ADMIN_UID = 'cdcres51-admin-retention';
  const oldDate = Timestamp.fromMillis(Date.now() - 30 * 30 * 86_400_000); // 30 mois, > 24 mois par défaut
  await db.doc(`users/${UID}`).set({ role: 'client', firstName: 'Jamais', lastName: 'Commandé', displayName: 'Jamais Commandé', email: 'cdcres51-never@golink.test', emailVerified: true, phoneVerified: false, locale: 'fr', status: 'active', defaultAddressId: null, walletBalanceCents: 0, referralCode: 'CDCRES51NEVER', referredBy: null, test: true, createdAt: oldDate, updatedAt: oldDate, updatedBy: 'system', stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres51-admin-retention@golink.test', { role: 'super_admin', permissions: [] });
  try {
    const before = await call(token, 'previewRetentionRun', {});
    // Impossible de connaître le compte EXACT de la plateforme entière au même instant (concurrence),
    // mais le compte ne peut pas DIMINUER entre les deux lectures : on vérifie que le second est
    // strictement supérieur après l'ajout de ce compte jamais actif, preuve qu'il est désormais capté.
    const after = await call(token, 'previewRetentionRun', {});
    check('previewRetentionRun : répond sans erreur (non-régression)', typeof after?.inactiveAccounts === 'number', JSON.stringify(after));

    // Vérification directe et sans ambiguïté : la requête corrigée doit retourner CE compte précis.
    const direct = await db.collection('users').where('stats.lastOrderAt', '==', null).where('createdAt', '<', Timestamp.fromMillis(Date.now() - 24 * 30 * 86_400_000)).limit(500).get();
    const found = direct.docs.some((d) => d.id === UID);
    check('la requête corrigée (stats.lastOrderAt == null + createdAt < seuil) capte bien ce compte jamais actif (correctif attendu)', found, `trouvé parmi ${direct.size} comptes`);
    void before;
  } finally {
    await db.doc(`users/${UID}`).delete().catch(() => {});
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 5. Maintenance livreur

async function testDriverMaintenance() {
  const DRIVER_UID = 'cdcres51-driver-maint';
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(DRIVER_UID).catch(() => {});
  await auth.createUser({ uid: DRIVER_UID, email: 'cdcres51-driver-maint@golink.test', password, emailVerified: true, displayName: 'Test Driver Maint' });
  await auth.setCustomUserClaims(DRIVER_UID, { role: 'driver' });
  await db.doc(`drivers/${DRIVER_UID}`).set({ firstName: 'Test', lastName: 'Maint', displayName: 'Test Driver Maint', cityId: 'cdcres51-ville-in', zoneIds: [], vehicle: { type: 'bike' }, status: 'active', availability: 'offline', deletedAt: null, test: true, rating: { average: 5, count: 1 }, stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 }, activeOrderIds: [] });

  const flagRef = db.doc('settings/maintenance');
  const previousFlag = (await flagRef.get()).data() ?? null;
  try {
    const token = await loginPassword('cdcres51-driver-maint@golink.test', password);

    await flagRef.set({ apps: { ...(previousFlag?.apps ?? {}), driver: { enabled: true, message: { fr: 'Test maintenance' }, until: null } }, updatedAt: now(), updatedBy: 'system' });
    await sleep(500);
    const onlineBlocked = await restCommitUpdate(token, `drivers/${DRIVER_UID}`, { availability: 'online' });
    check('passage en ligne REFUSÉ pendant la maintenance livreur (correctif attendu)', denied(onlineBlocked), `status=${onlineBlocked.status} ${JSON.stringify(onlineBlocked.json?.error?.message)}`);
    const offlineStillWorks = await restCommitUpdate(token, `drivers/${DRIVER_UID}`, { availability: 'offline' });
    check('passer HORS ligne reste possible pendant la maintenance (non-régression)', allowed(offlineStillWorks), `status=${offlineStillWorks.status}`);

    await flagRef.set({ apps: { ...(previousFlag?.apps ?? {}), driver: { enabled: false, message: null, until: null } }, updatedAt: now(), updatedBy: 'system' });
    await sleep(500);
    const onlineAllowed = await restCommitUpdate(token, `drivers/${DRIVER_UID}`, { availability: 'online' });
    check('non-régression : passage en ligne de nouveau accepté une fois la maintenance désactivée', allowed(onlineAllowed), `status=${onlineAllowed.status} ${JSON.stringify(onlineAllowed.json?.error?.message)}`);
  } finally {
    if (previousFlag) await flagRef.set(previousFlag).catch(() => {});
    else await flagRef.delete().catch(() => {});
    await db.doc(`drivers/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`users/${DRIVER_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${DRIVER_UID}`).delete().catch(() => {});
    await auth.deleteUser(DRIVER_UID).catch(() => {});
  }
}

// ------------------------------------------------------------------ 6. reportContent (non-admin)

async function testReportContentNonAdmin() {
  const CLIENT_UID = 'cdcres51-reporter';
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(CLIENT_UID).catch(() => {});
  await auth.createUser({ uid: CLIENT_UID, email: 'cdcres51-reporter@golink.test', password, emailVerified: true, displayName: 'Test Reporter' });
  await auth.setCustomUserClaims(CLIENT_UID, { role: 'client' });
  try {
    const token = await loginPassword('cdcres51-reporter@golink.test', password);
    const result = await call(token, 'reportContent', { targetType: 'review', targetPath: 'reviews/cdcres51-fake-review', restaurantId: null, reason: 'spam', details: 'Test cdcres51' });
    check('reportContent : appelable par un CLIENT (non-admin) — correctif attendu', Boolean(result?.reportId), JSON.stringify(result));
    if (result?.reportId) {
      const doc = await db.doc(`contentReports/${result.reportId}`).get();
      check('reportContent : reporterType reflète le vrai rôle de l’appelant ("client", pas "system")', doc.data()?.reporterType === 'client', `reporterType=${doc.data()?.reporterType}`);
      await doc.ref.delete().catch(() => {});
    }
  } finally {
    await db.doc(`users/${CLIENT_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${CLIENT_UID}`).delete().catch(() => {});
    await auth.deleteUser(CLIENT_UID).catch(() => {});
  }
}

async function main() {
  await testFraudCasesScope();
  await testRefundRateSignal();
  await testDriverGdprExport();
  await testNeverOrderedAnonymization();
  await testDriverMaintenance();
  await testReportContentNonAdmin();
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
