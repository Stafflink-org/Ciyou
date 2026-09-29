// Habillage commun des écrans d'authentification. Copie fidèle de
// apps/client/src/auth/AuthLayout.tsx.
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { LOGO_MARK } from '../theme/logo';
import { Text } from '../ui/Text';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandZone}>
            <Image source={LOGO_MARK} style={styles.logo} resizeMode="contain" />
            <Text variant="title" color="inverted" style={styles.brandTitle}>
              Ciyou Eats Livreur
            </Text>
          </View>
          <View style={styles.card}>
            <Text variant="title">{title}</Text>
            {subtitle ? (
              <Text variant="body" color="muted" style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  brandZone: { alignItems: 'center', justifyContent: 'flex-end', paddingTop: 72, paddingBottom: 36, gap: 10, width: '100%' },
  logo: { width: 56, height: 56, borderRadius: radius.md },
  brandTitle: { letterSpacing: 0.5 },
  card: {
    flex: 1,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  subtitle: { marginTop: 6 },
  body: { marginTop: spacing.xl, gap: spacing.md },
  footer: { marginTop: spacing.xl, alignItems: 'center' },
});
