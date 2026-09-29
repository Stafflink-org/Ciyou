// Bouton flottant « Voir le panier N » (§4, §5 client.md : reste visible pendant
// la recherche et la fiche restaurant tant que le panier n'est pas vide).
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { useCart } from './CartContext';

export function FloatingCartButton() {
  const { itemsCount } = useCart();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  if (itemsCount === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable style={styles.button} onPress={() => navigation.navigate('Cart')} testID="button-open-cart">
        <Text variant="bodyStrong" style={{ color: colors.primaryFg }}>
          Voir le panier {itemsCount}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: spacing.lg, alignItems: 'center' },
  button: { backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: spacing.xl, borderRadius: radius.pill, ...shadow.card },
});
