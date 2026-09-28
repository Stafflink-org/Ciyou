// Exports filtrés (cahier §4) : restaurants, clients, livreurs, commandes,
// reversements, factures, abonnements, statistiques, tickets, avis, en CSV, Excel
// ou PDF. Droit `exports.run` + droit de consultation de l'entité ; périmètre
// géographique imposé ; coordonnées masquées sans `personal_data.view`. Chaque
// export est journalisé (bulkJobs, auditLogs) ; un export volumineux lève une
// alerte de sécurité `mass_export`.
import {
  COLLECTIONS,
  DRIVER_STATUS_LABELS,
  DRIVER_AVAILABILITY_LABELS,
  EXPORT_ENTITY_LABELS,
  EXPORT_ENTITY_PERMISSIONS,
  FULFILLMENT_LABELS,
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYOUT_STATUS_LABELS,
  RESTAURANT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  VEHICLE_LABELS,
  adminHasPermission,
  maskEmail,
  maskPhone,
  type AdminUser,
  type DailyStats,
  type Driver,
  type ExportDataResult,
  type ExportEntity,
  type ExportFilters,
  type ExportFormat,
  type Invoice,
  type Order,
  type Payout,
  type Restaurant,
  type Review,
  type Subscription,
  type SupportTicket,
  type UserProfile,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { loadLimitsSettings } from '../../lib/limits';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { loadSecurityPolicy } from '../../platform/runtime';
import { platformDaily, restaurantsInScope } from './data';
import { zDay } from './overview';
import { PILOTAGE_HEAVY_RUNTIME, pilotageCallable } from './runtime';
import { chunks, cityAllowed, resolveScope, type ResolvedScope } from './scope';
import { MIME_TYPES, render, type TableColumn, type TableDocument, type TableValue } from './tabular';
import { listDays, parisDay, rangeBounds } from './time';

const iso = (ts: { toDate(): Date } | null | undefined) => (ts ? ts.toDate().toISOString() : null);
const label = <K extends string>(map: Record<K, string>, key: string | null | undefined) => (key ? (map[key as K] ?? key) : null);
const USER_STATUS: Record<string, string> = { active: 'Actif', blocked: 'Bloqué', pending_deletion: 'Suppression demandée', deleted: 'Supprimé' };

export interface ExportContext {
  admin: AdminUser;
  scope: ResolvedScope;
  filters: ExportFilters;
  showPersonal: boolean;
  limit: number;
}

type Built = { columns: TableColumn[]; rows: Array<Record<string, TableValue>>; truncated: boolean };

/** Requête bornée par période sur `field`, restreinte aux villes du périmètre. */
async function scopedQuery(
  ctx: ExportContext,
  collection: string,
  field: string | null,
  extra?: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query,
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; truncated: boolean }> {
  let base: FirebaseFirestore.Query = db.collection(collection);
  if (extra) base = extra(base);
  if (field && ctx.filters.from && ctx.filters.to) {
    const { start, end } = rangeBounds(ctx.filters.from, ctx.filters.to);
    base = base.where(field, '>=', Timestamp.fromDate(start)).where(field, '<', Timestamp.fromDate(end)).orderBy(field, 'desc');
  }
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let truncated = false;
  const run = async (query: FirebaseFirestore.Query) => {
    const snap = await query.limit(ctx.limit + 1 - docs.length).get();
    if (snap.size > ctx.limit - docs.length) truncated = true;
    docs.push(...snap.docs.slice(0, ctx.limit - docs.length));
  };
  if (ctx.scope.cityIds) {
    for (const ids of chunks(ctx.scope.cityIds)) {
      if (ids.length && docs.length < ctx.limit) await run(base.where('cityId', 'in', ids));
    }
  } else await run(base);
  return { docs, truncated };
}

const cityName = (ctx: ExportContext, cityId: string | null | undefined) => (cityId ? (ctx.scope.markets.cities.get(cityId)?.name ?? cityId) : null);
const email = (ctx: ExportContext, value: string | null | undefined) => (value ? (ctx.showPersonal ? value : maskEmail(value)) : null);
const phone = (ctx: ExportContext, value: string | null | undefined) => (value ? (ctx.showPersonal ? value : maskPhone(value)) : null);

const BUILDERS: Record<ExportEntity, (ctx: ExportContext) => Promise<Built>> = {
  async restaurants(ctx) {
    const list = (await restaurantsInScope(ctx.scope, ctx.filters.planCode)).filter((r) => !ctx.filters.status || r.status === ctx.filters.status);
    const rows = list.slice(0, ctx.limit).map((r: Restaurant & { id: string }) => ({
      id: r.id,
      name: r.name,
      city: cityName(ctx, r.cityId),
      status: label(RESTAURANT_STATUS_LABELS, r.status),
      onboarding: label(ONBOARDING_STATUS_LABELS, r.onboardingStatus),
      plan: r.planCode,
      email: email(ctx, r.email),
      phone: phone(ctx, r.phone),
      rating: r.rating?.average ?? null,
      ratingCount: r.rating?.count ?? 0,
      orders: r.ordersCount ?? 0,
      createdAt: iso(r.createdAt),
    }));
    return {
      columns: [
        { key: 'id', label: 'Identifiant', width: 1.2 },
        { key: 'name', label: 'Commerce', width: 1.8 },
        { key: 'city', label: 'Ville' },
        { key: 'status', label: 'Statut' },
        { key: 'onboarding', label: 'Inscription' },
        { key: 'plan', label: 'Formule', width: 0.8 },
        { key: 'email', label: 'E-mail', width: 1.8 },
        { key: 'phone', label: 'Téléphone', width: 1.2 },
        { key: 'rating', label: 'Note', type: 'number', width: 0.6 },
        { key: 'ratingCount', label: 'Avis', type: 'number', width: 0.6 },
        { key: 'orders', label: 'Commandes', type: 'number', width: 0.8 },
        { key: 'createdAt', label: 'Inscrit le', type: 'date' },
      ],
      rows,
      truncated: list.length > ctx.limit,
    };
  },

  async clients(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.users, 'createdAt', (q) => q.where('role', '==', 'client'));
    const rows = docs
      .map((doc) => ({ id: doc.id, u: doc.data() as UserProfile }))
      .filter(({ u }) => !ctx.filters.status || u.status === ctx.filters.status)
      .map(({ id, u }) => ({
        id,
        name: u.displayName,
        email: email(ctx, u.email),
        phone: phone(ctx, u.phone),
        city: cityName(ctx, u.cityId),
        status: USER_STATUS[u.status] ?? u.status,
        orders: u.stats?.ordersCount ?? 0,
        spent: u.stats?.totalSpentCents ?? 0,
        lastOrderAt: iso(u.stats?.lastOrderAt),
        createdAt: iso(u.createdAt),
      }));
    return {
      columns: [
        { key: 'id', label: 'Identifiant', width: 1.2 },
        { key: 'name', label: 'Client', width: 1.4 },
        { key: 'email', label: 'E-mail', width: 1.8 },
        { key: 'phone', label: 'Téléphone', width: 1.2 },
        { key: 'city', label: 'Ville' },
        { key: 'status', label: 'Statut' },
        { key: 'orders', label: 'Commandes', type: 'number', width: 0.8 },
        { key: 'spent', label: 'Dépenses', type: 'money' },
        { key: 'lastOrderAt', label: 'Dernière commande', type: 'date' },
        { key: 'createdAt', label: 'Inscrit le', type: 'date' },
      ],
      rows,
      truncated,
    };
  },

  async drivers(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.drivers, null);
    const rows = docs
      .map((doc) => ({ id: doc.id, d: doc.data() as Driver }))
      .filter(({ d }) => !d.deletedAt && (!ctx.filters.status || d.status === ctx.filters.status))
      .map(({ id, d }) => ({
        id,
        name: `${d.firstName} ${d.lastName}`.trim(),
        email: email(ctx, d.email),
        phone: phone(ctx, d.phone),
        city: cityName(ctx, d.cityId),
        type: d.type === 'restaurant' ? 'Salarié commerce' : 'Indépendant',
        vehicle: label(VEHICLE_LABELS, d.vehicle?.type),
        status: label(DRIVER_STATUS_LABELS, d.status),
        availability: label(DRIVER_AVAILABILITY_LABELS, d.availability),
        deliveries: d.stats?.deliveries ?? 0,
        acceptance: d.stats?.acceptanceRate ?? null,
        onTime: d.stats?.onTimeRate ?? null,
        rating: d.rating?.average ?? null,
        createdAt: iso(d.createdAt),
      }));
    return {
      columns: [
        { key: 'id', label: 'Identifiant', width: 1.2 },
        { key: 'name', label: 'Livreur', width: 1.3 },
        { key: 'email', label: 'E-mail', width: 1.6 },
        { key: 'phone', label: 'Téléphone', width: 1.1 },
        { key: 'city', label: 'Ville' },
        { key: 'type', label: 'Type' },
        { key: 'vehicle', label: 'Véhicule', width: 0.8 },
        { key: 'status', label: 'Statut', width: 0.8 },
        { key: 'availability', label: 'Disponibilité', width: 0.9 },
        { key: 'deliveries', label: 'Livraisons', type: 'number', width: 0.8 },
        { key: 'acceptance', label: 'Acceptation', type: 'percent', width: 0.8 },
        { key: 'onTime', label: 'Ponctualité', type: 'percent', width: 0.8 },
        { key: 'rating', label: 'Note', type: 'number', width: 0.6 },
        { key: 'createdAt', label: 'Inscrit le', type: 'date' },
      ],
      rows,
      truncated,
    };
  },

  async orders(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.orders, 'createdAt');
    const rows = docs
      .map((doc) => ({ id: doc.id, o: doc.data() as Order }))
      .filter(({ o }) => !ctx.filters.status || o.status === ctx.filters.status)
      .map(({ id, o }) => ({
        number: o.number,
        id,
        createdAt: iso(o.createdAt),
        city: cityName(ctx, o.cityId),
        restaurant: o.restaurantName,
        customer: o.customerName,
        fulfillment: label(FULFILLMENT_LABELS, o.fulfillment),
        status: label(ORDER_STATUS_LABELS, o.status),
        payment: label(PAYMENT_METHOD_LABELS, o.payment?.method),
        items: o.itemsCount,
        subtotal: o.amounts.subtotalCents,
        delivery: o.amounts.deliveryFeeCents,
        discount: o.amounts.discount?.totalCents ?? 0,
        tip: o.amounts.tipCents,
        total: o.amounts.totalCents,
        refunded: o.amounts.refundedCents,
        late: o.flags?.late ?? false,
      }));
    return {
      columns: [
        { key: 'number', label: 'Commande', width: 0.9 },
        { key: 'createdAt', label: 'Date', type: 'datetime', width: 1.1 },
        { key: 'city', label: 'Ville', width: 0.8 },
        { key: 'restaurant', label: 'Commerce', width: 1.3 },
        { key: 'customer', label: 'Client', width: 1 },
        { key: 'fulfillment', label: 'Mode', width: 0.8 },
        { key: 'status', label: 'Statut', width: 0.9 },
        { key: 'payment', label: 'Paiement', width: 0.9 },
        { key: 'items', label: 'Articles', type: 'number', width: 0.5 },
        { key: 'subtotal', label: 'Articles TTC', type: 'money', width: 0.9 },
        { key: 'delivery', label: 'Livraison', type: 'money', width: 0.8 },
        { key: 'discount', label: 'Remise', type: 'money', width: 0.8 },
        { key: 'tip', label: 'Pourboire', type: 'money', width: 0.8 },
        { key: 'total', label: 'Total TTC', type: 'money', width: 0.9 },
        { key: 'refunded', label: 'Remboursé', type: 'money', width: 0.9 },
        { key: 'late', label: 'En retard', width: 0.6 },
      ],
      rows,
      truncated,
    };
  },

  async payouts(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.payouts, 'scheduledFor');
    const rows = docs
      .map((doc) => ({ id: doc.id, p: doc.data() as Payout }))
      .filter(({ p }) => !ctx.filters.status || p.status === ctx.filters.status)
      .map(({ id, p }) => ({
        id,
        beneficiary: p.beneficiaryName,
        type: p.beneficiaryType === 'driver' ? 'Livreur' : 'Commerce',
        city: cityName(ctx, p.cityId),
        period: `${p.periodStart.split('-').reverse().join('/')} → ${p.periodEnd.split('-').reverse().join('/')}`,
        gross: p.grossCents,
        commission: p.commissionCents,
        refunds: p.refundsChargedCents,
        adjustments: p.adjustmentsCents,
        tips: p.tipsCents,
        net: p.netCents,
        status: label(PAYOUT_STATUS_LABELS, p.status),
        scheduledFor: iso(p.scheduledFor),
        paidAt: iso(p.paidAt),
      }));
    return {
      columns: [
        { key: 'beneficiary', label: 'Bénéficiaire', width: 1.4 },
        { key: 'type', label: 'Type', width: 0.7 },
        { key: 'city', label: 'Ville', width: 0.8 },
        { key: 'period', label: 'Période', width: 1.4 },
        { key: 'gross', label: 'Brut', type: 'money' },
        { key: 'commission', label: 'Commission', type: 'money' },
        { key: 'refunds', label: 'Remboursements', type: 'money' },
        { key: 'adjustments', label: 'Ajustements', type: 'money' },
        { key: 'tips', label: 'Pourboires', type: 'money' },
        { key: 'net', label: 'Net versé', type: 'money' },
        { key: 'status', label: 'Statut', width: 0.8 },
        { key: 'scheduledFor', label: 'Prévu le', type: 'date' },
        { key: 'paidAt', label: 'Payé le', type: 'date' },
      ],
      rows,
      truncated,
    };
  },

  async invoices(ctx) {
    // Les factures ne portent pas toujours de ville : filtre par pays puis par ville connue.
    const scopeless: ExportContext = { ...ctx, scope: { ...ctx.scope, cityIds: null } };
    const { docs, truncated } = await scopedQuery(scopeless, COLLECTIONS.invoices, 'issuedAt');
    const rows = docs
      .map((doc) => ({ id: doc.id, inv: doc.data() as Invoice }))
      .filter(({ inv }) => (!ctx.scope.countryId || inv.countryId === ctx.scope.countryId) && (!inv.cityId || cityAllowed(ctx.scope, inv.cityId)))
      .filter(({ inv }) => !ctx.scope.cityIds || inv.cityId || ctx.admin.cityIds.length === 0)
      .filter(({ inv }) => !ctx.filters.status || inv.status === ctx.filters.status)
      .map(({ inv }) => ({
        number: inv.number,
        kind: label(INVOICE_KIND_LABELS, inv.kind),
        issuedAt: iso(inv.issuedAt),
        recipient: inv.recipient?.name ?? null,
        recipientType: inv.recipient?.type ?? null,
        ht: inv.totalHtCents,
        vat: inv.totalVatCents,
        ttc: inv.totalTtcCents,
        status: label(INVOICE_STATUS_LABELS, inv.status),
        period: inv.periodStart && inv.periodEnd ? `${inv.periodStart.split('-').reverse().join('/')} → ${inv.periodEnd.split('-').reverse().join('/')}` : null,
      }));
    return {
      columns: [
        { key: 'number', label: 'Numéro', width: 1.4 },
        { key: 'kind', label: 'Type', width: 1.3 },
        { key: 'issuedAt', label: 'Émise le', type: 'date', width: 0.9 },
        { key: 'recipient', label: 'Destinataire', width: 1.5 },
        { key: 'period', label: 'Période', width: 1.4 },
        { key: 'ht', label: 'Total HT', type: 'money' },
        { key: 'vat', label: 'TVA', type: 'money' },
        { key: 'ttc', label: 'Total TTC', type: 'money' },
        { key: 'status', label: 'Statut', width: 0.8 },
      ],
      rows,
      truncated,
    };
  },

  async subscriptions(ctx) {
    const restaurants = await restaurantsInScope(ctx.scope);
    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    const snap = await db.collection(COLLECTIONS.subscriptions).get();
    const list = snap.docs
      .map((doc) => ({ id: doc.id, s: doc.data() as Subscription }))
      .filter(({ s }) => (s.restaurantIds?.length ? s.restaurantIds : [s.subscriberId]).some((id) => names.has(id)))
      .filter(({ s }) => (!ctx.filters.planCode || s.planCode === ctx.filters.planCode) && (!ctx.filters.status || s.status === ctx.filters.status));
    return {
      columns: [
        { key: 'subscriber', label: 'Commerce', width: 1.5 },
        { key: 'plan', label: 'Formule', width: 0.8 },
        { key: 'status', label: 'Statut' },
        { key: 'cycle', label: 'Facturation', width: 0.8 },
        { key: 'price', label: 'Prix HT', type: 'money' },
        { key: 'periodEnd', label: 'Fin de période', type: 'date' },
        { key: 'cancelAtPeriodEnd', label: 'Résiliation programmée', width: 0.9 },
        { key: 'dunning', label: 'Relances', type: 'number', width: 0.6 },
        { key: 'createdAt', label: 'Souscrit le', type: 'date' },
      ],
      rows: list.slice(0, ctx.limit).map(({ s }) => ({
        subscriber: names.get(s.subscriberId) ?? s.subscriberId,
        plan: s.planCode,
        status: label(SUBSCRIPTION_STATUS_LABELS, s.status),
        cycle: s.billingCycle === 'yearly' ? 'Annuelle' : 'Mensuelle',
        price: s.priceHtCents,
        periodEnd: iso(s.currentPeriodEnd),
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        dunning: s.dunning?.attempts ?? 0,
        createdAt: iso(s.createdAt),
      })),
      truncated: list.length > ctx.limit,
    };
  },

  async stats(ctx) {
    const from = ctx.filters.from ?? parisDay(new Date(Date.now() - 29 * 86_400_000));
    const to = ctx.filters.to ?? parisDay(new Date());
    const byDay = await platformDaily(ctx.scope, from, to);
    const rows = listDays(from, to).map((day) => {
      const list: DailyStats[] = byDay.get(day) ?? [];
      const sum = (pick: (s: DailyStats) => number) => list.reduce((t, s) => t + pick(s), 0);
      const delivered = sum((s) => s.orders.delivered);
      const placed = sum((s) => s.orders.placed);
      const gmv = sum((s) => s.revenue.gmvCents);
      return {
        day,
        placed,
        delivered,
        cancelled: sum((s) => s.orders.cancelled),
        cancellationRate: placed ? sum((s) => s.orders.cancelled) / placed : 0,
        gmv,
        sales: sum((s) => s.revenue.restaurantSalesCents),
        commission: sum((s) => s.revenue.commissionHtCents),
        fees: sum((s) => s.revenue.feesHtCents),
        subscriptions: sum((s) => s.revenue.subscriptionsHtCents),
        refunds: sum((s) => s.revenue.refundsCents),
        margin: sum((s) => s.revenue.marginCents),
        basket: delivered ? Math.round(gmv / delivered) : 0,
        customersNew: sum((s) => s.actors.customersNew),
      };
    });
    return {
      columns: [
        { key: 'day', label: 'Jour', type: 'date', width: 0.9 },
        { key: 'placed', label: 'Commandes', type: 'number', width: 0.8 },
        { key: 'delivered', label: 'Livrées', type: 'number', width: 0.7 },
        { key: 'cancelled', label: 'Annulées', type: 'number', width: 0.7 },
        { key: 'cancellationRate', label: 'Annulation', type: 'percent', width: 0.8 },
        { key: 'gmv', label: 'Volume d’affaires', type: 'money' },
        { key: 'sales', label: 'CA commerces', type: 'money' },
        { key: 'commission', label: 'Commissions HT', type: 'money' },
        { key: 'fees', label: 'Frais HT', type: 'money' },
        { key: 'subscriptions', label: 'Abonnements HT', type: 'money' },
        { key: 'refunds', label: 'Remboursements', type: 'money' },
        { key: 'margin', label: 'Marge', type: 'money' },
        { key: 'basket', label: 'Panier moyen', type: 'money' },
        { key: 'customersNew', label: 'Nouveaux clients', type: 'number', width: 0.8 },
      ],
      rows,
      truncated: false,
    };
  },

  async tickets(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.supportTickets, 'createdAt');
    const rows = docs
      .map((doc) => doc.data() as SupportTicket)
      .filter((t) => !ctx.filters.status || t.status === ctx.filters.status)
      .map((t) => ({
        number: t.number,
        createdAt: iso(t.createdAt),
        requester: t.requesterName,
        requesterType: t.requesterType,
        city: cityName(ctx, t.cityId),
        subject: t.subject,
        priority: label(TICKET_PRIORITY_LABELS, t.priority),
        status: label(TICKET_STATUS_LABELS, t.status),
        escalated: t.escalated,
        firstResponseAt: iso(t.firstResponseAt),
        resolvedAt: iso(t.resolvedAt),
        compensation: t.compensationCents,
      }));
    return {
      columns: [
        { key: 'number', label: 'Ticket', width: 0.8 },
        { key: 'createdAt', label: 'Ouvert le', type: 'datetime' },
        { key: 'requester', label: 'Demandeur', width: 1.4 },
        { key: 'city', label: 'Ville', width: 0.8 },
        { key: 'subject', label: 'Objet', width: 2 },
        { key: 'priority', label: 'Priorité', width: 0.7 },
        { key: 'status', label: 'Statut', width: 0.8 },
        { key: 'escalated', label: 'Escaladé', width: 0.6 },
        { key: 'firstResponseAt', label: 'Première réponse', type: 'datetime' },
        { key: 'resolvedAt', label: 'Résolu le', type: 'datetime' },
        { key: 'compensation', label: 'Geste commercial', type: 'money' },
      ],
      rows,
      truncated,
    };
  },

  async reviews(ctx) {
    const { docs, truncated } = await scopedQuery(ctx, COLLECTIONS.reviews, 'createdAt');
    const restaurants = await restaurantsInScope(ctx.scope);
    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    const rows = docs
      .map((doc) => doc.data() as Review)
      .filter((r) => !ctx.filters.status || r.status === ctx.filters.status)
      .map((r) => ({
        createdAt: iso(r.createdAt),
        restaurant: names.get(r.restaurantId) ?? r.restaurantId,
        city: cityName(ctx, r.cityId),
        customer: r.customerDisplayName,
        restaurantRating: r.restaurantRating,
        driverRating: r.driverRating ?? null,
        comment: r.comment ?? null,
        status: label(REVIEW_STATUS_LABELS, r.status),
        reply: r.reply?.text ?? null,
        reports: r.reportsCount ?? 0,
      }));
    return {
      columns: [
        { key: 'createdAt', label: 'Date', type: 'date', width: 0.8 },
        { key: 'restaurant', label: 'Commerce', width: 1.3 },
        { key: 'city', label: 'Ville', width: 0.8 },
        { key: 'customer', label: 'Client', width: 0.9 },
        { key: 'restaurantRating', label: 'Note commerce', type: 'number', width: 0.7 },
        { key: 'driverRating', label: 'Note livreur', type: 'number', width: 0.7 },
        { key: 'comment', label: 'Commentaire', width: 2.4 },
        { key: 'status', label: 'Statut', width: 0.8 },
        { key: 'reply', label: 'Réponse', width: 1.6 },
        { key: 'reports', label: 'Signalements', type: 'number', width: 0.7 },
      ],
      rows,
      truncated,
    };
  },
};

function describeFilters(ctx: ExportContext): string {
  const parts: string[] = [];
  if (ctx.filters.from && ctx.filters.to) parts.push(`du ${ctx.filters.from.split('-').reverse().join('/')} au ${ctx.filters.to.split('-').reverse().join('/')}`);
  if (ctx.scope.cityIds?.length) parts.push(ctx.scope.cityIds.map((id) => ctx.scope.markets.cities.get(id)?.name ?? id).join(', '));
  else if (ctx.scope.countryId) parts.push(ctx.scope.markets.countries.get(ctx.scope.countryId)?.name ?? ctx.scope.countryId);
  else parts.push('tous les marchés');
  if (ctx.filters.planCode) parts.push(`formule ${ctx.filters.planCode}`);
  if (ctx.filters.status) parts.push(`statut « ${ctx.filters.status} »`);
  return parts.join(' · ');
}

/** Construit le tableau d'une entité pour un export ou un rapport programmé. */
export async function buildEntityTable(entity: ExportEntity, ctx: ExportContext): Promise<TableDocument & { truncated: boolean }> {
  const built = await BUILDERS[entity](ctx);
  return {
    title: `Export ${EXPORT_ENTITY_LABELS[entity].toLowerCase()}`,
    subtitle: `${built.rows.length.toLocaleString('fr-FR')} ligne${built.rows.length > 1 ? 's' : ''} · ${describeFilters(ctx)}`,
    columns: built.columns,
    rows: built.rows,
    truncated: built.truncated,
  };
}

export const zExportFilters = z.object({
  from: zDay.nullish(),
  to: zDay.nullish(),
  countryId: z.string().trim().max(8).nullish(),
  cityIds: z.array(z.string().trim().min(1).max(64)).max(30).nullish(),
  status: z.string().trim().max(40).nullish(),
  planCode: z.enum(['basic', 'pro', 'premium']).nullish(),
});

export const exportData = pilotageCallable(
  z.object({
    entity: z.enum(['restaurants', 'clients', 'drivers', 'orders', 'payouts', 'invoices', 'subscriptions', 'stats', 'tickets', 'reviews']),
    format: z.enum(['csv', 'xlsx', 'pdf']),
    filters: zExportFilters,
    /** Motif obligatoire pour tout export (qui, quoi, quand, pourquoi). */
    reason: z.string().trim().min(3, 'Indiquez le motif de l’export.').max(300),
  }),
  async (data, request): Promise<ExportDataResult> => {
    const { caller, admin } = await requireAdmin(request, 'exports.run');
    const entity = data.entity as ExportEntity;
    if (!adminHasPermission(admin, EXPORT_ENTITY_PERMISSIONS[entity])) {
      throw fail.forbidden(`Vous n’avez pas accès aux données « ${EXPORT_ENTITY_LABELS[entity]} ».`);
    }
    if (data.filters.from && data.filters.to && data.filters.from > data.filters.to) throw fail.invalid('La date de début doit précéder la date de fin.');
    const scope = await resolveScope(admin, data.filters);
    const format = data.format as ExportFormat;
    const limits = await loadLimitsSettings();
    const maxRows: Record<ExportFormat, number> = { csv: limits.exports.csvMaxRows, xlsx: limits.exports.xlsxMaxRows, pdf: limits.exports.pdfMaxRows };
    const ctx: ExportContext = {
      admin,
      scope,
      filters: data.filters,
      showPersonal: adminHasPermission(admin, 'personal_data.view'),
      limit: maxRows[format],
    };
    const securityPolicy = await loadSecurityPolicy();
    const massExportRows = securityPolicy.alerts.massExportRows;
    const jobRef = db.collection(COLLECTIONS.bulkJobs).doc();
    const startedAt = FieldValue.serverTimestamp();
    const table = await buildEntityTable(entity, ctx);
    const buffer = render(table, format);
    if (buffer.length > 9_000_000) throw fail.precondition('Fichier trop volumineux : réduisez la période ou choisissez le format CSV.');
    const stamp = parisDay(new Date()).replaceAll('-', '');
    const fileName = `golink-${entity}-${stamp}.${format}`;
    await jobRef.set({
      type: 'export',
      entity,
      params: { ...data.filters, format },
      input: null,
      format,
      status: 'completed',
      total: table.rows.length,
      processed: table.rows.length,
      succeeded: table.rows.length,
      failed: 0,
      errors: [],
      output: null,
      reason: data.reason ?? null,
      startedAt,
      finishedAt: FieldValue.serverTimestamp(),
      fileName,
      truncated: table.truncated,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'export.generated',
      target: { type: 'other', id: jobRef.id, label: `${EXPORT_ENTITY_LABELS[entity]} (${format.toUpperCase()})` },
      reason: data.reason ?? null,
      after: { entity, format, rows: table.rows.length, filters: { ...data.filters } },
      countryId: scope.countryId,
      cityId: scope.cityIds?.length === 1 ? scope.cityIds[0] : null,
      sensitive: ['clients', 'drivers'].includes(entity) || table.rows.length >= massExportRows,
      request,
    });
    if (table.rows.length >= massExportRows || (ctx.showPersonal && ['clients', 'drivers'].includes(entity) && table.rows.length >= 200)) {
      await db.collection(COLLECTIONS.securityAlerts).add({
        type: 'mass_export',
        adminId: caller.uid,
        severity: table.rows.length >= massExportRows * 5 ? 'warning' : 'info',
        details: `Export de ${table.rows.length.toLocaleString('fr-FR')} lignes « ${EXPORT_ENTITY_LABELS[entity]} » par ${admin.displayName}.`,
        status: 'open',
        detectedAt: FieldValue.serverTimestamp(),
        handledBy: null,
        handledAt: null,
      });
    }
    return {
      jobId: jobRef.id,
      fileName,
      mimeType: MIME_TYPES[format],
      contentBase64: buffer.toString('base64'),
      rowCount: table.rows.length,
      truncated: table.truncated,
    };
  },
  PILOTAGE_HEAVY_RUNTIME,
);
