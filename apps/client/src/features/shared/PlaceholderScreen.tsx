// Coquille commune aux écrans non encore construits (lots suivants). Pas un
// message d'erreur : une composition soignée (icône, titre, note) cohérente
// avec le design system, pour ne jamais donner une impression d'app inachevée
// pendant la démonstration.
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { useTranslation } from '../../i18n/I18nProvider';

export function PlaceholderScreen({ title, note, icon, badgeLabel }: { title: string; note?: string; icon?: string; badgeLabel?: string }) {
  const { t } = useTranslation('common');
  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{icon ?? '🍽️'}</Text>
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      <Badge label={badgeLabel ?? t('placeholder.comingSoon')} tone="primary" style={{ alignSelf: 'center' }} />
      {note ? (
        <Text variant="body" color="muted" align="center" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  iconWrap: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  icon: { fontSize: 36 },
  note: { maxWidth: 280, marginTop: spacing.xs },
});
