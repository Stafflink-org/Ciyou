// Promotions (`PromotionsScreen`, §18.1, §16 client.md) — offres réelles
// visibles (vitrine `promotions`). « Appliquer » place le code dans le panier
// (`CartContext.promoCode`, repris par CheckoutScreen) : le code n'est
// vérifié qu'à la confirmation de commande (`placeOrder`), comme documenté
// pour le champ équivalent du lot 2.
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useCart } from '../cart/CartContext';
import { useShowcasePromotions, promotionValueLabel } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'Promotions'>;

export function PromotionsScreen({ navigation }: Props) {
  const { data: promotions, loading } = useShowcasePromotions();
  const cart = useCart();
  const toast = useToast();

  if (loading) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton style={{ height: 110, borderRadius: 16 }} />
        <Skeleton style={{ height: 110, borderRadius: 16 }} />
      </View>
    );
  }

  if (promotions.length === 0) {
    return <PlaceholderScreen icon="🏷️" title="Aucune offre pour le moment" note="Revenez bientôt : les offres des commerces apparaîtront ici." />;
  }

  const apply = (code: string | null | undefined) => {
    if (!code) {
      toast.show('Offre appliquée automatiquement au panier, sans code.');
      return;
    }
    cart.setPromoCode(code);
    toast.show(`Code ${code} ajouté à votre panier`);
    if (cart.lines.length > 0) navigation.navigate('Cart');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="eyebrow" color="muted">
        BONS PLANS
      </Text>
      <Text variant="title" style={{ marginBottom: spacing.sm }}>
        Toutes les offres
      </Text>

      {promotions.map((promo) => (
        <Card key={promo.id}>
          <View style={styles.row}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {promo.title.fr}
            </Text>
            <Badge label={promotionValueLabel(promo)} tone="primary" />
          </View>
          {promo.description ? (
            <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
              {promo.description.fr}
            </Text>
          ) : null}
          {promo.minSubtotalCents > 0 ? (
            <Text variant="caption" color="subtle" style={{ marginTop: 4 }}>
              Dès {(promo.minSubtotalCents / 100).toFixed(2).replace('.', ',')} € d'achat
            </Text>
          ) : null}
          <View style={styles.footerRow}>
            {promo.code ? (
              <Text variant="bodyStrong" color="primary">
                Code {promo.code}
              </Text>
            ) : (
              <Text variant="caption" color="muted">
                Appliquée automatiquement
              </Text>
            )}
            <Button label="Appliquer" size="md" fullWidth={false} onPress={() => apply(promo.code)} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'center' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
});
