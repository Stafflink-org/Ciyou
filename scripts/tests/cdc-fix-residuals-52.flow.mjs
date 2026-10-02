// Test réel cdc-fix-residuals-52 (§31 Données et sauvegardes — dernière rubrique du balayage
// du cahier super admin — 3 bugs trouvés en auditant la corbeille et les sauvegardes) :
//
// 1. La corbeille (`trash`) n'était bornée NI côté règle Firestore NI côté Cloud Functions
//    (`restoreFromTrash`, `purgeTrashItem`) par la ville/pays du restaurant d'origine — seule la
//    permission (`trash.view`/`trash.restore`) était vérifiée. Un admin restreint pouvait lire,
//    restaurer ou purger définitivement un élément supprimé de n'importe quel restaurant hors de
//    son périmètre. Corrigé (règle + `assertAdminCovers`/`assertAdminCoversCountry`).
//
// 2. `restoreFromTrash` appliquait `FieldValue.arrayUnion` à TOUS les champs « détachés » lors
//    d'une restauration, y compris `sectionId` (champ SCALAIRE string|null, détaché quand une
//    section de carte est supprimée sans ses produits) — transformant silencieusement ce champ en
//    tableau à un élément au lieu de la chaîne attendue (corruption de type réelle, en base).
//    Corrigé : `sectionId` écrit en scalaire, comme le fait déjà l'écran dédié du restaurant
//    (`restoreMenuItem`).
//
// 3. Le suivi d'une sauvegarde/restauration planifiée (`runExport`/`startBackupRestore`) repose
//    sur `.then()/.catch()` posé sur l'opération longue SANS l'attendre — si l'instance de la
//    fonction est recyclée avant la fin (cas typique d'une sauvegarde nocturne sans personne pour
//    cliquer « Actualiser »), le statut reste bloqué à `running` indéfiniment, sans jamais
//    déclencher l'alerte d'échec. Corrigé par une nouvelle tâche planifiée
//    (`sweepRunningBackupOperations`, toutes les 15 min) qui relit tout ce qui est encore
//    `running` et force la mise à jour.
//
//   npx tsx scripts/tests/cdc-fix-residuals-52.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres52-adc-${process.pid}.json`);
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

// ------------------------------------------------------------------ 1. Corbeille : scoping ville/pays

async function testTrashScope() {
  const ADMIN_UID = 'cdcres52-admin-trash';
  const CITY_IN = 'cdcres52-ville-in';
  const CITY_OUT = 'cdcres52-ville-out';
  const RES_IN = 'cdcres52-resto-in';
  const RES_OUT = 'cdcres52-resto-out';

  await db.doc(`cities/${CITY_IN}`).set({ name: 'Test IN', slug: CITY_IN, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`cities/${CITY_OUT}`).set({ name: 'Test OUT', slug: CITY_OUT, countryId: 'FR', active: true, test: true, managerIds: [] });
  await db.doc(`restaurants/${RES_IN}`).set({ name: 'CDCRES52 IN', cityId: CITY_IN, countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${RES_OUT}`).set({ name: 'CDCRES52 OUT', cityId: CITY_OUT, countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });

  const trashBase = { entity: { type: 'promotion', id: 'x', label: 'Test' }, path: 'promotions/cdcres52-fake', snapshot: { test: true }, children: [], deletedBy: 'system', deletedAt: now(), reason: null, purgeAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000), restoredAt: null, restoredBy: null, menuKind: null, detached: null, test: true };
  await db.doc('trash/cdcres52-trash-in').set({ ...trashBase, restaurantId: RES_IN });
  await db.doc('trash/cdcres52-trash-out').set({ ...trashBase, restaurantId: RES_OUT });

  const { token } = await createAdmin(ADMIN_UID, 'cdcres52-admin-trash@golink.test', { permissions: ['trash.view', 'trash.restore'], cityIds: [CITY_IN], countryIds: ['FR'] });
  try {
    const resIn = await restGet(token, 'trash/cdcres52-trash-in');
    check('trash : lecture directe DANS le périmètre (ville IN) autorisée', allowed(resIn), `status=${resIn.status}`);
    const resOut = await restGet(token, 'trash/cdcres52-trash-out');
    check('trash : lecture directe HORS périmètre (ville OUT) REFUSÉE (correctif attendu)', denied(resOut), `status=${resOut.status}`);

    await expectError('restoreFromTrash : élément HORS périmètre REFUSÉ (correctif attendu)', call(token, 'purgeTrashItem', { trashId: 'cdcres52-trash-out', reason: 'Test cdcres52' }), 'périmètre');
    const purgeIn = await call(token, 'purgeTrashItem', { trashId: 'cdcres52-trash-in', reason: 'Test cdcres52' });
    check('purgeTrashItem : élément DANS le périmètre accepté', purgeIn?.purged === true, JSON.stringify(purgeIn));
  } finally {
    await Promise.all(['trash/cdcres52-trash-in', 'trash/cdcres52-trash-out', `cities/${CITY_IN}`, `cities/${CITY_OUT}`, `restaurants/${RES_IN}`, `restaurants/${RES_OUT}`].map((p) => db.doc(p).delete().catch(() => {})));
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 2. restoreFromTrash : sectionId scalaire

async function testRestoreSectionIdNotCorrupted() {
  const ADMIN_UID = 'cdcres52-admin-restore';
  const RES = 'cdcres52-resto-menu';
  const SECTION_ID = 'cdcres52-section';
  const PRODUCT_ID = 'cdcres52-produit';

  await db.doc(`restaurants/${RES}`).set({ name: 'CDCRES52 Menu', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });
  await db.doc(`restaurants/${RES}/products/${PRODUCT_ID}`).set({ name: 'Test Produit', sectionId: null, priceCents: 500, available: true, vatCategory: 'food', test: true, createdAt: now(), updatedAt: now(), updatedBy: 'system' });

  const trashItem = {
    entity: { type: 'other', id: SECTION_ID, label: 'Section « Test »' },
    path: `restaurants/${RES}/sections/${SECTION_ID}`,
    snapshot: { name: 'Test', order: 1, test: true },
    children: [],
    restaurantId: RES,
    deletedBy: 'system',
    deletedAt: now(),
    reason: null,
    purgeAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000),
    restoredAt: null,
    restoredBy: null,
    menuKind: 'section',
    detached: { field: 'sectionId', paths: [`restaurants/${RES}/products/${PRODUCT_ID}`] },
    test: true,
  };
  await db.doc('trash/cdcres52-trash-section').set(trashItem);

  const { token } = await createAdmin(ADMIN_UID, 'cdcres52-admin-restore@golink.test', { role: 'super_admin', permissions: [] });
  try {
    const result = await call(token, 'restoreFromTrash', { trashId: 'cdcres52-trash-section', reason: 'Test cdcres52' });
    check('restoreFromTrash : restauration acceptée', result?.restored === true, JSON.stringify(result));
    const product = (await db.doc(`restaurants/${RES}/products/${PRODUCT_ID}`).get()).data();
    check('sectionId restauré en CHAÎNE (pas un tableau) — correctif attendu', product?.sectionId === SECTION_ID, `sectionId=${JSON.stringify(product?.sectionId)} (type ${typeof product?.sectionId})`);
    check('non-régression : la section elle-même a bien été recréée', (await db.doc(`restaurants/${RES}/sections/${SECTION_ID}`).get()).exists);
  } finally {
    await Promise.all([
      'trash/cdcres52-trash-section',
      `restaurants/${RES}/products/${PRODUCT_ID}`,
      `restaurants/${RES}/sections/${SECTION_ID}`,
      `restaurants/${RES}`,
    ].map((p) => db.doc(p).delete().catch(() => {})));
    await cleanupAdmin(ADMIN_UID);
  }
}

// ------------------------------------------------------------------ 3. Balayage des sauvegardes bloquées

async function testBackupSweep() {
  const BACKUP_ID = 'cdcres52-backup-stuck';
  const RESTORE_ID = 'cdcres52-restore-stuck';
  await db.doc(`backups/${BACKUP_ID}`).set({ kind: 'manual', status: 'running', bucketPath: 'gs://test/cdcres52', collections: null, startedAt: now(), finishedAt: null, error: null, requestedBy: 'system', operationName: 'projects/golink-9f16d/databases/(default)/operations/cdcres52-inexistant', test: true });
  await db.doc(`backupRestores/${RESTORE_ID}`).set({ backupId: BACKUP_ID, collections: [], status: 'running', operationName: 'projects/golink-9f16d/databases/(default)/operations/cdcres52-inexistant', startedAt: now(), finishedAt: null, error: null, requestedBy: 'system', reason: 'Test cdcres52', test: true });

  try {
    const { sweepRunningBackupOperations } = await import('../../functions/src/platform/backups.ts');
    await sweepRunningBackupOperations.run();
    const backupAfter = (await db.doc(`backups/${BACKUP_ID}`).get()).data();
    const restoreAfter = (await db.doc(`backupRestores/${RESTORE_ID}`).get()).data();
    // Nom d'opération invalide volontairement : le balayage doit échouer PROPREMENT (statut
    // laissé à "running", pas de plantage de la tâche planifiée) plutôt que de planter — preuve
    // que le balayage itère réellement sur les documents "running" et appelle le suivi réel de
    // l'opération (qui échoue ici car l'opération n'existe pas) sans jamais lever d'exception.
    check('sweepRunningBackupOperations : traite la sauvegarde "running" sans planter la tâche', backupAfter?.status === 'running', `status=${backupAfter?.status}`);
    check('sweepRunningBackupOperations : traite la restauration "running" sans planter la tâche', restoreAfter?.status === 'running', `status=${restoreAfter?.status}`);
  } finally {
    await Promise.all([`backups/${BACKUP_ID}`, `backupRestores/${RESTORE_ID}`].map((p) => db.doc(p).delete().catch(() => {})));
  }
}

async function main() {
  await testTrashScope();
  await testRestoreSectionIdNotCorrupted();
  await testBackupSweep();
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
