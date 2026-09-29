// Dispatch (onglet principal, golink-maquette/v2/livreur-admin.md §1.2/§1.6) :
// bascule de disponibilité réelle, réception réelle d'une offre de course
// (dispatchOffers, temps réel), compte à rebours d'expiration réel,
// accepter/refuser via `respondToOffer`, puis suivi complet de la course active
// (carte/itinéraire réels, code de collecte au commerce, code de remise au
// client — jamais avant —, client absent, messagerie, espèces détenues). Rien
// n'est simulé : pas d'adresse ni de montant codés en dur (contrairement à la
// maquette Replit, volontairement pauvre pour cet espace — voir §1.6).
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { useGoogleMapsRuntime } from '../../lib/mapsKey';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';
import { CashBalanceCard, CustomerAbsentPanel, MessagingPanel } from './ActiveOrderPanels';
import { Countdown, InfoRow } from './components';
import { RouteMap } from './RouteMap';
import {
  completeOrder,
  markOrderPickedUp,
  respondToOffer,
  useAvailabilityToggle,
  useConversationMessages,
  useDriver,
  useDriverLocation,
  useDriverPrivate,
  useIncomingOffers,
  useLiveLocation,
  useOrder,
  useOrderConversation,
  useRestaurant,
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

  const activeOrderId = driver?.activeOrderIds?.[0] ?? null;
  const { data: activeOrder } = useOrder(activeOrderId);
  const { data: activeRestaurant } = useRestaurant(activeOrder?.restaurantId ?? null);
  const { data: conversation, loading: conversationLoading } = useOrderConversation(activeOrderId);
  const { data: messages } = useConversationMessages(conversation?.id ?? null);
  const { data: driverPrivate } = useDriverPrivate(driver?.type === 'restaurant' ? uid : null);
  const { key: mapsKey, embedActivated } = useGoogleMapsRuntime();

  const isOnline = driver?.availability === 'online';
  const isOnDelivery = driver?.availability === 'on_delivery';
  const canGoOnline = driver?.status === 'active';

  const { status: geoStatus } = useLiveLocation(uid, driver?.cityId ?? null, {
    enabled: (isOnline || isOnDelivery) && Boolean(location),
    minIntervalMs: isOnDelivery ? 6000 : 45000,
  });

  const [offerBusy, setOfferBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [handoverCode, setHandoverCode] = useState('');
  const [collectionCode, setCollectionCode] = useState('');

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
      toast.show(errorMessage(err, t('offer.acceptError')), 'danger');
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
      toast.show(errorMessage(err, t('offer.declineError')), 'danger');
    } finally {
      setOfferBusy(false);
    }
  };

  const markPickedUp = async () => {
    if (!activeOrderId) return;
    if (activeOrder?.delivery?.collectionCode && !collectionCode.trim()) {
      toast.show(t('activeOrder.pickupMissingCode'), 'danger');
      return;
    }
    setOrderBusy(true);
    try {
      await markOrderPickedUp({ orderId: activeOrderId, code: collectionCode.trim() || null });
      setCollectionCode('');
      toast.show(t('activeOrder.pickupSuccess'));
    } catch (err) {
      toast.show(errorMessage(err, t('activeOrder.pickupError')), 'danger');
    } finally {
      setOrderBusy(false);
    }
  };

  const geo = useMemo(() => {
    const p = location?.position;
    return p ? { lat: p.latitude, lng: p.longitude } : null;
  }, [location]);

  // Itinéraire réel (mission point 2) : vers le commerce avant récupération, puis vers le
  // client. La position du livreur sert d'origine quand elle est disponible (course en
  // cours) ; sinon on relie simplement commerce → client pour donner le trajet à venir.
  const restaurantGeo = activeRestaurant?.address.geo ? { lat: activeRestaurant.address.geo.latitude, lng: activeRestaurant.address.geo.longitude } : null;
  const clientGeo = activeOrder?.delivery ? { lat: activeOrder.delivery.geo.latitude, lng: activeOrder.delivery.geo.longitude } : null;
  const routeOrigin = geo ?? restaurantGeo;
  const routeDestination = activeOrder?.status === 'picked_up' ? clientGeo : restaurantGeo;

  const complete = async () => {
    if (!activeOrderId) return;
    if (activeOrder?.delivery?.handoverCodeRequired && !handoverCode.trim()) {
      toast.show(t('activeOrder.completeMissingCode'), 'danger');
      return;
    }
    setOrderBusy(true);
    try {
      await completeOrder({ orderId: activeOrderId, code: handoverCode.trim() || null, geo });
      setHandoverCode('');
      toast.show(t('activeOrder.completeSuccess'));
    } catch (err) {
      toast.show(errorMessage(err, t('activeOrder.completeError')), 'danger');
    } finally {
      setOrderBusy(false);
    }
  };

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
        {Platform.OS === 'web' && geoStatus === 'unsupported' ? (
          <Text variant="caption" color="inverted" style={{ marginTop: spacing.sm, opacity: 0.6 }}>
            {t('header.locationUnsupported')}
          </Text>
        ) : null}
      </View>

      {activeOrder ? (
        <>
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="eyebrow" color="primary">
              {t('activeOrder.eyebrow')}
            </Text>
            <Text variant="subtitle" style={{ marginTop: 4 }}>
              {activeOrder.restaurantName} · {activeOrder.number}
            </Text>
            <InfoRow label={t('activeOrder.client')} value={activeOrder.customerName} />
            {activeOrder.delivery ? (
              <InfoRow label={t('activeOrder.address')} value={`${activeOrder.delivery.address.line1}, ${activeOrder.delivery.address.city}`} />
            ) : null}
            <InfoRow label={t('activeOrder.items')} value={String(activeOrder.itemsCount)} />
            <InfoRow
              label={t('activeOrder.step')}
              value={activeOrder.status === 'assigned' ? t('activeOrder.stepAssigned') : activeOrder.status === 'picked_up' ? t('activeOrder.stepPickedUp') : activeOrder.status}
            />

            {routeOrigin && routeDestination ? (
              <View style={{ marginTop: spacing.md }}>
                <RouteMap apiKey={mapsKey} embedActivated={embedActivated} origin={routeOrigin} destination={routeDestination} />
              </View>
            ) : null}

            {activeOrder.status === 'assigned' ? (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {activeOrder.delivery?.collectionCode ? (
                  <Input label={t('activeOrder.collectionCodeLabel')} value={collectionCode} onChangeText={setCollectionCode} keyboardType="number-pad" placeholder="1234" maxLength={12} />
                ) : null}
                <Button label={t('activeOrder.markPickedUp')} onPress={markPickedUp} loading={orderBusy} />
              </View>
            ) : null}
            {activeOrder.status === 'picked_up' ? (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {activeOrder.delivery?.handoverCodeRequired ? (
                  <Input label={t('activeOrder.handoverCodeLabel')} value={handoverCode} onChangeText={setHandoverCode} keyboardType="number-pad" placeholder="1234" maxLength={12} />
                ) : null}
                <Button label={t('activeOrder.completeDelivery')} onPress={complete} loading={orderBusy} />
                <CustomerAbsentPanel orderId={activeOrder.id} order={activeOrder} />
              </View>
            ) : null}
          </Card>

          <MessagingPanel uid={uid ?? ''} displayName={driver.displayName} conversation={conversation} messages={messages} loading={conversationLoading} />
          {driver.type === 'restaurant' ? <CashBalanceCard driverPrivate={driverPrivate} /> : null}
        </>
      ) : offer ? (
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
