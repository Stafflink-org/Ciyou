// Champ de saisie — libellé, erreur, icône, bouton « afficher le mot de passe ».
// Un seul style de champ pour toute l'app (connexion, adresses, checkout…).
import { useState } from 'react';
import { Pressable, TextInput, View, StyleSheet, type TextInputProps } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  secure?: boolean;
  leftIcon?: React.ReactNode;
}

export function Input({ label, error, secure, leftIcon, ...rest }: InputProps) {
  const [reveal, setReveal] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" color="muted" style={styles.label}>
          {label.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.field, focused && styles.focused, error && styles.errorField]}>
        {leftIcon}
        <TextInput
          {...rest}
          secureTextEntry={secure && !reveal}
          placeholderTextColor={colors.fgSubtle}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
        />
        {secure ? (
          <Pressable onPress={() => setReveal((v) => !v)} hitSlop={10}>
            <Text variant="caption" color="primary">
              {reveal ? 'Masquer' : 'Afficher'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { marginLeft: 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 50,
  },
  focused: { borderColor: colors.primary },
  errorField: { borderColor: colors.danger },
  input: { flex: 1, fontSize: 15, color: colors.fg, paddingVertical: 8 },
  error: { marginLeft: 2 },
});
