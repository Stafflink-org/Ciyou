// Test réel cdc-fix-residuals-37 (§7 Gestion des clients, « Indicateurs de risque ») : la
// fiche client lit `userPrivate/{uid}.riskScore`/`.riskFlags` (via `customerRiskLevel`,
// packages/shared) pour afficher le signal « Signaux de fraude » — mais rien n'écrivait
// jamais ces champs au-delà de leur initialisation à 0/[] à la création du compte. La
// détection de fraude (`detectFraudSignals`, §28) ouvre bien un dossier réel dans `fraudCases`
// avec un `riskScore` calculé, mais ce score n'était jamais recopié vers `userPrivate` : un
// client avec un dossier de fraude grave ouvert restait affiché sans aucun signal de risque
// sur sa fiche.
//
// Corrigé : nouveau déclencheur `onFraudCaseWritten` (functions/src/platform/fraud.ts) qui
// recopie `riskScore` et les codes de signaux (`riskFlags`) vers `userPrivate/{uid}` dès qu'un
// dossier de fraude CLIENT est créé ou complété ; pose aussi `fraudCaseIds` (lu par
// `ClientPage.tsx`, jamais alimenté non plus).
//
// Test réel sur `golink-9f16d` : un signal de fraude réel est ouvert pour un client jetable
// via `upsertSignal` (fonction exportée, même appelée par la détection planifiée), le
// déclencheur étant un vrai déclencheur Firestore déployé, la vérification attend sa
// propagation réelle. Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-37.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres37-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLIENT_UID = 'cdcres37-client';
const CASE_ID = `client_${CLIENT_UID}`;

async function main() {
  await db.doc(`userPrivate/${CLIENT_UID}`).set({ stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: new Date() });

  const { upsertSignal } = await import('../../functions/src/platform/fraud.ts');
  await upsertSignal('client', CLIENT_UID, 'CDCRES37 Test', 'FR', { code: 'abnormal_cancellations', detail: 'Test cdcres37', score: 45 });

  // Premier déclenchement après déploiement : laisser le temps d'un démarrage à froid.
  let priv = null;
  for (let i = 0; i < 40; i += 1) {
    priv = (await db.doc(`userPrivate/${CLIENT_UID}`).get()).data();
    if ((priv?.riskScore ?? 0) > 0) break;
    await sleep(5000);
  }
  check('userPrivate.riskScore synchronise depuis fraudCases (correctif attendu)', priv?.riskScore === 45, `riskScore=${priv?.riskScore}`);
  check('userPrivate.riskFlags contient le code du signal', Array.isArray(priv?.riskFlags) && priv.riskFlags.includes('abnormal_cancellations'), JSON.stringify(priv?.riskFlags));
  check('userPrivate.fraudCaseIds pose (lu par ClientPage.tsx, jamais alimente avant)', Array.isArray(priv?.fraudCaseIds) && priv.fraudCaseIds.includes(CASE_ID), JSON.stringify(priv?.fraudCaseIds));

  // Deuxième signal : le score s'accumule (plafonné à 100), toujours synchronisé.
  await upsertSignal('client', CLIENT_UID, 'CDCRES37 Test', 'FR', { code: 'promo_abuse', detail: 'Test cdcres37 (second signal)', score: 40 });
  let priv2 = null;
  for (let i = 0; i < 20; i += 1) {
    priv2 = (await db.doc(`userPrivate/${CLIENT_UID}`).get()).data();
    if ((priv2?.riskScore ?? 0) >= 85) break;
    await sleep(3000);
  }
  check('deuxieme signal : riskScore cumule (45+40=85)', priv2?.riskScore === 85, `riskScore=${priv2?.riskScore}`);
  check('deuxieme signal : les deux codes presents dans riskFlags', priv2?.riskFlags?.includes('abnormal_cancellations') && priv2?.riskFlags?.includes('promo_abuse'), JSON.stringify(priv2?.riskFlags));
}

async function cleanup() {
  await db.doc(`fraudCases/${CASE_ID}`).delete().catch(() => {});
  await db.doc(`userPrivate/${CLIENT_UID}`).delete().catch(() => {});
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
