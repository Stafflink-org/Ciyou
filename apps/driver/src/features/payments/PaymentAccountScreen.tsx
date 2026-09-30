// Compte de paiement (§15 « Livreurs »/annexe Q&R n°1) : active le compte de
// paiement Stripe Connect Express du livreur indépendant (pays Stripe) ou
// enregistre un compte local (virement/portefeuille mobile) dans un pays sans
// Stripe (DZ/MA/TN). Sans cet écran, aucun reversement livreur réel n'est
// possible (voir docs/AUDIT_COUVERTURE_CDC.md §15).
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { colors, spacing } from '../../theme/tokens';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { useTranslation } from '../../i18n/I18nProvider';
import { useDriverProfile } from '../profile/hooks';
import { useCountry, useDriverPayoutStatus, useDriverStripeConnect, useSetDriverLocalPayoutAccount } from './hooks';

const STRIPE_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  restricted: 'warning',
  enabled: 'success',
};

export function PaymentAccountScreen() {
  const { user } = useAuth();
  const { t } = useTranslation('payments');
  const uid = user?.uid ?? null;
  const { data: driver } = useDriverProfile(uid);
  const { data: priv } = useDriverPayoutStatus(uid);
  const { data: country } = useCountry(driver?.countryId ?? null);
  const toast = useToast();

  if (driver && driver.type !== 'platform') {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg }}>
        <Card>
          <Text variant="body">{t('payments:employedByRestaurant')}</Text>
        </Card>
      </ScrollView>
    );
  }

  // Le pays n'est pas encore chargé : on attend plutôt que de deviner le mode Stripe/local.
  if (driver && !country) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg }}>
        <Card>
          <Text variant="body" color="muted">
            {t('payments:loading')}
          </Text>
        </Card>
      </ScrollView>
    );
  }

  const stripeAvailable = country?.stripeAvailable !== false;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
      {stripeAvailable ? (
        <StripeConnectCard status={priv?.stripeAccountStatus ?? null} toast={toast} />
      ) : (
        <LocalAccountCard existing={priv?.payoutAccount ?? null} toast={toast} />
      )}
    </ScrollView>
  );
}

function StripeConnectCard({ status, toast }: { status: 'pending' | 'restricted' | 'enabled' | null; toast: ReturnType<typeof useToast> }) {
  const { t } = useTranslation('payments');
  const { openOnboarding, refresh, pending, error } = useDriverStripeConnect();

  const statusLabel =
    status === 'enabled'
      ? t('payments:stripe.status.enabled')
      : status === 'restricted'
        ? t('payments:stripe.status.restricted')
        : status === 'pending'
          ? t('payments:stripe.status.pending')
          : t('payments:stripe.status.none');

  return (
    <Card>
      <Text variant="subtitle">{t('payments:stripe.title')}</Text>
      <Text variant="caption" color="muted" style={{ marginTop: 4, marginBottom: spacing.md }}>
        {t('payments:stripe.description')}
      </Text>
      <Badge label={statusLabel} tone={status ? STRIPE_STATUS_TONE[status] ?? 'neutral' : 'neutral'} />

      {status === 'enabled' ? (
        <Text variant="caption" color="success" style={{ marginTop: spacing.md }}>
          {t('payments:stripe.enabledHint')}
        </Text>
      ) : (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.md }}>
          {status === 'restricted' ? t('payments:stripe.restrictedHint') : t('payments:stripe.pendingHint')}
        </Text>
      )}

      {error ? (
        <Text variant="caption" color="danger" style={{ marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
        <Button
          label={status === 'enabled' ? t('payments:stripe.manage') : t('payments:stripe.activate')}
          loading={pending === 'link'}
          onPress={async () => {
            const url = await openOnboarding();
            if (url) await Linking.openURL(url);
            else toast.show(t('payments:stripe.openError'), 'danger');
          }}
          style={{ flex: 1 }}
        />
        <Button
          label={t('payments:stripe.refresh')}
          variant="outline"
          loading={pending === 'refresh'}
          onPress={async () => {
            const next = await refresh();
            if (next) toast.show(t('payments:stripe.refreshed'));
          }}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

function LocalAccountCard({
  existing,
  toast,
}: {
  existing: { accountMasked: string; verified: boolean; provider: string } | null;
  toast: ReturnType<typeof useToast>;
}) {
  const { t } = useTranslation('payments');
  const { submit, pending, error } = useSetDriverLocalPayoutAccount();
  const [provider, setProvider] = useState<'bank_transfer' | 'mobile_wallet'>('bank_transfer');
  const [holderName, setHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const canSubmit = holderName.trim().length >= 2 && accountNumber.trim().length >= 6;

  return (
    <Card>
      <Text variant="subtitle">{t('payments:local.title')}</Text>
      <Text variant="caption" color="muted" style={{ marginTop: 4, marginBottom: spacing.md }}>
        {t('payments:local.description')}
      </Text>

      {existing ? (
        <Badge
          label={existing.verified ? t('payments:local.verified', { account: existing.accountMasked }) : t('payments:local.pendingVerification', { account: existing.accountMasked })}
          tone={existing.verified ? 'success' : 'warning'}
          style={{ marginBottom: spacing.md }}
        />
      ) : null}

      <View style={styles.chipRow}>
        {(['bank_transfer', 'mobile_wallet'] as const).map((value) => (
          <Button
            key={value}
            label={value === 'bank_transfer' ? t('payments:local.bankTransfer') : t('payments:local.mobileWallet')}
            variant={provider === value ? 'primary' : 'outline'}
            size="md"
            fullWidth={false}
            onPress={() => setProvider(value)}
          />
        ))}
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Input label={t('payments:local.holderName')} value={holderName} onChangeText={setHolderName} />
        <Input label={t('payments:local.accountNumber')} value={accountNumber} onChangeText={setAccountNumber} autoCapitalize="characters" />
      </View>

      {error ? (
        <Text variant="caption" color="danger" style={{ marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      <Button
        label={existing ? t('payments:local.replace') : t('payments:local.save')}
        loading={pending}
        disabled={!canSubmit}
        style={{ marginTop: spacing.lg }}
        onPress={async () => {
          const ok = await submit({ provider, holderName: holderName.trim(), accountNumber: accountNumber.trim() });
          if (ok) {
            toast.show(t('payments:local.saved'));
            setAccountNumber('');
          } else toast.show(error ?? t('payments:local.saveError'), 'danger');
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
