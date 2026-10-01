// Test réel cdc-fix-residuals-42 (§9 Règles automatiques des commandes, « Temps de
// préparation », défaut déjà documenté dans l'audit) : le « mode affluence » du commerce
// (`busyExtraMinutes`, ajouté au temps de préparation de TOUTES les commandes tant qu'il est
// actif) était écrit directement par le restaurant via les règles Firestore, plafonné à
// 90 minutes codées en dur — totalement indépendant de `rules.maxPrepExtensionMinutes`
// (réglable par ville/pays, 30 par défaut), qui plafonne la notion équivalente côté
// `extendPrepTime`. Un commerce dans une ville réglée à un plafond plus bas pouvait donc
// contourner ce réglage en activant simplement le mode affluence.
//
// Corrigé : nouvelle Cloud Function `setBusyMode` (functions/src/orders/transitions.ts) qui
// valide `busyExtraMinutes` contre `rules.maxPrepExtensionMinutes` avant d'écrire ; l'écriture
// Firestore directe d'une valeur NON NULLE est désormais refusée par les règles (seule la
// remise à zéro directe reste possible, utilisée par `AutoPauseBanner.tsx`).
//
// Test réel sur `golink-9f16d` : une ville jetable réglée à 15 minutes maximum, un commerce
// jetable dans cette ville, un membre jetable (propriétaire). `setBusyMode` à 15 min accepté,
// à 20 min refusé avec le message exact ; écriture Firestore directe à une valeur non nulle
// refusée (règles) ; remise à zéro directe toujours acceptée (non-régression,
// AutoPauseBanner.tsx). Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-42.flow.mjs
import { randomBytes } from 'node:crypto';
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const PROJECT_ID = 'golink-9f16d';

const CITY_ID = 'cdcres42-ville';
const RESTAURANT_ID = 'cdcres42-resto';
const OWNER_UID = 'cdcres42-owner';
const MAX_MINUTES = 15;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
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
  return loginPassword(email, password);
}
async function call(token, name, data) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, result: body.result };
  return { ok: false, error: body.error?.message ?? `HTTP ${res.status}` };
}
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
const I = (v) => ({ integerValue: v });
const B = (v) => ({ booleanValue: v });

async function main() {
  await db.doc(`cities/${CITY_ID}`).set({ name: 'Test cdcres42', slug: CITY_ID, countryId: 'FR', orderRules: { maxPrepExtensionMinutes: MAX_MINUTES }, test: true, managerIds: [] });
  await db.doc(`restaurants/${RESTAURANT_ID}`).set({
    name: 'CDCRES42 Resto', slug: 'cdcres42-resto', cityId: CITY_ID, countryId: 'FR', status: 'active', onboardingStatus: 'approved',
    isOpen: true, busyExtraMinutes: 0, acceptingOrders: true, test: true, createdAt: new Date(), updatedAt: new Date(), updatedBy: 'system',
  });
  await db.doc(`restaurants/${RESTAURANT_ID}/members/${OWNER_UID}`).set({
    uid: OWNER_UID, restaurantId: RESTAURANT_ID, displayName: 'CDCRES42 Owner', email: 'cdcres42-owner@golink.test', role: 'owner', permissions: [], active: true, onDuty: false, invitedBy: OWNER_UID, invitedAt: new Date(),
  });

  const token = await testUserSession(OWNER_UID, 'cdcres42-owner@golink.test');

  // --- 1. setBusyMode : valeur dans la limite de la ville -> acceptee ---
  const within = await call(token, 'setBusyMode', { restaurantId: RESTAURANT_ID, isOpen: true, busyExtraMinutes: MAX_MINUTES });
  check('setBusyMode accepte une valeur dans la limite de la ville (15 min)', within.ok, JSON.stringify(within));
  const afterWithin = (await db.doc(`restaurants/${RESTAURANT_ID}`).get()).data();
  check('busyExtraMinutes reellement pose a 15', afterWithin?.busyExtraMinutes === MAX_MINUTES, `busyExtraMinutes=${afterWithin?.busyExtraMinutes}`);

  // --- 2. setBusyMode : valeur au-dela de la limite -> refusee (correctif attendu) ---
  const over = await call(token, 'setBusyMode', { restaurantId: RESTAURANT_ID, isOpen: true, busyExtraMinutes: MAX_MINUTES + 5 });
  check('setBusyMode refuse une valeur au-dela de la limite de la ville (correctif attendu)', !over.ok && /limit/i.test(over.error ?? ''), JSON.stringify(over));
  const afterOver = (await db.doc(`restaurants/${RESTAURANT_ID}`).get()).data();
  check('valeur refusee non ecrite (reste a 15)', afterOver?.busyExtraMinutes === MAX_MINUTES, `busyExtraMinutes=${afterOver?.busyExtraMinutes}`);

  // --- 3. ecriture directe Firestore d'une valeur non nulle -> refusee (correctif attendu) ---
  const directWrite = await commitUpdate(token, `restaurants/${RESTAURANT_ID}`, { busyExtraMinutes: I('99'), isOpen: B(true) }, ['busyExtraMinutes', 'isOpen']);
  const directDenied = directWrite.status === 403 || directWrite.json?.[0]?.status?.code === 7 || JSON.stringify(directWrite.json).includes('PERMISSION_DENIED');
  check('ecriture Firestore directe d une valeur non nulle refusee (correctif attendu)', directDenied, `status=${directWrite.status} ${JSON.stringify(directWrite.json)}`);

  // --- 4. remise a zero directe toujours acceptee (non-regression, AutoPauseBanner.tsx) ---
  const resetWrite = await commitUpdate(token, `restaurants/${RESTAURANT_ID}`, { busyExtraMinutes: I('0'), isOpen: B(true) }, ['busyExtraMinutes', 'isOpen']);
  check('remise a zero directe toujours acceptee (non-regression)', resetWrite.status === 200, `status=${resetWrite.status} ${JSON.stringify(resetWrite.json?.error ?? '')}`);
  const afterReset = (await db.doc(`restaurants/${RESTAURANT_ID}`).get()).data();
  check('busyExtraMinutes reellement remis a 0', afterReset?.busyExtraMinutes === 0, `busyExtraMinutes=${afterReset?.busyExtraMinutes}`);
}

async function cleanup() {
  await db.doc(`restaurants/${RESTAURANT_ID}/members/${OWNER_UID}`).delete().catch(() => {});
  await db.doc(`restaurants/${RESTAURANT_ID}`).delete().catch(() => {});
  await db.doc(`cities/${CITY_ID}`).delete().catch(() => {});
  await db.doc(`users/${OWNER_UID}`).delete().catch(() => {});
  await db.doc(`userPrivate/${OWNER_UID}`).delete().catch(() => {});
  await auth.deleteUser(OWNER_UID).catch(() => {});
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Echecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
