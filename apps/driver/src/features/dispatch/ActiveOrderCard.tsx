// Détail + actions d'une course active (une seule commande). Extrait de DispatchScreen pour
// être réutilisable aussi bien quand le livreur n'a qu'une course (cas courant, affiché
// directement) que quand il en a plusieurs à la fois (carte multi-commandes, sélection d'un
// pin — document client « Points à corriger », App livreur #3 ; dispatch groupé réel mais
// désactivé par défaut, voir `dispatch.strategy` dans les réglages d'exploitation).
import { useMemo, useState } from 'react';
import { Alert, Linking, Platform, View } from 'react-native';
import { spacing } from '../../theme/tokens';
import { useGoogleMapsRuntime } from '../../lib/mapsKey';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';
import { CashBalanceCard, CustomerAbsentPanel, MessagingPanel } from './ActiveOrderPanels';
import { InfoRow } from './components';
import { RouteMap } from './RouteMap';
import { cancelDriverAssignment, completeOrder, markOrderPickedUp, useConversationMessages, useDriverPrivate, useOrder, useOrderConversation, useRestaurant } from './hooks';

type NavApp = 'google' | 'waze' | 'native';

/** Lien externe vers l'app de navigation choisie, destination au format lat/lng. */
function navigationUrl(app: NavApp, dest: { lat: number; lng: number }): string {
  const { lat, lng } = dest;
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    case 'waze':
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    case 'native':
      return Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}&dirflg=d` : `geo:${lat},${lng}?q=${lat},${lng}`;
  }
}

export interface ActiveOrderCardProps {
  orderId: string;
  uid: string;
  /** Position actuelle du livreur (partagée entre toutes ses courses, pas propre à l'une d'elles). */
  geo: { lat: number; lng: number } | null;
  driverType: 'platform' | 'restaurant';
  driverDisplayName: string;
}

export function ActiveOrderCard({ orderId, uid, geo, driverType, driverDisplayName }: ActiveOrderCardProps) {
  const toast = useToast();
  const { t } = useTranslation('dispatch');
  const { data: activeOrder } = useOrder(orderId);
  const { data: activeRestaurant } = useRestaurant(activeOrder?.restaurantId ?? null);
  const { data: conversation, loading: conversationLoading } = useOrderConversation(orderId);
  const { data: messages } = useConversationMessages(conversation?.id ?? null);
  const { data: driverPrivate } = useDriverPrivate(driverType === 'restaurant' ? uid : null);
  const { key: mapsKey, embedActivated } = useGoogleMapsRuntime();

  const [orderBusy, setOrderBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [handoverCode, setHandoverCode] = useState('');
  const [collectionCode, setCollectionCode] = useState('');

  const markPickedUp = async () => {
    if (activeOrder?.delivery?.collectionCode && !collectionCode.trim()) {
      toast.show(t('activeOrder.pickupMissingCode'), 'danger');
      return;
    }
    setOrderBusy(true);
    try {
      await markOrderPickedUp({ orderId, code: collectionCode.trim() || null });
      setCollectionCode('');
      toast.show(t('activeOrder.pickupSuccess'));
    } catch (err) {
      toast.show(errorMessage(err, t, t('activeOrder.pickupError')), 'danger');
    } finally {
      setOrderBusy(false);
    }
  };

  const doCancelAssignment = async () => {
    setCancelBusy(true);
    try {
      await cancelDriverAssignment({ orderId });
      toast.show(t('activeOrder.cancelAssignmentSuccess'));
    } catch (err) {
      toast.show(errorMessage(err, t, t('activeOrder.cancelAssignmentError')), 'danger');
    } finally {
      setCancelBusy(false);
    }
  };

  const cancelAssignment = () => {
    Alert.alert(t('activeOrder.cancelAssignmentConfirmTitle'), t('activeOrder.cancelAssignmentConfirmMessage'), [
      { text: t('activeOrder.cancelAssignmentDismiss'), style: 'cancel' },
      { text: t('activeOrder.cancelAssignmentConfirmButton'), style: 'destructive', onPress: () => void doCancelAssignment() },
    ]);
  };

  // Itinéraire réel : vers le commerce avant récupération, puis vers le client. La position du
  // livreur sert d'origine quand elle est disponible (course en cours) ; sinon on relie
  // simplement commerce → client pour donner le trajet à venir.
  const restaurantGeo = activeRestaurant?.address.geo ? { lat: activeRestaurant.address.geo.latitude, lng: activeRestaurant.address.geo.longitude } : null;
  const clientGeo = activeOrder?.delivery?.geo ? { lat: activeOrder.delivery.geo.latitude, lng: activeOrder.delivery.geo.longitude } : null;
  const routeOrigin = geo ?? restaurantGeo;
  const routeDestination = activeOrder?.status === 'picked_up' ? clientGeo : restaurantGeo;

  const openNavigation = async (app: NavApp, dest: { lat: number; lng: number }) => {
    try {
      await Linking.openURL(navigationUrl(app, dest));
    } catch {
      toast.show(t('activeOrder.navAppUnavailable'), 'danger');
    }
  };

  const startRoute = () => {
    if (!routeDestination) return;
    const dest = routeDestination;
    if (Platform.OS === 'web') {
      void openNavigation('google', dest);
      return;
    }
    Alert.alert(t('activeOrder.navAppTitle'), undefined, [
      { text: t('activeOrder.navAppGoogleMaps'), onPress: () => void openNavigation('google', dest) },
      { text: t('activeOrder.navAppWaze'), onPress: () => void openNavigation('waze', dest) },
      { text: t('activeOrder.navAppPlans'), onPress: () => void openNavigation('native', dest) },
      { text: t('activeOrder.navAppCancel'), style: 'cancel' },
    ]);
  };

  const complete = async () => {
    if (activeOrder?.delivery?.handoverCodeRequired && !handoverCode.trim()) {
      toast.show(t('activeOrder.completeMissingCode'), 'danger');
      return;
    }
    setOrderBusy(true);
    try {
      await completeOrder({ orderId, code: handoverCode.trim() || null, geo });
      setHandoverCode('');
      toast.show(t('activeOrder.completeSuccess'));
    } catch (err) {
      toast.show(errorMessage(err, t, t('activeOrder.completeError')), 'danger');
    } finally {
      setOrderBusy(false);
    }
  };

  const stepLabel = useMemo(() => {
    if (!activeOrder) return '';
    return activeOrder.status === 'assigned' ? t('activeOrder.stepAssigned') : activeOrder.status === 'picked_up' ? t('activeOrder.stepPickedUp') : activeOrder.status;
  }, [activeOrder, t]);

  if (!activeOrder) return null;

  return (
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
        <InfoRow label={t('activeOrder.step')} value={stepLabel} />

        {routeOrigin && routeDestination ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <RouteMap apiKey={mapsKey} embedActivated={embedActivated} origin={routeOrigin} destination={routeDestination} />
            <Button label={t('activeOrder.startRoute')} variant="outline" onPress={startRoute} />
          </View>
        ) : null}

        {activeOrder.status === 'assigned' ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {activeOrder.delivery?.collectionCode ? (
              <Input label={t('activeOrder.collectionCodeLabel')} value={collectionCode} onChangeText={setCollectionCode} keyboardType="number-pad" placeholder="1234" maxLength={12} />
            ) : null}
            <Button label={t('activeOrder.markPickedUp')} onPress={markPickedUp} loading={orderBusy} />
            <Button label={t('activeOrder.cancelAssignment')} variant="outline" onPress={cancelAssignment} loading={cancelBusy} />
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

      <MessagingPanel uid={uid} displayName={driverDisplayName} conversation={conversation} messages={messages} loading={conversationLoading} />
      {driverType === 'restaurant' ? <CashBalanceCard driverPrivate={driverPrivate} /> : null}
    </>
  );
}
