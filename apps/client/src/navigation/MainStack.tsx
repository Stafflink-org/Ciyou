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

const Stack = createNativeStackNavigator<MainStackParamList>();

const HEADER_OPTIONS = {
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.fg,
  headerTitleStyle: { fontWeight: '700' as const },
  headerShadowVisible: false,
};

export function MainStack() {
  return (
    <Stack.Navigator screenOptions={HEADER_OPTIONS}>
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Restaurant" component={RestaurantScreen} options={{ title: '' }} />
      <Stack.Screen name="Product" component={ProductScreen} options={{ title: 'Produit', presentation: 'modal' }} />
      <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'Panier', presentation: 'modal' }} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Commande' }} />
      <Stack.Screen name="Confirmation" component={OrderConfirmationScreen} options={{ title: 'Confirmation', headerBackVisible: false }} />
      <Stack.Screen name="Tracking" component={OrderTrackingScreen} options={{ title: 'Suivi' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Détail de la commande' }} />
      <Stack.Screen name="RateOrder" component={RateOrderScreen} options={{ title: 'Votre avis', presentation: 'modal' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="Addresses" component={AddressesScreen} options={{ title: 'Vos adresses' }} />
      <Stack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: 'Adresse', presentation: 'modal' }} />
      <Stack.Screen name="Promotions" component={PromotionsScreen} options={{ title: 'Offres' }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Modifier le profil' }} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: 'Modes de paiement' }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Aide' }} />
    </Stack.Navigator>
  );
}
