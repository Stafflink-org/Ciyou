// Parrainage client (§19 cahier super admin, point cité dans le verdict mobile)
// — code personnel réel (`users/{uid}.referralCode`, généré à l'inscription,
// `functions/src/lib/accounts.ts`) à partager, et saisie du code d'un ami
// (`applyReferralCode`, avant la première commande).
import { useState } from 'react';
import { Share, ScrollView, StyleSheet, View } from 'react-native';
import type { UserProfile } from '@golink/shared';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import { docAt, errorMessage, useDoc, callFunction } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';

const applyReferralCode = callFunction<{ code: string }, { referralId: string; rewardCents: number; minFirstOrderCents: number }>('applyReferralCode');

export function ReferralScreen() {
  const { user } = useAuth();
  const { data: profile, loading } = useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
  const toast = useToast();
  const { t } = useTranslation('referral');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);

  const alreadyOrdered = (profile?.stats?.ordersCount ?? 0) > 0;
  const alreadyReferred = Boolean(profile?.referredBy);

  const share = async () => {
    if (!profile?.referralCode) return;
    await Share.share({ message: t('referral:shareMessage', { code: profile.referralCode }) }).catch(() => undefined);
  };

  const apply = async () => {
    if (code.trim().length < 4) {
      toast.show(t('referral:invalidCode'), 'danger');
      return;
    }
    setSending(true);
    try {
      const result = await applyReferralCode({ code: code.trim() });
      toast.show(t('referral:codeAccepted', { amount: (result.rewardCents / 100).toFixed(2).replace('.', ',') }));
      setCode('');
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Skeleton style={{ height: 140, borderRadius: 16 }} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="eyebrow" color="muted">
        {t('referral:eyebrow')}
      </Text>
      <Text variant="title" style={{ marginBottom: 4 }}>
        {t('referral:title')}
      </Text>
      <Text variant="body" color="muted">
        {t('referral:intro')}
      </Text>

      <Card>
        <Text variant="caption" color="muted">
          {t('referral:yourCode')}
        </Text>
        <Text variant="title" style={{ marginTop: 4, letterSpacing: 1 }}>
          {profile?.referralCode ?? '—'}
        </Text>
        <Button label={t('referral:shareButton')} onPress={share} style={{ marginTop: spacing.md }} />
      </Card>

      <Card>
        <Text variant="bodyStrong">{t('referral:enterCodeTitle')}</Text>
        {alreadyReferred ? (
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            {t('referral:alreadyReferred')}
          </Text>
        ) : alreadyOrdered ? (
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            {t('referral:alreadyOrdered')}
          </Text>
        ) : (
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            <Input placeholder={t('referral:inputPlaceholder')} value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" />
            <Button label={t('referral:validateButton')} variant="outline" onPress={apply} loading={sending} disabled={code.trim().length < 4} />
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
