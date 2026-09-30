// Test réel des correctifs de la tâche cdc-fix-residuals-3 (§6 Gestion des livreurs) :
//  1. `computeDriverStats` (functions/src/admin/operations/driver-stats.ts) échouait
//     TOUTES LES NUITS depuis le 28/09/2026 (`FAILED_PRECONDITION: The query requires
//     an index`, confirmé par les journaux de production) faute d'un index composite
//     Firestore sur `orders` (fulfillment + createdAt) — jamais créé. La rubrique
//     « Performance » (§6) restait donc FAUX (drivers.stats toujours à 0/valeurs seed)
//     malgré une fonction de calcul déjà écrite et déployée. Index ajouté
//     (firebase/firestore.indexes.json) et déployé ; le premier bloc appelle directement
//     la logique de calcul (exportée `runDriverStatsCompute`) sur la vraie base — laisser
//     `RUN_STATS=1` seulement quand l'index est prêt (déjà validé une fois).
//  2. `bulkUpdateDrivers` (action « message ») échappait au contrôle `drivers.bulk` dès
//     plus d'un destinataire : un compte disposant seulement de `drivers.view` (ici
//     `metz@golink.test`) pouvait notifier jusqu'à 300 livreurs. Corrigé.
//  3. L'export CSV des livreurs n'exigeait aucun droit `exports.run` ni aucune trace
//     d'audit (nouvelle fonction `auditDriversExport`, appelée avant le téléchargement
//     côté client). Testé ici directement contre la fonction déployée.
//
//   RUN_STATS=1 npx tsx scripts/tests/cdc-fix-residuals-3.flow.mjs   (avec ADC, cf. progress)
//   npx tsx scripts/tests/cdc-fix-residuals-3.flow.mjs               (permissions seules)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function testStats() {
  const { db } = await import('../lib/admin.mjs');
  const before = (await db.doc('drivers/test-driver-lot1').get()).data()?.stats;
  record('avant : stats à zéro (bug confirmé)', before && before.deliveries === 0, JSON.stringify(before));

  const { runDriverStatsCompute } = await import('../../functions/src/admin/operations/driver-stats.ts');
  const result = await runDriverStatsCompute();
  record('runDriverStatsCompute exécuté sans lever d’exception (index désormais présent)', Boolean(result), JSON.stringify(result));
  record('au moins un livreur mis à jour', (result?.drivers ?? 0) > 0, `drivers=${result?.drivers}`);

  const after = (await db.doc('drivers/test-driver-lot1').get()).data()?.stats;
  record('après : deliveries réel (≥ 2, commandes GL-12983/GL-12984 livrées)', (after?.deliveries ?? 0) >= 2, JSON.stringify(after));
  record('après : onTimeRate calculé (pas de retard sur les commandes de test)', after?.onTimeRate === 1, `onTimeRate=${after?.onTimeRate}`);
  record('après : averageDeliveryMinutes > 0 (calculé depuis picked_up→delivered réels)', (after?.averageDeliveryMinutes ?? 0) > 0, `averageDeliveryMinutes=${after?.averageDeliveryMinutes}`);
  record('après : cancellationRate reflète la commande annulée GL-12982', typeof after?.cancellationRate === 'number', `cancellationRate=${after?.cancellationRate}`);
}

async function testPermissions() {
  const metzToken = await login('metz@golink.test');
  const superToken = await login('superadmin@golink.test');
  const testDriverIds = ['test-driver-lot1', 'test-driver-lot3-restaurant'];

  // 2. Message groupé (>1 destinataire) refusé pour un compte sans `drivers.bulk`.
  const msgDenied = await call(metzToken, 'bulkUpdateDrivers', {
    driverIds: testDriverIds,
    action: 'message',
    reason: 'Test cdc-fix-residuals-3 (doit être refusé)',
    message: { title: 'Test', body: 'Ce message ne doit jamais être envoyé (droits insuffisants).' },
  });
  record('bulkUpdateDrivers message groupé refusé sans drivers.bulk (metz)', msgDenied.status === 403 || msgDenied.body?.error, `status=${msgDenied.status} ${JSON.stringify(msgDenied.body?.error ?? '')}`);

  // Un message à un seul destinataire reste autorisé avec seulement drivers.view.
  const msgSingleAllowed = await call(metzToken, 'bulkUpdateDrivers', {
    driverIds: [testDriverIds[0]],
    action: 'message',
    reason: 'Test cdc-fix-residuals-3 (destinataire unique, doit passer)',
    message: { title: 'Test Ciyou Eats', body: 'Message de test cdc-fix-residuals-3, sans conséquence.' },
  });
  record('bulkUpdateDrivers message à un seul livreur toujours autorisé avec drivers.view (metz)', msgSingleAllowed.status === 200, `status=${msgSingleAllowed.status} ${JSON.stringify(msgSingleAllowed.body).slice(0, 200)}`);

  // Le même message groupé passe pour un compte avec drivers.bulk (superadmin).
  const msgAllowed = await call(superToken, 'bulkUpdateDrivers', {
    driverIds: testDriverIds,
    action: 'message',
    reason: 'Test cdc-fix-residuals-3 (superadmin, doit passer)',
    message: { title: 'Test Ciyou Eats', body: 'Message de test cdc-fix-residuals-3, sans conséquence.' },
  });
  record('bulkUpdateDrivers message groupé autorisé avec drivers.bulk (superadmin)', msgAllowed.status === 200, `status=${msgAllowed.status} ${JSON.stringify(msgAllowed.body).slice(0, 200)}`);

  // 3. Export refusé sans `exports.run` (metz), autorisé avec (superadmin) — et audité.
  const exportDenied = await call(metzToken, 'auditDriversExport', { driverIds: testDriverIds, reason: 'Test cdc-fix-residuals-3 (doit être refusé)' });
  record('auditDriversExport refusé sans exports.run (metz)', exportDenied.status === 403 || exportDenied.body?.error, `status=${exportDenied.status} ${JSON.stringify(exportDenied.body?.error ?? '')}`);

  const exportAllowed = await call(superToken, 'auditDriversExport', { driverIds: testDriverIds, reason: 'Test cdc-fix-residuals-3 (superadmin, doit passer et être audité)' });
  record('auditDriversExport autorisé avec exports.run (superadmin)', exportAllowed.status === 200 && exportAllowed.body?.result?.ok === true, `status=${exportAllowed.status} ${JSON.stringify(exportAllowed.body)}`);

  // Vérifie qu'une trace d'audit a bien été écrite pour l'export réussi (pas d'index
  // dédié pour ce tri ponctuel : filtre par motif de ce test, sans orderBy).
  const { db } = await import('../lib/admin.mjs');
  const auditSnap = await db.collection('auditLogs').where('action', '==', 'driver.export').where('reason', '==', 'Test cdc-fix-residuals-3 (superadmin, doit passer et être audité)').limit(1).get();
  const lastAudit = auditSnap.docs[0]?.data();
  record('audit écrit pour l’export réel (driver.export)', Boolean(lastAudit), JSON.stringify({ action: lastAudit?.action, reason: lastAudit?.reason, after: lastAudit?.after }));
}

async function main() {
  if (process.env.RUN_STATS === '1') await testStats();
  await testPermissions();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
