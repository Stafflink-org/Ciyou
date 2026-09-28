// Données complémentaires « Pilotage » du super admin (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/a-pilotage.ts            (écrit)
//   npx tsx scripts/seed/only/a-pilotage.ts --dry-run  (affiche sans écrire)
//
// 1. Recalcule statsDaily (villes, pays, plateforme) jour par jour à partir des
//    commandes réelles, avec le même calcul que les Cloud Functions : heures de
//    pointe, délais, marge, nouveaux commerces et livreurs, support, abonnements.
//    Le tunnel de commande existant est conservé ; le relevé des livreurs en ligne
//    par heure est reconstitué quand il manque (démonstration offre / demande).
// 2. Seuils de surveillance (settings/monitoring) s'ils n'existent pas.
// 3. Rapports programmés de démonstration (identifiants stables, `seed: true`).
// 4. Historique d'exports de démonstration (bulkJobs, `seed: true`).
import { Timestamp } from '@google-cloud/firestore';
import {
  COLLECTIONS,
  DEFAULT_MONITORING_SETTINGS,
  SETTINGS_DOCS,
  type City,
  type Invoice,
  type Order,
  type OrderFinancials,
  type ScheduledReport,
  type SupportTicket,
} from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';
import { computeCityStats, statsDocId, sumStats, type StatsDoc } from '../../../functions/src/admin/pilotage/stats-compute';
import { nextReportRun, parisClock, parisDay } from '../../../functions/src/admin/pilotage/time';

const DRY_RUN = process.argv.includes('--dry-run');
type PlatformPart = OrderFinancials['settlement']['platform'];

async function commit(writes: Array<{ path: string; data: Record<string, unknown>; merge?: boolean }>): Promise<void> {
  if (DRY_RUN) {
    for (const w of writes.slice(0, 5)) console.log('  ·', w.path);
    if (writes.length > 5) console.log(`  … ${writes.length - 5} autres`);
    return;
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      if (w.merge) batch.set(db.doc(w.path), w.data, { merge: true });
      else batch.set(db.doc(w.path), w.data);
    }
    await batch.commit();
  }
}

/** Relevé plausible des livreurs en ligne par heure, déduit des commandes (démonstration). */
function syntheticDriversByHour(byHour: number[], seed: number): number[] {
  return byHour.map((orders, hour) => {
    const service = (hour >= 11 && hour <= 14) || (hour >= 18 && hour <= 22);
    if (!service && orders === 0) return 0;
    const base = service ? 2 : 1;
    const jitter = ((seed * 31 + hour * 17) % 3) - 1;
    return Math.max(0, Math.round(orders / 1.6) + base + jitter);
  });
}

async function rebuildStats(): Promise<void> {
  console.log('1. Agrégats statsDaily…');
  const [citiesSnap, ordersSnap, finSnap, restaurantsSnap, driversSnap, ticketsSnap, invoicesSnap, existingSnap] = await Promise.all([
    db.collection(COLLECTIONS.cities).get(),
    db.collection(COLLECTIONS.orders).get(),
    db.collection(COLLECTIONS.orderFinancials).get(),
    db.collection(COLLECTIONS.restaurants).select('cityId', 'createdAt').get(),
    db.collection(COLLECTIONS.drivers).select('cityId', 'createdAt').get(),
    db.collection(COLLECTIONS.supportTickets).select('cityId', 'createdAt', 'resolvedAt').get(),
    db.collection(COLLECTIONS.invoices).where('kind', '==', 'subscription_invoice').get(),
    db.collection(COLLECTIONS.statsDaily).where('scope', '==', 'city').get(),
  ]);
  const cities = new Map(citiesSnap.docs.map((d) => [d.id, d.data() as City]));
  const financials = new Map<string, PlatformPart>();
  for (const doc of finSnap.docs) {
    const fin = doc.data() as OrderFinancials;
    if (fin.settlement?.platform) financials.set(doc.id, fin.settlement.platform);
  }
  const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data() as StatsDoc]));
  const restaurantCity = new Map(restaurantsSnap.docs.map((d) => [d.id, d.get('cityId') as string]));

  // Commandes groupées par ville et par jour (heure de Paris).
  const groups = new Map<string, Array<Order & { id: string }>>();
  for (const doc of ordersSnap.docs) {
    const order = { ...(doc.data() as Order), id: doc.id };
    if (!order.cityId || !order.createdAt) continue;
    const key = `${order.cityId}|${parisDay(order.createdAt.toDate())}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  const countBy = (docs: FirebaseFirestore.QueryDocumentSnapshot[], field = 'createdAt') => {
    const map = new Map<string, number>();
    for (const d of docs) {
      const ts = d.get(field) as Timestamp | undefined;
      const cityId = d.get('cityId') as string | undefined;
      if (!ts || !cityId) continue;
      const key = `${cityId}|${parisDay(ts.toDate())}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const restaurantsNew = countBy(restaurantsSnap.docs);
  const driversNew = countBy(driversSnap.docs);
  const ticketsOpened = countBy(ticketsSnap.docs);
  const resolved = new Map<string, { count: number; minutes: number }>();
  for (const d of ticketsSnap.docs) {
    const t = d.data() as Pick<SupportTicket, 'cityId' | 'createdAt' | 'resolvedAt'>;
    if (!t.resolvedAt || !t.cityId) continue;
    const key = `${t.cityId}|${parisDay(t.resolvedAt.toDate())}`;
    const entry = resolved.get(key) ?? { count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += (t.resolvedAt.toMillis() - t.createdAt.toMillis()) / 60_000;
    resolved.set(key, entry);
  }
  const subscriptions = new Map<string, number>();
  for (const d of invoicesSnap.docs) {
    const inv = d.data() as Invoice;
    const cityId = inv.cityId ?? (inv.recipient?.type === 'restaurant' ? restaurantCity.get(inv.recipient.id) : undefined);
    if (!cityId || !inv.issuedAt) continue;
    const key = `${cityId}|${parisDay(inv.issuedAt.toDate())}`;
    subscriptions.set(key, (subscriptions.get(key) ?? 0) + inv.totalHtCents);
  }

  const keys = new Set([...groups.keys(), ...restaurantsNew.keys(), ...driversNew.keys(), ...ticketsOpened.keys()]);
  const cityDocs: StatsDoc[] = [];
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const now = Timestamp.now();
  let index = 0;
  for (const key of [...keys].sort()) {
    const [cityId, day] = key.split('|') as [string, string];
    const city = cities.get(cityId);
    if (!city) continue;
    const previous = existing.get(statsDocId('city', cityId, day)) ?? null;
    const r = resolved.get(key);
    const merged: Partial<StatsDoc> = {
      ...(previous ?? {}),
      actors: {
        restaurantsActive: 0,
        customersNew: 0,
        customersActive: 0,
        restaurantsNew: restaurantsNew.get(key) ?? 0,
        driversNew: driversNew.get(key) ?? 0,
        driversOnlinePeak: previous?.actors?.driversOnlinePeak ?? 0,
      },
      support: {
        ticketsOpened: ticketsOpened.get(key) ?? 0,
        ticketsResolved: r?.count ?? 0,
        averageResolutionMinutes: r?.count ? Math.round(r.minutes / r.count) : 0,
      },
      revenue: { ...(previous?.revenue ?? ({} as StatsDoc['revenue'])), subscriptionsHtCents: subscriptions.get(key) ?? 0 },
    };
    const stats = computeCityStats({
      day,
      cityId,
      countryId: city.countryId,
      orders: groups.get(key) ?? [],
      financials,
      hourOf: (date) => parisClock(date).hour,
      previous: merged,
    });
    // Tunnel (Firebase Analytics) : conservé ; à défaut, reconstitué à partir des commandes pour la démonstration.
    if (!previous?.funnel || previous.funnel.appOpens === 0) {
      const placed = stats.orders.placed;
      stats.funnel = { appOpens: placed * 11, restaurantViews: placed * 6, addToCart: Math.round(placed * 2.1), checkoutStarted: Math.round(placed * 1.35), paid: placed };
    }
    if (!(stats.driversOnlineByHour ?? []).some((n) => n > 0) && stats.orders.placed > 0) {
      stats.driversOnlineByHour = syntheticDriversByHour(stats.orders.byHour, index);
      stats.actors.driversOnlinePeak = Math.max(...stats.driversOnlineByHour);
    }
    index += 1;
    cityDocs.push(stats);
    writes.push({ path: `${COLLECTIONS.statsDaily}/${statsDocId('city', cityId, day)}`, data: { ...stats, seed: true, updatedAt: now } });
  }

  const byDay = new Map<string, StatsDoc[]>();
  for (const s of cityDocs) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  for (const [day, parts] of byDay) {
    const byCountry = new Map<string, StatsDoc[]>();
    for (const p of parts) byCountry.set(p.countryId ?? 'FR', [...(byCountry.get(p.countryId ?? 'FR') ?? []), p]);
    for (const [countryId, list] of byCountry) {
      writes.push({ path: `${COLLECTIONS.statsDaily}/${statsDocId('country', countryId, day)}`, data: { ...sumStats('country', countryId, day, list), seed: true, updatedAt: now } });
    }
    writes.push({ path: `${COLLECTIONS.statsDaily}/${statsDocId('platform', 'all', day)}`, data: { ...sumStats('platform', 'all', day, parts), seed: true, updatedAt: now } });
  }
  console.log(`   ${cityDocs.length} agrégats de ville, ${byDay.size} jours, ${writes.length} documents.`);
  await commit(writes);
}

async function monitoring(): Promise<void> {
  console.log('2. Seuils de surveillance…');
  const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.monitoring);
  const snap = await ref.get();
  if (snap.exists) {
    console.log('   déjà présents, conservés.');
    return;
  }
  await commit([{ path: ref.path, data: { ...DEFAULT_MONITORING_SETTINGS, updatedAt: Timestamp.now(), updatedBy: account('superAdmin').uid } }]);
}

async function reports(): Promise<void> {
  console.log('3. Rapports programmés…');
  const superAdmin = account('superAdmin').uid;
  const finance = account('finance').uid;
  const metz = account('cityMetz').uid;
  const now = new Date();
  const ts = (d: Date) => Timestamp.fromDate(d);
  const tracked = (by: string) => ({ createdAt: ts(new Date(now.getTime() - 20 * 86_400_000)), createdBy: by, updatedAt: ts(now), updatedBy: by });
  const lastRun = (frequency: ScheduledReport['frequency'], hour: number) => {
    let at = nextReportRun(frequency, hour, new Date(now.getTime() - (frequency === 'monthly' ? 32 : frequency === 'weekly' ? 8 : 1.2) * 86_400_000));
    while (nextReportRun(frequency, hour, at).getTime() < now.getTime()) at = nextReportRun(frequency, hour, at);
    return at;
  };
  const docs: Array<{ id: string; data: Record<string, unknown> }> = [
    {
      id: 'rapport-quotidien',
      data: {
        name: 'Synthèse quotidienne',
        report: 'daily_summary',
        frequency: 'daily',
        recipients: ['direction@golink.test'],
        filters: { countryId: null, cityIds: null },
        format: 'pdf',
        hour: 7,
        active: true,
        lastRunAt: ts(lastRun('daily', 7)),
        lastRunStatus: 'sent',
        lastRunError: null,
        runsCount: 38,
        nextRunAt: ts(nextReportRun('daily', 7, now)),
        ...tracked(superAdmin),
      },
    },
    {
      id: 'rapport-finance',
      data: {
        name: 'Finance mensuelle',
        report: 'finance',
        frequency: 'monthly',
        recipients: ['finance@golink.test', 'comptabilite@golink.test'],
        filters: { countryId: null, cityIds: null },
        format: 'xlsx',
        hour: 8,
        active: true,
        lastRunAt: ts(lastRun('monthly', 8)),
        lastRunStatus: 'sent',
        lastRunError: null,
        runsCount: 3,
        nextRunAt: ts(nextReportRun('monthly', 8, now)),
        ...tracked(finance),
      },
    },
    {
      id: 'rapport-classement-metz',
      data: {
        name: 'Classement hebdomadaire · Metz',
        report: 'restaurants',
        frequency: 'weekly',
        recipients: ['metz@golink.test'],
        filters: { countryId: 'FR', cityIds: ['metz'] },
        format: 'xlsx',
        hour: 9,
        active: true,
        lastRunAt: ts(lastRun('weekly', 9)),
        lastRunStatus: 'sent',
        lastRunError: null,
        runsCount: 6,
        nextRunAt: ts(nextReportRun('weekly', 9, now)),
        ...tracked(metz),
      },
    },
    {
      id: 'rapport-livreurs-luxembourg',
      data: {
        name: 'Performance livreurs · Luxembourg',
        report: 'drivers',
        frequency: 'weekly',
        recipients: ['operations@golink.test'],
        filters: { countryId: 'LU', cityIds: null },
        format: 'csv',
        hour: 8,
        active: false,
        lastRunAt: ts(lastRun('weekly', 8)),
        lastRunStatus: 'partial',
        lastRunError: '1 destinataire sur 2 refusé par la messagerie.',
        runsCount: 4,
        nextRunAt: ts(nextReportRun('weekly', 8, now)),
        ...tracked(superAdmin),
      },
    },
  ];
  await commit(docs.map((d) => ({ path: `${COLLECTIONS.scheduledReports}/${d.id}`, data: { ...d.data, seed: true } })));
}

async function exportsHistory(): Promise<void> {
  console.log('4. Historique des exports…');
  const now = Date.now();
  const at = (hoursAgo: number) => Timestamp.fromMillis(now - hoursAgo * 3_600_000);
  const job = (id: string, by: string, hoursAgo: number, entity: string, format: string, rows: number, params: Record<string, unknown>, reason: string | null) => ({
    path: `${COLLECTIONS.bulkJobs}/${id}`,
    data: {
      type: 'export',
      entity,
      params: { ...params, format },
      input: null,
      format,
      status: 'completed',
      total: rows,
      processed: rows,
      succeeded: rows,
      failed: 0,
      errors: [],
      output: null,
      reason,
      fileName: `golink-${entity}-${parisDay(at(hoursAgo).toDate()).replaceAll('-', '')}.${format}`,
      truncated: false,
      startedAt: at(hoursAgo),
      finishedAt: at(hoursAgo),
      createdAt: at(hoursAgo),
      createdBy: by,
      updatedAt: at(hoursAgo),
      updatedBy: by,
      seed: true,
    },
  });
  await commit([
    job('export-demo-stats-septembre', account('superAdmin').uid, 26, 'stats', 'xlsx', 26, { from: '2026-09-01', to: '2026-09-26' }, 'Point associés'),
    job('export-demo-restaurants', account('superAdmin').uid, 70, 'restaurants', 'csv', 12, {}, null),
    job('export-demo-reversements', account('finance').uid, 140, 'payouts', 'pdf', 48, { from: '2026-09-01', to: '2026-09-15', status: 'paid' }, 'Rapprochement bancaire'),
  ]);
}

async function main(): Promise<void> {
  await rebuildStats();
  await monitoring();
  await reports();
  await exportsHistory();
  console.log(DRY_RUN ? '\nSimulation terminée (rien n’est écrit).' : '\nDonnées « Pilotage » à jour.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
