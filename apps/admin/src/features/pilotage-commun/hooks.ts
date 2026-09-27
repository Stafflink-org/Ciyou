// Hooks communs du pilotage : filtres (période, formule) mémorisés, périmètre
// géographique, appels de fonctions en lecture et agrégats journaliers temps réel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { COLLECTIONS, type DailyStats, type PilotageFilters, type PlanCode } from '@golink/shared';
import { useAuth, useLocale, usePersistentState } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { buildPeriod, listDays, type Period, type PeriodPreset, type PeriodRange } from './period';

interface StoredFilters {
  preset: PeriodPreset;
  custom: PeriodRange | null;
  planCode: PlanCode | null;
}

export interface PilotageFilterState {
  period: Period;
  planCode: PlanCode | null;
  setPreset: (preset: Exclude<PeriodPreset, 'custom'>) => void;
  setCustom: (range: PeriodRange) => void;
  setPlanCode: (plan: PlanCode | null) => void;
  /** Filtres prêts pour les Cloud Functions (période, pays, villes, formule). */
  filters: PilotageFilters;
  /** Clé stable des filtres (dépendance des rechargements). */
  key: string;
}

/** Filtres partagés par le tableau de bord et les analytics (mémorisés par administrateur). */
export function usePilotageFilters(defaultPreset: PeriodPreset = '30d'): PilotageFilterState {
  const { user } = useAuth();
  const geo = useGeoScope();
  const [stored, setStored] = usePersistentState<StoredFilters>(`golink:admin:pilotage:${user?.uid ?? ''}`, {
    preset: defaultPreset,
    custom: null,
    planCode: null,
  });
  // La date du jour est figée au montage : pas de glissement de période en cours de lecture.
  const [now] = useState(() => new Date());
  const { locale } = useLocale();
  // locale : les libellés de période sont produits dans la langue courante.
  const period = useMemo(() => buildPeriod(stored.preset, stored.custom, now), [stored.preset, stored.custom, now, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const filters = useMemo<PilotageFilters>(
    () => ({
      from: period.from,
      to: period.to,
      countryId: geo.countryId,
      cityIds: geo.cityIds,
      planCode: stored.planCode,
    }),
    [period.from, period.to, geo.countryId, geo.cityIds, stored.planCode],
  );
  return {
    period,
    planCode: stored.planCode,
    setPreset: (preset) => setStored({ ...stored, preset, custom: null }),
    setCustom: (range) => setStored({ ...stored, preset: 'custom', custom: range }),
    setPlanCode: (planCode) => setStored({ ...stored, planCode }),
    filters,
    key: JSON.stringify(filters),
  };
}

export interface CallableQueryState<T> {
  data: T | null;
  loading: boolean;
  /** Rechargement en cours alors que des données sont déjà affichées. */
  refreshing: boolean;
  error: unknown;
  reload: () => void;
}

const CALL_TTL_MS = 60_000;
const callCache = new WeakMap<object, Map<string, { at: number; promise: Promise<unknown> }>>();

/**
 * Appel mutualisé : une même lecture demandée plusieurs fois en moins d'une minute
 * (retour sur la page, double montage) ne relance pas la fonction. `force` l'impose.
 */
function cachedCall<I, O>(fn: (input: I) => Promise<O>, input: I, key: string, force: boolean): Promise<O> {
  let store = callCache.get(fn);
  if (!store) {
    store = new Map();
    callCache.set(fn, store);
  }
  const hit = store.get(key);
  if (!force && hit && Date.now() - hit.at < CALL_TTL_MS) return hit.promise as Promise<O>;
  // Une nouvelle tentative après un court délai absorbe les démarrages à froid saturés.
  const promise = fn(input).catch(
    (error: unknown) =>
      new Promise<O>((resolve, reject) => {
        const code = (error as { code?: string } | null)?.code ?? '';
        if (!['functions/internal', 'functions/unavailable', 'functions/resource-exhausted', 'functions/deadline-exceeded'].includes(code)) {
          reject(error);
          return;
        }
        window.setTimeout(() => fn(input).then(resolve, reject), 2_500);
      }),
  );
  const entry = { at: Date.now(), promise: promise as Promise<unknown> };
  store.set(key, entry);
  promise.catch(() => {
    if (store.get(key) === entry) store.delete(key);
  });
  return promise;
}

/**
 * Lecture via une Cloud Function (agrégats calculés côté serveur). Relance quand
 * `key` change ; ignore les réponses obsolètes. `input` null suspend l'appel.
 */
export function useCallableQuery<I, O>(fn: (input: I) => Promise<O>, input: I | null, key: string): CallableQueryState<O> {
  const [state, setState] = useState<{ key: string | null; data: O | null; error: unknown; loading: boolean }>({
    key: null,
    data: null,
    error: null,
    loading: input !== null,
  });
  const [nonce, setNonce] = useState(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const current = inputRef.current;
    if (current === null) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    cachedCall(fnRef.current, current, key, nonce > 0)
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((prev) => ({ ...prev, key, error, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, input === null]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const stale = state.key !== key;
  return {
    data: state.data,
    loading: state.loading && (state.data === null || stale),
    refreshing: state.loading && state.data !== null && !stale,
    error: state.error,
    reload,
  };
}

// ------------------------------------------------------------------ statsDaily

export interface DayStats {
  day: string;
  placed: number;
  delivered: number;
  cancelled: number;
  rejected: number;
  late: number;
  gmvCents: number;
  restaurantSalesCents: number;
  commissionHtCents: number;
  feesHtCents: number;
  subscriptionsHtCents: number;
  refundsCents: number;
  marginCents: number;
  promoCostCents: number;
  courierCostCents: number;
  paymentFeesCents: number;
  customersNew: number;
  customersActive: number;
  restaurantsNew: number;
  restaurantsActive: number;
  driversNew: number;
  deliveryMinutesSum: number;
  deliveryCount: number;
  byHour: number[];
  driversOnlineByHour: number[];
  funnel: DailyStats['funnel'];
  ticketsOpened: number;
  ticketsResolved: number;
}

export function emptyDay(day: string): DayStats {
  return {
    day,
    placed: 0,
    delivered: 0,
    cancelled: 0,
    rejected: 0,
    late: 0,
    gmvCents: 0,
    restaurantSalesCents: 0,
    commissionHtCents: 0,
    feesHtCents: 0,
    subscriptionsHtCents: 0,
    refundsCents: 0,
    marginCents: 0,
    promoCostCents: 0,
    courierCostCents: 0,
    paymentFeesCents: 0,
    customersNew: 0,
    customersActive: 0,
    restaurantsNew: 0,
    restaurantsActive: 0,
    driversNew: 0,
    deliveryMinutesSum: 0,
    deliveryCount: 0,
    byHour: Array.from({ length: 24 }, () => 0),
    driversOnlineByHour: Array.from({ length: 24 }, () => 0),
    funnel: { appOpens: 0, restaurantViews: 0, addToCart: 0, checkoutStarted: 0, paid: 0 },
    ticketsOpened: 0,
    ticketsResolved: 0,
  };
}

function addDoc(target: DayStats, doc: DailyStats): void {
  const o = doc.orders;
  const r = doc.revenue;
  target.placed += o?.placed ?? 0;
  target.delivered += o?.delivered ?? 0;
  target.cancelled += o?.cancelled ?? 0;
  target.rejected += o?.rejected ?? 0;
  target.late += o?.late ?? 0;
  target.gmvCents += r?.gmvCents ?? 0;
  target.restaurantSalesCents += r?.restaurantSalesCents ?? 0;
  target.commissionHtCents += r?.commissionHtCents ?? 0;
  target.feesHtCents += r?.feesHtCents ?? 0;
  target.subscriptionsHtCents += r?.subscriptionsHtCents ?? 0;
  target.refundsCents += r?.refundsCents ?? 0;
  target.marginCents += r?.marginCents ?? 0;
  target.promoCostCents += r?.promoCostCents ?? 0;
  target.courierCostCents += r?.courierCostCents ?? 0;
  target.paymentFeesCents += r?.paymentFeesCents ?? 0;
  target.customersNew += doc.actors?.customersNew ?? 0;
  target.customersActive += doc.actors?.customersActive ?? 0;
  target.restaurantsNew += doc.actors?.restaurantsNew ?? 0;
  target.restaurantsActive += doc.actors?.restaurantsActive ?? 0;
  target.driversNew += doc.actors?.driversNew ?? 0;
  const deliveries = o?.byMode?.delivery ?? o?.delivered ?? 0;
  if (doc.delivery?.averageMinutes) {
    target.deliveryMinutesSum += doc.delivery.averageMinutes * deliveries;
    target.deliveryCount += deliveries;
  }
  (o?.byHour ?? []).forEach((count, hour) => {
    target.byHour[hour] = (target.byHour[hour] ?? 0) + count;
  });
  (doc.driversOnlineByHour ?? []).forEach((count, hour) => {
    target.driversOnlineByHour[hour] = (target.driversOnlineByHour[hour] ?? 0) + count;
  });
  if (doc.funnel) {
    target.funnel.appOpens += doc.funnel.appOpens ?? 0;
    target.funnel.restaurantViews += doc.funnel.restaurantViews ?? 0;
    target.funnel.addToCart += doc.funnel.addToCart ?? 0;
    target.funnel.checkoutStarted += doc.funnel.checkoutStarted ?? 0;
    target.funnel.paid += doc.funnel.paid ?? 0;
  }
  target.ticketsOpened += doc.support?.ticketsOpened ?? 0;
  target.ticketsResolved += doc.support?.ticketsResolved ?? 0;
}

/** Somme de plusieurs journées (indicateurs de période). */
export function sumDays(days: DayStats[]): DayStats {
  const out = emptyDay(days[0]?.day ?? '');
  for (const d of days) {
    for (const key of Object.keys(out) as Array<keyof DayStats>) {
      const value = d[key];
      if (typeof value === 'number') (out[key] as number) += value;
    }
    d.byHour.forEach((count, hour) => {
      out.byHour[hour] = (out.byHour[hour] ?? 0) + count;
    });
    d.driversOnlineByHour.forEach((count, hour) => {
      out.driversOnlineByHour[hour] = Math.max(out.driversOnlineByHour[hour] ?? 0, count);
    });
    out.funnel.appOpens += d.funnel.appOpens;
    out.funnel.restaurantViews += d.funnel.restaurantViews;
    out.funnel.addToCart += d.funnel.addToCart;
    out.funnel.checkoutStarted += d.funnel.checkoutStarted;
    out.funnel.paid += d.funnel.paid;
  }
  return out;
}

export interface PeriodKpis {
  platformRevenueHtCents: number;
  gmvCents: number;
  restaurantSalesCents: number;
  commissionHtCents: number;
  subscriptionsHtCents: number;
  feesHtCents: number;
  marginCents: number;
  refundsCents: number;
  orders: number;
  delivered: number;
  cancelled: number;
  averageBasketCents: number;
  cancellationRate: number;
  customersNew: number;
  restaurantsNew: number;
  driversNew: number;
  averageDeliveryMinutes: number;
  onTimeRate: number;
}

export function kpisOf(total: DayStats): PeriodKpis {
  return {
    platformRevenueHtCents: total.commissionHtCents + total.feesHtCents + total.subscriptionsHtCents,
    gmvCents: total.gmvCents,
    restaurantSalesCents: total.restaurantSalesCents,
    commissionHtCents: total.commissionHtCents,
    subscriptionsHtCents: total.subscriptionsHtCents,
    feesHtCents: total.feesHtCents,
    marginCents: total.marginCents,
    refundsCents: total.refundsCents,
    orders: total.placed,
    delivered: total.delivered,
    cancelled: total.cancelled,
    averageBasketCents: total.delivered ? Math.round(total.gmvCents / total.delivered) : 0,
    cancellationRate: total.placed ? total.cancelled / total.placed : 0,
    customersNew: total.customersNew,
    restaurantsNew: total.restaurantsNew,
    driversNew: total.driversNew,
    averageDeliveryMinutes: total.deliveryCount ? Math.round(total.deliveryMinutesSum / total.deliveryCount) : 0,
    onTimeRate: total.delivered ? (total.delivered - total.late) / total.delivered : 0,
  };
}

export interface DailyStatsState {
  /** Une entrée par jour de [from, to] (zéros quand aucun agrégat). */
  days: DayStats[];
  byDay: Map<string, DayStats>;
  loading: boolean;
  error: unknown;
}

/**
 * Agrégats statsDaily du périmètre courant, en temps réel : plateforme, pays, ou
 * somme des villes (responsable de ville, ville choisie).
 */
export function useDailyStats(from: string, to: string, enabled = true): DailyStatsState {
  const geo = useGeoScope();
  const cityKey = geo.cityIds?.slice(0, 30).join(',') ?? '';
  const statsQuery = useMemo(() => {
    if (!enabled || from > to) return null;
    const ref = collection(db, COLLECTIONS.statsDaily);
    const range = [where('day', '>=', from), where('day', '<=', to)];
    if (geo.cityIds) {
      if (geo.cityIds.length === 0) return null;
      return query(ref, where('scope', '==', 'city'), where('cityId', 'in', cityKey.split(',')), ...range);
    }
    if (geo.countryId) return query(ref, where('scope', '==', 'country'), where('scopeId', '==', geo.countryId), ...range);
    return query(ref, where('scope', '==', 'platform'), where('scopeId', '==', 'all'), ...range);
  }, [enabled, from, to, geo.cityIds, geo.countryId, cityKey]);

  const { data, loading, error } = useCollection<DailyStats>(statsQuery);

  return useMemo(() => {
    const byDay = new Map<string, DayStats>();
    for (const day of from <= to ? listDays(from, to) : []) byDay.set(day, emptyDay(day));
    for (const doc of data) {
      const target = byDay.get(doc.day);
      if (target) addDoc(target, doc);
    }
    return { days: [...byDay.values()], byDay, loading: Boolean(statsQuery) && loading, error };
  }, [data, loading, error, from, to, statsQuery]);
}
