// Modes de paiement (§19 client.md) — lecture réelle de `users/{uid}/paymentMethods` (cartes
// masquées) + ajout réel d'une carte (`functions/src/payments/cards.ts` : `createSetupIntent`
// puis `savePaymentMethod`, enregistrement Stripe sans paiement). `PaymentProvider` posé au plus
// près du formulaire, même pattern que `CheckoutScreen` (voir ce fichier pour le détail du choix).
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import { callFunction, errorMessage, useCollection } from '../../lib/firestore';
import { collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { SavedPaymentMethod } from '@golink/shared';
import { useTranslation } from '../../i18n/I18nProvider';
import { CardEntry, useCardPayment } from '../checkout/payment/CardInput';
import { PaymentProvider } from '../checkout/payment/PaymentProvider';

const BRAND_ICON: Record<string, string> = { visa: '💳', mastercard: '💳', amex: '💳' };

const createSetupIntent = callFunction<Record<string, never>, { clientSecret: string }>('createSetupIntent');
const savePaymentMethod = callFunction<{ setupIntentId: string }, { id: string }>('savePaymentMethod');

export function PaymentMethodsScreen() {
  const { user } = useAuth();
  const q = user ? collection(db, `users/${user.uid}/paymentMethods`) : null;
  const { data, loading } = useCollection<SavedPaymentMethod>(q);
  const { t } = useTranslation('paymentMethods');
  const [adding, setAdding] = useState(false);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">{t('paymentMethods:title')}</Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm }}>
        {t('paymentMethods:description')}
      </Text>

      {loading ? (
        <Skeleton style={{ height: 64, borderRadius: 14, marginTop: spacing.lg }} />
      ) : data.length === 0 && !adding ? (
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

      {adding ? (
        <PaymentProvider>
          <AddCardForm onDone={() => setAdding(false)} />
        </PaymentProvider>
      ) : (
        <Button
          label={t('paymentMethods:addCard')}
          variant="outline"
          style={{ marginTop: spacing.lg }}
          onPress={() => setAdding(true)}
          testID="button-add-payment-method"
        />
      )}
    </ScrollView>
  );
}

function AddCardForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('paymentMethods');
  const toast = useToast();
  const cardPayment = useCardPayment();
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const onConfirm = async () => {
    setErrorText(null);
    setSubmitting(true);
    try {
      const { clientSecret } = await createSetupIntent({});
      const confirmed = await cardPayment.confirmCardSetup(clientSecret);
      if ('error' in confirmed) {
        setErrorText(confirmed.error);
        return;
      }
      await savePaymentMethod({ setupIntentId: confirmed.id });
      toast.show(t('paymentMethods:cardAddedToast'));
      onDone();
    } catch (error) {
      setErrorText(errorMessage(error, t) || t('paymentMethods:genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card style={{ marginTop: spacing.lg }}>
      <Text variant="label" color="muted" style={{ marginBottom: spacing.xs }}>
        {t('paymentMethods:cardFieldLabel').toUpperCase()}
      </Text>
      <CardEntry onChange={setComplete} />
      {errorText ? (
        <Text variant="body" color="danger" style={{ marginTop: spacing.sm }}>
          {errorText}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Button label={t('paymentMethods:cancel')} variant="subtle" onPress={onDone} disabled={submitting} />
        <Button label={t('paymentMethods:save')} variant="primary" onPress={onConfirm} disabled={!complete} loading={submitting} testID="button-confirm-add-payment-method" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'center' },
});
