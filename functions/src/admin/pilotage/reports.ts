// Rapports automatiques (cahier §4) : récapitulatif envoyé par e-mail (Brevo) chaque
// jour, chaque lundi ou le 1er du mois, avec pièce jointe CSV, Excel ou PDF. Le
// périmètre d'un rapport est borné par celui de son auteur. Création, modification,
// suppression et envoi manuel passent par des fonctions auditées ; l'aperçu
// (dryRun) n'envoie aucun e-mail.
import {
  COLLECTIONS,
  REPORT_FREQUENCY_LABELS,
  REPORT_KIND_LABELS,
  adminHasPermission,
  type AdminUser,
  type ExportEntity,
  type PilotageKpis,
  type ReportKind,
  type RunReportNowResult,
  type ScheduledReport,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { sendEmail } from '../../lib/brevo';
import { APP_URLS } from '../../lib/config';
import { renderEmail } from '../../lib/email-layout';
import type { EmailMessage } from '../../lib/emails';
import { fail } from '../../lib/errors';
import { loadAdmin, requireAdmin } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zEmail, zId, zReason } from '../../lib/validation';
import { kpisFromPlatform, platformDaily, restaurantDaily, restaurantsInScope } from './data';
import { buildEntityTable, type ExportContext } from './exports';
import { PILOTAGE_HEAVY_RUNTIME, pilotageCallable } from './runtime';
import { resolveScope, type ResolvedScope } from './scope';
import { render, type TableDocument } from './tabular';
import { addDays, daysInRange, nextReportRun, parisDay, reportPeriod, TIMEZONE } from './time';

const eur = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100).replace(/[  ]/g, ' ');
const int = (n: number) => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ');
const pct = (ratio: number) => new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(ratio).replace(/[  ]/g, ' ');
const frDay = (day: string) => day.split('-').reverse().join('/');

function delta(current: number, previous: number): string {
  if (!previous) return '';
  const ratio = (current - previous) / previous;
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '';
  return ` (${sign}${pct(Math.abs(ratio))} vs période précédente)`;
}

/** Entité exportée en pièce jointe selon le type de rapport. */
const ATTACHMENT_ENTITY: Record<ReportKind, ExportEntity | 'ranking'> = {
  daily_summary: 'stats',
  finance: 'stats',
  orders: 'orders',
  restaurants: 'ranking',
  drivers: 'drivers',
  support: 'tickets',
};

interface BuiltReport {
  message: EmailMessage;
  attachment: { name: string; buffer: Buffer };
  period: { from: string; to: string };
}

async function rankingTable(scope: ResolvedScope, from: string, to: string): Promise<TableDocument> {
  const restaurants = await restaurantsInScope(scope);
  const daily = await restaurantDaily(
    restaurants.map((r) => r.id),
    from,
    to,
  );
  const rows = restaurants
    .map((r) => {
      const days = daily.get(r.id) ?? [];
      const orders = days.reduce((s, d) => s + d.ordersCount, 0);
      const delivered = days.reduce((s, d) => s + d.deliveredCount, 0);
      const sales = days.reduce((s, d) => s + d.salesCents, 0);
      return {
        name: r.name,
        city: scope.markets.cities.get(r.cityId)?.name ?? r.cityId,
        plan: r.planCode,
        orders,
        sales,
        commission: days.reduce((s, d) => s + d.commissionCents, 0),
        basket: delivered ? Math.round(sales / delivered) : 0,
        cancellation: orders ? days.reduce((s, d) => s + d.cancelledCount, 0) / orders : 0,
        rating: r.rating?.average ?? null,
      };
    })
    .sort((a, b) => b.sales - a.sales);
  return {
    title: 'Classement des restaurants',
    subtitle: `Du ${frDay(from)} au ${frDay(to)}`,
    columns: [
      { key: 'name', label: 'Commerce', width: 1.6 },
      { key: 'city', label: 'Ville' },
      { key: 'plan', label: 'Formule', width: 0.7 },
      { key: 'orders', label: 'Commandes', type: 'number', width: 0.8 },
      { key: 'sales', label: 'CA TTC', type: 'money' },
      { key: 'commission', label: 'Commission HT', type: 'money' },
      { key: 'basket', label: 'Panier moyen', type: 'money' },
      { key: 'cancellation', label: 'Annulation', type: 'percent', width: 0.8 },
      { key: 'rating', label: 'Note', type: 'number', width: 0.6 },
    ],
    rows,
  };
}

/** Construit le contenu d'un rapport pour une période. */
export async function buildReport(report: ScheduledReport, owner: AdminUser, period: { from: string; to: string }): Promise<BuiltReport> {
  const scope = await resolveScope(owner, {
    countryId: typeof report.filters?.countryId === 'string' ? report.filters.countryId : null,
    cityIds: Array.isArray(report.filters?.cityIds) ? report.filters.cityIds : null,
  });
  const length = daysInRange(period.from, period.to);
  const previous = { from: addDays(period.from, -length), to: addDays(period.from, -1) };
  const [current, before] = await Promise.all([platformDaily(scope, period.from, period.to), platformDaily(scope, previous.from, previous.to)]);
  const k: PilotageKpis = kpisFromPlatform([...current.values()].flat());
  const p: PilotageKpis = kpisFromPlatform([...before.values()].flat());
  const scopeLabel = scope.statsScope.scope === 'platform'
    ? 'Tous les marchés'
    : scope.statsScope.scope === 'country'
      ? (scope.markets.countries.get(scope.statsScope.ids[0] ?? '')?.name ?? 'Pays')
      : scope.statsScope.ids.map((id) => scope.markets.cities.get(id)?.name ?? id).join(', ');
  const periodLabel = period.from === period.to ? `le ${frDay(period.from)}` : `du ${frDay(period.from)} au ${frDay(period.to)}`;

  let details: Array<{ label: string; value: string }> = [];
  const paragraphs: string[] = [`Voici le rapport « ${report.name} » ${periodLabel} · ${scopeLabel}.`];
  switch (report.report) {
    case 'finance':
      details = [
        { label: 'Volume d’affaires TTC', value: `${eur(k.gmvCents)}${delta(k.gmvCents, p.gmvCents)}` },
        { label: 'Chiffre d’affaires commerces', value: eur(k.restaurantSalesCents) },
        { label: 'Commissions HT', value: `${eur(k.commissionHtCents)}${delta(k.commissionHtCents, p.commissionHtCents)}` },
        { label: 'Frais de service et livraison HT', value: eur(k.feesHtCents) },
        { label: 'Abonnements HT', value: eur(k.subscriptionsHtCents) },
        { label: 'Remboursements', value: eur(k.refundsCents) },
        { label: 'Marge Ciyou Eats', value: `${eur(k.marginCents)}${delta(k.marginCents, p.marginCents)}` },
      ];
      break;
    case 'orders':
      details = [
        { label: 'Commandes passées', value: `${int(k.ordersPlaced)}${delta(k.ordersPlaced, p.ordersPlaced)}` },
        { label: 'Livrées', value: int(k.ordersDelivered) },
        { label: 'Annulées', value: `${int(k.ordersCancelled)} (${pct(k.cancellationRate)})` },
        { label: 'Refusées par le commerce', value: int(k.ordersRejected) },
        { label: 'Livrées en retard', value: int(k.ordersLate) },
        { label: 'Panier moyen', value: eur(k.averageBasketCents) },
      ];
      break;
    case 'support': {
      const days = [...current.values()].flat();
      const opened = days.reduce((s, d) => s + (d.support?.ticketsOpened ?? 0), 0);
      const resolved = days.reduce((s, d) => s + (d.support?.ticketsResolved ?? 0), 0);
      const resolutionWeighted = days.reduce((s, d) => s + (d.support?.averageResolutionMinutes ?? 0) * (d.support?.ticketsResolved ?? 0), 0);
      details = [
        { label: 'Tickets ouverts', value: int(opened) },
        { label: 'Tickets résolus', value: int(resolved) },
        { label: 'Délai moyen de résolution', value: resolved ? `${Math.round(resolutionWeighted / resolved / 60)} h` : '—' },
        { label: 'Commandes remboursées', value: eur(k.refundsCents) },
      ];
      break;
    }
    default:
      details = [
        { label: 'Volume d’affaires TTC', value: `${eur(k.gmvCents)}${delta(k.gmvCents, p.gmvCents)}` },
        { label: 'Commandes', value: `${int(k.ordersPlaced)}${delta(k.ordersPlaced, p.ordersPlaced)}` },
        { label: 'Panier moyen', value: eur(k.averageBasketCents) },
        { label: 'Taux d’annulation', value: pct(k.cancellationRate) },
        { label: 'Commissions HT', value: eur(k.commissionHtCents) },
        { label: 'Nouveaux clients', value: int(k.customersNew) },
      ];
  }

  // Pièce jointe.
  const entity = ATTACHMENT_ENTITY[report.report];
  let table: TableDocument;
  if (entity === 'ranking') {
    table = await rankingTable(scope, period.from, period.to);
    const top = table.rows.slice(0, 5);
    if (top.length) {
      paragraphs.push('Meilleures ventes de la période :');
      top.forEach((row, i) => paragraphs.push(`${i + 1}. ${String(row.name)} — ${eur(Number(row.sales))} (${int(Number(row.orders))} commandes)`));
    }
    if (report.report === 'restaurants') {
      // KPI dédiés commerces (cahier §4 « contenu du récapitulatif ») : calculés à partir
      // des mêmes lignes que la pièce jointe (aucune requête supplémentaire).
      const count = table.rows.length;
      const totalSales = table.rows.reduce((s, row) => s + Number(row.sales), 0);
      const totalCommission = table.rows.reduce((s, row) => s + Number(row.commission), 0);
      const totalOrders = table.rows.reduce((s, row) => s + Number(row.orders), 0);
      const avgCancellation = totalOrders ? table.rows.reduce((s, row) => s + Number(row.cancellation) * Number(row.orders), 0) / totalOrders : 0;
      const rated = table.rows.filter((row) => row.rating != null);
      const avgRating = rated.length ? rated.reduce((s, row) => s + Number(row.rating), 0) / rated.length : null;
      details = [
        { label: 'Commerces dans le périmètre', value: int(count) },
        { label: 'CA total TTC', value: eur(totalSales) },
        { label: 'Commissions HT', value: eur(totalCommission) },
        { label: 'Taux d’annulation moyen', value: pct(avgCancellation) },
        { label: 'Note moyenne', value: avgRating != null ? avgRating.toFixed(1) : '—' },
      ];
    }
  } else {
    const ctx: ExportContext = {
      admin: owner,
      scope,
      filters: { from: period.from, to: period.to, countryId: scope.countryId, cityIds: scope.cityIds },
      showPersonal: adminHasPermission(owner, 'personal_data.view'),
      limit: report.format === 'pdf' ? 3_000 : 20_000,
    };
    table = await buildEntityTable(entity, ctx);
    if (report.report === 'drivers') {
      // KPI dédiés livreurs (cahier §4 « contenu du récapitulatif ») : agrégés à partir des
      // mêmes lignes que la pièce jointe (`deliveries`/`acceptance`/`onTime`/`rating`
      // proviennent de `Driver.stats`, cumulés depuis l'inscription — pas de série sur la
      // période, limite documentée comme pour l'export lui-même).
      const count = table.rows.length;
      const totalDeliveries = table.rows.reduce((s, row) => s + Number(row.deliveries ?? 0), 0);
      const withAcceptance = table.rows.filter((row) => row.acceptance != null);
      const avgAcceptance = withAcceptance.length ? withAcceptance.reduce((s, row) => s + Number(row.acceptance), 0) / withAcceptance.length : null;
      const withOnTime = table.rows.filter((row) => row.onTime != null);
      const avgOnTime = withOnTime.length ? withOnTime.reduce((s, row) => s + Number(row.onTime), 0) / withOnTime.length : null;
      const rated = table.rows.filter((row) => row.rating != null);
      const avgRating = rated.length ? rated.reduce((s, row) => s + Number(row.rating), 0) / rated.length : null;
      details = [
        { label: 'Livreurs dans le périmètre', value: int(count) },
        { label: 'Livraisons cumulées', value: int(totalDeliveries) },
        { label: 'Taux d’acceptation moyen', value: avgAcceptance != null ? pct(avgAcceptance) : '—' },
        { label: 'Ponctualité moyenne', value: avgOnTime != null ? pct(avgOnTime) : '—' },
        { label: 'Note moyenne', value: avgRating != null ? avgRating.toFixed(1) : '—' },
      ];
    }
  }
  if (report.report === 'daily_summary') {
    const alerts = await db.collection(COLLECTIONS.platformAlerts).where('status', '==', 'open').select('cityId', 'queue').get();
    const visible = alerts.docs.filter((d) => !scope.cityIds || !d.get('cityId') || scope.cityIds.includes(d.get('cityId') as string));
    const open = visible.filter((d) => d.get('queue') === 'alert').length;
    const todo = visible.filter((d) => d.get('queue') === 'todo').length;
    paragraphs.push(open || todo ? `À surveiller : ${open} alerte${open > 1 ? 's' : ''} ouverte${open > 1 ? 's' : ''} et ${todo} élément${todo > 1 ? 's' : ''} à traiter.` : 'Aucune alerte ouverte : la plateforme fonctionne normalement.');
  }
  table.title = `${REPORT_KIND_LABELS[report.report]} · ${report.name}`;
  table.subtitle = `${periodLabel.charAt(0).toUpperCase()}${periodLabel.slice(1)} · ${scopeLabel}`;
  table.summary = details.map((d) => ({ label: d.label, value: d.value.replace(/ \(.*\)$/, '') }));
  const buffer = render(table, report.format);
  paragraphs.push(`Le détail figure dans la pièce jointe (${report.format.toUpperCase()}).`);

  const subject = `Ciyou Eats · ${report.name} · ${period.from === period.to ? frDay(period.from) : `${frDay(period.from)} – ${frDay(period.to)}`}`;
  const message: EmailMessage = {
    subject,
    ...renderEmail({
      preheader: `${details[0]?.label ?? 'Rapport'} : ${details[0]?.value ?? ''}`,
      eyebrow: `${REPORT_KIND_LABELS[report.report]} · ${REPORT_FREQUENCY_LABELS[report.frequency]}`,
      title: report.name,
      paragraphs,
      details,
      cta: { label: 'Ouvrir le tableau de bord', url: `${APP_URLS.admin}/` },
      footerReason: 'Vous recevez ce rapport car votre adresse figure parmi ses destinataires dans l’administration Ciyou Eats.',
    }),
  };
  const stamp = period.from === period.to ? period.from : `${period.from}_${period.to}`;
  return { message, attachment: { name: `golink-${report.report}-${stamp}.${report.format}`, buffer }, period };
}

// Adresse de démonstration (données de seed) : jamais de véritable envoi tant que
// le client n'a pas renseigné une vraie adresse dans les destinataires du rapport.
const RESERVED_DOMAINS = /\.(test|example|invalid|localhost)$/i;

async function deliver(id: string, report: ScheduledReport, built: BuiltReport): Promise<{ sent: number; failed: number; skipped: number; error: string | null }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let error: string | null = null;
  for (const recipient of report.recipients) {
    if (RESERVED_DOMAINS.test(recipient)) {
      skipped += 1;
      continue;
    }
    const result = await sendEmail({
      to: { email: recipient },
      message: built.message,
      recipientType: 'admin',
      recipientId: id,
      templateKey: 'scheduled_report',
      tags: [report.report],
      attachments: [{ name: built.attachment.name, contentBase64: built.attachment.buffer.toString('base64') }],
    });
    if (result.ok) sent += 1;
    else {
      failed += 1;
      error = result.error;
    }
  }
  return { sent, failed, skipped, error };
}

/** Statut honnête du dernier envoi : `sent` exige au moins un e-mail réellement parti. */
function outcomeStatus(outcome: { sent: number; failed: number; skipped: number }): 'sent' | 'partial' | 'failed' | 'skipped' {
  if (outcome.sent === 0 && outcome.failed === 0) return 'skipped';
  if (outcome.failed === 0) return 'sent';
  return outcome.sent > 0 ? 'partial' : 'failed';
}

/** Envoie les rapports arrivés à échéance (toutes les heures, à 5 minutes). */
export const runScheduledReports = onSchedule(
  { schedule: '5 * * * *', timeZone: TIMEZONE, retryCount: 0, secrets: EMAIL_SECRETS, ...PILOTAGE_HEAVY_RUNTIME, timeoutSeconds: 540 },
  async () => {
    const now = new Date();
    const due = await db.collection(COLLECTIONS.scheduledReports).where('active', '==', true).where('nextRunAt', '<=', Timestamp.fromDate(now)).limit(50).get();
    for (const doc of due.docs) {
      const report = doc.data() as ScheduledReport;
      const next = Timestamp.fromDate(nextReportRun(report.frequency, report.hour ?? 7, now));
      try {
        const owner = report.createdBy ? await loadAdmin(report.createdBy) : null;
        if (!owner?.active || !adminHasPermission(owner, 'reports.view')) {
          await doc.ref.update({ nextRunAt: next, lastRunStatus: 'failed', lastRunError: 'L’auteur du rapport n’a plus accès aux rapports.' });
          continue;
        }
        const built = await buildReport(report, owner, reportPeriod(report.frequency, parisDay(now)));
        const outcome = await deliver(doc.id, report, built);
        await doc.ref.update({
          lastRunAt: FieldValue.serverTimestamp(),
          nextRunAt: next,
          lastRunStatus: outcomeStatus(outcome),
          lastRunError: outcome.error ?? (outcome.skipped > 0 && outcome.sent === 0 ? 'Aucun destinataire réel (domaines de test uniquement).' : null),
          lastRunSentCount: outcome.sent,
          runsCount: FieldValue.increment(1),
        });
      } catch (error) {
        logger.error('Rapport programmé en échec', { reportId: doc.id, error: error instanceof Error ? error.stack : String(error) });
        await doc.ref.update({ nextRunAt: next, lastRunStatus: 'failed', lastRunError: 'Erreur lors de la préparation du rapport.' });
      }
    }
  },
);

const zReportInput = z.object({
  id: zId.nullish(),
  name: z.string().trim().min(3, 'Nom trop court').max(80),
  report: z.enum(['daily_summary', 'finance', 'orders', 'restaurants', 'drivers', 'support']),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(zEmail).min(1, 'Ajoutez au moins un destinataire').max(10, '10 destinataires au maximum'),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  hour: z.number().int().min(0).max(23),
  countryId: z.string().trim().max(8).nullish(),
  cityIds: z.array(z.string().trim().min(1).max(64)).max(30).nullish(),
  active: z.boolean(),
  reason: zReason,
});

export const saveScheduledReport = pilotageCallable(zReportInput, async (data, request): Promise<{ id: string; nextRunAt: string }> => {
  const { caller, admin } = await requireAdmin(request, 'reports.schedule');
  // Vérifie que le périmètre demandé est couvert par l'auteur.
  await resolveScope(admin, { countryId: data.countryId ?? null, cityIds: data.cityIds ?? null });
  const ref = data.id ? db.collection(COLLECTIONS.scheduledReports).doc(data.id) : db.collection(COLLECTIONS.scheduledReports).doc();
  const existing = data.id ? await ref.get() : null;
  if (data.id && !existing?.exists) throw fail.notFound('Rapport');
  const nextRunAt = nextReportRun(data.frequency, data.hour, new Date());
  const payload = {
    name: data.name,
    report: data.report,
    frequency: data.frequency,
    recipients: [...new Set(data.recipients)],
    filters: { countryId: data.countryId ?? null, cityIds: data.cityIds?.length ? data.cityIds : null },
    format: data.format,
    hour: data.hour,
    active: data.active,
    nextRunAt: Timestamp.fromDate(nextRunAt),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  };
  if (existing?.exists) await ref.update(payload);
  else await ref.set({ ...payload, lastRunAt: null, lastRunStatus: null, lastRunError: null, runsCount: 0, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: existing?.exists ? 'report.updated' : 'report.scheduled',
    target: { type: 'other', id: ref.id, label: data.name },
    reason: data.reason,
    before: existing?.exists ? { recipients: existing.get('recipients'), frequency: existing.get('frequency'), active: existing.get('active') } : null,
    after: { recipients: payload.recipients, frequency: data.frequency, report: data.report, format: data.format, active: data.active },
    countryId: data.countryId ?? null,
    request,
  });
  return { id: ref.id, nextRunAt: nextRunAt.toISOString() };
});

export const deleteScheduledReport = pilotageCallable(z.object({ id: zId, reason: zReason }), async (data, request): Promise<{ ok: true }> => {
  const { caller } = await requireAdmin(request, 'reports.schedule');
  const ref = db.collection(COLLECTIONS.scheduledReports).doc(data.id);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Rapport');
  await ref.delete();
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'report.deleted',
    target: { type: 'other', id: data.id, label: snap.get('name') as string },
    reason: data.reason,
    before: { name: snap.get('name'), recipients: snap.get('recipients'), frequency: snap.get('frequency') },
    request,
  });
  return { ok: true };
});

/** Aperçu (dryRun, aucun envoi) ou envoi immédiat d'un rapport sur sa dernière période. */
export const runReportNow = pilotageCallable(
  z.object({ id: zId, dryRun: z.boolean(), reason: zReason.nullish() }),
  async (data, request): Promise<RunReportNowResult> => {
    const { caller, admin } = await requireAdmin(request, data.dryRun ? 'reports.view' : 'reports.schedule');
    if (!data.dryRun && !data.reason) throw fail.invalid('Indiquez le motif de l’envoi immédiat du rapport.');
    const ref = db.collection(COLLECTIONS.scheduledReports).doc(data.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Rapport');
    const report = snap.data() as ScheduledReport;
    const built = await buildReport(report, admin, reportPeriod(report.frequency, parisDay(new Date())));
    let sent = 0;
    let failed = 0;
    if (!data.dryRun) {
      const outcome = await deliver(ref.id, report, built);
      sent = outcome.sent;
      failed = outcome.failed;
      await ref.update({
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunStatus: outcomeStatus(outcome),
        lastRunError: outcome.error ?? (outcome.skipped > 0 && outcome.sent === 0 ? 'Aucun destinataire réel (domaines de test uniquement).' : null),
        lastRunSentCount: outcome.sent,
        runsCount: FieldValue.increment(1),
      });
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'report.sent',
        target: { type: 'other', id: ref.id, label: report.name },
        reason: data.reason ?? null,
        after: { recipients: report.recipients.length, sent, failed },
        request,
      });
    }
    return {
      sent,
      failed,
      subject: built.message.subject,
      html: built.message.html,
      period: built.period,
      attachmentName: built.attachment.name,
    };
  },
  { ...PILOTAGE_HEAVY_RUNTIME, secrets: EMAIL_SECRETS },
);

