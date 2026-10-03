// Pastille de statut (ouvert/fermé, note, promo…) — mêmes couleurs sémantiques
// que les back-offices.
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme/tokens';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'dark';

const TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceRaised, fg: colors.fgMuted },
  primary: { bg: colors.primarySoft, fg: colors.primarySoftFg },
  success: { bg: colors.successSoft, fg: colors.success },
  danger: { bg: colors.dangerSoft, fg: colors.dangerSoftFg },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  info: { bg: colors.infoSoft, fg: colors.infoSoftFg },
  dark: { bg: colors.ink, fg: colors.inkFg },
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', icon, style }: BadgeProps) {
  const { bg, fg } = TONE[tone];
  return (
    <View style={[styles.base, { backgroundColor: bg }, style]}>
      {icon}
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
});
