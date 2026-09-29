// Emplacement de chargement animé (pulsation), pour les listes en attente de
// données réelles (accueil, recherche…) plutôt qu'un simple spinner centré.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme/tokens';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, radius: r = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.skeleton, opacity }, style]} />;
}

/** Silhouette d'une carte restaurant, pour l'accueil pendant le chargement. */
export function RestaurantCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton height={140} radius={radius.lg} />
      <View style={styles.body}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="45%" height={12} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%' },
  body: { paddingTop: 10 },
});
