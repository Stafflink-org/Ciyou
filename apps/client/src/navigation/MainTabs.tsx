// Barre basse (§18.2, `button-client-nav-<home|search|orders|favorites|profile>`
// de la maquette) : Accueil, Recherche, Commandes, Favoris, Profil.
import { StyleSheet, Text as RNText, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabsParamList } from './types';
import { colors } from '../theme/tokens';
import { HomeScreen } from '../features/home/HomeScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { OrdersScreen } from '../features/orders/OrdersScreen';
import { FavoritesScreen } from '../features/favorites/FavoritesScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';

const Tab = createBottomTabNavigator<MainTabsParamList>();

const TAB_ICON: Record<keyof MainTabsParamList, string> = {
  Home: '🏠',
  Search: '🔍',
  Orders: '🧾',
  Favorites: '❤️',
  Profile: '👤',
};

const TAB_LABEL: Record<keyof MainTabsParamList, string> = {
  Home: 'Accueil',
  Search: 'Recherche',
  Orders: 'Commandes',
  Favorites: 'Favoris',
  Profile: 'Profil',
};

export function MainTabs() {
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
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 60, paddingBottom: 8, paddingTop: 6 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
});
