// Historique (onglet, golink-maquette/v2/livreur-admin.md §1.4/§1.6) : courses
// terminées réelles (orders `delivered`, driverId = moi), détail au clic.
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList, MainTabsParamList } from '../../navigation/types';
import { useAuth } from '../../auth/AuthContext';
import { colors, spacing } from '../../theme/tokens';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { useTranslation } from '../../i18n/I18nProvider';
import { intlLocale } from '../../i18n/core';
import { useDeliveredOrders } from './hooks';

type Props = CompositeScreenProps<BottomTabScreenProps<MainTabsParamList, 'History'>, NativeStackScreenProps<MainStackParamList>>;

export function HistoryScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { t, locale } = useTranslation('history');
  const { data, loading } = useDeliveredOrders(user?.uid ?? null);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm }}
      data={data}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <Card>
          <Text variant="body" color="muted" align="center">
            {t('history:empty')}
          </Text>
        </Card>
      }
      renderItem={({ item }) => (
        <Card onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })} style={{ marginBottom: spacing.sm }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">
                {item.number} · {item.restaurantName}
              </Text>
              <Text variant="caption" color="muted">
                {item.customerName} · {item.timeline.delivered?.toDate().toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? ''}
              </Text>
            </View>
            <Text variant="body" color="subtle">
              ›
            </Text>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'center' },
});
