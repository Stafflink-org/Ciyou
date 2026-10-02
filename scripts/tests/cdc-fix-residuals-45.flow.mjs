// Test réel cdc-fix-residuals-45 (§1 Tableau de bord global) : le KPI « Abonnements
// encaissés » et la courbe « Commerces » de l'onglet Évolution restaient figés sur la valeur de
// la veille toute la journée — `aggregatePlatformStats` (tâche à la minute, déclenchée par les
// écritures de commande) ne recalcule jamais les champs externes (nouveaux commerces/livreurs,
// support, abonnements encaissés), seule la consolidation de NUIT (`refreshPlatformStats`,
// 03h30) les met à jour, et uniquement pour J-1/J-2 — jamais pour AUJOURD'HUI.
//
// Corrigé : nouvelle tâche planifiée `refreshTodayExternalFields` (toutes les 30 min) qui
// applique la même logique (`externalFields` + `recomputeCity` + `recomputeRollups`) au jour
// courant — fraîcheur maximale 30 min au lieu de jusqu'à 24h+.
//
// Test réel sur `golink-9f16d` : appel direct des fonctions exportées (`externalFields`,
// `recomputeCity`) — le même code que la tâche planifiée exécute — sur une ville et un
// commerce/une facture jetables créés AUJOURD'HUI, puis vérification du document `statsDaily`
// résultant. Nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-45.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres45-adc-${process.pid}.json`);
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

const CITY_ID = 'cdcres45-ville';
const RESTO_ID = 'cdcres45-resto';
const INVOICE_ID = 'cdcres45-invoice';

function parisDayToday() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const day = parisDayToday();
  const now = Timestamp.now();

  await db.doc(`cities/${CITY_ID}`).set({ name: 'Test cdcres45', slug: CITY_ID, countryId: 'FR', active: true, orderRules: null, test: true, managerIds: [] });
  await db.doc(`restaurants/${RESTO_ID}`).set({
    name: 'CDCRES45 Resto', cityId: CITY_ID, countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now, updatedAt: now, updatedBy: 'system',
  });
  await db.doc(`invoices/${INVOICE_ID}`).set({
    number: 'TEST-CDCRES45', kind: 'subscription_invoice', status: 'paid', cityId: CITY_ID, countryId: 'FR',
    recipient: { type: 'restaurant', id: RESTO_ID, name: 'CDCRES45 Resto' }, issuer: { type: 'platform', name: 'Ciyou Eats' },
    lines: [{ label: 'Abonnement Pro', htCents: 4900, vatRateBps: 2000, vatCents: 980 }],
    totalHtCents: 4900, totalVatCents: 980, totalTtcCents: 5880, vatSummary: [],
    issuedAt: now, paidAt: now, test: true, createdAt: now, updatedAt: now,
  });

  const { externalFields, recomputeCity } = await import('../../functions/src/admin/pilotage/platform-stats.ts');
  const { statsDocId } = await import('../../functions/src/admin/pilotage/stats-compute.ts');

  const external = await externalFields(CITY_ID, day);
  check('externalFields detecte le nouveau commerce du jour', external.actors?.restaurantsNew === 1, `restaurantsNew=${external.actors?.restaurantsNew}`);
  check('externalFields detecte la facture d abonnement encaissee', external.revenue?.subscriptionsHtCents === 4900, `subscriptionsHtCents=${external.revenue?.subscriptionsHtCents}`);

  await recomputeCity(CITY_ID, day, external);
  const docId = statsDocId('city', CITY_ID, day);
  const stats = (await db.doc(`statsDaily/${docId}`).get()).data();
  check('statsDaily (ville, jour courant) reflete le nouveau commerce (correctif attendu)', stats?.actors?.restaurantsNew === 1, `restaurantsNew=${stats?.actors?.restaurantsNew}`);
  check('statsDaily (ville, jour courant) reflete l abonnement encaisse (correctif attendu)', stats?.revenue?.subscriptionsHtCents === 4900, `subscriptionsHtCents=${stats?.revenue?.subscriptionsHtCents}`);
}

async function cleanup() {
  const day = parisDayToday();
  const { statsDocId } = await import('../../functions/src/admin/pilotage/stats-compute.ts');
  await db.doc(`invoices/${INVOICE_ID}`).delete().catch(() => {});
  await db.doc(`restaurants/${RESTO_ID}`).delete().catch(() => {});
  await db.doc(`cities/${CITY_ID}`).delete().catch(() => {});
  await db.doc(`statsDaily/${statsDocId('city', CITY_ID, day)}`).delete().catch(() => {});
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
