// Test réel du correctif de la tâche cdc-fix-residuals-5 (§15 « Livreurs » — compte
// de paiement) contre la vraie base golink-9f16d.
//   npx tsx scripts/tests/cdc-fix-residuals-5.flow.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';

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

// Compte de test dédié (pas driver.lot1 : un compte Connect Stripe historique existant sous
// l'ancienne clé d'idempotence `connect-driver-test-driver-lot1` bloque toute nouvelle création
// avec les paramètres actuels — résidu d'un test antérieur (cdc-fix-c), pas un défaut de code ;
// voir .autopilot/progress/cdc-fix.md). Compte créé par scripts/tests/_tmp-create-driver-payments.mjs.
const DRIVER_ID = 'test-driver-cdcres5';
const DRIVER_EMAIL = 'driver.cdcres5@golink.test';

async function main() {
  // État avant test : aucun compte Stripe (vérifié en base au préalable, stripeAccountId:null).
  const before = await db.doc(`driverPrivate/${DRIVER_ID}`).get();
  record('précondition : aucun compte Stripe avant test', before.data()?.stripeAccountId == null, `stripeAccountId=${before.data()?.stripeAccountId}`);

  const token = await login(DRIVER_EMAIL);
  record('connexion driver.cdcres5', !!token);

  // 1) L'écran apps/driver/src/features/payments/PaymentAccountScreen.tsx appelle
  //    createDriverConnectAccount puis createDriverConnectAccountLink (bouton « Activer »).
  const createRes = await call(token, 'createDriverConnectAccount', {});
  record('createDriverConnectAccount', createRes.status === 200 && !!createRes.body.result?.accountId, JSON.stringify(createRes.body).slice(0, 200));

  const linkRes = await call(token, 'createDriverConnectAccountLink', {});
  record('createDriverConnectAccountLink', linkRes.status === 200 && typeof linkRes.body.result?.url === 'string' && linkRes.body.result.url.startsWith('https://'), JSON.stringify(linkRes.body).slice(0, 200));

  // 2) Vérification en base : le compte connecté a bien été écrit par la Cloud Function réelle (pas simulé).
  const afterCreate = await db.doc(`driverPrivate/${DRIVER_ID}`).get();
  const accountId = afterCreate.data()?.stripeAccountId;
  record('stripeAccountId écrit en base par la fonction réelle', typeof accountId === 'string' && accountId.startsWith('acct_'), `stripeAccountId=${accountId}`);

  // 3) Bouton « Actualiser » de l'écran : refreshDriverConnectAccountStatus relit l'état chez Stripe.
  const refreshRes = await call(token, 'refreshDriverConnectAccountStatus', {});
  record('refreshDriverConnectAccountStatus', refreshRes.status === 200 && ['pending', 'restricted', 'enabled', null].includes(refreshRes.body.result?.status), JSON.stringify(refreshRes.body).slice(0, 200));

  // 4) Audit sensible écrit à la création (driver.stripe_account_created) — sans orderBy pour éviter
  //    un index composite dédié à ce seul test (target.id + action suffisent à identifier l'entrée).
  const auditSnap = await db.collection('auditLogs').where('target.id', '==', DRIVER_ID).where('action', '==', 'driver.stripe_account_created').limit(1).get();
  record('audit driver.stripe_account_created présent', !auditSnap.empty, `${auditSnap.size} entrée(s)`);

  // Nettoyage : ce compte de test dédié (créé pour ce lot) est laissé tel quel ; il n'est pas
  // partagé avec d'autres tâches (voir .autopilot/progress/cdc-fix.md pour la raison du choix
  // de ce compte plutôt que driver.lot1).

  // Vérification finale que le compte fonctionne toujours avec le mot de passe documenté.
  const finalLogin = await login(DRIVER_EMAIL);
  record('compte de test toujours fonctionnel avec son mot de passe documenté', !!finalLogin);

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} OK`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR', err);
  process.exit(1);
});
