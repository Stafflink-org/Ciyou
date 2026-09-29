// Typographie de l'app client — seul composant texte à utiliser dans les écrans
// (jamais `<Text>` de react-native directement) : garantit la même échelle et
// les mêmes couleurs partout.
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, font } from '../theme/tokens';

export type TextVariant = 'display' | 'title' | 'subtitle' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'eyebrow';
export type TextColor = 'default' | 'muted' | 'subtle' | 'primary' | 'danger' | 'success' | 'inverted';

const VARIANT_STYLE: Record<TextVariant, TextStyle> = {
  display: { fontSize: font.size.xxl, fontWeight: font.weight.bold, lineHeight: 36 },
  title: { fontSize: font.size.xl, fontWeight: font.weight.bold, lineHeight: 30 },
  subtitle: { fontSize: font.size.md, fontWeight: font.weight.medium, lineHeight: 24 },
  body: { fontSize: font.size.base, fontWeight: font.weight.regular, lineHeight: 21 },
  bodyStrong: { fontSize: font.size.base, fontWeight: font.weight.medium, lineHeight: 21 },
  caption: { fontSize: font.size.sm, fontWeight: font.weight.regular, lineHeight: 18 },
  label: { fontSize: font.size.xs, fontWeight: font.weight.bold, lineHeight: 16, letterSpacing: 0.6 },
  eyebrow: { fontSize: font.size.xs, fontWeight: font.weight.bold, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
};

const COLOR_MAP: Record<TextColor, string> = {
  default: colors.fg,
  muted: colors.fgMuted,
  subtle: colors.fgSubtle,
  primary: colors.primary,
  danger: colors.danger,
  success: colors.success,
  inverted: colors.onDark,
};

export interface TextComponentProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', color = 'default', align, style, ...rest }: TextComponentProps) {
  return <RNText style={[VARIANT_STYLE[variant], { color: COLOR_MAP[color] }, align ? { textAlign: align } : null, style]} {...rest} />;
}
