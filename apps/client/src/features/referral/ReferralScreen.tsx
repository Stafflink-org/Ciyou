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

const applyReferralCode = callFunction<{ code: string }, { referralId: string; rewardCents: number; minFirstOrderCents: number }>('applyReferralCode');

export function ReferralScreen() {
  const { user } = useAuth();
  const { data: profile, loading } = useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
  const toast = useToast();
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);

  const alreadyOrdered = (profile?.stats?.ordersCount ?? 0) > 0;
  const alreadyReferred = Boolean(profile?.referredBy);

  const share = async () => {
    if (!profile?.referralCode) return;
    await Share.share({ message: `Rejoins-moi sur Ciyou Eats et profite d'une remise avec mon code ${profile.referralCode} !` }).catch(() => undefined);
  };

  const apply = async () => {
    if (code.trim().length < 4) {
      toast.show('Saisissez un code valide.', 'danger');
      return;
    }
    setSending(true);
    try {
      const result = await applyReferralCode({ code: code.trim() });
      toast.show(`Code accepté : ${(result.rewardCents / 100).toFixed(2).replace('.', ',')} € offerts à votre première commande.`);
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
        PARRAINAGE
      </Text>
      <Text variant="title" style={{ marginBottom: 4 }}>
        Invitez vos proches
      </Text>
      <Text variant="body" color="muted">
        Partagez votre code : vos proches en profitent à leur inscription, et vous êtes récompensé(e) à leur première commande.
      </Text>

      <Card>
        <Text variant="caption" color="muted">
          Votre code personnel
        </Text>
        <Text variant="title" style={{ marginTop: 4, letterSpacing: 1 }}>
          {profile?.referralCode ?? '—'}
        </Text>
        <Button label="Partager mon code" onPress={share} style={{ marginTop: spacing.md }} />
      </Card>

      <Card>
        <Text variant="bodyStrong">Un code à saisir ?</Text>
        {alreadyReferred ? (
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            Un code de parrainage est déjà enregistré sur votre compte.
          </Text>
        ) : alreadyOrdered ? (
          <Text variant="body" color="muted" style={{ marginTop: 4 }}>
            Le code de parrainage se saisit avant votre première commande : ce n'est plus possible sur ce compte.
          </Text>
        ) : (
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            <Input placeholder="Code de votre parrain" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" />
            <Button label="Valider le code" variant="outline" onPress={apply} loading={sending} disabled={code.trim().length < 4} />
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
