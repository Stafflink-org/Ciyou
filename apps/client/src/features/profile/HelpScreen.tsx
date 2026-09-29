// Aide / support (§19 client.md) — FAQ statique (aucune collection FAQ dédiée
// trouvée côté serveur) + accès réel au support (`Support`/`TicketDetail`,
// tâche `cdc-mobile-recompte` : ouverture de ticket et chat désormais réels,
// `functions/src/messaging/client/support.ts`).
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = NativeStackScreenProps<MainStackParamList, 'Help'>;

const FAQ_KEYS = ['late', 'editCancel', 'missingItem', 'deleteAccount'] as const;

export function HelpScreen({ navigation }: Props) {
  const { t } = useTranslation('help');
  const faq = FAQ_KEYS.map((key) => ({
    key,
    q: t(`help:faq.${key}.question`),
    a: t(`help:faq.${key}.answer`),
  }));

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">{t('help:title')}</Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
        {t('help:subtitle')}
      </Text>

      <View style={{ gap: spacing.sm }}>
        {faq.map((item) => (
          <Card key={item.key}>
            <Text variant="bodyStrong">{item.q}</Text>
            <Text variant="body" color="muted" style={{ marginTop: 4 }}>
              {item.a}
            </Text>
          </Card>
        ))}
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text variant="bodyStrong">{t('help:contact.title')}</Text>
        <Text variant="body" color="muted" style={{ marginTop: 4 }}>
          {t('help:contact.description')}
        </Text>
        <Button label={t('help:contact.support')} onPress={() => navigation.navigate('Support', undefined)} style={{ marginTop: spacing.md }} />
        <Button
          label={t('help:contact.email')}
          variant="outline"
          onPress={() => Linking.openURL('mailto:support@ciyou-eats.com')}
          style={{ marginTop: spacing.sm }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
