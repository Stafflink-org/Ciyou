// Données personnelles (RGPD, §29 cahier super admin) : dépôt d'une demande d'exercice
// de droits (accès, portabilité, rectification, effacement, opposition) et
// téléchargement de l'export une fois traité. Adaptation client, fidèle à
// apps/driver/src/features/gdpr/GdprScreen.tsx (mêmes Cloud Functions,
// jamais dupliquées), atteignable depuis ProfileScreen. Contrairement à la copie
// livreur (i18n non exploité), cet écran neuf passe par le namespace `gdpr` et
// `labelOf` (packages/shared/src/constants/labels-i18n.ts) pour les libellés.
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { labelOf, type GdprRequest, type GdprRequestType, type WithId } from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useTranslation } from '../../i18n/I18nProvider';
import { getGdprExportLink, submitGdprRequest, useMyGdprRequests } from './hooks';

const TYPES: GdprRequestType[] = ['access', 'portability', 'rectification', 'erasure', 'objection'];

const STATUS_TONE: Record<string, BadgeTone> = {
  received: 'neutral',
  identity_check: 'warning',
  in_progress: 'warning',
  completed: 'success',
  rejected: 'danger',
};

export function GdprScreen() {
  const { user } = useAuth();
  const { t, locale } = useTranslation('gdpr');
  const toast = useToast();
  const requests = useMyGdprRequests(user?.uid ?? null);
  const [pendingType, setPendingType] = useState<GdprRequestType | null>(null);

  const openRequests = requests.data.filter((r) => r.status !== 'completed' && r.status !== 'rejected');
  const hasOpen = openRequests.length > 0;

  const submit = async (type: GdprRequestType) => {
    setPendingType(type);
    try {
      await submitGdprRequest({ type, restaurantId: null, notes: null });
      toast.show(t('gdpr:submitted'));
    } catch (error) {
      toast.show(errorMessage(error, t), 'danger');
    } finally {
      setPendingType(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">{t('gdpr:title')}</Text>
      <Text variant="body" color="muted" style={{ marginTop: 4 }}>
        {t('gdpr:intro')}
      </Text>

      {requests.data.length > 0 ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {requests.data.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </View>
      ) : null}

      {hasOpen ? (
        <Card style={{ marginTop: spacing.lg }}>
          <Text variant="body" color="muted">
            {t('gdpr:pendingNotice')}
          </Text>
        </Card>
      ) : (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {TYPES.map((type) => (
            <Button
              key={type}
              label={t('gdpr:requestLabel', { type: labelOf('GDPR_REQUEST_TYPE_LABELS', type, locale) })}
              variant="outline"
              loading={pendingType === type}
              disabled={pendingType !== null}
              onPress={() => void submit(type)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function RequestRow({ request }: { request: WithId<GdprRequest> }) {
  const toast = useToast();
  const { t, locale } = useTranslation('gdpr');
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    try {
      const result = await getGdprExportLink({ requestId: request.id });
      await Linking.openURL(result.url);
    } catch (error) {
      toast.show(errorMessage(error, t), 'danger');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={styles.requestRow}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{labelOf('GDPR_REQUEST_TYPE_LABELS', request.type, locale)}</Text>
        <View style={{ marginTop: 6 }}>
          <Badge label={labelOf('GDPR_REQUEST_STATUS_LABELS', request.status, locale)} tone={STATUS_TONE[request.status] ?? 'neutral'} />
        </View>
      </View>
      {request.status === 'completed' && request.export ? (
        <Button label={t('gdpr:download')} variant="outline" loading={loading} onPress={() => void download()} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderRadius: radius.lg },
});
