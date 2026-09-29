// Données personnelles (RGPD, §29 cahier super admin) : dépôt d'une demande d'exercice
// de droits (accès, portabilité, rectification, effacement, opposition) et
// téléchargement de l'export une fois traité. Adaptation livreur, fidèle à
// apps/restaurant/src/features/documents/GdprSection.tsx (mêmes Cloud Functions,
// jamais dupliquées), atteignable depuis ProfileScreen.
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { GDPR_REQUEST_STATUS_LABELS, GDPR_REQUEST_TYPE_LABELS, type GdprRequest, type GdprRequestType, type WithId } from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
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
  const toast = useToast();
  const requests = useMyGdprRequests(user?.uid ?? null);
  const [pendingType, setPendingType] = useState<GdprRequestType | null>(null);

  const openRequests = requests.data.filter((r) => r.status !== 'completed' && r.status !== 'rejected');
  const hasOpen = openRequests.length > 0;

  const submit = async (type: GdprRequestType) => {
    setPendingType(type);
    try {
      await submitGdprRequest({ type, restaurantId: null, notes: null });
      toast.show('Votre demande a été enregistrée. Réponse sous 30 jours.');
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setPendingType(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">Données personnelles</Text>
      <Text variant="body" color="muted" style={{ marginTop: 4 }}>
        Demandez l'accès, la portabilité, la rectification ou l'effacement de vos données détenues par Ciyou Eats, ou opposez-vous à un traitement. Réponse sous 30 jours.
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
            Une demande est déjà en cours de traitement pour votre compte. Vous pourrez en déposer une nouvelle une fois celle-ci close.
          </Text>
        </Card>
      ) : (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {TYPES.map((type) => (
            <Button
              key={type}
              label={`Demander : ${GDPR_REQUEST_TYPE_LABELS[type]}`}
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
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    try {
      const result = await getGdprExportLink({ requestId: request.id });
      await Linking.openURL(result.url);
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={styles.requestRow}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{GDPR_REQUEST_TYPE_LABELS[request.type]}</Text>
        <View style={{ marginTop: 6 }}>
          <Badge label={GDPR_REQUEST_STATUS_LABELS[request.status]} tone={STATUS_TONE[request.status] ?? 'neutral'} />
        </View>
      </View>
      {request.status === 'completed' && request.export ? (
        <Button label="Télécharger" variant="outline" loading={loading} onPress={() => void download()} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  requestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderRadius: radius.lg },
});
