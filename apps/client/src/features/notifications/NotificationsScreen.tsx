// Notifications (`NotificationsScreen`, §18.1, §14 client.md) — lecture réelle
// de `users/{uid}/notifications`, marquer comme lu au toucher.
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import type { WithId, UserNotification } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Skeleton } from '../../ui/Skeleton';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useNotifications } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'Notifications'>;

const CATEGORY_ICON: Record<string, string> = {
  order: '🧾',
  promotion: '🏷️',
  account: '👤',
  announcement: '📣',
  support: '💬',
  payout: '💳',
  document: '📄',
};

function timeAgo(at: unknown): string {
  const date = at && typeof at === 'object' && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : null;
  if (!date) return '';
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function NotificationsScreen({ navigation }: Props) {
  const { data, loading, markRead } = useNotifications();

  const onPress = (n: WithId<UserNotification>) => {
    if (!n.read) markRead(n.id);
    if (n.link?.type === 'order') navigation.navigate('OrderDetail', { orderId: n.link.target });
    else if (n.link?.type === 'promotion') navigation.navigate('Promotions');
  };

  if (loading) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton style={{ height: 70, borderRadius: 14 }} />
        <Skeleton style={{ height: 70, borderRadius: 14 }} />
      </View>
    );
  }

  if (data.length === 0) {
    return <PlaceholderScreen icon="🔔" title="Aucune notification" note="Vos notifications de commande et de promotions apparaîtront ici." />;
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      data={data}
      keyExtractor={(n) => n.id}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => onPress(item)} style={[styles.card, !item.read && styles.unread]}>
          <Text style={{ fontSize: 22 }}>{CATEGORY_ICON[item.category] ?? '🔔'}</Text>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{item.title}</Text>
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              {item.body}
            </Text>
            <Text variant="caption" color="subtle" style={{ marginTop: 4 }}>
              {timeAgo(item.createdAt)}
            </Text>
          </View>
          {!item.read ? <View style={styles.dot} /> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  unread: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
});
