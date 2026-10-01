// Test réel cdc-fix-residuals-40 (§11 Affichage dans l'app client, « Mises en avant
// payantes ») : `bookSponsoredPlacement` (functions/src/admin/experience/display.ts) vérifiait
// la capacité de l'emplacement (`maxConcurrent`) par une lecture Firestore classique AVANT la
// transaction qui crée réellement le placement — la transaction elle-même ne relisait jamais
// cette capacité. Deux réservations concurrentes sur le même emplacement/ville/période (double
// clic, ou deux agents) pouvaient donc toutes deux réussir le contrôle de capacité avant qu'ni
// l'une ni l'autre n'ait écrit, puis toutes deux créer leur placement — dépassant
// `maxConcurrent`, contredisant la promesse d'un emplacement exclusif/plafonné.
//
// Corrigé : la lecture des placements concurrents se fait désormais DANS la transaction
// (`tx.get(overlapQuery)`), garantissant que Firestore fait rejouer l'une des deux tentatives
// concurrentes si l'autre a déjà écrit entre-temps (conflit détecté sur la requête relue).
//
// Test réel sur `golink-9f16d` : un emplacement jetable à capacité 1 (`maxConcurrent:1`), deux
// commerces jetables de la même ville, deux appels à la fonction DÉPLOYÉE lancés en parallèle
// (Promise.allSettled) pour la même période — un seul doit réussir, l'autre doit être refusé
// pour « Emplacement complet », et un seul document `sponsoredPlacements` doit exister en base
// à la fin (pas deux). Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-40.flow.mjs
import { randomBytes } from 'node:crypto';
import { auth, db } from '../lib/admin.mjs';

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const ADMIN_UID = 'cdcres40-admin';
const OFFER_ID = 'cdcres40-offer';
const CITY_ID = 'cdcres40-ville';
const RESTAURANT_A = 'cdcres40-resto-a';
const RESTAURANT_B = 'cdcres40-resto-b';
const START_DAY = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const created = { authUsers: new Set() };

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
const passwords = new Map();
/** Garantit juste l'existence du compte Auth ; ne connecte pas encore — voir login() (piège course claims/onUserCreate). */
async function ensureAuthUser(uid, email) {
  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { password, email });
  } catch {
    await auth.createUser({ uid, email, password, emailVerified: true, displayName: uid });
  }
  created.authUsers.add(uid);
  passwords.set(uid, password);
}
async function login(uid, email) {
  return loginPassword(email, passwords.get(uid));
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

async function main() {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
  const adcPath = join(tmpdir(), `cdcres40-adc-${process.pid}.json`);
  writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');

  // Ordre important (piège course claims/onUserCreate) : compte Auth créé AVANT syncClaims,
  // connexion APRÈS, pour que le jeton porte les droits à jour.
  await ensureAuthUser(ADMIN_UID, 'cdcres40-admin@golink.test');
  await db.doc(`admins/${ADMIN_UID}`).set({ active: true, role: 'super_admin', permissions: [], email: 'cdcres40-admin@golink.test', displayName: 'CDCRES40 Admin', cities: [], createdAt: new Date() });
  await syncClaims(ADMIN_UID);
  const adminToken = await login(ADMIN_UID, 'cdcres40-admin@golink.test');

  await db.doc(`sponsoredOffers/${OFFER_ID}`).set({ slot: 'home_top', label: 'Test cdcres40', cityIds: null, durationDays: 7, priceHtCents: 10000, maxConcurrent: 1, active: true, order: 999, test: true, createdAt: new Date(), updatedAt: new Date() });
  for (const [id, name] of [[RESTAURANT_A, 'CDCRES40 Resto A'], [RESTAURANT_B, 'CDCRES40 Resto B']]) {
    await db.doc(`restaurants/${id}`).set({ name, cityId: CITY_ID, countryId: 'FR', status: 'active', onboardingStatus: 'approved', sponsored: false, test: true, createdAt: new Date(), updatedAt: new Date() });
  }

  const bookingArgs = { offerId: OFFER_ID, startDay: START_DAY, periods: 1, billing: 'invoice', categoryId: null, note: 'Test cdcres40 (condition de course)' };
  const [resA, resB] = await Promise.all([
    call(adminToken, 'bookSponsoredPlacement', { ...bookingArgs, restaurantId: RESTAURANT_A }),
    call(adminToken, 'bookSponsoredPlacement', { ...bookingArgs, restaurantId: RESTAURANT_B }),
  ]);

  const successes = [resA, resB].filter((r) => r.ok);
  const failures = [resA, resB].filter((r) => !r.ok);
  check('exactement une des deux reservations concurrentes reussit (correctif attendu)', successes.length === 1, `A=${JSON.stringify(resA)} B=${JSON.stringify(resB)}`);
  check('la reservation refusee porte le message de capacite', failures.length === 1 && /complet/i.test(failures[0].error ?? ''), JSON.stringify(failures[0]));

  const placements = await db.collection('sponsoredPlacements').where('offerId', '==', OFFER_ID).get();
  check('un seul document sponsoredPlacements cree en base (pas deux, correctif attendu)', placements.size === 1, `count=${placements.size}`);
}

async function cleanup() {
  const placements = await db.collection('sponsoredPlacements').where('offerId', '==', OFFER_ID).get();
  await Promise.all(placements.docs.map((d) => d.ref.delete()));
  await db.doc(`sponsoredOffers/${OFFER_ID}`).delete().catch(() => {});
  await db.doc(`restaurants/${RESTAURANT_A}`).delete().catch(() => {});
  await db.doc(`restaurants/${RESTAURANT_B}`).delete().catch(() => {});
  await db.doc(`admins/${ADMIN_UID}`).delete().catch(() => {});
  await db.doc(`users/${ADMIN_UID}`).delete().catch(() => {});
  await db.doc(`userPrivate/${ADMIN_UID}`).delete().catch(() => {});
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch(() => {});
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
