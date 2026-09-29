// Bouton — variantes primaire (corail), sombre (encre), discrète et destructive ;
// tailles md/lg ; état de chargement (remplace le libellé par un indicateur,
// garde la largeur pour éviter un sursaut visuel).
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'dark' | 'subtle' | 'outline' | 'outlineInverted' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BG: Record<ButtonVariant, string> = {
  primary: colors.primary,
  dark: colors.ink,
  subtle: colors.primarySoft,
  outline: 'transparent',
  outlineInverted: 'transparent',
  danger: colors.danger,
};

const FG: Record<ButtonVariant, string> = {
  primary: colors.primaryFg,
  dark: colors.inkFg,
  subtle: colors.primarySoftFg,
  outline: colors.ink,
  outlineInverted: colors.onDark,
  danger: colors.white,
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', disabled, loading, fullWidth = true, icon, style, testID }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: BG[variant] },
        variant === 'outline' && styles.outlineBorder,
        variant === 'outlineInverted' && styles.outlineInvertedBorder,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={FG[variant]} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text variant="bodyStrong" style={{ color: FG[variant] }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  md: { paddingVertical: 10, paddingHorizontal: spacing.lg },
  lg: { paddingVertical: 15, paddingHorizontal: spacing.xl },
  fullWidth: { alignSelf: 'stretch' },
  outlineBorder: { borderWidth: 1.5, borderColor: colors.borderStrong },
  outlineInvertedBorder: { borderWidth: 1.5, borderColor: 'rgba(248,244,236,0.4)' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
