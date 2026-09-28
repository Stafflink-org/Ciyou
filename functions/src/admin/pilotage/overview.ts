// Tableau de bord global (cahier §1) : compteurs d'acteurs, activité récente et,
// quand une formule est choisie, indicateurs recalculés sur les restaurants de cette
// formule. Les chiffres clés sans filtre de formule sont lus en temps réel par
// l'application dans statsDaily.
import {
  COLLECTIONS,
  PILOTAGE_PLAN_CODES,
  type AuditLog,
  type Driver,
  type PilotageActivity,
  type PilotageCounters,
  type PilotageOverview,
  type Restaurant,
  type Subscription,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { requireAdmin } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { kpisFromRestaurants, restaurantDaily, restaurantsInScope } from './data';
import { pilotageCallable } from './runtime';
import { chunks, cityAllowed, resolveScope, type ResolvedScope } from './scope';
import { isIsoDay, listDays } from './time';

export const zDay = z.string().refine(isIsoDay, 'Date invalide (AAAA-MM-JJ)');
export const zFilters = {
  from: zDay,
  to: zDay,
  countryId: z.string().trim().max(8).nullish(),
  cityIds: z.array(z.string().trim().min(1).max(64)).max(30).nullish(),
  planCode: z.enum(PILOTAGE_PLAN_CODES as ['basic', 'pro', 'premium']).nullish(),
};

async function countWhere(base: FirebaseFirestore.Query, scope: ResolvedScope, field = 'cityId'): Promise<number> {
  if (!scope.cityIds) return (await base.count().get()).data().count;
  let total = 0;
  for (const ids of chunks(scope.cityIds)) {
    if (!ids.length) continue;
    total += (await base.where(field, 'in', ids).count().get()).data().count;
  }
  return total;
}

function monthlyPrice(s: Subscription): number {
  const discount = s.specialOffer?.discountBps ? 1 - s.specialOffer.discountBps / 10_000 : 1;
  const monthly = s.billingCycle === 'yearly' ? s.priceHtCents / 12 : s.priceHtCents;
  return Math.round(monthly * discount);
}

async function counters(scope: ResolvedScope, planCode: string | null | undefined): Promise<PilotageCounters> {
  const restaurants = await restaurantsInScope(scope, planCode as never);
  const byStatus = (status: Restaurant['status']) => restaurants.filter((r) => r.status === status).length;
  const users = db.collection(COLLECTIONS.users).where('role', '==', 'client');
  const since = Timestamp.fromMillis(Date.now() - 30 * 86_400_000);
  const drivers = db.collection(COLLECTIONS.drivers);
  const [registered, active30d, driversTotal, driversActive, driversOnline, driversOnDelivery, driversOnboarding] = await Promise.all([
    countWhere(users, scope),
    countWhere(users.where('stats.lastOrderAt', '>=', since), scope),
    countWhere(drivers, scope),
    countWhere(drivers.where('status', '==', 'active'), scope),
    countWhere(drivers.where('availability', '==', 'online'), scope),
    countWhere(drivers.where('availability', '==', 'on_delivery'), scope),
    countWhere(drivers.where('status', '==', 'onboarding'), scope),
  ]);
  const subsSnap = await db.collection(COLLECTIONS.subscriptions).get();
  const restaurantIds = new Set(restaurants.map((r) => r.id));
  const subs = subsSnap.docs
    .map((doc) => doc.data() as Subscription)
    .filter((s) => (!planCode || s.planCode === planCode) && (s.restaurantIds?.length ? s.restaurantIds : [s.subscriberId]).some((id) => restaurantIds.has(id)));
  const live = subs.filter((s) => s.status === 'active' || s.status === 'past_due');
  return {
    restaurants: {
      active: byStatus('active'),
      paused: byStatus('paused'),
      suspended: byStatus('suspended'),
      onboarding: byStatus('onboarding'),
      closed: byStatus('closed'),
      total: restaurants.length,
    },
    customers: { registered, active30d },
    drivers: { registered: driversTotal, active: driversActive, online: driversOnline + driversOnDelivery, onDelivery: driversOnDelivery, onboarding: driversOnboarding },
    subscriptions: {
      active: subs.filter((s) => s.status === 'active').length,
      trialing: subs.filter((s) => s.status === 'trialing').length,
      pastDue: subs.filter((s) => s.status === 'past_due' || s.status === 'restricted').length,
      cancelled: subs.filter((s) => s.status === 'cancelled').length,
      mrrCents: live.reduce((sum, s) => sum + monthlyPrice(s), 0),
    },
  };
}

const PLAN_LABEL: Record<string, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };

const AUDIT_ACTIVITY: Record<string, { title: string; tone: PilotageActivity['tone']; kind: PilotageActivity['kind'] }> = {
  'restaurant.approved': { title: 'Commerce validé', tone: 'success', kind: 'restaurant_status' },
  'restaurant.rejected': { title: 'Inscription refusée', tone: 'danger', kind: 'restaurant_status' },
  'restaurant.suspended': { title: 'Commerce suspendu', tone: 'danger', kind: 'restaurant_status' },
  'restaurant.reactivated': { title: 'Commerce réactivé', tone: 'success', kind: 'restaurant_status' },
  'restaurant.paused': { title: 'Commerce mis en pause', tone: 'warning', kind: 'restaurant_status' },
  'restaurant.plan_changed': { title: 'Changement de formule', tone: 'info', kind: 'plan_change' },
  'subscription.plan_changed': { title: 'Changement de formule', tone: 'info', kind: 'plan_change' },
  'subscription.cancelled': { title: 'Résiliation d’abonnement', tone: 'danger', kind: 'subscription_cancelled' },
  'driver.approved': { title: 'Livreur validé', tone: 'success', kind: 'driver_status' },
  'driver.rejected': { title: 'Candidature livreur refusée', tone: 'danger', kind: 'driver_status' },
  'driver.suspended': { title: 'Livreur suspendu', tone: 'danger', kind: 'driver_status' },
  'driver.reactivated': { title: 'Livreur réactivé', tone: 'success', kind: 'driver_status' },
  'city.launched': { title: 'Ville ouverte', tone: 'brand', kind: 'audit' },
};

async function activity(scope: ResolvedScope, names: Map<string, string>): Promise<PilotageActivity[]> {
  const items: PilotageActivity[] = [];
  const [restaurants, drivers, audit, subs] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection(COLLECTIONS.drivers).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection(COLLECTIONS.auditLogs).orderBy('at', 'desc').limit(120).get(),
    db.collection(COLLECTIONS.subscriptions).orderBy('updatedAt', 'desc').limit(40).get(),
  ]);
  for (const doc of restaurants.docs) {
    const r = doc.data() as Restaurant;
    if (!cityAllowed(scope, r.cityId) || !r.createdAt) continue;
    items.push({
      id: `r-${doc.id}`,
      kind: 'restaurant_signup',
      title: 'Nouvelle inscription commerce',
      detail: `${r.name} · ${scope.markets.cities.get(r.cityId)?.name ?? r.cityId}`,
      target: { type: 'restaurant', id: doc.id, label: r.name },
      cityId: r.cityId,
      tone: 'brand',
      at: r.createdAt.toDate().toISOString(),
    });
  }
  for (const doc of drivers.docs) {
    const d = doc.data() as Driver;
    if (!cityAllowed(scope, d.cityId) || !d.createdAt) continue;
    items.push({
      id: `d-${doc.id}`,
      kind: 'driver_signup',
      title: 'Nouvelle candidature livreur',
      detail: `${d.displayName} · ${scope.markets.cities.get(d.cityId)?.name ?? d.cityId}`,
      target: { type: 'driver', id: doc.id, label: d.displayName },
      cityId: d.cityId,
      tone: 'info',
      at: d.createdAt.toDate().toISOString(),
    });
  }
  for (const doc of audit.docs) {
    const log = doc.data() as AuditLog;
    const meta = AUDIT_ACTIVITY[log.action];
    if (!meta || !log.at) continue;
    if (scope.cityIds && log.cityId && !scope.cityIds.includes(log.cityId)) continue;
    if (scope.cityIds && !log.cityId && log.target.type === 'city' && !scope.cityIds.includes(log.target.id)) continue;
    if (scope.countryId && log.countryId && log.countryId !== scope.countryId) continue;
    items.push({
      id: `a-${doc.id}`,
      kind: meta.kind,
      title: meta.title,
      detail: [log.target.label, log.reason ? `« ${log.reason} »` : null, log.actor.name].filter(Boolean).join(' · '),
      target: log.target,
      cityId: log.cityId ?? null,
      tone: meta.tone,
      at: log.at.toDate().toISOString(),
    });
  }
  for (const doc of subs.docs) {
    const s = doc.data() as Subscription;
    if (!cityAllowed(scope, s.cityId ?? null) && scope.cityIds) continue;
    for (const [index, event] of (s.history ?? []).entries()) {
      if (!['upgraded', 'downgraded', 'cancelled'].includes(event.event)) continue;
      items.push({
        id: `s-${doc.id}-${index}`,
        kind: event.event === 'cancelled' ? 'subscription_cancelled' : 'plan_change',
        title: event.event === 'cancelled' ? 'Résiliation d’abonnement' : event.event === 'upgraded' ? 'Passage à une formule supérieure' : 'Passage à une formule inférieure',
        detail: [names.get(s.subscriberId) ?? s.subscriberId, `Formule ${PLAN_LABEL[event.planCode] ?? event.planCode}`, event.reason].filter(Boolean).join(' · '),
        target: { type: 'restaurant', id: s.subscriberId, label: names.get(s.subscriberId) ?? null },
        cityId: s.cityId ?? null,
        tone: event.event === 'cancelled' ? 'danger' : event.event === 'upgraded' ? 'success' : 'warning',
        at: event.at.toDate().toISOString(),
      });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);
}

export const getPilotageOverview = pilotageCallable(
  z.object({ ...zFilters, compareFrom: zDay, compareTo: zDay }),
  async (data, request): Promise<PilotageOverview> => {
    const { admin } = await requireAdmin(request, 'dashboard.view');
    const scope = await resolveScope(admin, data);
    const allRestaurants = await restaurantsInScope(scope);
    const names = new Map(allRestaurants.map((r) => [r.id, r.name]));
    const [counterValues, recent] = await Promise.all([counters(scope, data.planCode), activity(scope, names)]);
    let planKpis: PilotageOverview['planKpis'] = null;
    if (data.planCode) {
      const restaurants = await restaurantsInScope(scope, data.planCode);
      const daily = await restaurantDaily(
        restaurants.map((r) => r.id),
        data.compareFrom < data.from ? data.compareFrom : data.from,
        data.to,
      );
      const all = [...daily.values()].flat();
      const current = all.filter((d) => d.day >= data.from && d.day <= data.to);
      const previous = all.filter((d) => d.day >= data.compareFrom && d.day <= data.compareTo);
      planKpis = {
        current: kpisFromRestaurants(current),
        previous: kpisFromRestaurants(previous),
        daily: listDays(data.from, data.to).map((day) => {
          const list = current.filter((d) => d.day === day);
          return {
            day,
            gmvCents: list.reduce((s, d) => s + d.salesCents, 0),
            orders: list.reduce((s, d) => s + d.ordersCount, 0),
            commissionHtCents: list.reduce((s, d) => s + d.commissionCents, 0),
          };
        }),
      };
    }
    return { counters: counterValues, activity: recent, planKpis, generatedAt: new Date().toISOString() };
  },
  { memory: '512MiB' },
);
