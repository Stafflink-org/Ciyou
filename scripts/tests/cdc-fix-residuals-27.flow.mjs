// Test réel cdc-fix-residuals-27 (§7 Gestion des clients, « Liste et filtres » — export) :
// l'export CSV des clients (`apps/admin/src/features/clients/ClientsPage.tsx::exportRows`) était
// généré directement dans le navigateur, sans aucun contrôle `exports.run` ni aucune trace
// d'audit — alors que la liste contient des données personnelles (e-mail, téléphone non masqués
// selon le rôle, dépenses, avoirs). Même défaut déjà trouvé et corrigé une fois pour les livreurs
// (`auditDriversExport`, `cdc-fix-residuals-3`), jamais appliqué aux clients.
//
// Corrigé : nouvelle Cloud Function `auditCustomersExport` (exige `exports.run`, écrit un audit
// sensible `customer.exported`), appelée par `exportRows` AVANT toute génération de fichier ; le
// bouton « Exporter » de la liste clients n'apparaît plus sans ce droit (`can('exports.run')`).
//
// Test réel contre la fonction DÉPLOYÉE (golink-9f16d), via les deux comptes administrateur
// RÉELS déjà utilisés par le test équivalent sur les livreurs (`metz@golink.test`, responsable de
// ville sans `exports.run` ; `finance@golink.test`, a `exports.run`) — jamais contre le site
// déployé.
//
//   npx tsx scripts/tests/cdc-fix-residuals-27.flow.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const TEST_CLIENT_IDS = ['JpbbCEhHZIX8Jk5wOx5WyOUW6292', 'fpgIMG4RMIQvP1eZy7CemqS2VWn1'];

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

async function main() {
  const { db } = await import('../lib/admin.mjs');

  const metzToken = await login('metz@golink.test');
  const financeToken = await login('finance@golink.test');

  const before = await db.collection('auditLogs').where('action', '==', 'customer.exported').get();

  const denied = await call(metzToken, 'auditCustomersExport', { userIds: TEST_CLIENT_IDS, reason: 'Test cdc-fix-residuals-27 (doit être refusé)' });
  record('auditCustomersExport refusé sans exports.run (metz)', denied.status === 403 || !!denied.body?.error, `status=${denied.status} ${JSON.stringify(denied.body?.error ?? '')}`);

  const allowed = await call(financeToken, 'auditCustomersExport', { userIds: TEST_CLIENT_IDS, reason: 'Test cdc-fix-residuals-27 (finance, doit passer et être audité)' });
  record('auditCustomersExport autorisé avec exports.run (finance)', allowed.status === 200 && allowed.body?.result?.ok === true, `status=${allowed.status} ${JSON.stringify(allowed.body)}`);

  const after = await db.collection('auditLogs').where('action', '==', 'customer.exported').get();
  const newEntry = after.docs.find((d) => !before.docs.some((b) => b.id === d.id));
  record('trace d’audit réellement écrite (customer.exported, sensible)', !!newEntry && newEntry.data().sensitive === true && newEntry.data().after?.count === TEST_CLIENT_IDS.length, newEntry ? JSON.stringify(newEntry.data().after) : 'aucune nouvelle entrée');

  if (newEntry) {
    await newEntry.ref.delete().catch(() => {});
  }
  const stillThere = (await db.collection('auditLogs').where('action', '==', 'customer.exported').get()).docs.find((d) => newEntry && d.id === newEntry.id);
  record('nettoyage : entrée d’audit de test supprimée', newEntry ? !stillThere : true);
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
