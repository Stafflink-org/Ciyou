// Test réel cdc-fix-residuals-36 (§7 Gestion des clients, « Remboursements et avoirs ») :
// `creditCustomer` (functions/src/admin/acteurs/customers.ts), déclenché depuis la fiche
// client, écrivait `expiresAt: null` dès que `validityDays` n'était pas renseigné (champ
// optionnel) — cet avoir ne serait alors JAMAIS purgé par la tâche d'expiration des avoirs.
// `creditFromTicket` (functions/src/admin/experience/refunds.ts), qui fait exactement la même
// opération métier mais depuis un ticket support, appliquait déjà la bonne règle (validité
// réglée dans `settings/refunds.walletCreditValidityDays`, ou 180 jours par défaut) — un
// oubli de portage entre deux chemins dupliqués, pas une décision produit non tranchée.
//
// Corrigé : `creditCustomer` lit désormais `settings/refunds.walletCreditValidityDays` avec le
// même repli à 180 jours.
//
// Test réel sur `golink-9f16d` : appel réel de la fonction déployée, sans `validityDays`, pour
// un client jetable — l'écriture `walletTransactions` doit porter un `expiresAt` réel (environ
// 180 jours plus tard, cohérent avec le réglage actuel), pas `null`. Un appel avec
// `validityDays` explicite doit toujours le respecter (non-régression). Nettoyage complet.
//
//   npx tsx scripts/tests/cdc-fix-residuals-36.flow.mjs
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

const ADMIN_UID = 'cdcres36-admin';
const CLIENT_UID = 'cdcres36-client';
const created = { authUsers: new Set(), walletTx: new Set() };

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
/** Garantit juste l'existence du compte Auth (mot de passe mémorisé) ; ne connecte pas encore — voir login(). */
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
/** Connexion différée : appelée seulement après syncClaims(uid), pour que le jeton porte les droits à jour (piège course claims/onUserCreate). */
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
  if (res.ok) return body.result;
  throw new Error(body.error?.message ?? `HTTP ${res.status}`);
}

async function main() {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
  const adcPath = join(tmpdir(), `cdcres36-adc-${process.pid}.json`);
  writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  const { syncClaims } = await import('../../functions/src/lib/claims.ts');

  // Ordre important (piège course claims/onUserCreate) : le compte Auth doit exister AVANT
  // syncClaims, et la connexion (login) doit avoir lieu APRÈS, pour que le jeton porte les
  // droits à jour.
  await ensureAuthUser(ADMIN_UID, 'cdcres36-admin@golink.test');
  await db.doc(`admins/${ADMIN_UID}`).set({ active: true, role: 'super_admin', permissions: [], email: 'cdcres36-admin@golink.test', displayName: 'CDCRES36 Admin', cities: [], createdAt: new Date() });
  await syncClaims(ADMIN_UID);
  const adminToken = await login(ADMIN_UID, 'cdcres36-admin@golink.test');

  await db.doc(`users/${CLIENT_UID}`).set({ role: 'client', email: 'cdcres36-client@golink.test', firstName: 'CDCRES36', lastName: 'Client', displayName: 'CDCRES36 Client', cityId: null, walletBalanceCents: 0, referralCode: 'CDCR36X', referredBy: null, test: true, acceptedLegal: {}, consents: {}, stats: { firstOrderAt: null, cancelledCount: 0, refundsCount: 0, lastOrderAt: null, ordersCount: 0, totalSpentCents: 0 } });

  // --- 1. Sans validityDays : doit désormais expirer (correctif attendu), pas rester null ---
  const before = Date.now();
  const res1 = await call(adminToken, 'creditCustomer', { userId: CLIENT_UID, amountCents: 500, reason: 'commercial_gesture', note: 'Test cdcres36 (sans validityDays)' });
  const tx1 = await findWalletTx(CLIENT_UID, 'Test cdcres36 (sans validityDays)');
  check('creditCustomer sans validityDays : expiresAt posé (pas null) - correctif attendu', tx1?.expiresAt != null, JSON.stringify(tx1?.expiresAt));
  if (tx1?.expiresAt) {
    const days = Math.round((tx1.expiresAt.toMillis() - before) / 86_400_000);
    check('creditCustomer sans validityDays : environ 180 jours (reglage settings/refunds)', days >= 179 && days <= 181, `days=${days}`);
  }
  void res1;

  // --- 2. Avec validityDays explicite : toujours respecté (non-regression) ---
  const res2 = await call(adminToken, 'creditCustomer', { userId: CLIENT_UID, amountCents: 300, reason: 'commercial_gesture', note: 'Test cdcres36 (validityDays=30)', validityDays: 30 });
  const tx2 = await findWalletTx(CLIENT_UID, 'Test cdcres36 (validityDays=30)');
  if (tx2?.expiresAt) {
    const days = Math.round((tx2.expiresAt.toMillis() - before) / 86_400_000);
    check('creditCustomer avec validityDays=30 : respecte 30 jours (non-regression)', days >= 29 && days <= 31, `days=${days}`);
  } else {
    check('creditCustomer avec validityDays=30 : expiresAt pose', false, 'absent');
  }
  void res2;
}

async function findWalletTx(userId, note) {
  const snap = await db.collection('walletTransactions').where('userId', '==', userId).where('note', '==', note).limit(1).get();
  const doc = snap.docs[0];
  if (doc) created.walletTx.add(doc.id);
  return doc?.data();
}

async function cleanup() {
  for (const id of created.walletTx) await db.doc(`walletTransactions/${id}`).delete().catch(() => {});
  const ledgerSnap = await db.collection('ledgerEntries').where('accountId', '==', CLIENT_UID).get();
  await Promise.all(ledgerSnap.docs.map((d) => d.ref.delete()));
  await db.doc(`users/${CLIENT_UID}`).delete().catch(() => {});
  await db.doc(`userPrivate/${CLIENT_UID}`).delete().catch(() => {});
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
