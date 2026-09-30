// Pile principale connectée : onglets + détail d'une course (historique).
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { colors } from '../theme/tokens';
import { MainTabs } from './MainTabs';
import { OrderDetailScreen } from '../features/history/OrderDetailScreen';
import { ProfileSettingsScreen } from '../features/profile/ProfileSettingsScreen';
import { GdprScreen } from '../features/gdpr/GdprScreen';
import { SupportScreen } from '../features/support/SupportScreen';
import { TicketDetailScreen } from '../features/support/TicketDetailScreen';
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
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t('screenTitles.orderDetail') }} />
      <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ title: t('screenTitles.profileSettings') }} />
      <Stack.Screen name="Gdpr" component={GdprScreen} options={{ title: 'Données personnelles' }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: t('screenTitles.support') }} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} options={{ title: t('screenTitles.ticketDetail') }} />
    </Stack.Navigator>
  );
}
