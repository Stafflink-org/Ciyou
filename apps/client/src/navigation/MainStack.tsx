// Pile principale connectée (§18.2) : onglets + écrans empilés (fiche
// restaurant/produit, panier, tunnel de commande, suivi, adresses…).
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { colors } from '../theme/tokens';
import { MainTabs } from './MainTabs';
import { RestaurantScreen } from '../features/restaurant/RestaurantScreen';
import { ProductScreen } from '../features/product/ProductScreen';
import { CartScreen } from '../features/cart/CartScreen';
import { CheckoutScreen } from '../features/checkout/CheckoutScreen';
import { OrderConfirmationScreen } from '../features/confirmation/OrderConfirmationScreen';
import { OrderTrackingScreen } from '../features/tracking/OrderTrackingScreen';
import { OrderDetailScreen } from '../features/orders/OrderDetailScreen';
import { RateOrderScreen } from '../features/orders/RateOrderScreen';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { AddressesScreen } from '../features/addresses/AddressesScreen';
import { AddressFormScreen } from '../features/addresses/AddressFormScreen';
import { PromotionsScreen } from '../features/promotions/PromotionsScreen';
import { EditProfileScreen } from '../features/profile/EditProfileScreen';
import { PaymentMethodsScreen } from '../features/profile/PaymentMethodsScreen';
import { HelpScreen } from '../features/profile/HelpScreen';
import { SupportScreen } from '../features/support/SupportScreen';
import { TicketDetailScreen } from '../features/support/TicketDetailScreen';
import { ReferralScreen } from '../features/referral/ReferralScreen';
import { useTranslation } from '../i18n/I18nProvider';

const Stack = createNativeStackNavigator<MainStackParamList>();

const HEADER_OPTIONS = {
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.fg,
  headerTitleStyle: { fontWeight: '700' as const },
  headerShadowVisible: false,
};

export function MainStack() {
  const { t } = useTranslation('common');
  return (
    <Stack.Navigator screenOptions={HEADER_OPTIONS}>
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Restaurant" component={RestaurantScreen} options={{ title: '' }} />
      <Stack.Screen name="Product" component={ProductScreen} options={{ title: t('screenTitles.product'), presentation: 'modal' }} />
      <Stack.Screen name="Cart" component={CartScreen} options={{ title: t('screenTitles.cart'), presentation: 'modal' }} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title: t('screenTitles.checkout') }} />
      <Stack.Screen name="Confirmation" component={OrderConfirmationScreen} options={{ title: t('screenTitles.confirmation'), headerBackVisible: false }} />
      <Stack.Screen name="Tracking" component={OrderTrackingScreen} options={{ title: t('screenTitles.tracking') }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t('screenTitles.orderDetail') }} />
      <Stack.Screen name="RateOrder" component={RateOrderScreen} options={{ title: t('screenTitles.rateOrder'), presentation: 'modal' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('screenTitles.notifications') }} />
      <Stack.Screen name="Addresses" component={AddressesScreen} options={{ title: t('screenTitles.addresses') }} />
      <Stack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: t('screenTitles.addressForm'), presentation: 'modal' }} />
      <Stack.Screen name="Promotions" component={PromotionsScreen} options={{ title: t('screenTitles.promotions') }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: t('screenTitles.editProfile') }} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: t('screenTitles.paymentMethods') }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('screenTitles.help') }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: t('screenTitles.support') }} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: t('screenTitles.ticketDetail') }} />
      <Stack.Screen name="Referral" component={ReferralScreen} options={{ title: t('screenTitles.referral') }} />
    </Stack.Navigator>
  );
}
