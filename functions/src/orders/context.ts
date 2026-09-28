// Outils communs du domaine commandes : chargement des règles et de la
// tarification applicables, journal d'événements, acteurs, horaires.
import {
  COLLECTIONS,
  DEFAULT_ORDER_RULES,
  DEFAULT_PRICING_BY_COUNTRY,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  memberHasPermission,
  mergePricing,
  type City,
  type Country,
  type DispatchRules,
  type MarketPricingConfig,
  type Order,
  type OrderActor,
  type OrderEvent,
  type OrderRules,
  type RestaurantMember,
  type WeeklyHours,
} from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { db, Timestamp } from '../lib/admin';
import { fail } from '../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../lib/permissions';

const FALLBACK_DISPATCH: DispatchRules = {
  strategy: 'nearest',
  offerTimeoutSeconds: 45,
  initialRadiusMeters: 2000,
  radiusStepMeters: 1000,
  maxRadiusMeters: 6000,
  maxRounds: 5,
  dispatchLeadMinutes: 8,
  maxConcurrentOrdersPerDriver: 2,
  shortageRatioAlert: 0.6,
};

export function orderRef(orderId: string): DocumentReference {
  return db.collection(COLLECTIONS.orders).doc(orderId);
}

export async function loadOrder(orderId: string): Promise<Order> {
  const snap = await orderRef(orderId).get();
  if (!snap.exists) throw fail.notFound('Commande');
  return snap.data() as Order;
}

export interface Market {
  country: Country | null;
  city: City | null;
}

export async function loadMarket(countryId: string, cityId: string | null | undefined): Promise<Market> {
  const [country, city] = await Promise.all([
    db.collection(COLLECTIONS.countries).doc(countryId).get(),
    cityId ? db.collection(COLLECTIONS.cities).doc(cityId).get() : Promise.resolve(null),
  ]);
  return {
    country: country.exists ? (country.data() as Country) : null,
    city: city?.exists ? (city.data() as City) : null,
  };
}

/**
 * Règles de commande : valeurs d'amorçage (décisions du client), puis paramètres
 * de la plateforme, surchargés par le pays et la ville. La vente d'alcool reste
 * verrouillée quel que soit le paramétrage.
 */
export async function loadOrderRules(market: Market): Promise<OrderRules> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.orderRules).get();
  const base = (snap.exists ? snap.data() : {}) as Partial<OrderRules>;
  const merged = { ...DEFAULT_ORDER_RULES, ...base, ...(market.country?.orderRules ?? {}), ...(market.city?.orderRules ?? {}) } as OrderRules;
  // Les blocs enrichis après coup gardent leurs valeurs d'amorçage quand la base ne les porte pas encore.
  return {
    ...merged,
    customerAbsent: { ...DEFAULT_ORDER_RULES.customerAbsent, ...merged.customerAbsent },
    itemUnavailable: { ...DEFAULT_ORDER_RULES.itemUnavailable, ...merged.itemUnavailable },
    lateCredit: { ...DEFAULT_ORDER_RULES.lateCredit, ...merged.lateCredit },
    merchantInactivity: { ...DEFAULT_ORDER_RULES.merchantInactivity!, ...(merged.merchantInactivity ?? {}) },
    claims: { ...DEFAULT_ORDER_RULES.claims!, ...(merged.claims ?? {}) },
    lateToleranceMinutes: merged.lateToleranceMinutes ?? DEFAULT_ORDER_RULES.lateToleranceMinutes ?? 0,
    alcohol: { ...DEFAULT_ORDER_RULES.alcohol, enabled: false, locked: true },
  };
}

export async function loadDispatchRules(market: Market): Promise<DispatchRules> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dispatch).get();
  const base = (snap.exists ? snap.data() : FALLBACK_DISPATCH) as DispatchRules;
  return { ...FALLBACK_DISPATCH, ...base, ...(market.city?.dispatch ?? {}) };
}

/** Configuration tarifaire du marché, surchargée par la ville. */
export function pricingFor(countryId: string, market: Market): MarketPricingConfig {
  const base = market.country?.pricing ?? DEFAULT_PRICING_BY_COUNTRY[countryId];
  if (!base) throw fail.precondition('La tarification de ce pays n’est pas configurée.');
  return mergePricing(base, market.city?.pricing ?? null);
}

// ------------------------------------------------------------------ Acteurs

export interface EventActor {
  type: OrderActor;
  uid: string | null;
  name: string | null;
}

export const SYSTEM_EVENT_ACTOR: EventActor = { type: 'system', uid: null, name: 'Ciyou Eats' };

export function eventActorOf(actor: RestaurantActor): EventActor {
  if (actor.kind === 'admin') return { type: 'admin', uid: actor.caller.uid, name: 'Support Ciyou Eats' };
  return { type: 'restaurant', uid: actor.caller.uid, name: actor.member.displayName || actor.caller.name };
}

/** Membre du restaurant (ou administrateur habilité) pour une action sur la commande. */
export function requireOrderStaff(
  request: CallableRequest<unknown>,
  order: Order,
  permission: 'orders.manage' | 'orders.cancel' | 'orders.view',
): Promise<RestaurantActor> {
  return requireRestaurantAccess(request, order.restaurantId, permission, 'orders.intervene');
}

// ------------------------------------------------------------------ Journal

export type NewEvent = Omit<OrderEvent, 'at' | 'actor' | 'actorId' | 'actorName'>;

/** Ajoute un événement à la chronologie de la commande (dans la transaction fournie). */
export function addEvent(tx: Transaction, orderId: string, actor: EventActor, event: NewEvent, at: Timestamp = Timestamp.now()): void {
  const ref = orderRef(orderId).collection(SUBCOLLECTIONS.orders.events).doc();
  tx.set(ref, {
    ...event,
    from: event.from ?? null,
    to: event.to ?? null,
    message: event.message ?? null,
    data: event.data ?? null,
    actor: actor.type,
    actorId: actor.uid,
    actorName: actor.name,
    at,
  } satisfies OrderEvent);
}

/** Personnel du restaurant autorisé à voir les commandes (lecteurs de la position du livreur). */
export async function orderViewerUids(restaurantId: string): Promise<string[]> {
  const snap = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.members)
    .where('active', '==', true)
    .get();
  return snap.docs
    .filter((doc) => memberHasPermission(doc.data() as RestaurantMember, 'orders.view'))
    .map((doc) => doc.id);
}

// ------------------------------------------------------------------ Horaires

interface LocalClock {
  day: string;
  weekday: number;
  minutes: number;
}

/** Jour (AAAA-MM-JJ), jour de semaine (0 = lundi) et minutes depuis minuit dans un fuseau. */
export function localClock(date: Date, timezone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** L'établissement (ou le service de livraison) est-il ouvert à cet instant ? */
export function isOpenAt(hours: WeeklyHours | null | undefined, date: Date): boolean {
  if (!hours?.days?.length) return true;
  const clock = localClock(date, hours.timezone || 'Europe/Paris');
  const exception = hours.exceptions?.find((e) => e.date === clock.day);
  const slots = exception ? (exception.closed ? [] : (exception.slots ?? [])) : (hours.days.find((d) => d.day === clock.weekday)?.open ? (hours.days.find((d) => d.day === clock.weekday)?.slots ?? []) : []);
  return slots.some((slot) => {
    const from = toMinutes(slot.from);
    const to = toMinutes(slot.to);
    // Créneau qui passe minuit (ex. 18:00 → 01:00).
    return to > from ? clock.minutes >= from && clock.minutes < to : clock.minutes >= from || clock.minutes < to;
  });
}

/** Début et fin (exclue) d'un jour local, en instants UTC. */
export function dayBounds(day: string, timezone: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = (dayOffset: number) => {
    const utc = new Date(Date.UTC(y, m - 1, d + dayOffset, 0, 0));
    const local = localClock(utc, timezone);
    // Décalage du fuseau à cet instant (minutes), appliqué pour retomber sur minuit local.
    const offset = local.minutes > 12 * 60 ? local.minutes - 24 * 60 : local.minutes;
    return new Date(utc.getTime() - offset * 60_000);
  };
  return { start: guess(0), end: guess(1) };
}

/** Minutes écoulées entre deux horodatages. */
export function minutesBetween(from: { toMillis(): number } | null | undefined, to: { toMillis(): number } | null | undefined): number | null {
  if (!from || !to) return null;
  return (to.toMillis() - from.toMillis()) / 60_000;
}
