// Test réel cdc-fix-residuals-22 (§11 Affichage dans l'app client, « Mise en avant payante ») :
// les compteurs `sponsoredPlacements.{impressions,clicks,orders}` étaient initialisés à 0 à la
// réservation d'un emplacement mais n'avaient ensuite AUCUN producteur dans `functions/src` — ni
// la Cloud Function, ni l'app cliente ne les incrémentaient jamais. L'écran admin
// (`apps/admin/src/features/affichage/SponsoredPage.tsx`) affichait donc en permanence
// « 0 vues », « Taux de clic — » pour tout emplacement, qu'il soit réellement vu ou non. Les
// règles Firestore verrouillaient déjà ces 3 champs contre toute écriture admin directe —
// l'architecture prévoyait une fonction dédiée, jamais écrite.
//
// Corrigé :
//  - Nouvelle Cloud Function publique `trackSponsoredEvent` (`functions/src/admin/experience/
//    display.ts`), appelée désormais par l'app client (`apps/client/src/lib/sponsored.ts`,
//    branchée sur `RestaurantCard` — accueil ET recherche, qui réutilise le même composant) à
//    l'affichage d'une carte « Sponsorisé » (impression) et au clic sur cette carte (clic).
//  - `functions/src/orders/triggers.ts::onOrderWritten` incrémente désormais `orders` sur tous
//    les emplacements actifs du commerce, une seule fois, à la création de la commande.
//
// Test réel sur `golink-9f16d`, sur le VRAI emplacement sponsorisé actif « emplacement-santo-
// tete » (Santo Smash, ville de Metz) : appel direct de la fonction déployée (impression + clic),
// puis déclenchement réel du trigger `onOrderWritten` (écriture directe d'une commande jetable,
// comme n'importe quelle écriture réelle le ferait). Restauré exactement à son état d'origine et
// commande jetable supprimée après coup.
//
//   npx tsx scripts/tests/cdc-fix-residuals-22.flow.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres22-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PLACEMENT_ID = 'emplacement-santo-tete';
const RESTAURANT_ID = 'santo-smash';
const ORDER_ID = 'cdcres22-test-order';

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
  const { trackSponsoredEvent } = await import('../../functions/src/admin/experience/display.ts');

  const placementRef = db.doc(`sponsoredPlacements/${PLACEMENT_ID}`);
  const before = (await placementRef.get()).data();
  if (!before || before.status !== 'active') throw new Error('Emplacement de test introuvable ou inactif — test interrompu sans modification.');
  console.log('avant :', { impressions: before.impressions, clicks: before.clicks, orders: before.orders });

  const orderRef = db.doc(`orders/${ORDER_ID}`);

  try {
    // 1. Impression + clic via la Cloud Function déployée.
    const impRes = await trackSponsoredEvent.run({ data: { restaurantId: RESTAURANT_ID, event: 'impression' }, auth: null });
    record('appel trackSponsoredEvent (impression) réussi', impRes.ok === true, JSON.stringify(impRes));
    const clickRes = await trackSponsoredEvent.run({ data: { restaurantId: RESTAURANT_ID, event: 'click' }, auth: null });
    record('appel trackSponsoredEvent (clic) réussi', clickRes.ok === true, JSON.stringify(clickRes));

    const afterEvents = (await placementRef.get()).data();
    record('impressions incrémentées de 1 — correctif attendu', afterEvents.impressions === before.impressions + 1, `avant=${before.impressions} après=${afterEvents.impressions}`);
    record('clics incrémentés de 1 — correctif attendu', afterEvents.clicks === before.clicks + 1, `avant=${before.clicks} après=${afterEvents.clicks}`);

    // 2. Déclenchement réel du trigger onOrderWritten (création d'une commande jetable).
    const now = Timestamp.now();
    await orderRef.set({
      number: 'GL-CDCRES22',
      status: 'accepted',
      fulfillment: 'delivery',
      restaurantId: RESTAURANT_ID,
      restaurantName: 'Santo Smash',
      customerId: 'cdcres22-test-customer',
      customerName: 'Client Test Résiduel22',
      countryId: 'FR',
      cityId: 'metz',
      createdAt: now,
      updatedAt: now,
      test: true,
    });

    const ordersAfter = await waitFor(async () => {
      const snap = await placementRef.get();
      const v = snap.data()?.orders;
      return v === before.orders + 1 ? v : undefined;
    }).catch(() => undefined);
    const finalOrders = (await placementRef.get()).data()?.orders;
    record('orders incrémenté de 1 par le trigger onOrderWritten — correctif attendu', ordersAfter === before.orders + 1, `avant=${before.orders} après=${finalOrders}`);
  } finally {
    await orderRef.delete().catch(() => {});
    // Restauration intégrale de l'emplacement à son état exact d'origine.
    await placementRef.set(before);
    const restored = (await placementRef.get()).data();
    record(
      'nettoyage : emplacement restauré à son état exact d’origine',
      restored.impressions === before.impressions && restored.clicks === before.clicks && restored.orders === before.orders,
      JSON.stringify({ impressions: restored.impressions, clicks: restored.clicks, orders: restored.orders }),
    );
    const orderGone = !(await orderRef.get()).exists;
    record('nettoyage : commande jetable supprimée', orderGone);
  }
}

await main();
const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
