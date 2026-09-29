// Barre basse de l'espace livreur : Dispatch, Gains, Historique, Profil
// (golink-maquette/v2/livreur-admin.md §1.6 : squelette d'UX à conserver).
import { StyleSheet, Text as RNText, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabsParamList } from './types';
import { colors } from '../theme/tokens';
import { DispatchScreen } from '../features/dispatch/DispatchScreen';
import { EarningsScreen } from '../features/earnings/EarningsScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { useTranslation } from '../i18n/I18nProvider';

const Tab = createBottomTabNavigator<MainTabsParamList>();

const TAB_ICON: Record<keyof MainTabsParamList, string> = {
  Dispatch: '🛵',
  Earnings: '💶',
  History: '🧾',
  Profile: '👤',
};

export function MainTabs() {
  const { t } = useTranslation('common');
  const TAB_LABEL: Record<keyof MainTabsParamList, string> = {
    Dispatch: t('nav.tabs.dispatch'),
    Earnings: t('nav.tabs.earnings'),
    History: t('nav.tabs.history'),
    Profile: t('nav.tabs.profile'),
  };
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.fgSubtle,
        tabBarStyle: styles.bar,
        tabBarLabel: TAB_LABEL[route.name as keyof MainTabsParamList],
        tabBarIcon: ({ color }) => (
          <View style={styles.iconWrap}>
            <RNText style={{ fontSize: 20, opacity: color === colors.primary ? 1 : 0.55 }}>{TAB_ICON[route.name as keyof MainTabsParamList]}</RNText>
          </View>
        ),
      })}
    >
      <Tab.Screen name="Dispatch" component={DispatchScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 60, paddingBottom: 8, paddingTop: 6 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
});
