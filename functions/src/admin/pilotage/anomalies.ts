// Surveillance par exception (cahier §1) : toutes les 15 minutes, la plateforme est
// passée en revue et seules les anomalies remontent dans platformAlerts (file
// « alertes ») ; les éléments en attente d'une décision humaine alimentent la file
// « à traiter ». Une alerte par clé de dédoublonnage ; elle se résout d'elle-même
// quand la situation redevient normale. Une alerte écartée par un humain n'est
// rouverte que si la situation persiste 7 jours plus tard.
import {
  COLLECTIONS,
  DEFAULT_MONITORING_SETTINGS,
  SETTINGS_DOCS,
  PILOTAGE_SERVICE_LABELS,
  SERVICE_HEALTH_LABELS,
  SUBCOLLECTIONS,
  type AlertSeverity,
  type ContentReport,
  type DailyStats,
  type Driver,
  type GdprRequest,
  type MonitoringSettings,
  type PartnerDocument,
  type Payout,
  type PlatformAlert,
  type Restaurant,
  type RestaurantDailyStats,
  type ServiceStatus,
  type Subscription,
  type SupportTicket,
  type Zone,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { sendEmail } from '../../lib/brevo';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { sampleDriversOnline } from './platform-stats';
import { PILOTAGE_RUNTIME } from './runtime';
import { loadMarkets } from './scope';

/**
 * Alertes critiques (§1, §30) : envoyées par e-mail aux super administrateurs actifs,
 * pas seulement visibles dans l'interface (sans quoi une panne peut passer inaperçue
 * plusieurs heures si personne n'ouvre l'écran des alertes).
 */
async function notifySuperAdmins(alerts: PlatformAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  const admins = await db.collection(COLLECTIONS.admins).where('role', '==', 'super_admin').where('active', '==', true).get();
  if (admins.empty) return;
  const subject = alerts.length === 1 ? `Alerte critique Ciyou Eats : ${alerts[0]!.title}` : `${alerts.length} alertes critiques Ciyou Eats`;
  const html = `<p>Signalé automatiquement par la surveillance de la plateforme :</p><ul>${alerts.map((a) => `<li><strong>${a.title}</strong> — ${a.message}</li>`).join('')}</ul>`;
  const text = alerts.map((a) => `${a.title} — ${a.message}`).join('\n');
  for (const doc of admins.docs) {
    const email = doc.get('email') as string | undefined;
    if (!email) continue;
    await sendEmail({ to: { email }, message: { subject, html, text }, recipientType: 'admin', recipientId: doc.id, templateKey: 'critical_alert' }).catch((error) =>
      logger.error('Alerte critique : envoi e-mail échoué', { adminId: doc.id, error: String(error) }),
    );
  }
}
import { addDays, parisClock, parisDay, TIMEZONE } from './time';

type Candidate = Omit<PlatformAlert, 'status' | 'detectedAt' | 'acknowledgedBy' | 'acknowledgedAt' | 'resolvedAt'>;

/** Types d'alertes entièrement calculés ici (donc résolus automatiquement). */
const MANAGED_KINDS: ReadonlySet<PlatformAlert['kind']> = new Set([
  'restaurant_cancellation_rate',
  'restaurant_rejection_rate',
  'zone_driver_shortage',
  'refund_spike',
  'city_order_drop',
  'service_down',
  'subscription_unpaid',
  'restaurant_to_validate',
  'driver_to_validate',
  'document_expired',
  'ticket_escalated',
  'review_reported',
  'gdpr_request',
  'payout_failed',
]);

const percent = (ratio: number) => `${Math.round(ratio * 1000) / 10} %`.replace('.', ',');

export async function loadMonitoringSettings(): Promise<Omit<MonitoringSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.monitoring).get();
  return { ...DEFAULT_MONITORING_SETTINGS, ...((snap.data() as Partial<MonitoringSettings> | undefined) ?? {}) };
}

// ------------------------------------------------------------------ Détections

async function restaurantRates(settings: Awaited<ReturnType<typeof loadMonitoringSettings>>, today: string): Promise<Candidate[]> {
  const restaurants = await db.collection(COLLECTIONS.restaurants).where('status', 'in', ['active', 'paused']).get();
  const from = addDays(today, -6);
  const out: Candidate[] = [];
  await Promise.all(
    restaurants.docs.map(async (doc) => {
      const r = doc.data() as Restaurant;
      const stats = await doc.ref
        .collection(SUBCOLLECTIONS.restaurants.dailyStats)
        .where('day', '>=', from)
        .get();
      const days = stats.docs.map((d) => d.data() as RestaurantDailyStats);
      const orders = days.reduce((s, d) => s + d.ordersCount, 0);
      if (orders < settings.restaurantMinOrders) return;
      const cancelled = days.reduce((s, d) => s + d.cancelledCount, 0);
      const rejected = days.reduce((s, d) => s + d.rejectedCount, 0);
      const target = { type: 'restaurant' as const, id: doc.id, label: r.name };
      const cancelRate = cancelled / orders;
      if (cancelRate > settings.restaurantCancellationRate) {
        out.push({
          kind: 'restaurant_cancellation_rate',
          queue: 'alert',
          severity: cancelRate > settings.restaurantCancellationRate * 2 ? 'critical' : 'warning',
          title: `Taux d’annulation élevé : ${r.name}`,
          message: `${percent(cancelRate)} d’annulations sur 7 jours (${cancelled} sur ${orders} commandes), seuil ${percent(settings.restaurantCancellationRate)}.`,
          target,
          countryId: r.countryId,
          cityId: r.cityId,
          metric: { value: Math.round(cancelRate * 1000) / 10, threshold: Math.round(settings.restaurantCancellationRate * 1000) / 10, unit: '%' },
          dedupKey: `restaurant_cancellation_rate_${doc.id}`,
        });
      }
      const rejectRate = rejected / orders;
      if (rejectRate > settings.restaurantRejectionRate) {
        out.push({
          kind: 'restaurant_rejection_rate',
          queue: 'alert',
          severity: rejectRate > settings.restaurantRejectionRate * 2 ? 'critical' : 'warning',
          title: `Commandes refusées : ${r.name}`,
          message: `${percent(rejectRate)} de commandes refusées ou expirées sur 7 jours (${rejected} sur ${orders}), seuil ${percent(settings.restaurantRejectionRate)}.`,
          target,
          countryId: r.countryId,
          cityId: r.cityId,
          metric: { value: Math.round(rejectRate * 1000) / 10, threshold: Math.round(settings.restaurantRejectionRate * 1000) / 10, unit: '%' },
          dedupKey: `restaurant_rejection_rate_${doc.id}`,
        });
      }
    }),
  );
  return out;
}

async function cityTrends(settings: Awaited<ReturnType<typeof loadMonitoringSettings>>, today: string): Promise<Candidate[]> {
  const markets = await loadMarkets();
  const out: Candidate[] = [];
  const hour = parisClock(new Date()).hour;
  const from = addDays(today, -35);
  const snap = await db
    .collection(COLLECTIONS.statsDaily)
    .where('scope', '==', 'city')
    .where('day', '>=', from)
    .get();
  const byCity = new Map<string, Map<string, DailyStats>>();
  for (const doc of snap.docs) {
    const s = doc.data() as DailyStats;
    const map = byCity.get(s.scopeId) ?? new Map<string, DailyStats>();
    map.set(s.day, s);
    byCity.set(s.scopeId, map);
  }
  for (const city of markets.cities.values()) {
    if (!city.active) continue;
    const days = byCity.get(city.id) ?? new Map<string, DailyStats>();
    // Commandes du jour jusqu'à l'heure courante vs mêmes créneaux des 4 semaines précédentes.
    const until = (s: DailyStats | undefined) => (s ? s.orders.byHour.slice(0, hour).reduce((a, b) => a + b, 0) : 0);
    const reference = [7, 14, 21, 28].map((d) => until(days.get(addDays(today, -d))));
    const expected = reference.reduce((a, b) => a + b, 0) / reference.length;
    const actual = until(days.get(today));
    if (hour >= 12 && expected >= settings.cityMinOrders && actual < expected * (1 - settings.cityOrderDrop)) {
      const drop = 1 - actual / expected;
      out.push({
        kind: 'city_order_drop',
        queue: 'alert',
        severity: drop > 0.6 ? 'critical' : 'warning',
        title: `Chute des commandes : ${city.name}`,
        message: `${actual} commandes depuis minuit contre ${Math.round(expected)} en moyenne à la même heure les 4 semaines précédentes (−${percent(drop)}).`,
        target: { type: 'city', id: city.id, label: city.name },
        countryId: city.countryId,
        cityId: city.id,
        metric: { value: actual, threshold: Math.round(expected * (1 - settings.cityOrderDrop)), unit: 'commandes' },
        dedupKey: `city_order_drop_${city.id}`,
      });
    }
    // Remboursements des 7 derniers jours vs moyenne hebdomadaire des 28 jours précédents.
    const sumRefunds = (start: number, end: number) => {
      let total = 0;
      for (let d = start; d <= end; d += 1) total += days.get(addDays(today, -d))?.revenue.refundsCents ?? 0;
      return total;
    };
    const recent = sumRefunds(0, 6);
    const baseline = sumRefunds(7, 34) / 4;
    if (recent >= 5000 && recent > Math.max(baseline, 1000) * (1 + settings.refundSpike)) {
      out.push({
        kind: 'refund_spike',
        queue: 'alert',
        severity: recent > Math.max(baseline, 1000) * (1 + settings.refundSpike * 2) ? 'critical' : 'warning',
        title: `Hausse des remboursements : ${city.name}`,
        message: `${(recent / 100).toFixed(2).replace('.', ',')} € remboursés sur 7 jours contre ${(baseline / 100).toFixed(2).replace('.', ',')} € en moyenne par semaine auparavant.`,
        target: { type: 'city', id: city.id, label: city.name },
        countryId: city.countryId,
        cityId: city.id,
        metric: { value: Math.round(recent / 100), threshold: Math.round((Math.max(baseline, 1000) * (1 + settings.refundSpike)) / 100), unit: '€' },
        dedupKey: `refund_spike_${city.id}`,
      });
    }
  }
  return out;
}

async function zoneShortages(settings: Awaited<ReturnType<typeof loadMonitoringSettings>>): Promise<Candidate[]> {
  const zones = await db.collection(COLLECTIONS.zones).where('active', '==', true).get();
  const markets = await loadMarkets();
  const out: Candidate[] = [];
  for (const doc of zones.docs) {
    const zone = doc.data() as Zone;
    const live = zone.live;
    if (!live || live.ordersWaiting < 2) continue;
    if (Date.now() - live.updatedAt.toMillis() > 30 * 60_000) continue;
    const ratio = live.driversAvailable / live.ordersWaiting;
    if (ratio >= settings.zoneDriverRatio) continue;
    out.push({
      kind: 'zone_driver_shortage',
      queue: 'alert',
      severity: ratio < settings.zoneDriverRatio / 2 ? 'critical' : 'warning',
      title: `Manque de livreurs : ${zone.name}`,
      message: `${live.driversAvailable} livreur${live.driversAvailable > 1 ? 's' : ''} disponible${live.driversAvailable > 1 ? 's' : ''} pour ${live.ordersWaiting} commandes en attente.`,
      target: { type: 'zone', id: doc.id, label: zone.name },
      countryId: markets.cities.get(zone.cityId)?.countryId ?? zone.countryId ?? null,
      cityId: zone.cityId,
      metric: { value: Math.round(ratio * 100) / 100, threshold: settings.zoneDriverRatio, unit: 'ratio' },
      dedupKey: `zone_driver_shortage_${doc.id}`,
    });
  }
  return out;
}

async function servicesDown(): Promise<Candidate[]> {
  const snap = await db.collection(COLLECTIONS.serviceStatus).where('status', 'in', ['partial_outage', 'major_outage']).get();
  return snap.docs.map((doc) => {
    const s = doc.data() as ServiceStatus;
    const label = PILOTAGE_SERVICE_LABELS[s.key] ?? doc.id;
    return {
      kind: 'service_down' as const,
      queue: 'alert' as const,
      severity: (s.status === 'major_outage' ? 'critical' : 'warning') as AlertSeverity,
      title: `${SERVICE_HEALTH_LABELS[s.status]} : ${label}`,
      message: s.status === 'major_outage' ? 'Le service ne répond plus. Les utilisateurs sont impactés.' : 'Le service fonctionne de façon dégradée.',
      target: { type: 'other' as const, id: doc.id, label },
      countryId: null,
      cityId: null,
      metric: null,
      dedupKey: `service_down_${doc.id}`,
    };
  });
}

async function todoQueue(settings: Awaited<ReturnType<typeof loadMonitoringSettings>>, today: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const [restaurants, drivers, subscriptions, docsExpired, docsOutdated, tickets, reports, gdpr, payouts] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).where('onboardingStatus', 'in', ['pending', 'documents_missing']).get(),
    db.collection(COLLECTIONS.drivers).where('onboardingStatus', 'in', ['pending', 'documents_missing']).get(),
    db.collection(COLLECTIONS.subscriptions).where('status', 'in', ['past_due', 'restricted']).get(),
    db.collection(COLLECTIONS.partnerDocuments).where('status', '==', 'expired').get(),
    db.collection(COLLECTIONS.partnerDocuments).where('status', '==', 'approved').where('expiresAt', '<', today).get(),
    db.collection(COLLECTIONS.supportTickets).where('escalated', '==', true).where('status', 'in', ['open', 'in_progress', 'waiting_customer']).get(),
    db.collection(COLLECTIONS.contentReports).where('status', 'in', ['open', 'under_review']).get(),
    db.collection(COLLECTIONS.gdprRequests).where('status', 'in', ['received', 'identity_check', 'in_progress']).get(),
    db.collection(COLLECTIONS.payouts).where('status', '==', 'failed').get(),
  ]);

  // Noms des restaurants et livreurs concernés (abonnements, documents).
  const restaurantIds = new Set<string>();
  const driverIds = new Set<string>();
  for (const doc of subscriptions.docs) if (doc.get('subscriberType') === 'restaurant') restaurantIds.add(doc.get('subscriberId') as string);
  for (const doc of [...docsExpired.docs, ...docsOutdated.docs]) {
    (doc.get('ownerType') === 'driver' ? driverIds : restaurantIds).add(doc.get('ownerId') as string);
  }
  const names = new Map<string, string>();
  const loadNames = async (collection: string, ids: Set<string>, field: string) => {
    const list = [...ids].filter(Boolean);
    for (let i = 0; i < list.length; i += 200) {
      const snaps = await db.getAll(...list.slice(i, i + 200).map((id) => db.collection(collection).doc(id)));
      for (const snap of snaps) if (snap.exists) names.set(`${collection}/${snap.id}`, String(snap.get(field) ?? snap.id));
    }
  };
  await Promise.all([loadNames(COLLECTIONS.restaurants, restaurantIds, 'name'), loadNames(COLLECTIONS.drivers, driverIds, 'displayName')]);

  for (const doc of restaurants.docs) {
    const r = doc.data() as Restaurant;
    const missing = r.onboardingStatus === 'documents_missing';
    out.push({
      kind: 'restaurant_to_validate',
      queue: 'todo',
      severity: missing ? 'warning' : 'info',
      title: missing ? `Documents manquants : ${r.name}` : `Nouveau commerce à valider : ${r.name}`,
      message: missing ? 'Le dossier est incomplet : relancer le commerce ou compléter la validation.' : 'Dossier complet en attente de validation.',
      target: { type: 'restaurant', id: doc.id, label: r.name },
      countryId: r.countryId,
      cityId: r.cityId,
      metric: null,
      dedupKey: `restaurant_to_validate_${doc.id}`,
    });
  }
  for (const doc of drivers.docs) {
    const d = doc.data() as Driver;
    out.push({
      kind: 'driver_to_validate',
      queue: 'todo',
      severity: 'info',
      title: `Candidature livreur : ${d.displayName}`,
      message: d.onboardingStatus === 'documents_missing' ? 'Pièces manquantes à relancer.' : 'Pièces déposées, contrôle d’identité à effectuer.',
      target: { type: 'driver', id: doc.id, label: d.displayName },
      countryId: d.countryId,
      cityId: d.cityId,
      metric: null,
      dedupKey: `driver_to_validate_${doc.id}`,
    });
  }
  for (const doc of subscriptions.docs) {
    const s = doc.data() as Subscription;
    const label = names.get(`${COLLECTIONS.restaurants}/${s.subscriberId}`) ?? s.subscriberId;
    out.push({
      kind: 'subscription_unpaid',
      queue: 'todo',
      severity: s.status === 'restricted' ? 'critical' : 'warning',
      title: `Abonnement impayé : ${label}`,
      message: `${s.dunning?.attempts ?? 0} tentative${(s.dunning?.attempts ?? 0) > 1 ? 's' : ''} de prélèvement refusée${(s.dunning?.attempts ?? 0) > 1 ? 's' : ''}.${s.status === 'restricted' ? ' Accès restreint.' : ''}`,
      target: s.subscriberType === 'restaurant' ? { type: 'restaurant', id: s.subscriberId, label } : { type: 'subscription', id: doc.id, label },
      countryId: s.countryId,
      cityId: s.cityId ?? null,
      metric: null,
      dedupKey: `subscription_unpaid_${doc.id}`,
    });
  }
  const seenDocs = new Set<string>();
  for (const doc of [...docsExpired.docs, ...docsOutdated.docs]) {
    if (seenDocs.has(doc.id)) continue;
    seenDocs.add(doc.id);
    const d = doc.data() as PartnerDocument;
    const owner = names.get(`${d.ownerType === 'driver' ? COLLECTIONS.drivers : COLLECTIONS.restaurants}/${d.ownerId}`) ?? d.ownerId;
    out.push({
      kind: 'document_expired',
      queue: 'todo',
      severity: 'warning',
      title: `Document expiré : ${owner}`,
      message: `Pièce expirée${d.expiresAt ? ` depuis le ${d.expiresAt.split('-').reverse().join('/')}` : ''} : le compte reste bloqué jusqu’au dépôt d’un document valide.`,
      target: { type: d.ownerType === 'driver' ? 'driver' : 'restaurant', id: d.ownerId, label: owner },
      countryId: d.countryId,
      cityId: d.cityId ?? null,
      metric: null,
      dedupKey: `document_expired_${doc.id}`,
    });
  }
  for (const doc of tickets.docs) {
    const t = doc.data() as SupportTicket;
    out.push({
      kind: 'ticket_escalated',
      queue: 'todo',
      severity: t.priority === 'urgent' ? 'critical' : 'warning',
      title: `Ticket escaladé ${t.number} : ${t.subject}`,
      message: `Demande de ${t.requesterName}${t.escalatedTo ? `, escaladée vers ${t.escalatedTo}` : ''}.`,
      target: { type: 'ticket', id: doc.id, label: t.number },
      countryId: t.countryId,
      cityId: t.cityId ?? null,
      metric: null,
      dedupKey: `ticket_escalated_${doc.id}`,
    });
  }
  for (const doc of reports.docs) {
    const r = doc.data() as ContentReport;
    const reviewId = r.targetType === 'review' || r.targetType === 'review_reply' ? (r.targetPath.split('/')[1] ?? doc.id) : doc.id;
    out.push({
      kind: 'review_reported',
      queue: 'todo',
      severity: r.reason === 'illegal' || r.reason === 'hate' ? 'warning' : 'info',
      title: r.targetType.startsWith('review') ? 'Avis signalé' : 'Contenu signalé',
      message: r.details ? r.details.slice(0, 160) : 'Signalement à examiner (obligation de traitement DSA).',
      target: { type: r.targetType.startsWith('review') ? 'review' : 'other', id: reviewId, label: null },
      countryId: null,
      cityId: null,
      metric: null,
      dedupKey: `review_reported_${doc.id}`,
    });
  }
  const warnMs = settings.gdprDueWarningDays * 86_400_000;
  for (const doc of gdpr.docs) {
    const g = doc.data() as GdprRequest;
    const remaining = g.dueAt.toMillis() - Date.now();
    out.push({
      kind: 'gdpr_request',
      queue: 'todo',
      severity: remaining < 0 ? 'critical' : remaining < warnMs ? 'warning' : 'info',
      title: remaining < 0 ? 'Demande RGPD hors délai' : 'Demande RGPD à traiter',
      message: `Échéance légale le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: TIMEZONE }).format(g.dueAt.toDate())}.`,
      target: { type: 'other', id: doc.id, label: null },
      countryId: null,
      cityId: null,
      metric: null,
      dedupKey: `gdpr_request_${doc.id}`,
    });
  }
  for (const doc of payouts.docs) {
    const p = doc.data() as Payout;
    out.push({
      kind: 'payout_failed',
      queue: 'alert',
      severity: 'critical',
      title: `Reversement en échec : ${p.beneficiaryName}`,
      message: `${(p.netCents / 100).toFixed(2).replace('.', ',')} € non versés (période du ${p.periodStart.split('-').reverse().join('/')} au ${p.periodEnd.split('-').reverse().join('/')}).`,
      target: { type: 'payout', id: doc.id, label: p.beneficiaryName },
      countryId: p.countryId,
      cityId: p.cityId ?? null,
      metric: null,
      dedupKey: `payout_failed_${doc.id}`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Écriture

function alertId(dedupKey: string): string {
  return `mon_${dedupKey.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 140)}`;
}

/** Applique les alertes détectées : création, mise à jour, réouverture, résolution automatique. */
export async function applyAlerts(
  candidates: Candidate[],
  skipResolve: ReadonlySet<PlatformAlert['kind']> = new Set(),
  reopenAfterDays: number = DEFAULT_MONITORING_SETTINGS.alertReopenAfterDays,
): Promise<{ created: number; updated: number; resolved: number; criticalNew: PlatformAlert[] }> {
  const reopenAfterMs = reopenAfterDays * 86_400_000;
  const existing = await db.collection(COLLECTIONS.platformAlerts).where('status', 'in', ['open', 'acknowledged']).get();
  const openByKey = new Map(existing.docs.map((doc) => [doc.get('dedupKey') as string, doc]));
  const activeKeys = new Set(candidates.map((c) => c.dedupKey));
  let created = 0;
  let updated = 0;
  let resolved = 0;
  const criticalNew: PlatformAlert[] = [];
  const now = Timestamp.now();

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending) await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const candidate of candidates) {
    const open = openByKey.get(candidate.dedupKey);
    if (open) {
      batch.update(open.ref, { title: candidate.title, message: candidate.message, metric: candidate.metric ?? null, severity: candidate.severity });
      updated += 1;
    } else {
      const ref = db.collection(COLLECTIONS.platformAlerts).doc(alertId(candidate.dedupKey));
      const previous = await ref.get();
      const prevStatus = previous.get('status') as PlatformAlert['status'] | undefined;
      const closedAt = (previous.get('resolvedAt') ?? previous.get('acknowledgedAt')) as FirebaseFirestore.Timestamp | null | undefined;
      if (prevStatus === 'dismissed' && closedAt && now.toMillis() - closedAt.toMillis() < reopenAfterMs) continue;
      const alert: PlatformAlert = {
        ...candidate,
        status: 'open',
        detectedAt: now,
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedAt: null,
      };
      batch.set(ref, alert);
      created += 1;
      if (alert.severity === 'critical') criticalNew.push(alert);
    }
    pending += 1;
    if (pending >= 400) await flush();
  }

  for (const [key, doc] of openByKey) {
    const kind = doc.get('kind') as PlatformAlert['kind'];
    if (!MANAGED_KINDS.has(kind) || skipResolve.has(kind) || activeKeys.has(key)) continue;
    batch.update(doc.ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp() });
    resolved += 1;
    pending += 1;
    if (pending >= 400) await flush();
  }
  await flush();
  return { created, updated, resolved, criticalNew };
}

/** Lance toutes les détections et applique le résultat. */
export async function runMonitoring(): Promise<{ created: number; updated: number; resolved: number; candidates: number; criticalNew: PlatformAlert[] }> {
  const settings = await loadMonitoringSettings();
  const today = parisDay(new Date());
  const detectors: Array<{ kinds: PlatformAlert['kind'][]; run: () => Promise<Candidate[]> }> = [
    { kinds: ['restaurant_cancellation_rate', 'restaurant_rejection_rate'], run: () => restaurantRates(settings, today) },
    { kinds: ['city_order_drop', 'refund_spike'], run: () => cityTrends(settings, today) },
    { kinds: ['zone_driver_shortage'], run: () => zoneShortages(settings) },
    { kinds: ['service_down'], run: () => servicesDown() },
    {
      kinds: ['restaurant_to_validate', 'driver_to_validate', 'subscription_unpaid', 'document_expired', 'ticket_escalated', 'review_reported', 'gdpr_request', 'payout_failed'],
      run: () => todoQueue(settings, today),
    },
  ];
  const results = await Promise.allSettled(detectors.map((d) => d.run()));
  const candidates: Candidate[] = [];
  const skipResolve = new Set<PlatformAlert['kind']>();
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(...result.value);
    else {
      // Une détection en échec ne doit pas résoudre à tort les alertes qu'elle couvre.
      for (const kind of detectors[index]?.kinds ?? []) skipResolve.add(kind);
      logger.error('Détection en échec', { error: result.reason instanceof Error ? result.reason.stack : String(result.reason) });
    }
  });
  return { ...(await applyAlerts(candidates, skipResolve, settings.alertReopenAfterDays)), candidates: candidates.length };
}

export const detectAnomalies = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TIMEZONE, retryCount: 0, ...PILOTAGE_RUNTIME, timeoutSeconds: 300, memory: '512MiB', secrets: EMAIL_SECRETS },
  async () => {
    const [monitoring, sampling] = await Promise.allSettled([runMonitoring(), sampleDriversOnline()]);
    if (monitoring.status === 'fulfilled') {
      logger.info('Surveillance de la plateforme', monitoring.value);
      // Alertes critiques (§1, §30) : e-mail aux super administrateurs, pas seulement l'interface.
      await notifySuperAdmins(monitoring.value.criticalNew).catch((error) => logger.error('Notification des alertes critiques en échec', { error: String(error) }));
    } else {
      logger.error('Surveillance en échec', { error: monitoring.reason instanceof Error ? monitoring.reason.stack : String(monitoring.reason) });
    }
    if (sampling.status === 'rejected') logger.error('Relevé des livreurs en échec', { error: String(sampling.reason) });
  },
);
