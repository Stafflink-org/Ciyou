// Dispatch (onglet principal, golink-maquette/v2/livreur-admin.md §1.2/§1.6) :
// bascule de disponibilité réelle, réception réelle d'une offre de course
// (dispatchOffers, temps réel), compte à rebours d'expiration réel,
// accepter/refuser via `respondToOffer`, puis suivi complet de la ou des courses
// actives (une carte détaillée si une seule, une carte à pins avec aperçu au clic
// si plusieurs à la fois — dispatch groupé, voir `ActiveOrderCard`/`OrdersMap`).
// Rien n'est simulé : pas d'adresse ni de montant codés en dur (contrairement à
// la maquette Replit, volontairement pauvre pour cet espace — voir §1.6).
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { useGoogleMapsRuntime } from '../../lib/mapsKey';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';
import { ActiveOrderCard } from './ActiveOrderCard';
import { Countdown, InfoRow } from './components';
import { OrdersMap } from './OrdersMap';
import type { OrderPin } from './OrdersMap.shared';
import {
  respondToOffer,
  useAvailabilityToggle,
  useDriver,
  useDriverLocation,
  useIncomingOffers,
  useLiveLocation,
  useOrders,
  useRestaurants,
  type Availability,
} from './hooks';

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const km = (meters: number) => `${(meters / 1000).toFixed(1).replace('.', ',')} km`;

export function DispatchScreen() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const toast = useToast();
  const { t } = useTranslation('dispatch');

  const { data: driver, loading: driverLoading } = useDriver(uid);
  const { data: location } = useDriverLocation(uid);
  const { setAvailability, pending: togglePending } = useAvailabilityToggle(uid);
  const { offer } = useIncomingOffers(uid);
  const { key: mapsKey } = useGoogleMapsRuntime();

  const activeOrderIds = driver?.activeOrderIds ?? [];
  const hasMultipleOrders = activeOrderIds.length > 1;
  // Dispatch groupé (plusieurs courses actives à la fois) : résolu en une seule requête, pas
  // nécessaire quand il n'y en a qu'une (le cas courant, affiché directement par ActiveOrderCard).
  const { data: multiOrders } = useOrders(hasMultipleOrders ? activeOrderIds : []);
  const pendingPickupRestaurantIds = useMemo(() => [...new Set(multiOrders.filter((o) => o.status !== 'picked_up').map((o) => o.restaurantId))], [multiOrders]);
  const { data: multiRestaurants } = useRestaurants(pendingPickupRestaurantIds);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const isOnline = driver?.availability === 'online';
  const isOnDelivery = driver?.availability === 'on_delivery';
  const canGoOnline = driver?.status === 'active';

  const { status: geoStatus } = useLiveLocation(uid, driver?.cityId ?? null, {
    enabled: (isOnline || isOnDelivery) && Boolean(location),
    minIntervalMs: isOnDelivery ? 6000 : 45000,
  });

  const [offerBusy, setOfferBusy] = useState(false);

  const toggleAvailability = async () => {
    if (isOnDelivery) return;
    if (!isOnline && !canGoOnline) {
      Alert.alert(t('accountInactive.title'), t('accountInactive.message'));
      return;
    }
    await setAvailability(isOnline ? 'offline' : 'online');
  };

  const acceptOffer = async () => {
    if (!offer) return;
    setOfferBusy(true);
    try {
      await respondToOffer({ offerId: offer.id, accept: true });
      toast.show(t('offer.accepted'));
    } catch (err) {
      toast.show(errorMessage(err, t, t('offer.acceptError')), 'danger');
    } finally {
      setOfferBusy(false);
    }
  };

  const declineOffer = async () => {
    if (!offer) return;
    setOfferBusy(true);
    try {
      await respondToOffer({ offerId: offer.id, accept: false });
    } catch (err) {
      toast.show(errorMessage(err, t, t('offer.declineError')), 'danger');
    } finally {
      setOfferBusy(false);
    }
  };

  const geo = useMemo(() => {
    const p = location?.position;
    return p ? { lat: p.latitude, lng: p.longitude } : null;
  }, [location]);

  const restaurantGeoById = useMemo(() => new Map(multiRestaurants.map((r) => [r.id, r.address.geo] as const)), [multiRestaurants]);

  // Un pin par commande : au commerce avant récupération, chez le client une fois récupérée
  // (même logique que l'itinéraire d'une course unique, voir ActiveOrderCard).
  const pins = useMemo<OrderPin[]>(
    () =>
      multiOrders
        .map((o): OrderPin | null => {
          const geoPoint = o.status === 'picked_up' ? o.delivery?.geo : restaurantGeoById.get(o.restaurantId);
          if (!geoPoint) return null;
          return { id: o.id, lat: geoPoint.latitude, lng: geoPoint.longitude, label: `${o.number} · ${o.customerName}` };
        })
        .filter((p): p is OrderPin => p !== null),
    [multiOrders, restaurantGeoById],
  );

  if (driverLoading || !driver) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <View style={styles.headerCard}>
        <Text variant="eyebrow" color="inverted" style={{ opacity: 0.7 }}>
          {t('header.eyebrow')}
        </Text>
        <Text variant="title" color="inverted" style={{ marginTop: 6 }}>
          {isOnDelivery ? t('header.titleOnDelivery') : isOnline ? t('header.titleOnline') : t('header.titleOffline')}
        </Text>
        <Text variant="body" color="inverted" style={{ opacity: 0.75, marginTop: 4 }}>
          {isOnDelivery
            ? t('header.subtitleOnDelivery')
            : isOnline
              ? t('header.subtitleOnline')
              : t('header.subtitleOffline')}
        </Text>
        <View style={styles.headerRow}>
          <Badge label={t(`availability.${driver.availability}`)} tone={isOnline || isOnDelivery ? 'success' : 'neutral'} />
          <Button
            label={isOnline ? t('header.goOffline') : t('header.goOnline')}
            variant={isOnline ? 'outlineInverted' : 'primary'}
            size="md"
            fullWidth={false}
            disabled={isOnDelivery}
            loading={togglePending}
            onPress={toggleAvailability}
          />
        </View>
        {Platform.OS === 'web' && geoStatus === 'denied' ? (
          <Text variant="caption" color="danger" style={{ marginTop: spacing.sm }}>
            {t('header.locationDenied')}
          </Text>
        ) : null}
        {geoStatus === 'unsupported' ? (
          <Text variant="caption" color="inverted" style={{ marginTop: spacing.sm, opacity: 0.6 }}>
            {t('header.locationUnsupported')}
          </Text>
        ) : null}
      </View>

      {activeOrderIds.length === 0 ? (
        offer ? (
          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.offerHeader}>
              <Text variant="eyebrow" color="primary">
                {t('offer.eyebrow')}
              </Text>
              <Countdown untilMillis={offer.expiresAt.toMillis()} />
            </View>
            <InfoRow label={t('offer.toRestaurant')} value={km(offer.distanceToRestaurantMeters)} />
            <InfoRow label={t('offer.thenDelivery')} value={km(offer.deliveryDistanceMeters)} />
            <InfoRow label={t('offer.estimatedDuration')} value={t('offer.estimatedDurationValue', { minutes: offer.estimatedMinutes })} />
            <InfoRow label={t('offer.estimatedPay')} value={money(offer.estimatedPayCents)} />
            <View style={styles.offerActions}>
              <Button label={t('offer.decline')} variant="outline" onPress={declineOffer} loading={offerBusy} style={{ flex: 1 }} />
              <Button label={t('offer.accept')} onPress={acceptOffer} loading={offerBusy} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36 }}>{isOnline ? '📡' : '💤'}</Text>
            <Text variant="subtitle" align="center" style={{ marginTop: spacing.sm }}>
              {isOnline ? t('empty.noOrderTitle') : t('empty.offlineTitle')}
            </Text>
            <Text variant="body" color="muted" align="center" style={{ marginTop: 4 }}>
              {isOnline ? t('empty.noOrderNote') : t('empty.offlineNote')}
            </Text>
          </View>
        )
      ) : !hasMultipleOrders ? (
        <ActiveOrderCard orderId={activeOrderIds[0]} uid={uid ?? ''} geo={geo} driverType={driver.type} driverDisplayName={driver.displayName} />
      ) : selectedOrderId ? (
        <>
          <Button label={t('ordersMap.backToList')} variant="outline" onPress={() => setSelectedOrderId(null)} style={{ marginTop: spacing.lg }} />
          <ActiveOrderCard orderId={selectedOrderId} uid={uid ?? ''} geo={geo} driverType={driver.type} driverDisplayName={driver.displayName} />
        </>
      ) : (
        <Card style={{ marginTop: spacing.lg }}>
          <Text variant="eyebrow" color="primary">
            {t('ordersMap.title')}
          </Text>
          <Text variant="body" color="muted" style={{ marginTop: 4, marginBottom: spacing.md }}>
            {t('ordersMap.subtitle')}
          </Text>
          <OrdersMap apiKey={mapsKey} pins={pins} onSelect={setSelectedOrderId} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  headerCard: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  offerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  empty: { alignItems: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
});
