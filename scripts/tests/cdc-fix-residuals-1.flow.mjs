// Test réel des correctifs de la tâche cdc-fix-residuals-1 :
//  1. mentions légales des relevés livreurs par pays (Algérie/Maroc/Tunisie) sur
//     l'autofacturation des livreurs indépendants ;
//  2. reversement en échec classé dans la file « à traiter » (queue todo) par le
//     détecteur de rattrapage `todoQueue` (functions/src/admin/pilotage/anomalies.ts),
//     et non dans la file « alertes » (bug corrigé : `queue: 'alert'` → `queue: 'todo'`).
//
// Données de test isolées (préfixe `cdcres1-`, pays/villes fictifs pour ne toucher
// aucune donnée réelle) et mois de test 2019-01 (hors de toute plage réelle) : appel
// direct de `runMonthlyInvoices`/`todoQueue`/`applyAlerts`/`loadMonitoringSettings`
// (code des fonctions). Nettoyage systématique en fin de script (try/finally).
//
//   npx tsx scripts/tests/cdc-fix-residuals-1.flow.mjs
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../lib/admin.mjs';

const MONTH = '2019-01';
const COUNTRIES = ['DZ', 'MA', 'TN'];
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const created = { drivers: [], driverPrivate: [], ledgerEntries: [], invoices: [] };

async function seedDriver(countryId) {
  const uid = `cdcres1-driver-${countryId.toLowerCase()}`;
  const cityId = `cdcres1-ville-${countryId.toLowerCase()}`;
  await db.doc(`drivers/${uid}`).set({
    countryId,
    cityId,
    firstName: 'Test',
    lastName: countryId,
    displayName: `Test ${countryId}`,
    phone: '+33600000000',
    email: `cdcres1-${countryId.toLowerCase()}@golink.test`,
    type: 'platform',
    restaurantIds: [],
    vehicle: { type: 'scooter' },
    test: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  created.drivers.push(uid);
  await db.doc(`driverPrivate/${uid}`).set({
    birthDate: '1990-01-01',
    nationality: countryId,
    address: { line1: 'Test', postalCode: '00000', city: 'Test' },
    vatExempt: true,
    cashBalanceCents: 0,
    cashLimitCents: 0,
    test: true,
  });
  created.driverPrivate.push(uid);
  const entryRef = db.collection('ledgerEntries').doc(`cdcres1-earn-${countryId.toLowerCase()}`);
  await entryRef.set({
    countryId,
    cityId,
    accountType: 'driver',
    accountId: uid,
    type: 'courier_earning',
    amountCents: 500,
    currency: countryId === 'DZ' ? 'DZD' : countryId === 'MA' ? 'MAD' : 'TND',
    orderId: null,
    refundId: null,
    payoutId: null,
    invoiceId: null,
    subscriptionId: null,
    description: 'Test cdc-fix-residuals-1',
    reason: null,
    bookingDate: `${MONTH}-15`,
    createdAt: Timestamp.now(),
    createdBy: 'cdc-fix-residuals-1',
    test: true,
  });
  created.ledgerEntries.push(entryRef.path);
  return { uid, cityId };
}

async function testPayoutFailedTodoQueue() {
  const { todoQueue, loadMonitoringSettings, applyAlerts } = await import('../../functions/src/admin/pilotage/anomalies.ts');
  const payoutId = 'cdcres1-payout-failed';
  const today = new Date().toISOString().slice(0, 10);
  await db.doc(`payouts/${payoutId}`).set({
    beneficiaryType: 'restaurant',
    beneficiaryId: 'cdcres1-resto',
    beneficiaryName: 'Test cdc-fix-residuals-1',
    status: 'failed',
    countryId: 'FR',
    cityId: 'cdcres1-ville-fr',
    periodStart: `${MONTH}-01`,
    periodEnd: `${MONTH}-31`,
    netCents: 1234,
    currency: 'EUR',
    provider: 'stripe',
    test: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  try {
    const settings = await loadMonitoringSettings();
    const candidates = await todoQueue(settings, today);
    const candidate = candidates.find((c) => c.kind === 'payout_failed' && c.target.id === payoutId);
    record('Reversement en échec détecté par todoQueue', Boolean(candidate), JSON.stringify(candidate));
    record('Reversement en échec : queue = todo (pas alert)', candidate?.queue === 'todo', candidate?.queue);
    if (candidate) {
      await applyAlerts([candidate]);
      const alertId = `mon_${candidate.dedupKey.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 140)}`;
      const alertSnap = await db.doc(`platformAlerts/${alertId}`).get();
      record(
        'Alerte écrite en base avec queue = todo, statut open',
        alertSnap.exists && alertSnap.get('queue') === 'todo' && alertSnap.get('status') === 'open',
        JSON.stringify(alertSnap.data()),
      );
      await alertSnap.ref.delete().catch(() => undefined);
    }
  } finally {
    await db.doc(`payouts/${payoutId}`).delete().catch(() => undefined);
  }
}

async function main() {
  try {
    const { runMonthlyInvoices } = await import('../../functions/src/finance/argent/invoices.ts');
    for (const countryId of COUNTRIES) {
      const { uid, cityId } = await seedDriver(countryId);
      const run = await runMonthlyInvoices({ month: MONTH, countryId, cityIds: [cityId] });
      record(`${countryId} : relevé émis`, run.driverStatements === 1, JSON.stringify(run.preview));
      const invId = `rel-${uid}-${MONTH}`;
      created.invoices.push(invId);
      const snap = await db.doc(`invoices/${invId}`).get();
      const mentions = snap.exists ? snap.data().legalMentions ?? [] : [];
      const generic = 'TVA non applicable : prestataire exonéré selon le régime fiscal applicable dans son pays d’établissement.';
      const hasGeneric = mentions.includes(generic);
      const hasSpecific = mentions.some((m) => m.toLowerCase().includes(countryId === 'DZ' ? 'algérien' : countryId === 'MA' ? 'marocain' : 'tunisien'));
      record(`${countryId} : mention spécifique (pas le fallback générique)`, snap.exists && hasSpecific && !hasGeneric, mentions.join(' | '));
    }
    await testPayoutFailedTodoQueue();
  } finally {
    for (const id of created.invoices) await db.doc(`invoices/${id}`).delete().catch(() => undefined);
    for (const path of created.ledgerEntries) await db.doc(path).delete().catch(() => undefined);
    for (const uid of created.driverPrivate) await db.doc(`driverPrivate/${uid}`).delete().catch(() => undefined);
    for (const uid of created.drivers) await db.doc(`drivers/${uid}`).delete().catch(() => undefined);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
