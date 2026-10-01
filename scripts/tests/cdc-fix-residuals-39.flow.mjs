// Test réel cdc-fix-residuals-39 (§12 Avis et notes, §20 Notifications et communication) :
// trois défauts de cloisonnement par ville/périmètre dans les règles Firestore, de la même
// famille qu'un défaut déjà corrigé deux fois dans ce dépôt (`orders.rules::events`,
// `cdc-fix-residuals-20` ; `users.rules`, `cdc-fix-residuals-13`).
//
//  1. `reviews/{orderId}` : lecture et modération utilisaient `isAdmin('reviews.view'/'.moderate')`
//     (permission seule, sans ville) — un admin limité à une ville pouvait lire/modérer les avis
//     de N'IMPORTE QUELLE AUTRE ville. Corrigé : `isAdminIn(..., resource.data.cityId)`.
//  2. `ratingWatch/{watchId}` : même défaut, même correctif.
//  3. `campaigns/{campaignId}` (scope `platform`) : la règle d'écriture directe n'exigeait que
//     `isAdmin('notifications.send')`, sans vérifier le périmètre ville/pays NI la plage horaire
//     légale d'envoi — pourtant appliqués par la Cloud Function `savePlatformCampaign`
//     (seul chemin voulu). Un admin limité à une ville pouvait donc écrire directement un
//     document `campaigns` plateforme, ramassé et envoyé tel quel par la tâche planifiée
//     `sendCampaign`, hors de tout contrôle. Corrigé : écriture directe fermée pour
//     `scope == 'platform'` (comme pour `announcements`, déjà réservé à sa Cloud Function).
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// limité à Metz (`reviews.view`, `reviews.moderate`, `notifications.send`, cityIds=['metz']).
//
//   npx tsx scripts/tests/cdc-fix-residuals-39.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const PROJECT_ID = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'test-admin-cdcres39-metz-only';
const TEST_PASSWORD = `Cdcres39!${Math.random().toString(36).slice(2, 10)}`;

const REVIEW_METZ = 'cdcres39-review-metz';
const REVIEW_LONGWY = 'cdcres39-review-longwy';
const WATCH_METZ = 'cdcres39-watch-metz';
const WATCH_LONGWY = 'cdcres39-watch-longwy';
const CAMPAIGN_ID = 'cdcres39-campaign';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}
async function get(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
/** Création directe via :commit avec createdAt/updatedAt posés par le serveur (REQUEST_TIME),
 * seule façon de satisfaire createdNow() depuis un client REST brut — sans ça, un essai de
 * création échouerait de toute façon par incompatibilité d'horodatage, confondant le résultat. */
async function commitCreate(token, path, fields) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      writes: [{
        update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/${path}`, fields },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      }],
    }),
  });
  return { status: res.status, json: await res.json() };
}
const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: v });
const B = (v) => ({ booleanValue: v });

async function main() {
  const now = { timestampValue: new Date().toISOString() };
  for (const [id, cityId] of [[REVIEW_METZ, 'metz'], [REVIEW_LONGWY, 'longwy']]) {
    await db.doc(`reviews/${id}`).set({
      orderId: id, customerId: 'cdcres39-other-customer', restaurantId: 'cdcres39-other-restaurant',
      restaurantRating: 4, comment: null, status: 'pending_moderation', reportsCount: 0, reply: null,
      cityId, countryId: 'FR', createdAt: now, updatedAt: now, test: true,
    });
  }
  for (const [id, cityId] of [[WATCH_METZ, 'metz'], [WATCH_LONGWY, 'longwy']]) {
    await db.doc(`ratingWatch/${id}`).set({
      entityType: 'restaurant', entityId: 'cdcres39-other-restaurant', name: 'Test', countryId: 'FR', cityId,
      currentAverage: 3, previousAverage: 4, currentCount: 10, previousCount: 10, delta: -1, lowRatings: 2,
      overallAverage: 3.5, acknowledgedAt: null, acknowledgedBy: null, note: null, test: true,
    });
  }

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres39-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager', active: true, permissions: ['reviews.view', 'reviews.moderate', 'notifications.send'],
    cityIds: ['metz'], countryIds: [], displayName: 'Test cdcres39', email: 'cdcres39-admin@golink.test', test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres39-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : reviews.view/.moderate + notifications.send, cityIds=["metz"]');

    // --- 1. reviews : lecture bornée par ville ---
    const reviewMetz = await get(idToken, `reviews/${REVIEW_METZ}`);
    record('avis de Metz LISIBLE (dans le périmètre)', reviewMetz.status === 200 && !reviewMetz.json.error, `status=${reviewMetz.status}`);
    const reviewLongwy = await get(idToken, `reviews/${REVIEW_LONGWY}`);
    const reviewDenied = reviewLongwy.status === 403 || reviewLongwy.json?.error?.status === 'PERMISSION_DENIED';
    record('avis de Longwy REFUSÉ (hors périmètre, correctif attendu)', reviewDenied, `status=${reviewLongwy.status}`);

    // --- 2. ratingWatch : lecture bornée par ville ---
    const watchMetz = await get(idToken, `ratingWatch/${WATCH_METZ}`);
    record('ratingWatch de Metz LISIBLE (dans le périmètre)', watchMetz.status === 200 && !watchMetz.json.error, `status=${watchMetz.status}`);
    const watchLongwy = await get(idToken, `ratingWatch/${WATCH_LONGWY}`);
    const watchDenied = watchLongwy.status === 403 || watchLongwy.json?.error?.status === 'PERMISSION_DENIED';
    record('ratingWatch de Longwy REFUSÉ (hors périmètre, correctif attendu)', watchDenied, `status=${watchLongwy.status}`);

    // --- 3. campaigns : création directe d'une campagne plateforme désormais refusée ---
    const campaignFields = {
      scope: S('platform'), status: S('scheduled'), channel: S('push'),
      title: S('Test cdcres39'), body: S('Ne doit jamais être envoyé'),
      audience: { mapValue: { fields: { cityIds: { arrayValue: { values: [S('metz')] } }, countryId: S('FR') } } },
      stats: { mapValue: { fields: { sent: I('0') } } },
      scheduledAt: now, createdBy: S(TEST_UID), updatedBy: S(TEST_UID), test: B(true),
    };
    const campaignAttempt = await commitCreate(idToken, `campaigns/${CAMPAIGN_ID}`, campaignFields);
    const campaignDenied = campaignAttempt.status === 403 || campaignAttempt.json?.error?.status === 'PERMISSION_DENIED';
    record('création directe d’une campagne PLATEFORME par un admin limité à une ville REFUSÉE (correctif attendu)', campaignDenied, `status=${campaignAttempt.status} ${JSON.stringify(campaignAttempt.json?.error ?? '')}`);
    const createdAnyway = (await db.doc(`campaigns/${CAMPAIGN_ID}`).get()).exists;
    record('aucune campagne n’a été créée côté serveur malgré la tentative', !createdAnyway);
  } finally {
    await db.doc(`reviews/${REVIEW_METZ}`).delete().catch(() => {});
    await db.doc(`reviews/${REVIEW_LONGWY}`).delete().catch(() => {});
    await db.doc(`ratingWatch/${WATCH_METZ}`).delete().catch(() => {});
    await db.doc(`ratingWatch/${WATCH_LONGWY}`).delete().catch(() => {});
    await db.doc(`campaigns/${CAMPAIGN_ID}`).delete().catch(() => {});
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    // auth.createUser() déclenche onUserCreate (profil users/{uid} "client" fantôme) : purgé ici,
    // pas seulement admins/{uid} (piège déjà documenté dans ce dépôt).
    await db.doc(`users/${TEST_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists
      && !(await db.doc(`users/${TEST_UID}`).get()).exists
      && !(await db.doc(`reviews/${REVIEW_METZ}`).get()).exists
      && !(await db.doc(`ratingWatch/${WATCH_METZ}`).get()).exists
      && !(await db.doc(`campaigns/${CAMPAIGN_ID}`).get()).exists;
    record('nettoyage : avis, ratingWatch, campagne et compte admin de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
