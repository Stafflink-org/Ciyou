// Note et avis (§19 client.md) — écriture réelle de `reviews/{orderId}` (un
// avis par commande livrée, cf. firebase/rules/support.rules : create direct
// si la commande est `delivered` et `customerId == moi`, modération ensuite
// côté serveur).
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { serverTimestamp, setDoc } from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import type { Review } from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import { docAt, errorMessage } from '../../lib/firestore';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { useOrder, useOrderReview } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'RateOrder'>;

export function RateOrderScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const { user } = useAuth();
  const toast = useToast();
  const { data: order } = useOrder(orderId);
  const { data: existing } = useOrderReview(orderId);
  const [rating, setRating] = useState<number>(existing?.restaurantRating ?? 5);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);

  if (existing) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ fontSize: 36 }}>✅</Text>
        <Text variant="subtitle" align="center" style={{ marginTop: spacing.md }}>
          Vous avez déjà noté cette commande
        </Text>
        <Text style={{ marginTop: spacing.sm }}>{'⭐'.repeat(existing.restaurantRating)}</Text>
      </View>
    );
  }

  const submit = async () => {
    if (!user || !order) return;
    setSubmitting(true);
    try {
      const review: Review = {
        orderId,
        restaurantId: order.restaurantId,
        customerId: user.uid,
        customerDisplayName: user.displayName || 'Client Ciyou Eats',
        countryId: order.cityId,
        cityId: order.cityId,
        restaurantRating: rating as 1 | 2 | 3 | 4 | 5,
        comment: comment.trim() || null,
        tags: [],
        status: 'pending_moderation',
        reportsCount: 0,
        createdAt: serverTimestamp() as never,
      } as unknown as Review;
      await setDoc(docAt(`reviews/${orderId}`), review);
      toast.show('Merci pour votre avis !');
      navigation.goBack();
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">Votre avis</Text>
      <Text variant="body" color="muted" style={{ marginTop: 4 }}>
        {order?.restaurantName}
      </Text>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={8}>
            <Text style={{ fontSize: 34 }}>{n <= rating ? '⭐' : '☆'}</Text>
          </Pressable>
        ))}
      </View>

      <Input label="Commentaire (facultatif)" placeholder="Votre expérience…" value={comment} onChangeText={setComment} multiline />

      <Button label="Envoyer mon avis" onPress={submit} loading={submitting} style={{ marginTop: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stars: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg },
});
