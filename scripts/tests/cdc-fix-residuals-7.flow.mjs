// Test réel des correctifs de la tâche cdc-fix-residuals-7 (§6 Gestion des livreurs) :
//  1. `zoneShortages()` (functions/src/admin/pilotage/anomalies.ts) lisait un seul seuil
//     global `settings/monitoring.zoneDriverRatio`, ignorant la surcharge par ville/zone
//     (`shortageRatioAlert`) déjà affichée à l'écran « Flotte en direct » — un responsable
//     de ville personnalisant ce seuil ne changeait rien à l'alerte automatique planifiée.
//     Corrigé : le seuil résolu (plateforme → ville → zone, `resolveDispatchRules`) est
//     désormais le même des deux côtés. Testé en appelant directement la fonction sur des
//     documents Ville/Zone jetables construits pour que l'ancien et le nouveau seuil
//     donnent des résultats différents (preuve que la surcharge est bien prise en compte).
//  2. `reviewIdentityCheck` (functions/src/admin/operations/drivers.ts) suspendait déjà le
//     livreur en cas d'échec du contrôle d'identité, mais n'émettait jamais le signal de
//     fraude attendu par le cahier (§28, dossier `fraudCases`) : corrigé, nouveau code de
//     signal `identity_check_failed`. Testé contre la fonction déployée avec un livreur et
//     un contrôle d'identité jetables, nettoyés après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-7.flow.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Timestamp, FieldValue } from '@google-cloud/firestore';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

// `functions/src/lib/admin.ts` (import direct de zoneShortages) utilise le SDK Admin
// standard, qui exige des identifiants applicatifs (ADC) — contrairement à
// `scripts/lib/admin.mjs` qui échange lui-même le refresh token du CLI. On construit
// donc un fichier `authorized_user` temporaire à partir de la MÊME session Firebase CLI
// locale (aucune clé de service), supprimé dans tous les cas en fin de script.
const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres7-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function passwordOf(email) {
  const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
  return [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];
}
async function login(email) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: passwordOf(email), returnSecureToken: true }),
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
  return { status: res.status, body };
}

const CITY_ID = 'cdcres7-test-city';
const ZONE_ID = 'cdcres7-test-zone';
const DRIVER_ID = 'cdcres7-test-driver';
let CHECK_ID = null;

async function testZoneThreshold() {
  const { db } = await import('../lib/admin.mjs');
  // Ville/zone jetables : seuil de ville volontairement plus strict (0.9) que le réglage
  // global settings/monitoring.zoneDriverRatio (0.6 par défaut). ratio=0.7 (7 dispo / 10
  // en attente) : sous l'ancien code (seuil global seul) => PAS d'alerte (0.7 >= 0.6) ;
  // sous le nouveau code (seuil de ville résolu) => alerte (0.7 < 0.9).
  await db.doc(`cities/${CITY_ID}`).set({
    name: 'Ville de test cdc-fix-residuals-7',
    countryId: 'FR',
    active: true,
    timezone: 'Europe/Paris',
    dispatch: { shortageRatioAlert: 0.9 },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  await db.doc(`zones/${ZONE_ID}`).set({
    name: 'Zone de test cdc-fix-residuals-7',
    cityId: CITY_ID,
    countryId: 'FR',
    active: true,
    polygon: [],
    live: { driversAvailable: 7, ordersWaiting: 10, updatedAt: Timestamp.now() },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  try {
    const { zoneShortages } = await import('../../functions/src/admin/pilotage/anomalies.ts');
    const candidates = await zoneShortages();
    const mine = candidates.find((c) => c.target?.id === ZONE_ID);
    record('zoneShortages() détecte la zone de test grâce au seuil de ville résolu (0.9), pas le seuil global (0.6)', Boolean(mine), mine ? JSON.stringify(mine.metric) : 'non trouvée');
    if (mine) record('seuil retenu = celui de la ville (0.9), pas le réglage global (0.6)', mine.metric.threshold === 0.9, `threshold=${mine.metric.threshold}`);
  } finally {
    await db.doc(`zones/${ZONE_ID}`).delete();
    await db.doc(`cities/${CITY_ID}`).delete();
    const zoneGone = !(await db.doc(`zones/${ZONE_ID}`).get()).exists;
    const cityGone = !(await db.doc(`cities/${CITY_ID}`).get()).exists;
    record('nettoyage : ville et zone de test supprimées', zoneGone && cityGone);
  }
}

async function testFraudSignalOnIdentityFailure(token) {
  const { db } = await import('../lib/admin.mjs');
  await db.doc(`drivers/${DRIVER_ID}`).set({
    cityId: 'longwy',
    countryId: 'FR',
    firstName: 'Test',
    lastName: 'Résiduel7',
    displayName: 'Test Résiduel7',
    phone: '+33600000077',
    email: 'cdcres7-driver@golink.test',
    type: 'platform',
    restaurantIds: [],
    vehicle: { type: 'bike' },
    zoneIds: [],
    status: 'active',
    onboardingStatus: 'approved',
    availability: 'offline',
    activeOrderIds: [],
    acceptsCash: false,
    rating: { average: 0, count: 0 },
    stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
    searchKeywords: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  const checkRef = db.collection('identityChecks').doc();
  CHECK_ID = checkRef.id;
  await checkRef.set({
    driverId: DRIVER_ID,
    cityId: 'longwy',
    requestedAt: Timestamp.now(),
    requestedBy: 'test',
    trigger: 'manual',
    selfie: { path: 'drivers/cdcres7-test-driver/private/selfie.jpg', contentType: 'image/jpeg', size: 1000, name: 'selfie', uploadedAt: Timestamp.now(), uploadedBy: DRIVER_ID },
    status: 'submitted',
    submittedAt: Timestamp.now(),
    matchScore: null,
    reviewedBy: null,
    reviewedAt: null,
  });

  try {
    const res = await call(token, 'reviewIdentityCheck', { checkId: CHECK_ID, decision: 'fail', reason: 'Selfie de test manifestement différent (script de test).' });
    record('reviewIdentityCheck(fail) accepté (superadmin, drivers.validate)', res.status === 200, `status=${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);

    const driverAfter = (await db.doc(`drivers/${DRIVER_ID}`).get()).data();
    record('livreur suspendu (comportement déjà existant, non régressé)', driverAfter?.status === 'suspended' && driverAfter?.blocked?.reason === 'identity_check_failed', `status=${driverAfter?.status}`);

    const fraudCase = (await db.doc(`fraudCases/driver_${DRIVER_ID}`).get()).data();
    record('dossier de fraude créé (fraudCases/driver_cdcres7-test-driver) — CORRECTIF', Boolean(fraudCase), fraudCase ? JSON.stringify(fraudCase.signals) : 'absent');
    if (fraudCase) {
      const signal = fraudCase.signals.find((s) => s.code === 'identity_check_failed');
      record('signal identity_check_failed présent avec un score', Boolean(signal) && signal.score === 30, JSON.stringify(signal));
      record('riskScore du dossier = 30 (premier signal)', fraudCase.riskScore === 30, `riskScore=${fraudCase.riskScore}`);
    }
  } finally {
    await db.doc(`identityChecks/${CHECK_ID}`).delete();
    await db.doc(`fraudCases/driver_${DRIVER_ID}`).delete();
    await db.doc(`drivers/${DRIVER_ID}`).delete();
    const notifs = await db.collection(`users/${DRIVER_ID}/notifications`).get();
    for (const doc of notifs.docs) await doc.ref.delete();
    const driverGone = !(await db.doc(`drivers/${DRIVER_ID}`).get()).exists;
    const checkGone = !(await db.doc(`identityChecks/${CHECK_ID}`).get()).exists;
    const fraudGone = !(await db.doc(`fraudCases/driver_${DRIVER_ID}`).get()).exists;
    record('nettoyage : livreur, contrôle d’identité et dossier de fraude de test supprimés', driverGone && checkGone && fraudGone);
  }
}

async function main() {
  try {
    await testZoneThreshold();
    const token = await login('superadmin@golink.test');
    await testFraudSignalOnIdentityFailure(token);
  } finally {
    rmSync(adcPath, { force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  rmSync(adcPath, { force: true });
  process.exitCode = 1;
});
