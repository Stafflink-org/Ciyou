// Profil (onglet) : identité réelle (Firebase Auth + fiche drivers/{uid}),
// statut du compte, véhicule, distance maximale choisie (docs/DECISIONS_CLIENT.md
// « Distance max : choisie par le livreur »), déconnexion. Réglages (véhicule,
// distance, documents) : ProfileSettingsScreen (lot 3).
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SANCTION_TYPE_LABELS, VEHICLE_LABELS } from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useActiveSanction, useContestSanction, useDriverProfile } from './hooks';
import { useTranslation } from '../../i18n/I18nProvider';
import { intlLocale } from '../../i18n/core';
import { LanguagePicker } from '../../i18n/LanguagePicker';

const STATUS_KEY: Record<string, string> = {
  active: 'profile:status.active',
  onboarding: 'profile:status.onboarding',
  suspended: 'profile:status.suspended',
  deactivated: 'profile:status.deactivated',
};
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  onboarding: 'warning',
  suspended: 'danger',
  deactivated: 'danger',
};

export function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('profile');
  const [languageOpen, setLanguageOpen] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { data: driver } = useDriverProfile(user?.uid ?? null);
  const { data: sanction } = useActiveSanction(driver);
  const initials = (driver?.displayName ?? user?.email ?? '?').trim().slice(0, 1).toUpperCase();
  const status = driver
    ? { label: t(STATUS_KEY[driver.status] ?? driver.status), tone: STATUS_TONE[driver.status] ?? ('neutral' as const) }
    : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <Text variant="title" color="inverted">
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" numberOfLines={1}>
              {driver?.displayName || t('profile:defaultName')}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
        </View>
        {status ? <Badge label={status.label} tone={status.tone} style={{ marginTop: spacing.md }} /> : null}
      </Card>

      {driver ? (
        <View style={styles.infoBlock}>
          <InfoLine label={t('profile:info.vehicle')} value={VEHICLE_LABELS[driver.vehicle.type]} />
          <InfoLine
            label={t('profile:info.type')}
            value={driver.type === 'restaurant' ? t('profile:info.typeRestaurant') : t('profile:info.typeIndependent')}
          />
          <InfoLine
            label={t('profile:info.distance')}
            value={
              driver.maxDistanceMeters
                ? t('profile:info.distanceValue', { km: (driver.maxDistanceMeters / 1000).toFixed(1) })
                : t('profile:info.distanceUndefined')
            }
          />
          <InfoLine label={t('profile:info.cash')} value={driver.acceptsCash ? t('profile:info.cashAccepted') : t('profile:info.cashNotAccepted')} />
          <InfoLine
            label={t('profile:info.rating')}
            value={
              driver.rating.count > 0
                ? t('profile:info.ratingValue', { average: driver.rating.average.toFixed(1), count: driver.rating.count })
                : t('profile:info.ratingNone')
            }
          />
        </View>
      ) : null}

      {sanction ? <SanctionCard sanction={sanction} uid={user?.uid ?? null} /> : null}

      <Button
        label={t('profile:actions.settings')}
        variant="outline"
        onPress={() => navigation.navigate('ProfileSettings')}
        style={{ marginTop: spacing.lg }}
      />

      <Button label={tCommon('language.label')} variant="outline" onPress={() => setLanguageOpen(true)} style={{ marginTop: spacing.md }} />

      <Button label={t('profile:actions.signOut')} variant="outline" onPress={() => signOut()} style={{ marginTop: spacing.md }} />

      <LanguagePicker visible={languageOpen} onClose={() => setLanguageOpen(false)} />
    </ScrollView>
  );
}

/**
 * Sanction en cours (`docs/AUDIT_COUVERTURE_CDC.md` §6) : consultation réelle et,
 * si elle n'a pas déjà été contestée, formulaire de contestation (écriture directe
 * `driverSanctions/{id}`, décision ensuite prise par l'équipe support).
 */
function SanctionCard({ sanction, uid }: { sanction: NonNullable<ReturnType<typeof useActiveSanction>['data']>; uid: string | null }) {
  const { t, locale } = useTranslation('profile');
  const { submit, pending, error } = useContestSanction(uid);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const alreadyContested = sanction.status !== 'active' || Boolean(sanction.contest);

  return (
    <Card style={{ marginTop: spacing.lg, borderColor: colors.danger, borderWidth: 1 }}>
      <Text variant="bodyStrong">{SANCTION_TYPE_LABELS[sanction.type]}</Text>
      <Text variant="body" color="muted" style={{ marginTop: 4 }}>
        {sanction.reason}
      </Text>
      {sanction.endsAt ? (
        <Text variant="caption" color="subtle" style={{ marginTop: 4 }}>
          {t('profile:sanction.until', { date: new Date(sanction.endsAt.toDate()).toLocaleDateString(intlLocale(locale)) })}
        </Text>
      ) : null}

      {alreadyContested ? (
        <Badge
          label={
            sanction.status === 'contested'
              ? t('profile:sanction.contestedBadge')
              : sanction.status === 'overturned'
                ? t('profile:sanction.overturnedBadge')
                : t('profile:sanction.reviewedBadge')
          }
          tone={sanction.status === 'overturned' ? 'success' : 'neutral'}
          style={{ marginTop: spacing.md }}
        />
      ) : sent ? (
        <Badge label={t('profile:sanction.sentBadge')} tone="neutral" style={{ marginTop: spacing.md }} />
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text variant="caption" color="muted">
            {t('profile:sanction.prompt')}
          </Text>
          <Input placeholder={t('profile:sanction.placeholder')} value={message} onChangeText={setMessage} multiline numberOfLines={3} />
          {error ? (
            <Text variant="caption" color="danger">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('profile:sanction.contest')}
            variant="outline"
            loading={pending}
            disabled={message.trim().length < 10}
            onPress={async () => {
              const ok = await submit(sanction.id, message.trim());
              if (ok) setSent(true);
            }}
          />
        </View>
      )}
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text variant="body" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  infoBlock: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
});
