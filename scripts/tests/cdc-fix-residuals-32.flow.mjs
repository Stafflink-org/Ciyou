// Test réel cdc-fix-residuals-32 (§16 Légal/Fiscal, déclaration DAC7) : `runDac7`
// (functions/src/finance/argent/tax.ts) déduisait déjà les remboursements imputés au COMMERCE
// du revenu brut déclaré (`refunds` filtrées sur `allocation.restaurantCents`, correctif
// cdc-fix-residuals-3) mais PAS ceux imputés au LIVREUR : le filtre de lecture du grand livre
// (`ledgerEntries`) n'incluait que `courier_earning`/`courier_bonus`/`hourly_guarantee_topup`/
// `courier_tip`, jamais `refund_charge` — alors que `settlement.ts` (ligne ~372) écrit bien une
// entrée `refund_charge` négative sur le compte du livreur quand un remboursement lui est
// imputé. Un livreur ayant touché 50 € de course puis s'étant vu imputer 20 € de remboursement
// voyait donc déclarer 50 € de revenu brut au lieu de 30 € sur sa déclaration DAC7 transmise à
// l'administration fiscale.
//
// Corrigé : `refund_charge` ajouté au filtre des types lus, marqué `countsAsTransaction: false`
// (comme pour les commerces) pour ne pas compter comme une course de plus ; `courses` recalculé
// depuis les trimestres agrégés (comme pour les commerces) au lieu de `txs.length` brut, qui
// aurait sinon compté le remboursement comme une course supplémentaire.
//
// Test réel sur `golink-9f16d` : appel direct de `runDac7('FR', 2026)` (fonction exportée pour
// un test réel, même motif que cdc-fix-residuals-3) après avoir écrit deux écritures de grand
// livre jetables pour un livreur jetable (une course réelle + un remboursement imputé réel),
// vérification de la ligne DAC7 produite pour ce livreur, nettoyage complet après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-32.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

// `functions/src/finance/argent/tax.ts` importe `lib/admin` (SDK Admin, Application Default
// Credentials) : une ADC temporaire est nécessaire pour l'importer depuis un script local
// (même motif que cdc-fix-residuals-29/31).
const adcPath = join(tmpdir(), `cdcres32-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

const DRIVER_ID = 'cdcres32-driver';
const YEAR = 2026;

async function main() {
  await db.doc(`drivers/${DRIVER_ID}`).set({ firstName: 'CDCRES32', lastName: 'Livreur', test: true, seed: true });
  await db.doc(`driverPrivate/${DRIVER_ID}`).set({ taxIdentificationNumber: 'TEST-CDCRES32', address: { line1: '1 rue de test', postalCode: '54400', city: 'Longwy' }, birthDate: '1990-01-01', test: true, seed: true });

  const base = { currency: 'EUR', countryId: 'FR', cityId: 'longwy', createdAt: new Date(), createdBy: 'system', test: true };
  await db.doc('ledgerEntries/cdcres32-earning').set({
    ...base, accountType: 'driver', accountId: DRIVER_ID, type: 'courier_earning', amountCents: 5000, bookingDate: `${YEAR}-06-01`, orderId: 'o-cdcres32-test', vatCents: null, description: 'Test cdcres32 (course)',
  });
  await db.doc('ledgerEntries/cdcres32-refund').set({
    ...base, accountType: 'driver', accountId: DRIVER_ID, type: 'refund_charge', amountCents: -2000, bookingDate: `${YEAR}-06-02`, orderId: 'o-cdcres32-test', refundId: 'rf-cdcres32-test', vatCents: null, description: 'Test cdcres32 (remboursement imputé)',
  });

  const { runDac7 } = await import('../../functions/src/finance/argent/tax.ts');
  const { lines } = await runDac7('FR', YEAR);
  const line = lines.find((l) => l.sellerId === DRIVER_ID);

  check('runDac7.ligne_livreur_presente', Boolean(line), Boolean(line) ? `sellerId=${DRIVER_ID} trouvé` : `sellerId=${DRIVER_ID} introuvable`);
  check('runDac7.brut_deduit_du_remboursement (5000-2000=3000)', line?.grossCents === 3000, `grossCents=${line?.grossCents}`);
  check('runDac7.remboursement_ne_compte_pas_comme_une_course_de_plus (1 course, pas 2) — correctif attendu', line?.transactionsCount === 1, `transactionsCount=${line?.transactionsCount}`);
  const quarterWithData = line?.quarters?.find((q) => q.grossCents !== 0 || q.transactionsCount !== 0);
  check('runDac7.quarter_coherent (T2 2026, juin)', quarterWithData?.quarter === 2 && quarterWithData?.grossCents === 3000, JSON.stringify(quarterWithData));
}

async function cleanup() {
  await db.doc('ledgerEntries/cdcres32-earning').delete().catch(() => {});
  await db.doc('ledgerEntries/cdcres32-refund').delete().catch(() => {});
  await db.doc(`drivers/${DRIVER_ID}`).delete().catch(() => {});
  await db.doc(`driverPrivate/${DRIVER_ID}`).delete().catch(() => {});
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(async () => {
    if (!process.env.NO_CLEANUP) await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
