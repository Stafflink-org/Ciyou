// Pile principale connectée : onglets + détail d'une course (historique).
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainStackParamList } from './types';
import { colors } from '../theme/tokens';
import { MainTabs } from './MainTabs';
import { OrderDetailScreen } from '../features/history/OrderDetailScreen';
import { ProfileSettingsScreen } from '../features/profile/ProfileSettingsScreen';

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
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Détail de la course' }} />
      <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ title: 'Réglages du profil' }} />
    </Stack.Navigator>
  );
}
