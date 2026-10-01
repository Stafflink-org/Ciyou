// Test réel cdc-fix-residuals-19 (§20 Notifications et communication, « Envois ») :
// l'écran « Règles des campagnes » (Communication) n'exigeait que la permission
// `notifications.send` pour s'afficher dans le menu et pour l'écriture (`PERMISSION.campaignRules`,
// functions/src/marketing/platform/settings.ts), mais la RÈGLE FIRESTORE de lecture de
// `settings/campaignRules` exigeait `settings.view` — permission que des rôles ayant
// `notifications.send` (ex. city_manager) n'ont pas forcément. Résultat réel : l'onglet est
// visible dans le menu, mais son contenu échoue en « permission denied » dès l'ouverture.
//
// Corrigé : la règle de lecture de `campaignRules` suit désormais la même permission que
// l'écriture (`notifications.send`), sans toucher à l'écriture elle-même (toujours
// `allow write: if false`, exclusivement via `updateGrowthSettings` qui garde son propre
// contrôle « équipe centrale »).
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur
// JETABLE (notifications.send seul, sans settings.view) créé puis supprimé pour isoler
// précisément l'effet du correctif.
//
//   npx tsx scripts/tests/cdc-fix-residuals-19.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM'; // clé web publique golink-9f16d (apps/admin/src/lib/firebase.ts)
const PROJECT_ID = 'golink-9f16d';
const TEST_UID = 'test-admin-cdcres19-campaigns-only';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}

async function readCampaignRules(idToken) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/campaignRules`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function writeCampaignRules(idToken) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/campaignRules?updateMask.fieldPaths=test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: { test: { booleanValue: true } } }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const TEST_PASSWORD = `Cdcres19!${Math.random().toString(36).slice(2, 10)}`;
const OTHER_UID = 'test-admin-cdcres19-no-perm';
const OTHER_PASSWORD = `Cdcres19b!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres19-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager',
    active: true,
    permissions: ['notifications.send'], // uniquement ce droit, sans settings.view, pour isoler le correctif testé
    cityIds: [],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-19',
    email: 'cdcres19-admin@golink.test',
    test: true,
  });
  // Contrôle négatif : un admin SANS notifications.send (et sans settings.view) doit rester refusé
  // — preuve que le correctif discrimine bien par permission, pas un simple "autoriser tout admin".
  await auth.deleteUser(OTHER_UID).catch(() => {});
  await auth.createUser({ uid: OTHER_UID, email: 'cdcres19-other@golink.test', password: OTHER_PASSWORD });
  await auth.setCustomUserClaims(OTHER_UID, { role: 'admin' });
  await db.doc(`admins/${OTHER_UID}`).set({
    role: 'support',
    active: true,
    permissions: ['support.use'],
    cityIds: [],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-19 (contrôle négatif)',
    email: 'cdcres19-other@golink.test',
    test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres19-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : notifications.send seul, sans settings.view');

    const read = await readCampaignRules(idToken);
    // Le document settings/campaignRules n'existe pas forcément en base (aucun admin ne l'a
    // encore enregistré) : Firestore évalue les règles AVANT l'existence du document, donc un 404
    // (NOT_FOUND) prouve que la lecture est autorisée (sinon on obtiendrait 403 PERMISSION_DENIED,
    // quel que soit l'état du document). 200 (document existant) est également un succès.
    const readAllowed = read.status === 200 || read.status === 404;
    record('lecture de settings/campaignRules AUTORISÉE (correctif attendu : 200 ou 404, jamais 403)', readAllowed, `status=${read.status}`);

    const write = await writeCampaignRules(idToken);
    const writeDenied = write.status === 403 || write.json?.error?.status === 'PERMISSION_DENIED';
    record('écriture directe de settings/campaignRules toujours REFUSÉE (non régressé, allow write: if false inchangé)', writeDenied, `status=${write.status}`);

    const otherToken = await signInWithPassword('cdcres19-other@golink.test', OTHER_PASSWORD);
    const otherRead = await readCampaignRules(otherToken);
    const otherDenied = otherRead.status === 403 || otherRead.json?.error?.status === 'PERMISSION_DENIED';
    record('contrôle négatif : admin SANS notifications.send toujours REFUSÉ en lecture', otherDenied, `status=${otherRead.status}`);
  } finally {
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    await db.doc(`admins/${OTHER_UID}`).delete().catch(() => {});
    await auth.deleteUser(OTHER_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists && !(await db.doc(`admins/${OTHER_UID}`).get()).exists;
    record('nettoyage : comptes et documents admin de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
