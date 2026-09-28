// Carte — conteneur de base (fond surface, coins très arrondis, ombre douce),
// utilisé par toutes les cartes restaurant/produit/commande des lots suivants.
import { Pressable, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow } from '../theme/tokens';

export interface CardProps {
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
  testID?: string;
}

export function Card({ children, onPress, style, padded = true, elevated = true, testID }: CardProps) {
  const content = (
    <View style={[styles.base, padded && styles.padded, elevated && shadow.card, style]} testID={testID}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  padded: { padding: 14 },
  pressed: { opacity: 0.92 },
});
