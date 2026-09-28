// Données complémentaires des rubriques « Argent » du super admin (exécution seule,
// idempotente, identifiants stables, `seed: true`) :
//   npx tsx scripts/seed/only/a-argent.ts            (écrit)
//   npx tsx scripts/seed/only/a-argent.ts --dry-run  (affiche sans écrire)
//
// 1. Règles de relance des impayés (settings/dunning) si absentes.
// 2. Historique de barèmes de commission (versions closes : lancement, négociation échue).
// 3. Abonnement avec résiliation programmée et abonnement résilié (cycle de vie).
// 4. Blocage de reversement levé (historique des blocages).
// 5. Ajustements manuels motivés rattachés aux reversements programmés de la semaine
//    (le net du reversement est recalculé en conséquence).
import { Timestamp } from '@google-cloud/firestore';
import {
  COLLECTIONS,
  DEFAULT_DUNNING_SETTINGS,
  SETTINGS_DOCS,
  type CommissionRule,
  type LedgerEntry,
  type Payout,
  type PayoutHold,
  type Subscription,
} from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';

const DRY_RUN = process.argv.includes('--dry-run');
const DAY = 86_400_000;
const SEED = { seed: true, seedModule: 'a-argent' } as const;

function ts(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

function parisDay(ms: number): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

async function main(): Promise<void> {
  const finance = account('finance').uid;
  const superAdmin = account('superAdmin').uid;
  const now = Date.now();
  const writes: Array<{ path: string; data: Record<string, unknown>; merge?: boolean; onlyIfMissing?: boolean }> = [];

  // 1. Relances
  writes.push({
    path: `${COLLECTIONS.settings}/${SETTINGS_DOCS.dunning}`,
    data: { ...DEFAULT_DUNNING_SETTINGS, updatedAt: ts(now), updatedBy: superAdmin, ...SEED },
    onlyIfMissing: true,
  });

  // 2. Barèmes historiques (clos)
  const rules: Array<{ id: string; rule: CommissionRule & Record<string, unknown> }> = [
    {
      id: 'lancement-fr-2026',
      rule: {
        scope: 'country',
        scopeId: 'FR',
        countryId: 'FR',
        platformDeliveryBps: 3200,
        restaurantDeliveryBps: 1600,
        pickupBps: 1300,
        validFrom: ts(now - 150 * DAY),
        validTo: ts(now - 120 * DAY),
        reason: 'Barème d’ouverture des premières villes (phase pilote)',
        supersedesId: null,
        scopeLabel: 'France',
        createdAt: ts(now - 150 * DAY),
        createdBy: superAdmin,
        updatedAt: ts(now - 120 * DAY),
        updatedBy: superAdmin,
      },
    },
    {
      id: 'negocie-kumo-lancement',
      rule: {
        scope: 'restaurant',
        scopeId: 'kumo-ramen',
        countryId: 'LU',
        platformDeliveryBps: 2000,
        restaurantDeliveryBps: 1200,
        pickupBps: 1000,
        validFrom: ts(now - 110 * DAY),
        validTo: ts(now - 60 * DAY),
        reason: 'Offre de lancement négociée pour trois mois (premier commerce de Luxembourg)',
        supersedesId: null,
        scopeLabel: 'Kumo Ramen',
        cityId: 'luxembourg',
        createdAt: ts(now - 110 * DAY),
        createdBy: finance,
        updatedAt: ts(now - 60 * DAY),
        updatedBy: finance,
      },
    },
    {
      id: 'negocie-santo-ete',
      rule: {
        scope: 'restaurant',
        scopeId: 'santo-smash',
        countryId: 'FR',
        platformDeliveryBps: 2500,
        restaurantDeliveryBps: 1300,
        pickupBps: 1000,
        validFrom: ts(now - 90 * DAY),
        validTo: ts(now - 30 * DAY),
        reason: 'Remise estivale accordée par l’équipe commerciale (volume garanti)',
        supersedesId: null,
        scopeLabel: 'Santo Smash',
        cityId: 'metz',
        createdAt: ts(now - 90 * DAY),
        createdBy: finance,
        updatedAt: ts(now - 30 * DAY),
        updatedBy: finance,
      },
    },
  ];
  for (const { id, rule } of rules) writes.push({ path: `${COLLECTIONS.commissionRules}/${id}`, data: { ...rule, ...SEED } });

  // 3. Cycle de vie : résiliation programmée (Le Petit Pho) et abonnement résilié (Santo Smash).
  const petitPho = await db.doc(`${COLLECTIONS.subscriptions}/sub-le-petit-pho`).get();
  if (petitPho.exists) {
    const sub = petitPho.data() as Subscription;
    const already = (sub.history ?? []).some((h) => h.event === 'cancel_scheduled');
    if (!already) {
      writes.push({
        path: `${COLLECTIONS.subscriptions}/sub-le-petit-pho`,
        merge: true,
        data: {
          cancelAtPeriodEnd: true,
          cancelReason: 'Fermeture estivale prolongée : le commerce repasse sur la formule gratuite',
          history: [...(sub.history ?? []), { at: ts(now - 4 * DAY), event: 'cancel_scheduled', planCode: sub.planCode, by: finance, reason: 'Demande du gérant par téléphone' }],
          updatedAt: ts(now - 4 * DAY),
          updatedBy: finance,
        },
      });
    }
  }
  const cancelled: Subscription & Record<string, unknown> = {
    subscriberType: 'restaurant',
    subscriberId: 'santo-smash',
    restaurantIds: ['santo-smash'],
    planCode: 'pro',
    status: 'cancelled',
    billingCycle: 'monthly',
    priceHtCents: 4900,
    trialEndsAt: ts(now - 120 * DAY),
    currentPeriodStart: ts(now - 70 * DAY),
    currentPeriodEnd: ts(now - 40 * DAY),
    cancelAtPeriodEnd: false,
    cancelledAt: ts(now - 40 * DAY),
    cancelReason: 'Le commerce préfère rester sur la formule gratuite (volume insuffisant)',
    specialOffer: null,
    dunning: { attempts: 0, lastAttemptAt: null, nextRetryAt: null, restrictedAt: null },
    history: [
      { at: ts(now - 150 * DAY), event: 'created', planCode: 'pro', by: finance, reason: 'Essai Pro de 30 jours' },
      { at: ts(now - 55 * DAY), event: 'cancel_scheduled', planCode: 'pro', by: finance, reason: 'Demande du commerce' },
      { at: ts(now - 40 * DAY), event: 'cancelled', planCode: 'pro', by: 'system', reason: 'Résiliation en fin de période' },
    ],
    stripeSubscriptionId: null,
    pendingChange: null,
    countryId: 'FR',
    cityId: 'metz',
    createdAt: ts(now - 150 * DAY),
    createdBy: finance,
    updatedAt: ts(now - 40 * DAY),
    updatedBy: 'system',
  };
  writes.push({ path: `${COLLECTIONS.subscriptions}/sub-santo-smash-2026`, data: { ...cancelled, ...SEED } });

  // 4. Blocage levé
  const released: PayoutHold & Record<string, unknown> = {
    beneficiaryType: 'restaurant',
    beneficiaryId: 'le-petit-pho',
    beneficiaryName: 'Le Petit Pho',
    countryId: 'FR',
    cityId: 'metz',
    reason: 'dispute',
    details: 'Contestation bancaire d’un client sur la commande GL-10412 (débit en double).',
    active: false,
    releasedAt: ts(now - 18 * DAY),
    releasedBy: finance,
    releaseReason: 'Litige clos en faveur du commerce (justificatif de la banque reçu).',
    createdAt: ts(now - 25 * DAY),
    createdBy: finance,
    updatedAt: ts(now - 18 * DAY),
    updatedBy: finance,
  };
  writes.push({ path: `${COLLECTIONS.payoutHolds}/blocage-le-petit-pho-litige`, data: { ...released, ...SEED } });

  // 5. Ajustements rattachés aux reversements programmés
  const adjustments: Array<{ id: string; payoutId: string; accountType: 'restaurant' | 'driver'; accountId: string; amountCents: number; description: string; reason: string }> = [
    { id: 'aj-mina-kitchen-geste', payoutId: 'po-r-mina-kitchen-2026-09-21', accountType: 'restaurant', accountId: 'mina-kitchen', amountCents: 1500, description: 'Geste commercial : panne de la tablette de commandes', reason: 'Commandes perdues le 22 septembre pendant 40 minutes (incident GoLink)' },
    { id: 'aj-onda-pasta-sacs', payoutId: 'po-r-onda-pasta-club-2026-09-21', accountType: 'restaurant', accountId: 'onda-pasta-club', amountCents: -1200, description: 'Sacs isothermes GoLink (lot de 10)', reason: 'Commande de matériel validée par le gérant' },
  ];
  for (const a of adjustments) {
    const payoutRef = db.doc(`${COLLECTIONS.payouts}/${a.payoutId}`);
    const [payoutSnap, entrySnap] = await Promise.all([payoutRef.get(), db.doc(`${COLLECTIONS.ledgerEntries}/${a.id}`).get()]);
    if (!payoutSnap.exists || entrySnap.exists) continue;
    const payout = payoutSnap.data() as Payout;
    if (payout.status !== 'scheduled') continue;
    const entry: LedgerEntry & Record<string, unknown> = {
      countryId: payout.countryId,
      cityId: payout.cityId ?? null,
      accountType: a.accountType,
      accountId: a.accountId,
      type: 'manual_adjustment',
      amountCents: a.amountCents,
      currency: 'EUR',
      vatCents: null,
      orderId: null,
      payoutId: a.payoutId,
      description: a.description,
      reason: a.reason,
      bookingDate: parisDay(now - DAY),
      createdAt: ts(now - DAY),
      createdBy: finance,
      ...SEED,
    };
    writes.push({ path: `${COLLECTIONS.ledgerEntries}/${a.id}`, data: entry });
    writes.push({
      path: `${COLLECTIONS.payouts}/${a.payoutId}`,
      merge: true,
      data: { adjustmentsCents: payout.adjustmentsCents + a.amountCents, netCents: payout.netCents + a.amountCents, entriesCount: payout.entriesCount + 1, updatedAt: ts(now) },
    });
  }

  if (DRY_RUN) {
    for (const w of writes) console.log('  ·', w.path, w.onlyIfMissing ? '(si absent)' : w.merge ? '(fusion)' : '');
    return;
  }
  const batch = db.batch();
  let count = 0;
  for (const w of writes) {
    if (w.onlyIfMissing && (await db.doc(w.path).get()).exists) continue;
    if (w.merge) batch.set(db.doc(w.path), w.data, { merge: true });
    else batch.set(db.doc(w.path), w.data);
    count += 1;
  }
  await batch.commit();
  console.log(`${count} documents écrits.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
