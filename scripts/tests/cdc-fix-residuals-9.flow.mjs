// Test réel des correctifs de la tâche cdc-fix-residuals-9 (§8 Commandes, vision globale) :
//  1. `assignInTransaction` (functions/src/orders/dispatch.ts) et `assignDriverInTransaction`
//     (functions/src/orders/dispatch-advanced.ts) n'ajoutaient jamais le nom du livreur aux
//     `searchKeywords` de la commande (posés une seule fois à la création : numéro, client,
//     commerce, adresse) — la recherche « Toutes les commandes » (§8 « Consultation ») ne
//     pouvait donc jamais trouver une commande par nom de livreur. Corrigé : les deux
//     fonctions d'attribution fusionnent désormais `buildSearchKeywords(driverName)` dans
//     `searchKeywords` (sans écraser les mots-clés existants). Testé en appelant directement
//     `assignInTransaction` (exportée pour le test, comme `zoneShortages`/`assignDriverInTransaction`
//     le sont déjà) sur une commande et un livreur jetables.
//  2. `restaurantRates()` (functions/src/admin/pilotage/anomalies.ts) ne surveillait
//     automatiquement (tâche planifiée) que le taux d'annulation et de refus par commerce —
//     jamais le taux de retard, contrairement au cahier (« taux ... de retard ... anormal par
//     restaurant »). Corrigé : même fonction, 3e détection `restaurant_late_rate` sur
//     `lateCount`/`deliveredCount` (déjà alimentés par `orders/triggers.ts`), seuil réglable
//     `restaurantLateRate` (25 % par défaut). Testé en appelant directement `restaurantRates()`
//     (exportée pour le test) sur un commerce jetable avec un historique de retards fabriqué.
//
//   npx tsx scripts/tests/cdc-fix-residuals-9.flow.mjs
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
// Deux instances Firestore distinctes sont utilisées dans ce script (voir plus bas) ;
// chaque `Timestamp` doit venir du MÊME paquet que l'instance qui l'écrit, sinon
// `@google-cloud/firestore` refuse la valeur (« doesn't match the expected instance »).
import { Timestamp as RootTimestamp } from '@google-cloud/firestore';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Identifiants applicatifs temporaires (ADC), construits depuis la session Firebase CLI
// locale (aucune clé de service) — même patron que cdc-fix-residuals-1/3/7.
const { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } = await import('../gcp-token.mjs');
const adcPath = join(tmpdir(), `cdcres9-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const ORDER_ID = 'cdcres9-test-order';
const DRIVER_ID = 'cdcres9-test-driver';
const RESTAURANT_ID = 'cdcres9-test-restaurant';

async function testSearchKeywordsOnAssign() {
  // Important : la transaction doit être ouverte sur la MÊME instance Firestore que
  // celle utilisée par `assignInTransaction` (`functions/src/lib/admin`), sinon
  // `tx.getAll(...)` refuse les références (« not a valid DocumentReference »).
  const { db, Timestamp } = await import('../../functions/src/lib/admin.ts');
  await db.doc(`orders/${ORDER_ID}`).set({
    number: 'GL-CDCRES9',
    status: 'accepted',
    fulfillment: 'delivery',
    restaurantId: 'mina-kitchen',
    restaurantName: 'Mina Kitchen (test)',
    customerId: 'cdcres9-test-customer',
    customerName: 'Client Test Résiduel9',
    countryId: 'FR',
    cityId: 'longwy',
    driverId: null,
    delivery: null,
    // Mots-clés existants (numéro/client/commerce) : la fusion ne doit pas les effacer.
    searchKeywords: ['gl-cdcres9', 'client', 'test'],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  await db.doc(`drivers/${DRIVER_ID}`).set({
    cityId: 'longwy',
    countryId: 'FR',
    firstName: 'Zorglub',
    lastName: 'Résiduel9',
    displayName: 'Zorglub Résiduel9',
    phone: '+33600000099',
    email: 'cdcres9-driver@golink.test',
    type: 'platform',
    restaurantIds: [],
    vehicle: { type: 'bike' },
    zoneIds: [],
    status: 'active',
    onboardingStatus: 'approved',
    availability: 'online',
    activeOrderIds: [],
    acceptsCash: false,
    rating: { average: 0, count: 0 },
    stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
    searchKeywords: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  try {
    const { assignInTransaction } = await import('../../functions/src/orders/dispatch.ts');
    const { SYSTEM_EVENT_ACTOR } = await import('../../functions/src/orders/context.ts');
    const result = await db.runTransaction((tx) =>
      assignInTransaction(tx, { orderId: ORDER_ID, driverId: DRIVER_ID, actor: SYSTEM_EVENT_ACTOR, viewers: [], distanceMeters: 1200 }),
    );
    record('assignInTransaction() attribue bien le livreur', result.assigned === true, JSON.stringify(result));
    const after = (await db.doc(`orders/${ORDER_ID}`).get()).data();
    const kw = after?.searchKeywords ?? [];
    record('searchKeywords contient toujours le mot-clé du numéro/client d’origine (fusion, pas écrasement)', kw.includes('gl-cdcres9') && kw.includes('client'), JSON.stringify(kw));
    // `publicDisplayName` (§27 vie privée) ne renvoie que le prénom + l'initiale du nom
    // (« Zorglub R. »), jamais le nom complet : c'est donc « zorglub » et « zorglubr »
    // (mot-clé compact) qui doivent apparaître, pas le nom de famille entier.
    record('searchKeywords contient désormais des préfixes du nom (public) du livreur (« zorglub »)', kw.includes('zorglub'), JSON.stringify(kw));
    record('searchKeywords contient le mot-clé compact du nom affiché (« zorglubr »)', kw.includes('zorglubr'), JSON.stringify(kw));
  } finally {
    await db.doc(`orders/${ORDER_ID}`).collection('events').get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
    await db.doc(`orders/${ORDER_ID}`).delete();
    await db.doc(`drivers/${DRIVER_ID}`).delete();
    const orderGone = !(await db.doc(`orders/${ORDER_ID}`).get()).exists;
    const driverGone = !(await db.doc(`drivers/${DRIVER_ID}`).get()).exists;
    record('nettoyage : commande et livreur de test supprimés', orderGone && driverGone);
  }
}

async function testLateRateDetection() {
  const { db } = await import('../lib/admin.mjs');
  const Timestamp = RootTimestamp;
  const { restaurantRates, loadMonitoringSettings } = await import('../../functions/src/admin/pilotage/anomalies.ts');
  const { parisDay } = await import('../../functions/src/admin/pilotage/time.ts');
  const today = parisDay(new Date());
  const addDaysLocal = (day, delta) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };
  await db.doc(`restaurants/${RESTAURANT_ID}`).set({
    name: 'Commerce en retard (test)',
    status: 'active',
    countryId: 'FR',
    cityId: 'longwy',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  // 20 commandes livrées sur 7 jours, 12 en retard (60 %, largement au-dessus du seuil
  // par défaut 25 %) et 0 annulation/refus (pour isoler la nouvelle détection des deux
  // autres, déjà testées par les lots précédents).
  const days = [0, 1, 2].map((i) => addDaysLocal(today, -i));
  const perDay = [8, 6, 6];
  const lateDay = [5, 4, 3];
  await Promise.all(
    days.map((day, i) =>
      db.doc(`restaurants/${RESTAURANT_ID}/dailyStats/${day}`).set({
        day,
        ordersCount: perDay[i],
        deliveredCount: perDay[i],
        cancelledCount: 0,
        rejectedCount: 0,
        lateCount: lateDay[i],
        salesCents: 0,
        netPayoutCents: 0,
        commissionCents: 0,
        discountFundedCents: 0,
        averageBasketCents: 0,
        averagePrepMinutes: 0,
        byMode: {},
        byPayment: {},
        byHour: new Array(24).fill(0),
        newCustomers: 0,
        updatedAt: Timestamp.now(),
      }),
    ),
  );
  try {
    const settings = await loadMonitoringSettings();
    record('seuil par défaut restaurantLateRate = 25 %', settings.restaurantLateRate === 0.25, `restaurantLateRate=${settings.restaurantLateRate}`);
    const candidates = await restaurantRates(settings, today);
    const mine = candidates.find((c) => c.target?.id === RESTAURANT_ID);
    record('restaurantRates() détecte le commerce de test en retard anormal', Boolean(mine), mine ? JSON.stringify(mine.metric) : 'non trouvé');
    if (mine) {
      record('kind = restaurant_late_rate', mine.kind === 'restaurant_late_rate', mine.kind);
      record('dedupKey stable', mine.dedupKey === `restaurant_late_rate_${RESTAURANT_ID}`, mine.dedupKey);
      const totalLate = lateDay.reduce((a, b) => a + b, 0);
      const totalDelivered = perDay.reduce((a, b) => a + b, 0);
      const expected = Math.round((totalLate / totalDelivered) * 1000) / 10;
      record('taux calculé exact (12/20 = 60 %)', mine.metric.value === expected, `value=${mine.metric.value} attendu=${expected}`);
      record('sévérité critique (taux > 2× le seuil)', mine.severity === 'critical', mine.severity);
    }
    const falseCancel = candidates.find((c) => c.target?.id === RESTAURANT_ID && c.kind !== 'restaurant_late_rate');
    record('aucune fausse alerte annulation/refus sur ce commerce (0 annulation/refus fabriquées)', !falseCancel, falseCancel ? JSON.stringify(falseCancel) : 'aucune');
  } finally {
    await Promise.all(days.map((day) => db.doc(`restaurants/${RESTAURANT_ID}/dailyStats/${day}`).delete()));
    await db.doc(`restaurants/${RESTAURANT_ID}`).delete();
    const gone = !(await db.doc(`restaurants/${RESTAURANT_ID}`).get()).exists;
    record('nettoyage : commerce et dailyStats de test supprimés', gone);
  }
}

try {
  await testSearchKeywordsOnAssign();
  await testLateRateDetection();
} finally {
  try {
    rmSync(adcPath, { force: true });
  } catch {}
}

const ok = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} OK`);
process.exit(ok ? 0 : 1);
