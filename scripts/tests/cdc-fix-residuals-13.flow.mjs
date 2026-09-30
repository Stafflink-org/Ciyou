// Test réel cdc-fix-residuals-13 (§26 Administrateurs internes, « Accès limité par ville ») :
// la règle Firestore `users/{userId}` (`firebase/rules/users.rules`) autorisait la lecture de
// N'IMPORTE QUEL profil livreur à tout administrateur disposant de `drivers.view`, sans aucun
// contrôle de ville — un responsable de ville limité (ex. Metz) pouvait donc lire le profil d'un
// livreur d'une autre ville en appelant Firestore directement (contournement du filtrage fait
// uniquement côté écran, `DriversPage`). Corrigé : `drivers.view` est désormais borné par la
// ville du livreur (`isAdminIn('drivers.view', resource.data.cityId)`), aligné sur la règle déjà
// correcte de `drivers/{driverId}`. `customers.view` reste volontairement non borné (un client
// n'a pas de ville fixe : `cityId` toujours `null` sur son profil).
//
// Test réel contre la base ET les règles de PRODUCTION (golink-9f16d), via un compte
// administrateur JETABLE créé pour ce test (rôle isolé : drivers.view + cityIds:['metz'],
// AUCUNE autre permission — contrairement aux comptes partagés comme metz@golink.test qui ont
// aussi restaurants.view, une permission distincte qui accorde elle aussi une lecture non bornée
// et masquerait le signal de ce test précis). Compte et document admin supprimés en fin de test.
//
//   npx tsx scripts/tests/cdc-fix-residuals-13.flow.mjs
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM'; // clé web publique golink-9f16d (apps/admin/src/lib/firebase.ts)
const PROJECT_ID = 'golink-9f16d';
const TEST_UID = 'test-admin-cdcres13-metz-only';

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

const TEST_PASSWORD = `Cdcres13!${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres13-admin@golink.test', password: TEST_PASSWORD });
  await auth.setCustomUserClaims(TEST_UID, { role: 'admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager',
    active: true,
    permissions: ['drivers.view'], // uniquement ce droit, pour isoler le correctif testé
    cityIds: ['metz'],
    countryIds: [],
    displayName: 'Test cdc-fix-residuals-13',
    email: 'cdcres13-admin@golink.test',
    test: true,
  });

  try {
    const idToken = await signInWithPassword('cdcres13-admin@golink.test', TEST_PASSWORD);
    console.log('admin jetable connecté : drivers.view seul, cityIds=["metz"]');

    const metzDriver = await readUserDoc(idToken, 'sim-driver-metz-1');
    record('livreur de Metz lisible (dans le périmètre)', metzDriver.status === 200 && !metzDriver.json.error, `status=${metzDriver.status}`);

    const longwyDriver = await readUserDoc(idToken, 'sim-driver-longwy-1');
    const denied = longwyDriver.status === 403 || longwyDriver.json?.error?.status === 'PERMISSION_DENIED';
    record('livreur de Longwy REFUSÉ (hors périmètre, correctif attendu)', denied, `status=${longwyDriver.status}`);

    const luxDriver = await readUserDoc(idToken, 'sim-driver-luxembourg-1');
    const luxDenied = luxDriver.status === 403 || luxDriver.json?.error?.status === 'PERMISSION_DENIED';
    record('livreur du Luxembourg REFUSÉ (hors périmètre, correctif attendu)', luxDenied, `status=${luxDriver.status}`);

    const clientSnap = await db.collection('users').where('role', '==', 'client').limit(1).get();
    const clientId = clientSnap.docs[0]?.id;
    if (clientId) {
      const client = await readUserDoc(idToken, clientId);
      const clientDenied = client.status === 403 || client.json?.error?.status === 'PERMISSION_DENIED';
      record('client REFUSÉ (cet admin n’a pas customers.view, comportement déjà correct avant et après)', clientDenied, `status=${client.status}`);
    }
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
