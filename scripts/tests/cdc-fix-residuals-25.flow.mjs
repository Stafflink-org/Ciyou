// Test réel cdc-fix-residuals-25 (§26 Administrateurs internes, « Accès limité par ville ») :
// la règle Firestore `users/{userId}` (`firebase/rules/users.rules`) autorisait la lecture de
// N'IMPORTE QUEL profil utilisateur à tout administrateur disposant de `restaurants.view`, sans
// aucun contrôle de ville — un responsable de ville limité (ex. Metz) pouvait donc lire le profil
// d'un propriétaire de restaurant (ou de tout autre compte) d'une autre ville en appelant
// Firestore directement, contournant le filtrage fait uniquement côté écran. Même défaut que
// celui déjà corrigé pour `drivers.view` (`cdc-fix-residuals-13`), laissé ouvert à l'époque et
// explicitement documenté comme tel dans l'audit (ligne « Accès limité par ville »).
//
// Corrigé : `restaurants.view` est désormais borné par la ville de l'utilisateur
// (`isAdminIn('restaurants.view', cityId)`), comme `drivers.view` et comme la règle déjà
// correcte de `restaurants/{restaurantId}` elle-même (`restaurants.rules`). `customers.view`
// reste volontairement non borné (un client n'a pas de ville fixe).
//
// Test réel contre les règles de PRODUCTION (golink-9f16d), via un compte administrateur JETABLE
// créé pour ce test (rôle isolé : restaurants.view + cityIds:['metz'], AUCUNE autre permission —
// pour ne pas masquer le signal avec `drivers.view`/`customers.view`, qui accordent eux aussi une
// lecture et fausseraient le test). Compte et document admin supprimés en fin de test.
//
//   npx tsx scripts/tests/cdc-fix-residuals-25.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres25-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM'; // clé web publique golink-9f16d
const TEST_UID = 'test-admin-cdcres25-metz-only';
const METZ_USER_ID = 'seed-client-051';
const LONGWY_USER_ID = 'seed-client-001';

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

async function readUserDoc(idToken, userId) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${userId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = await res.json();
  return { status: res.status, json };
}

const TEST_PASSWORD = `Cdcres25!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  const { auth, db } = await import('../../functions/src/lib/admin.ts');
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');

  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres25-admin@golink.test', password: TEST_PASSWORD });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager',
    active: true,
    permissions: ['restaurants.view'], // uniquement ce droit, pour isoler le correctif testé
    cityIds: ['metz'],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-25',
    email: 'cdcres25-admin@golink.test',
    test: true,
  });
  // Déterministe : voir trap_ciyou_test_admin_claims_race — le doc admin doit exister avant
  // setCustomUserClaims pour que le déclencheur onUserCreate ne l'écrase pas en course.
  await syncClaims(TEST_UID);

  try {
    const idToken = await signInWithPassword('cdcres25-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : restaurants.view seul, cityIds=["metz"]');

    const metzUser = await readUserDoc(idToken, METZ_USER_ID);
    record('utilisateur de Metz lisible (dans le périmètre)', metzUser.status === 200 && !metzUser.json.error, `status=${metzUser.status}`);

    const longwyUser = await readUserDoc(idToken, LONGWY_USER_ID);
    const denied = longwyUser.status === 403 || longwyUser.json?.error?.status === 'PERMISSION_DENIED';
    record('utilisateur de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied, `status=${longwyUser.status}`);
  } finally {
    await db.doc(`admins/${TEST_UID}`).delete().catch(() => {});
    await auth.deleteUser(TEST_UID).catch(() => {});
    const gone = !(await db.doc(`admins/${TEST_UID}`).get()).exists;
    record('nettoyage : compte et document admin de test supprimés', gone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
