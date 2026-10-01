// Test réel cdc-fix-residuals-18 (§7 Gestion des clients, « Indicateurs de risque ») :
// `users/{uid}.stats.cancelledCount` et `.refundsCount` étaient initialisés à 0 à la création du
// compte mais jamais incrémentés ensuite nulle part dans functions/src — les deux signaux « annulations
// fréquentes » et « remboursements répétés » (`packages/shared/src/models/admin-actors.ts`,
// seuils ≥3) ne pouvaient donc jamais se déclencher sur la fiche client.
//
// Corrigé :
//  - `functions/src/orders/triggers.ts::onOrderWritten` incrémente désormais `stats.cancelledCount`
//    à la transition vers `status:'cancelled'` (même garde que les autres automatismes de ce
//    trigger, une seule fois).
//  - `functions/src/finance/argent/settlement.ts::onRefundProcessed` incrémente désormais
//    `stats.refundsCount` à la transition vers `status:'processed'`, AVANT `bookRefund` (qui
//    retourne tôt pour une commande annulée avant livraison — le cas le plus fréquent — et aurait
//    donc manqué la majorité des remboursements si le compteur y avait été posé à la place).
//
// Déclenche les deux triggers Firestore réels (écriture directe de documents jetables, comme
// n'importe quelle écriture réelle le ferait) sur le compte client réel existant
// `client.mobilerecompte@golink.test`, puis restaure son solde de compteurs et supprime toutes
// les données créées.
//
//   npx tsx scripts/tests/cdc-fix-residuals-18.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres18-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const CUSTOMER_ID = 'JpbbCEhHZIX8Jk5wOx5WyOUW6292'; // client.mobilerecompte@golink.test, compte réel existant
const ORDER_ID = 'cdcres18-test-order';
const REFUND_ID = 'cdcres18-test-refund';
const RESTAURANT_ID = 'cdcres18-test-restaurant';

async function waitFor(check, timeoutMs = 20000, intervalMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Délai dépassé en attendant la propagation du trigger.');
}

async function main() {
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');

  const userRef = db.doc(`users/${CUSTOMER_ID}`);
  const before = (await userRef.get()).data();
  const originalCancelled = before?.stats?.cancelledCount ?? 0;
  const originalRefunds = before?.stats?.refundsCount ?? 0;
  console.log('avant :', { cancelledCount: originalCancelled, refundsCount: originalRefunds });

  const orderRef = db.doc(`orders/${ORDER_ID}`);
  const refundRef = db.doc(`refunds/${REFUND_ID}`);

  try {
    const now = Timestamp.now();
    // 1. Commande jetable à l'état "accepted", puis transition vers "cancelled" (déclenche onOrderWritten).
    await orderRef.set({
      number: 'GL-CDCRES18',
      status: 'accepted',
      fulfillment: 'delivery',
      restaurantId: RESTAURANT_ID,
      restaurantName: 'Commerce de test (cdcres18)',
      customerId: CUSTOMER_ID,
      customerName: 'Client Test Résiduel18',
      countryId: 'FR',
      cityId: 'longwy',
      createdAt: now,
      updatedAt: now,
      test: true,
    });
    await orderRef.update({
      status: 'cancelled',
      cancellation: { reason: 'customer_request', by: 'customer', at: now, refundCents: 0 },
      updatedAt: now,
    });

    const cancelledAfter = await waitFor(async () => {
      const snap = await userRef.get();
      const v = snap.get('stats.cancelledCount');
      return v === originalCancelled + 1 ? v : undefined;
    }).catch(() => (undefined));
    record('stats.cancelledCount incrémenté de 1 (trigger onOrderWritten)', cancelledAfter === originalCancelled + 1, `avant=${originalCancelled} après=${cancelledAfter}`);

    // 2. Remboursement jetable à l'état "requested", puis transition vers "processed" (déclenche onRefundProcessed).
    // orderId pointe vers une commande sans orderFinancials (bookRefund retourne alors tôt, sans écriture de grand livre).
    await refundRef.set({
      orderId: `${ORDER_ID}-no-financials`,
      orderNumber: 'GL-CDCRES18',
      customerId: CUSTOMER_ID,
      restaurantId: RESTAURANT_ID,
      amountCents: 500,
      method: 'wallet',
      cause: 'other',
      allocation: { restaurantCents: 0, platformCents: 500 },
      status: 'requested',
      automatic: false,
      requestedBy: 'system',
      requestedAt: now,
      countryId: 'FR',
      cityId: 'longwy',
      test: true,
    });
    await refundRef.update({ status: 'processed', updatedAt: now });

    const refundsAfter = await waitFor(async () => {
      const snap = await userRef.get();
      const v = snap.get('stats.refundsCount');
      return v === originalRefunds + 1 ? v : undefined;
    }).catch(() => undefined);
    record('stats.refundsCount incrémenté de 1 (trigger onRefundProcessed)', refundsAfter === originalRefunds + 1, `avant=${originalRefunds} après=${refundsAfter}`);
  } finally {
    await orderRef.delete().catch(() => {});
    await refundRef.delete().catch(() => {});
    // Sous-collection dailyStats écrite par recomputeDailyStats sur le restaurant jetable.
    const dailyStatsSnap = await db.collection(`restaurants/${RESTAURANT_ID}/dailyStats`).get().catch(() => ({ docs: [] }));
    for (const d of dailyStatsSnap.docs ?? []) await d.ref.delete().catch(() => {});
    // Dot-notation : ne touche que ces deux champs, laisse le reste de stats.* intact
    // (un `set({stats:{...}}, {merge:true})` remplacerait toute la carte `stats`).
    await userRef.update({ 'stats.cancelledCount': originalCancelled, 'stats.refundsCount': originalRefunds });
    const restored = (await userRef.get()).data();
    const ok = restored?.stats?.cancelledCount === originalCancelled && restored?.stats?.refundsCount === originalRefunds;
    record('nettoyage : compteurs client restaurés, commande/remboursement/dailyStats de test supprimés', ok, JSON.stringify(restored?.stats));
  }
}

try {
  await main();
} finally {
  try {
    rmSync(adcPath, { force: true });
  } catch {}
}

const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
