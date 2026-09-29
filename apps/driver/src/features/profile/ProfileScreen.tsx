// Profil (onglet) : identité réelle (Firebase Auth + fiche drivers/{uid}),
// statut du compte, véhicule, distance maximale choisie (docs/DECISIONS_CLIENT.md
// « Distance max : choisie par le livreur »), déconnexion. Réglages (véhicule,
// distance, documents) : ProfileSettingsScreen (lot 3).
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, View } from 'react-native';
import { VEHICLE_LABELS } from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { useDriverProfile } from './hooks';

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Compte actif', tone: 'success' },
  onboarding: { label: 'Dossier en cours de validation', tone: 'warning' },
  suspended: { label: 'Compte suspendu', tone: 'danger' },
  deactivated: { label: 'Compte désactivé', tone: 'danger' },
};

export function ProfileScreen() {
  const { user, signOut } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { data: driver } = useDriverProfile(user?.uid ?? null);
  const initials = (driver?.displayName ?? user?.email ?? '?').trim().slice(0, 1).toUpperCase();
  const status = driver ? (STATUS_LABEL[driver.status] ?? { label: driver.status, tone: 'neutral' as const }) : null;

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
              {driver?.displayName || 'Livreur Ciyou Eats'}
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
          <InfoLine label="Véhicule" value={VEHICLE_LABELS[driver.vehicle.type]} />
          <InfoLine label="Type" value={driver.type === 'restaurant' ? 'Livreur salarié d’un commerce' : 'Livreur indépendant'} />
          <InfoLine label="Distance maximale" value={driver.maxDistanceMeters ? `${(driver.maxDistanceMeters / 1000).toFixed(1)} km` : 'Non définie'} />
          <InfoLine label="Espèces" value={driver.acceptsCash ? 'Acceptées' : 'Non acceptées'} />
          <InfoLine label="Note moyenne" value={driver.rating.count > 0 ? `${driver.rating.average.toFixed(1)} ★ (${driver.rating.count})` : 'Pas encore de note'} />
        </View>
      ) : null}

      <Button
        label="Véhicule, distance et documents"
        variant="outline"
        onPress={() => navigation.navigate('ProfileSettings')}
        style={{ marginTop: spacing.lg }}
      />

      <Button label="Se déconnecter" variant="outline" onPress={() => signOut()} style={{ marginTop: spacing.md }} />
    </ScrollView>
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
