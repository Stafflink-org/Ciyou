// Données complémentaires « Super admin : restaurants et clients » (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/a-restaurants-clients.ts
// - indicateurs 30 jours et score de qualité de chaque commerce (metrics30d, qualityBreakdown) ;
// - documents arrivant à expiration (relances J-30 / J-7 visibles dans la file de validation) ;
// - historique de barème de commission (version remplacée) ;
// - avoirs clients (walletTransactions) cohérents avec le solde, signaux de risque, blocage motivé ;
// - notes internes et filtres enregistrés partagés.
// Identifiants stables : relancer le script ne crée pas de doublon. Chaque document porte `seed: true`.
import {
  COLLECTIONS,
  computeQualityScore,
  type InternalNote,
  type RestaurantDailyStats,
  type RestaurantMetrics30d,
  type SavedFilter,
  type WalletTransaction,
} from '@golink/shared';
import { Timestamp } from '@google-cloud/firestore';
import { db } from '../../lib/admin.mjs';

const now = new Date();
const iso = (offsetDays: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAgo = (n: number, hour = 11) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return Timestamp.fromDate(d);
};
const SUPER_ADMIN = 'test-super-admin';

async function seedMetrics(): Promise<number> {
  const restaurants = await db.collection(COLLECTIONS.restaurants).get();
  const from = iso(-29);
  let count = 0;
  for (const r of restaurants.docs) {
    const [stats, issues] = await Promise.all([
      r.ref.collection('dailyStats').where('day', '>=', from).get(),
      db.collection(COLLECTIONS.menuIssues).where('restaurantId', '==', r.id).where('status', '==', 'open').count().get(),
    ]);
    const t = { ordersCount: 0, deliveredCount: 0, cancelledCount: 0, rejectedCount: 0, lateCount: 0, salesCents: 0, commissionCents: 0 };
    stats.docs.forEach((d) => {
      const s = d.data() as RestaurantDailyStats;
      t.ordersCount += s.ordersCount ?? 0;
      t.deliveredCount += s.deliveredCount ?? 0;
      t.cancelledCount += s.cancelledCount ?? 0;
      t.rejectedCount += s.rejectedCount ?? 0;
      t.lateCount += s.lateCount ?? 0;
      t.salesCents += s.salesCents ?? 0;
      t.commissionCents += s.commissionCents ?? 0;
    });
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) : 0);
    const metrics: Omit<RestaurantMetrics30d, 'computedAt'> & { computedAt: Timestamp } = {
      from,
      ...t,
      cancelRateBps: rate(t.cancelledCount, t.ordersCount),
      rejectRateBps: rate(t.rejectedCount, t.ordersCount),
      lateRateBps: rate(t.lateCount, Math.max(1, t.deliveredCount)),
      openMenuIssues: issues.data().count,
      computedAt: Timestamp.now(),
    };
    const rating = (r.get('rating') as { average: number; count: number } | undefined) ?? { average: 0, count: 0 };
    const { score, breakdown } = computeQualityScore({
      ordersCount: t.ordersCount,
      cancelRateBps: metrics.cancelRateBps,
      rejectRateBps: metrics.rejectRateBps,
      lateRateBps: metrics.lateRateBps,
      ratingAverage: rating.average,
      ratingCount: rating.count,
      openMenuIssues: metrics.openMenuIssues,
    });
    await r.ref.update({ metrics30d: metrics, qualityBreakdown: breakdown, qualityScore: score });
    count += 1;
  }
  return count;
}

async function seedExpiringDocuments(): Promise<void> {
  // Pièce d'identité du gérant du Petit Pho : expire dans 24 jours (1re relance faite).
  await db.doc(`${COLLECTIONS.partnerDocuments}/le-petit-pho-manager_id`).set({ expiresAt: iso(24), remindersSent: 1, lastReminderAt: daysAgo(6), seed: true }, { merge: true });
  // Attestation hygiène de Santo Smash : expire dans 5 jours (2e relance faite).
  await db.doc(`${COLLECTIONS.partnerDocuments}/santo-smash-hygiene_certificate`).set({ expiresAt: iso(5), remindersSent: 2, lastReminderAt: daysAgo(2), seed: true }, { merge: true });
}

async function seedCommissionHistory(): Promise<void> {
  const ref = db.doc(`${COLLECTIONS.commissionRules}/arc-kumo-2026-03`);
  await ref.set({
    scope: 'restaurant',
    scopeId: 'kumo-ramen',
    countryId: 'LU',
    platformDeliveryBps: 2800,
    restaurantDeliveryBps: 1500,
    pickupBps: 1200,
    validFrom: daysAgo(190),
    validTo: daysAgo(60),
    reason: 'Offre de lancement au Luxembourg (6 mois)',
    supersedesId: null,
    createdAt: daysAgo(190),
    createdBy: SUPER_ADMIN,
    updatedAt: daysAgo(60),
    updatedBy: SUPER_ADMIN,
    seed: true,
  });
  await db.doc(`${COLLECTIONS.commissionRules}/negocie-kumo`).set({ supersedesId: 'arc-kumo-2026-03' }, { merge: true });
}

async function seedWallets(): Promise<void> {
  const entries: Array<{ id: string; tx: WalletTransaction }> = [
    {
      id: 'arc-wallet-004-1',
      tx: { userId: 'seed-client-004', type: 'credit', amountCents: 500, balanceAfterCents: 500, reason: 'commercial_gesture', note: 'Livraison arrivée froide, geste du support', createdAt: daysAgo(9), createdBy: SUPER_ADMIN, expiresAt: daysAgo(-170) },
    },
    {
      id: 'arc-wallet-012-1',
      tx: { userId: 'seed-client-012', type: 'credit', amountCents: 800, balanceAfterCents: 800, reason: 'late_delivery', note: 'Retard de 35 minutes', createdAt: daysAgo(21), createdBy: SUPER_ADMIN, expiresAt: daysAgo(-160) },
    },
    {
      id: 'arc-wallet-012-2',
      tx: { userId: 'seed-client-012', type: 'debit', amountCents: -800, balanceAfterCents: 0, reason: 'order_payment', note: 'Utilisé sur une commande', createdAt: daysAgo(14), createdBy: 'seed-client-012' },
    },
  ];
  for (const { id, tx } of entries) await db.doc(`${COLLECTIONS.walletTransactions}/${id}`).set({ ...tx, seed: true });
  await db.doc(`${COLLECTIONS.users}/seed-client-004`).set({ walletBalanceCents: 500 }, { merge: true });
  await db.doc(`${COLLECTIONS.users}/seed-client-012`).set({ walletBalanceCents: 0 }, { merge: true });
}

async function seedRisk(): Promise<void> {
  await db
    .doc(`${COLLECTIONS.userPrivate}/seed-client-021`)
    .set({ riskScore: 72, riskFlags: ['repeated_claims', 'refund_rate'], updatedAt: Timestamp.now(), seed: true }, { merge: true });
  await db
    .doc(`${COLLECTIONS.users}/seed-client-017`)
    .set({ status: 'blocked', blockedReason: 'Réclamations abusives répétées (photos réutilisées)', blockedAt: daysAgo(12), blockedBy: SUPER_ADMIN }, { merge: true });
}

async function seedNotesAndFilters(): Promise<void> {
  const notes: Array<{ id: string; note: InternalNote }> = [
    {
      id: 'arc-note-maison-pita',
      note: {
        target: { type: 'restaurant', id: 'maison-pita', label: 'Maison Pita' },
        body: 'Gérant rappelé : Kbis de moins de 3 mois à redéposer si le premier est refusé. Ouverture prévue début octobre.',
        pinned: true,
        authorId: SUPER_ADMIN,
        authorName: 'Équipe partenaires',
        createdAt: daysAgo(1, 15),
        updatedAt: daysAgo(1, 15),
      },
    },
    {
      id: 'arc-note-client-021',
      note: {
        target: { type: 'client', id: 'seed-client-021', label: null },
        body: 'Trois réclamations « article manquant » en deux semaines, photos identiques. À surveiller avant tout nouvel avoir.',
        pinned: false,
        authorId: SUPER_ADMIN,
        authorName: 'Support',
        createdAt: daysAgo(3, 10),
        updatedAt: daysAgo(3, 10),
      },
    },
  ];
  for (const { id, note } of notes) await db.doc(`${COLLECTIONS.internalNotes}/${id}`).set({ ...note, seed: true });
  const filters: Array<{ id: string; filter: SavedFilter }> = [
    { id: 'arc-filtre-accompagner', filter: { ownerId: SUPER_ADMIN, entity: 'restaurants', name: 'Commerces à accompagner', filters: { quality: 'coach' }, shared: true, createdAt: daysAgo(5) } },
    { id: 'arc-filtre-allergenes', filter: { ownerId: SUPER_ADMIN, entity: 'restaurants', name: 'Allergènes incomplets', filters: { allergens: 'incomplete' }, shared: true, createdAt: daysAgo(5) } },
  ];
  for (const { id, filter } of filters) await db.doc(`${COLLECTIONS.savedFilters}/${id}`).set({ ...filter, seed: true });
}

async function main() {
  const metrics = await seedMetrics();
  await seedExpiringDocuments();
  await seedCommissionHistory();
  await seedWallets();
  await seedRisk();
  await seedNotesAndFilters();
  console.log(`Restaurants et clients : ${metrics} commerces calculés, documents, barèmes, avoirs, risques, notes et filtres à jour.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
