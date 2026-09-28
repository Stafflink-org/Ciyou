// Agrégats de la plateforme (statsDaily) : chaque écriture de commande met la ville
// et le jour concernés en file (statsQueue) ; une tâche chaque minute recalcule les
// villes en file, puis les pays et la plateforme par somme des villes. Une passe de
// nuit consolide la veille (nouveaux commerces et livreurs, support, abonnements).
import { COLLECTIONS, type DailyStats, type Invoice, type Order, type OrderFinancials, type SupportTicket } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { callable } from '../../lib/callable';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { z } from '../../lib/validation';
import { PILOTAGE_RUNTIME } from './runtime';
import { loadMarkets } from './scope';
import { computeCityStats, emptyStats, statsDocId, sumStats, type StatsDoc } from './stats-compute';
import { addDays, dayBounds, dayKey, parisClock, parisDay, TIMEZONE } from './time';

type PlatformPart = OrderFinancials['settlement']['platform'];

interface QueueEntry {
  cityId: string;
  day: string;
  queuedAt: FirebaseFirestore.Timestamp;
}

function statsChanged(before: Order | undefined, after: Order | undefined): boolean {
  if (!before || !after) return true;
  return (
    before.status !== after.status ||
    before.amounts?.refundedCents !== after.amounts?.refundedCents ||
    before.flags?.late !== after.flags?.late ||
    before.amounts?.totalCents !== after.amounts?.totalCents
  );
}

/** Met en file le recalcul de la ville et du jour d'une commande (idempotent). */
export const onOrderWrittenPlatformStats = onDocumentWritten(
  { document: 'orders/{orderId}', retry: false, ...PILOTAGE_RUNTIME },
  async (event) => {
    const before = event.data?.before.data() as Order | undefined;
    const after = event.data?.after.data() as Order | undefined;
    const order = after ?? before;
    if (!order?.cityId || !order.createdAt || !statsChanged(before, after)) return;
    const day = parisDay(order.createdAt.toDate());
    await db
      .collection(COLLECTIONS.statsQueue)
      .doc(`${order.cityId}_${dayKey(day)}`)
      .set({ cityId: order.cityId, day, queuedAt: FieldValue.serverTimestamp() });
  },
);

async function loadFinancials(orders: Array<Order & { id: string }>): Promise<Map<string, PlatformPart>> {
  const delivered = orders.filter((o) => o.status === 'delivered');
  const map = new Map<string, PlatformPart>();
  for (let i = 0; i < delivered.length; i += 200) {
    const refs = delivered.slice(i, i + 200).map((o) => db.collection(COLLECTIONS.orderFinancials).doc(o.id));
    if (!refs.length) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const fin = snap.data() as OrderFinancials | undefined;
      if (fin?.settlement?.platform) map.set(snap.id, fin.settlement.platform);
    }
  }
  return map;
}

/** Champs non dérivables des commandes, calculés lors de la consolidation de nuit. */
export async function externalFields(cityId: string, day: string): Promise<Partial<StatsDoc>> {
  const { start, end } = dayBounds(day);
  const inDay = (ts: { toMillis(): number } | null | undefined) => Boolean(ts && ts.toMillis() >= start.getTime() && ts.toMillis() < end.getTime());
  const [restaurants, drivers, tickets, invoices] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).where('cityId', '==', cityId).select('createdAt').get(),
    db.collection(COLLECTIONS.drivers).where('cityId', '==', cityId).select('createdAt').get(),
    db
      .collection(COLLECTIONS.supportTickets)
      .where('cityId', '==', cityId)
      .where('createdAt', '>=', Timestamp.fromDate(addDaysDate(start, -30)))
      .select('createdAt', 'resolvedAt')
      .get(),
    // « Abonnements encaissés » : seules les factures réellement payées comptent, à la date du paiement.
    db
      .collection(COLLECTIONS.invoices)
      .where('paidAt', '>=', Timestamp.fromDate(start))
      .where('paidAt', '<', Timestamp.fromDate(end))
      .orderBy('paidAt', 'desc')
      .get(),
  ]);
  let opened = 0;
  let resolved = 0;
  let resolutionSum = 0;
  for (const doc of tickets.docs) {
    const t = doc.data() as Pick<SupportTicket, 'createdAt' | 'resolvedAt'>;
    if (inDay(t.createdAt)) opened += 1;
    if (t.resolvedAt && inDay(t.resolvedAt)) {
      resolved += 1;
      resolutionSum += (t.resolvedAt.toMillis() - t.createdAt.toMillis()) / 60_000;
    }
  }
  // Factures d'abonnement : rattachées à la ville, sinon au restaurant destinataire.
  const restaurantIds = new Set(restaurants.docs.map((d) => d.id));
  const isSubscriptionLine = (label: string) => /^(abonnement|offre spéciale)/i.test(label.trim());
  const subscriptions = invoices.docs
    .map((doc) => doc.data() as Invoice)
    .filter((inv) => inv.status === 'paid' && (inv.cityId === cityId || (!inv.cityId && inv.recipient?.type === 'restaurant' && restaurantIds.has(inv.recipient.id))))
    .reduce((sum, inv) => {
      if (inv.kind === 'subscription_invoice') return sum + inv.totalHtCents;
      // Facture mensuelle : seule la part abonnement (lignes « Abonnement » et offres spéciales) est un abonnement encaissé.
      if (inv.kind === 'commission_invoice') return sum + inv.lines.filter((l) => isSubscriptionLine(l.label)).reduce((s, l) => s + l.htCents, 0);
      return sum;
    }, 0);
  return {
    actors: {
      restaurantsNew: restaurants.docs.filter((d) => inDay(d.get('createdAt'))).length,
      driversNew: drivers.docs.filter((d) => inDay(d.get('createdAt'))).length,
      restaurantsActive: 0,
      customersNew: 0,
      customersActive: 0,
      driversOnlinePeak: 0,
    },
    support: { ticketsOpened: opened, ticketsResolved: resolved, averageResolutionMinutes: resolved ? Math.round(resolutionSum / resolved) : 0 },
    revenue: { subscriptionsHtCents: subscriptions } as StatsDoc['revenue'],
  };
}

function addDaysDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Recalcule l'agrégat d'une ville pour un jour. `external` : champs consolidés à fusionner. */
export async function recomputeCity(cityId: string, day: string, external?: Partial<StatsDoc> | null): Promise<void> {
  const markets = await loadMarkets();
  const city = markets.cities.get(cityId);
  const { start, end } = dayBounds(day);
  const snap = await db
    .collection(COLLECTIONS.orders)
    .where('cityId', '==', cityId)
    .where('createdAt', '>=', Timestamp.fromDate(start))
    .where('createdAt', '<', Timestamp.fromDate(end))
    .orderBy('createdAt', 'desc')
    .get();
  const orders = snap.docs.map((doc) => ({ ...(doc.data() as Order), id: doc.id }));
  const financials = await loadFinancials(orders);
  const ref = db.collection(COLLECTIONS.statsDaily).doc(statsDocId('city', cityId, day));
  const previousSnap = await ref.get();
  const previous = (previousSnap.data() as Partial<StatsDoc> | undefined) ?? null;
  const merged: Partial<StatsDoc> | null = external
    ? {
        ...previous,
        actors: { ...(previous?.actors ?? ({} as StatsDoc['actors'])), restaurantsNew: external.actors?.restaurantsNew ?? 0, driversNew: external.actors?.driversNew ?? 0 },
        support: external.support ?? previous?.support,
        revenue: { ...(previous?.revenue ?? ({} as StatsDoc['revenue'])), subscriptionsHtCents: external.revenue?.subscriptionsHtCents ?? previous?.revenue?.subscriptionsHtCents ?? 0 },
      }
    : previous;
  const stats = computeCityStats({
    day,
    cityId,
    countryId: city?.countryId ?? null,
    orders,
    financials,
    hourOf: (date) => parisClock(date).hour,
    previous: merged,
  });
  if (!previousSnap.exists && stats.orders.placed === 0 && !external) return;
  await ref.set({ ...stats, updatedAt: FieldValue.serverTimestamp() });
}

/** Recalcule les agrégats pays et plateforme d'un jour à partir des villes. */
export async function recomputeRollups(day: string): Promise<void> {
  const markets = await loadMarkets();
  const snap = await db.collection(COLLECTIONS.statsDaily).where('scope', '==', 'city').where('day', '==', day).get();
  const cities = snap.docs.map((doc) => doc.data() as StatsDoc);
  const byCountry = new Map<string, StatsDoc[]>();
  for (const stats of cities) {
    const country = stats.countryId ?? markets.cities.get(stats.scopeId)?.countryId;
    if (!country) continue;
    byCountry.set(country, [...(byCountry.get(country) ?? []), stats]);
  }
  const batch = db.batch();
  for (const [countryId, parts] of byCountry) {
    batch.set(db.collection(COLLECTIONS.statsDaily).doc(statsDocId('country', countryId, day)), {
      ...sumStats('country', countryId, day, parts),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (cities.length) {
    batch.set(db.collection(COLLECTIONS.statsDaily).doc(statsDocId('platform', 'all', day)), {
      ...sumStats('platform', 'all', day, cities),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Traite la file : villes à recalculer puis pays et plateforme des jours touchés. */
export const aggregatePlatformStats = onSchedule(
  { schedule: 'every 1 minutes', timeZone: TIMEZONE, retryCount: 0, ...PILOTAGE_RUNTIME, timeoutSeconds: 120 },
  async () => {
    const queue = await db.collection(COLLECTIONS.statsQueue).orderBy('queuedAt', 'asc').limit(40).get();
    if (queue.empty) return;
    const days = new Set<string>();
    for (const doc of queue.docs) {
      const entry = doc.data() as QueueEntry;
      try {
        await recomputeCity(entry.cityId, entry.day);
        days.add(entry.day);
        // Retire l'entrée seulement si aucune nouvelle écriture n'est arrivée pendant le calcul.
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          const queuedAt = fresh.get('queuedAt') as FirebaseFirestore.Timestamp | undefined;
          if (fresh.exists && queuedAt && entry.queuedAt && queuedAt.isEqual(entry.queuedAt)) tx.delete(doc.ref);
        });
      } catch (error) {
        logger.error('Agrégat de ville en échec', { cityId: entry.cityId, day: entry.day, error: error instanceof Error ? error.stack : String(error) });
      }
    }
    for (const day of days) await recomputeRollups(day);
  },
);

/** Consolidation de nuit : veille et avant-veille de toutes les villes, champs externes compris. */
export const refreshPlatformStats = onSchedule(
  { schedule: '30 3 * * *', timeZone: TIMEZONE, retryCount: 1, ...PILOTAGE_RUNTIME, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const markets = await loadMarkets();
    const today = parisDay(new Date());
    for (const day of [addDays(today, -2), addDays(today, -1)]) {
      for (const city of markets.cities.values()) {
        try {
          await recomputeCity(city.id, day, await externalFields(city.id, day));
        } catch (error) {
          logger.error('Consolidation de ville en échec', { cityId: city.id, day, error: error instanceof Error ? error.stack : String(error) });
        }
      }
      await recomputeRollups(day);
    }
  },
);

/** Relève le nombre de livreurs en ligne par ville (maximum par heure) dans l'agrégat du jour. */
export async function sampleDriversOnline(): Promise<void> {
  const now = new Date();
  const day = parisDay(now);
  const hour = parisClock(now).hour;
  const drivers = await db.collection(COLLECTIONS.drivers).where('availability', 'in', ['online', 'on_delivery']).select('cityId').get();
  const counts = new Map<string, number>();
  for (const doc of drivers.docs) {
    const cityId = doc.get('cityId') as string | undefined;
    if (cityId) counts.set(cityId, (counts.get(cityId) ?? 0) + 1);
  }
  const markets = await loadMarkets();
  for (const city of markets.cities.values()) {
    const online = counts.get(city.id) ?? 0;
    const ref = db.collection(COLLECTIONS.statsDaily).doc(statsDocId('city', city.id, day));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        if (online === 0) return;
        // Pas encore de commande aujourd'hui : agrégat vide portant le relevé des livreurs.
        const empty = emptyStats('city', city.id, day, city.id, city.countryId);
        empty.driversOnlineByHour![hour] = online;
        empty.actors.driversOnlinePeak = online;
        tx.set(ref, { ...empty, updatedAt: FieldValue.serverTimestamp() });
        return;
      }
      const data = snap.data() as DailyStats;
      const byHour = data.driversOnlineByHour?.length === 24 ? [...data.driversOnlineByHour] : Array.from({ length: 24 }, () => 0);
      byHour[hour] = Math.max(byHour[hour] ?? 0, online);
      tx.update(ref, { driversOnlineByHour: byHour, 'actors.driversOnlinePeak': Math.max(data.actors?.driversOnlinePeak ?? 0, online) });
    });
  }
}

// ------------------------------------------------------------------ Tunnel de commande (§3)

/**
 * Collecte réelle des trois premières étapes du tunnel (ouverture de l'app, fiche
 * commerce vue, ajout au panier) : à appeler par l'application cliente. Les deux
 * dernières étapes (paiement lancé, payé) sont dérivées directement des commandes
 * (`stats-compute.ts`), pas de cet appel. Contrat détaillé dans
 * docs/CONTRATS_APPS_MOBILES.md. Anonyme et tolérant (jamais bloquant pour le client).
 */
export const trackFunnelEvent = callable(
  z.object({
    event: z.enum(['app_open', 'restaurant_view', 'add_to_cart']),
    countryId: z.string().trim().regex(/^[A-Z]{2}$/),
    cityId: z.string().trim().min(1).max(64),
  }),
  async (data) => {
    const field = data.event === 'app_open' ? 'appOpens' : data.event === 'restaurant_view' ? 'restaurantViews' : 'addToCart';
    const day = parisDay(new Date());
    const targets = [
      { scope: 'city' as const, scopeId: data.cityId, cityId: data.cityId, countryId: data.countryId },
      { scope: 'country' as const, scopeId: data.countryId, cityId: null, countryId: data.countryId },
      { scope: 'platform' as const, scopeId: 'all', cityId: null, countryId: null },
    ];
    await Promise.all(
      targets.map((t) =>
        db
          .collection(COLLECTIONS.statsDaily)
          .doc(statsDocId(t.scope, t.scopeId, day))
          .set(
            { scope: t.scope, scopeId: t.scopeId, day, cityId: t.cityId, countryId: t.countryId, funnel: { [field]: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          )
          .catch((error) => logger.warn('Événement du tunnel non compté', { event: data.event, error: String(error) })),
      ),
    );
    return { ok: true as const };
  },
);
