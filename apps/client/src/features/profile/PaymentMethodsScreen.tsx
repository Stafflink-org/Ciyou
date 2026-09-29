// Modes de paiement (§19 client.md) — lecture réelle de
// `users/{uid}/paymentMethods` (cartes masquées enregistrées par Stripe côté
// serveur, cf. packages/shared/src/models/users.ts). AUCUNE Cloud Function
// d'enregistrement de carte (`createSetupIntent` ou équivalent) n'existe côté
// serveur (vérifié par recherche dans functions/src) : l'ajout d'une carte
// n'est donc pas branché dans ce lot, limite assumée et documentée ici et
// dans docs/CONTRAT_MODULES.md §10 plutôt qu'un faux formulaire qui ne
// débiterait jamais rien.
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import { useAuth } from '../../auth/AuthContext';
import { docAt, useCollection } from '../../lib/firestore';
import { collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { SavedPaymentMethod } from '@golink/shared';
import { useTranslation } from '../../i18n/I18nProvider';

const BRAND_ICON: Record<string, string> = { visa: '💳', mastercard: '💳', amex: '💳' };

export function PaymentMethodsScreen() {
  const { user } = useAuth();
  const q = user ? collection(db, `users/${user.uid}/paymentMethods`) : null;
  const { data, loading } = useCollection<SavedPaymentMethod>(q);
  const { t } = useTranslation('paymentMethods');

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">{t('paymentMethods:title')}</Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
        {t('paymentMethods:description')}
      </Text>

      {loading ? (
        <Skeleton style={{ height: 64, borderRadius: 14, marginTop: spacing.lg }} />
      ) : data.length === 0 ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Text variant="body" color="muted" align="center">
            {t('paymentMethods:empty')}
          </Text>
        </Card>
      ) : (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {data.map((m) => (
            <Card key={m.id}>
              <View style={styles.row}>
                <Text style={{ fontSize: 20 }}>{BRAND_ICON[m.brand.toLowerCase()] ?? '💳'}</Text>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text variant="bodyStrong">
                    {m.brand} ···· {m.last4}
                  </Text>
                  <Text variant="caption" color="muted">
                    {t('paymentMethods:expires', { month: String(m.expMonth).padStart(2, '0'), year: m.expYear })}
                  </Text>
                </View>
                {m.isDefault ? <Badge label={t('paymentMethods:default')} tone="primary" /> : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'center' },
});
