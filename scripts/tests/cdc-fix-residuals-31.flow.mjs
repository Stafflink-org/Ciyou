// Test réel cdc-fix-residuals-31 (§5 Fiche restaurant, Storage `restaurants/{rid}/public/`) :
// la règle Storage autorisait tout administrateur disposant de la permission `restaurants.edit`
// à écrire/écraser directement le logo, la couverture ou les photos de la carte d'un commerce
// (`uploadBytes`/`deleteObject` du SDK Storage), sans passer par aucune Cloud Function — donc
// sans motif obligatoire et sans entrée dans `auditLogs` (confirmé : aucun déclencheur Storage
// n'existe dans tout le projet pour auditer ces écritures). Aucune fonctionnalité admin
// n'utilise d'ailleurs ce droit (vérifié par grep exhaustif sur `apps/admin/src` et
// `functions/src`) : un oubli de verrouillage, pas une fonctionnalité réelle.
//
// Corrigé : `firebase/rules/storage/files.rules` n'autorise plus l'écriture sur ce chemin que
// pour un membre du restaurant (`menu.edit`/`settings.manage`) ; `isAdmin('restaurants.edit')`
// retiré de la condition.
//
// Test réel sur `golink-9f16d` (règles Storage déjà déployées) : un compte admin jetable avec la
// permission `restaurants.edit` (mais sans appartenance au restaurant) doit désormais être
// REFUSÉ à l'écriture ; un membre du restaurant jetable (`menu.edit`) doit toujours pouvoir
// écrire ; la lecture publique reste ouverte à tous. Nettoyage complet après coup (fichier de
// test supprimé, compte admin et membre jetables supprimés).
//
//   npx tsx scripts/tests/cdc-fix-residuals-31.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

// `syncClaims` (functions/src/lib/claims.ts) utilise le SDK Admin avec les Application Default
// Credentials : une ADC temporaire est nécessaire pour l'appeler depuis un script local (même
// motif que cdc-fix-residuals-29).
const adcPath = join(tmpdir(), `cdcres31-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const BUCKET = 'golink-9f16d.firebasestorage.app';
const RESTAURANT_ID = 'mina-kitchen'; // commerce réel existant, jamais modifié par ce test (seul un fichier de test est déposé/retiré)
const OBJECT_PATH = `restaurants/${RESTAURANT_ID}/public/cdcres31-test.png`;

const results = [];
const created = { authUsers: new Set() };
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
async function testUserSession(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  created.authUsers.add(uid);
  return loginPassword(email, password);
}

// 1x1 PNG transparent valide (contentType image/png, quelques dizaines d'octets).
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function uploadAs(idToken) {
  const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?name=${encodeURIComponent(OBJECT_PATH)}`, {
    method: 'POST',
    headers: { Authorization: `Firebase ${idToken}`, 'Content-Type': 'image/png' },
    body: PNG_1PX,
  });
  return { status: res.status, body: await res.text() };
}
async function deleteAs(idToken) {
  return fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(OBJECT_PATH)}`, {
    method: 'DELETE',
    headers: { Authorization: `Firebase ${idToken}` },
  });
}

const ADMIN_UID = 'cdcres31-admin';
const MEMBER_UID = 'cdcres31-member';

async function main() {
  // --- Admin jetable avec restaurants.edit, SANS appartenance au restaurant ---
  await db.doc(`admins/${ADMIN_UID}`).set({ active: true, role: 'ops_city', permissions: ['restaurants.edit'], email: 'cdcres31-admin@golink.test', displayName: 'CDCRES31 Admin', cities: [], createdAt: new Date() });
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');
  await syncClaims(ADMIN_UID);
  const adminToken = await testUserSession(ADMIN_UID, 'cdcres31-admin@golink.test');

  const adminAttempt = await uploadAs(adminToken);
  check('storage.admin_restaurants_edit_refuse_ecriture — correctif attendu', adminAttempt.status === 403, `status=${adminAttempt.status} body=${adminAttempt.body.slice(0, 150)}`);

  // --- Membre jetable du restaurant (menu.edit), DOIT toujours pouvoir écrire ---
  await db.doc(`restaurants/${RESTAURANT_ID}/members/${MEMBER_UID}`).set({
    userId: MEMBER_UID, restaurantId: RESTAURANT_ID, displayName: 'CDCRES31 Membre', email: 'cdcres31-member@golink.test', role: 'staff', permissions: ['menu.edit'], active: true, test: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const memberToken = await testUserSession(MEMBER_UID, 'cdcres31-member@golink.test');

  const memberAttempt = await uploadAs(memberToken);
  check('storage.membre_menu_edit_peut_toujours_ecrire — non-régression', memberAttempt.status === 200, `status=${memberAttempt.status} body=${memberAttempt.body.slice(0, 150)}`);

  // --- Lecture publique, sans authentification ---
  const publicRead = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(OBJECT_PATH)}`);
  check('storage.lecture_publique_toujours_ouverte', publicRead.status === 200, `status=${publicRead.status}`);
}

async function cleanup() {
  await deleteAs(await testUserSession(MEMBER_UID, 'cdcres31-member@golink.test')).catch(() => {});
  await db.doc(`restaurants/${RESTAURANT_ID}/members/${MEMBER_UID}`).delete().catch(() => {});
  await db.doc(`admins/${ADMIN_UID}`).delete().catch(() => {});
  await db.doc(`users/${ADMIN_UID}`).delete().catch(() => {}); // profil fantôme créé par onUserCreate
  await db.doc(`userPrivate/${ADMIN_UID}`).delete().catch(() => {});
  await db.doc(`users/${MEMBER_UID}`).delete().catch(() => {});
  await db.doc(`userPrivate/${MEMBER_UID}`).delete().catch(() => {});
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => {});
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
