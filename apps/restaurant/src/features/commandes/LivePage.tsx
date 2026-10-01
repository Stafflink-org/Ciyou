// Suivi en direct : carte des livreurs en approche et des commandes en
// livraison (positions temps réel), avec l'heure d'arrivée estimée.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { query, where, limit } from 'firebase/firestore';
import { Bike, Clock3, MapPinned, Navigation } from 'lucide-react';
import { Badge, Card, EmptyState, Skeleton, cn, formatTime } from '@golink/ui';
import { COLLECTIONS, formatDistance, haversineMeters, type DriverLocation, type LatLng } from '@golink/shared';
import { useAuth, useRuntimeConfig } from '@golink/web';
import { useAppColorMode } from '@/app/color-mode';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { functions } from '@/lib/firebase';
import { collectionAt, errorMessage, toMillis, useCollection } from '@/lib/firestore';
import { useActiveOrders, useNow } from './hooks';
import type { OrderRow } from './lib';
import { OrderActionsProvider } from './components/OrderActions';
import { OrderSheet, OrdersLayout } from './components/OrdersLayout';
import { OrderStatus } from './components/parts';
import { LiveMap, type LiveMarker } from './components/LiveMap';

/** Vitesse moyenne retenue pour l'estimation (≈ 15 km/h en ville, mètres par minute). */
const METERS_PER_MINUTE = 250;
const ROAD_FACTOR = 1.25;

interface Leg {
  order: OrderRow;
  driver: (DriverLocation & { id: string }) | null;
  destination: LatLng | null;
  /** Minutes estimées avant l'étape suivante (restaurant ou client). */
  etaMinutes: number | null;
  phase: 'waiting' | 'to_restaurant' | 'to_customer';
}

function toLatLng(point: { latitude: number; longitude: number } | null | undefined): LatLng | null {
  return point ? { lat: point.latitude, lng: point.longitude } : null;
}

export function LivePage() {
  const { user } = useAuth();
  const { restaurant } = useRestaurantAccess();
  const { mode } = useAppColorMode();
  const [params, setParams] = useSearchParams();
  const openId = params.get('commande');
  const now = useNow(5000);
  const [focus, setFocus] = useState<string | null>(null);
  const orders = useActiveOrders();
  const runtimeConfig = useRuntimeConfig(functions);
  const locations = useCollection<DriverLocation>(
    user ? query(collectionAt(COLLECTIONS.driverLocations), where('visibleTo', 'array-contains', user.uid), limit(50)) : null,
  );

  const origin = toLatLng(restaurant.address.geo);
  const legs = useMemo<Leg[]>(() => {
    const byDriver = new Map(locations.data.map((l) => [l.id, l]));
    return orders.data
      .filter((o) => o.fulfillment === 'delivery' && ['accepted', 'preparing', 'ready', 'assigned', 'picked_up'].includes(o.status))
      .map((order) => {
        const driver = order.driverId ? (byDriver.get(order.driverId) ?? null) : null;
        const destination = toLatLng(order.delivery?.geo);
        const position = toLatLng(driver?.position);
        let etaMinutes: number | null = null;
        let phase: Leg['phase'] = 'waiting';
        if (position && order.status === 'picked_up' && destination) {
          phase = 'to_customer';
          etaMinutes = Math.max(1, Math.round((haversineMeters(position, destination) * ROAD_FACTOR) / METERS_PER_MINUTE));
        } else if (position && origin) {
          phase = 'to_restaurant';
          etaMinutes = Math.max(1, Math.round((haversineMeters(position, origin) * ROAD_FACTOR) / METERS_PER_MINUTE));
        }
        return { order, driver, destination, etaMinutes, phase };
      })
      .sort((a, b) => (a.order.status === 'picked_up' ? 0 : 1) - (b.order.status === 'picked_up' ? 0 : 1) || a.order.createdAt.toMillis() - b.order.createdAt.toMillis());
  }, [orders.data, locations.data, origin]);

  const markers = useMemo<LiveMarker[]>(() => {
    const list: LiveMarker[] = origin ? [{ id: 'restaurant', kind: 'restaurant', position: origin, label: restaurant.name, tone: 'brand' }] : [];
    for (const leg of legs) {
      const position = toLatLng(leg.driver?.position);
      const active = focus === leg.order.id;
      if (position) {
        list.push({
          id: `d-${leg.order.id}`,
          kind: 'driver',
          position,
          label: `${leg.order.delivery?.driverName ?? 'Livreur'} · ${leg.order.number}`,
          tone: leg.phase === 'to_customer' ? 'info' : 'plum',
          towards: leg.phase === 'to_customer' ? leg.destination : origin,
          active,
          onClick: () => setFocus(leg.order.id),
        });
      }
      if (leg.destination && (leg.order.status === 'picked_up' || active)) {
        list.push({ id: `c-${leg.order.id}`, kind: 'customer', position: leg.destination, label: `${leg.order.number} · ${leg.order.customerName}`, tone: 'neutral', active, onClick: () => open(leg.order.id) });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` dépend des paramètres d'URL, sans effet sur les positions.
  }, [legs, origin, focus, restaurant.name]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('commande', id);
    else next.delete('commande');
    setParams(next, { replace: !id });
  };

  const inDelivery = legs.filter((l) => l.order.status === 'picked_up').length;
  const approaching = legs.filter((l) => l.phase === 'to_restaurant').length;
  const loading = orders.loading || locations.loading;

  return (
    <OrderActionsProvider>
      <OrdersLayout
        pendingCount={orders.data.filter((o) => o.status === 'new').length}
        description="Livreurs en approche et commandes en route, positions actualisées en temps réel."
        showLiveTrackingLink={false}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-w-0">
            <LiveMap apiKey={runtimeConfig?.googleMapsWebKey ?? undefined} dark={mode === 'dark'} center={origin ?? { lat: 49.52, lng: 5.76 }} markers={markers} height="max(360px, min(68vh, 640px))" />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
              <Badge tone="plum" className="shadow-md">
                {approaching} en approche
              </Badge>
              <Badge tone="info" className="shadow-md">
                {inDelivery} en livraison
              </Badge>
            </div>
          </div>

          <Card className="flex min-h-0 flex-col lg:max-h-[min(68vh,640px)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">Livraisons en cours</h2>
              <span className="num rounded-full bg-surface-3 px-2 py-px font-mono text-2xs text-fg-muted">{legs.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : orders.error || locations.error ? (
                <p className="p-4 text-sm text-danger">{errorMessage(orders.error ?? locations.error)}</p>
              ) : legs.length === 0 ? (
                <EmptyState compact icon={<MapPinned />} title="Aucune livraison en cours" description="Les livreurs apparaissent sur la carte dès qu’une course leur est attribuée." />
              ) : (
                <ul className="divide-y divide-border">
                  {legs.map((leg) => {
                    const fresh = leg.driver ? Math.round((now - (toMillis(leg.driver.updatedAt) ?? now)) / 1000) : null;
                    const arrival = leg.etaMinutes !== null ? formatTime(now + leg.etaMinutes * 60_000) : null;
                    return (
                      <li key={leg.order.id}>
                        <button
                          type="button"
                          onClick={() => setFocus(leg.order.id)}
                          onDoubleClick={() => open(leg.order.id)}
                          className={cn('w-full px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', focus === leg.order.id && 'bg-surface-2')}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="num font-mono text-sm font-semibold text-fg">{leg.order.number}</span>
                            <OrderStatus order={leg.order} className="h-5 text-2xs" />
                          </div>
                          <p className="mt-1 truncate text-xs text-fg-muted">
                            {leg.order.customerName} · {leg.order.delivery?.address.line1}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {leg.order.delivery?.driverName ? (
                              <span className="inline-flex items-center gap-1 text-fg">
                                <Bike className="size-3.5 text-fg-subtle" /> {leg.order.delivery.driverName}
                              </span>
                            ) : (
                              <span className="text-fg-subtle">Livreur pas encore attribué</span>
                            )}
                            {leg.phase === 'to_restaurant' && arrival && (
                              <span className="tone-plum inline-flex items-center gap-1 font-medium text-(--tone-fg)">
                                <Navigation className="size-3.5" /> au restaurant dans ~{leg.etaMinutes} min
                              </span>
                            )}
                            {leg.phase === 'to_customer' && arrival && (
                              <span className="tone-info inline-flex items-center gap-1 font-medium text-(--tone-fg)">
                                <Clock3 className="size-3.5" /> chez le client vers {arrival}
                              </span>
                            )}
                            {leg.order.delivery && <span className="text-fg-subtle">{formatDistance(leg.order.delivery.distanceMeters)}</span>}
                          </div>
                          {fresh !== null && fresh > 90 && <p className="mt-1 text-2xs text-fg-subtle">Position reçue il y a {Math.round(fresh / 60)} min</p>}
                        </button>
                        <div className="px-4 pb-3">
                          <button type="button" onClick={() => open(leg.order.id)} className="text-xs font-medium text-primary-soft-fg hover:underline">
                            Ouvrir la fiche
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </OrdersLayout>
      <OrderSheet orderId={openId} onClose={() => open(null)} />
    </OrderActionsProvider>
  );
}
