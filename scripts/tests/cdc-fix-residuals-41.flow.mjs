// Test réel cdc-fix-residuals-41 (§21 Acquisition commerciale / CRM) : les règles Firestore de
// `prospects`/`prospects/{id}/activities` utilisaient `isAdmin('crm.view'/'crm.edit')`
// (permission seule, sans ville) alors que les Cloud Functions équivalentes (`saveProspect`,
// `moveProspect`) appliquent déjà `assertAdminCovers(admin, cityId)`. Un admin `city_manager`
// limité à une ville (rôle qui a justement `crm.view`/`crm.edit` par défaut) pouvait donc lire
// ET modifier directement les prospects (noms, contacts, notes commerciales) de n'importe
// quelle autre ville, en contournant tout cloisonnement — même famille de défaut déjà corrigée
// sur `orders.rules`/`users.rules`/`reviews`/`ratingWatch` dans des tâches antérieures.
//
// Corrigé : `isAdminIn('crm.view'/'crm.edit', cityId)` sur `prospects` (lecture/écriture) et sur
// `activities` (ville résolue depuis le prospect parent via `get()`).
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// limité à Metz (crm.view, crm.edit, cityIds=['metz']).
//
//   npx tsx scripts/tests/cdc-fix-residuals-41.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID as ADC_PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres41-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = ADC_PROJECT_ID;
process.env.GCLOUD_PROJECT = ADC_PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const PROJECT_ID = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'test-admin-cdcres41-metz-only';
const TEST_PASSWORD = `Cdcres41!${Math.random().toString(36).slice(2, 10)}`;

const PROSPECT_METZ = 'cdcres41-prospect-metz';
const PROSPECT_LONGWY = 'cdcres41-prospect-longwy';

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
/** Mise à jour directe avec updatedAt posé par le serveur (REQUEST_TIME) : seule façon de
 * satisfaire updatedNow() depuis un client REST brut. */
async function commitUpdate(token, path, fields, mask) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      writes: [{
        update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/${path}`, fields },
        updateMask: { fieldPaths: mask },
        currentDocument: { exists: true },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      }],
    }),
  });
  return { status: res.status, json: await res.json() };
}
const S = (v) => ({ stringValue: v });

async function main() {
  const now = { timestampValue: new Date().toISOString() };
  for (const [id, cityId] of [[PROSPECT_METZ, 'metz'], [PROSPECT_LONGWY, 'longwy']]) {
    await db.doc(`prospects/${id}`).set({
      name: 'Test cdcres41', countryId: 'FR', cityId, source: 'field', stage: 'new', ownerId: 'cdcres41-other-owner',
      notes: 'Note initiale', contactEmail: null, contactPhone: null, createdAt: now, updatedAt: now, createdBy: 'system', updatedBy: 'system', test: true,
    });
  }

  // Ordre important (piège course claims/onUserCreate, voir mémoire du projet) : compte Auth
  // créé D'ABORD, admins/{uid} écrit ENSUITE, puis syncClaims appelé directement (dernier mot
  // déterministe) plutôt que de se fier seul à setCustomUserClaims + au déclencheur async.
  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres41-admin@golink.test', password: TEST_PASSWORD });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager', active: true, permissions: ['crm.view', 'crm.edit'], cityIds: ['metz'], countryIds: [],
    displayName: 'Test cdcres41', email: 'cdcres41-admin@golink.test', test: true,
  });
  await syncClaims(TEST_UID);

  try {
    const idToken = await signInWithPassword('cdcres41-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : crm.view/crm.edit, cityIds=["metz"]');

    const prospectMetz = await get(idToken, `prospects/${PROSPECT_METZ}`);
    record('prospect de Metz LISIBLE (dans le périmètre)', prospectMetz.status === 200 && !prospectMetz.json.error, `status=${prospectMetz.status}`);
    const prospectLongwy = await get(idToken, `prospects/${PROSPECT_LONGWY}`);
    const readDenied = prospectLongwy.status === 403 || prospectLongwy.json?.error?.status === 'PERMISSION_DENIED';
    record('prospect de Longwy REFUSÉ (hors périmètre, correctif attendu)', readDenied, `status=${prospectLongwy.status}`);

    const updateMetz = await commitUpdate(idToken, `prospects/${PROSPECT_METZ}`, { notes: S('Note mise à jour par Metz'), updatedBy: S(TEST_UID) }, ['notes', 'updatedBy']);
    record('modification du prospect de Metz ACCEPTÉE (non-régression)', updateMetz.status === 200, `status=${updateMetz.status} ${JSON.stringify(updateMetz.json?.error ?? '')}`);
    const updateLongwy = await commitUpdate(idToken, `prospects/${PROSPECT_LONGWY}`, { notes: S('Ne doit jamais être écrit'), updatedBy: S(TEST_UID) }, ['notes', 'updatedBy']);
    const writeDenied = updateLongwy.status === 403 || updateLongwy.json?.error?.status === 'PERMISSION_DENIED';
    record('modification du prospect de Longwy REFUSÉE (hors périmètre, correctif attendu)', writeDenied, `status=${updateLongwy.status}`);

    const afterLongwy = (await db.doc(`prospects/${PROSPECT_LONGWY}`).get()).data();
    record('le prospect de Longwy n’a réellement pas été modifié', afterLongwy?.notes === 'Note initiale', `notes=${afterLongwy?.notes}`);

    // Sous-collection activities : ville résolue depuis le prospect parent.
    const activityMetz = await get(idToken, `prospects/${PROSPECT_METZ}/activities/x`);
    const activityMetzDeniedForMissingDoc = activityMetz.status === 404 || activityMetz.json?.error?.status === 'NOT_FOUND';
    record('activities de Metz : refus NOT_FOUND (pas PERMISSION_DENIED) — accès au périmètre autorisé', activityMetzDeniedForMissingDoc, `status=${activityMetz.status} ${activityMetz.json?.error?.status}`);
    const activityLongwy = await get(idToken, `prospects/${PROSPECT_LONGWY}/activities/x`);
    const activityLongwyDenied = activityLongwy.status === 403 || activityLongwy.json?.error?.status === 'PERMISSION_DENIED';
    record('activities de Longwy REFUSÉ (hors périmètre, correctif attendu)', activityLongwyDenied, `status=${activityLongwy.status} ${activityLongwy.json?.error?.status}`);
  } finally {
    await db.doc(`prospects/${PROSPECT_METZ}`).delete().catch(() => {});
    await db.doc(`prospects/${PROSPECT_LONGWY}`).delete().catch(() => {});
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await db.doc(`users/${TEST_UID}`).delete().catch(() => {});
    await db.doc(`userPrivate/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists
      && !(await db.doc(`users/${TEST_UID}`).get()).exists
      && !(await db.doc(`prospects/${PROSPECT_METZ}`).get()).exists
      && !(await db.doc(`prospects/${PROSPECT_LONGWY}`).get()).exists;
    record('nettoyage : prospects et compte admin de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
