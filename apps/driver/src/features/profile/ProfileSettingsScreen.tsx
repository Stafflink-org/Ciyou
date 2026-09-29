// Réglages du profil (mission lot 3) : véhicule, distance maximale, justificatifs.
// Modification réelle drivers/{uid}.vehicle et .maxDistanceMeters (docs/DECISIONS_CLIENT.md
// « Distance max : choisie par le livreur »), dépôt réel de justificatifs
// (partnerDocuments, ownerType 'driver', functions/src/drivers/documents.ts).
import { useEffect, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  DOCUMENT_STATUS_LABELS,
  PARTNER_DOCUMENT_LABELS,
  VEHICLE_LABELS,
  VEHICLE_TYPES,
  type PartnerDocumentType,
  type VehicleType,
} from '@golink/shared';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { useTranslation } from '../../i18n/I18nProvider';
import { errorMessage } from '../../lib/firestore';
import { uploadPrivateDriverDocument } from '../../lib/storage';
import { useDriverDocuments, useDriverProfile, uploadDriverDocument, useUpdateDriverSettings } from './hooks';

/** Types de justificatifs pertinents pour un livreur (mêmes valeurs que functions/src/drivers/documents.ts). */
const DRIVER_DOCUMENT_TYPES: PartnerDocumentType[] = [
  'identity',
  'residence_permit',
  'work_permit',
  'siret_registration',
  'urssaf_certificate',
  'insurance',
  'driving_license',
  'vehicle_registration',
  'other',
];

/** Véhicules motorisés : seuls ceux-ci demandent assurance/permis/carte grise. */
const MOTORIZED: VehicleType[] = ['scooter', 'motorbike', 'car'];

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'danger',
};

export function ProfileSettingsScreen() {
  const { user } = useAuth();
  const { t } = useTranslation('profileSettings');
  const uid = user?.uid ?? null;
  const { data: driver } = useDriverProfile(uid);
  const { save, pending: savingSettings, error: settingsError } = useUpdateDriverSettings(uid);
  const { data: documents } = useDriverDocuments(uid);
  const toast = useToast();

  const [vehicleType, setVehicleType] = useState<VehicleType>('bike');
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [distanceKm, setDistanceKm] = useState('5');
  const [uploadingType, setUploadingType] = useState<PartnerDocumentType | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (!driver) return;
    setVehicleType(driver.vehicle.type);
    setPlate(driver.vehicle.plate ?? '');
    setModel(driver.vehicle.model ?? '');
    setColor(driver.vehicle.color ?? '');
    setDistanceKm(driver.maxDistanceMeters ? String(Math.round(driver.maxDistanceMeters / 1000)) : '5');
  }, [driver]);

  const distanceMeters = useMemo(() => {
    const km = Number(distanceKm.replace(',', '.'));
    if (!Number.isFinite(km)) return null;
    return Math.round(km * 1000);
  }, [distanceKm]);
  const distanceError = distanceMeters === null || distanceMeters < 500 || distanceMeters > 50000 ? t('profileSettings:distance.error') : null;

  const saveSettings = async () => {
    if (distanceError || distanceMeters === null) return;
    const ok = await save({
      vehicle: { type: vehicleType, plate: plate.trim() || null, model: model.trim() || null, color: color.trim() || null },
      maxDistanceMeters: distanceMeters,
    });
    if (ok) toast.show(t('profileSettings:toast.saved'));
    else toast.show(settingsError ?? t('profileSettings:toast.saveError'), 'danger');
  };

  const pickAndUpload = async (type: PartnerDocumentType) => {
    if (!uid) return;
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploadingType(type);
    setUploadProgress(0);
    try {
      const storagePath = await uploadPrivateDriverDocument(
        uid,
        type,
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file },
        setUploadProgress,
      );
      await uploadDriverDocument({
        driverId: uid,
        type,
        storagePath,
        fileName: asset.name,
        number: null,
        issuedAt: null,
        expiresAt: null,
      });
      toast.show(t('profileSettings:toast.uploaded', { label: PARTNER_DOCUMENT_LABELS[type] }));
    } catch (error) {
      toast.show(errorMessage(error, t('profileSettings:toast.uploadError')), 'danger');
    } finally {
      setUploadingType(null);
    }
  };

  const relevantVehicleTypes = VEHICLE_TYPES;
  const isMotorized = MOTORIZED.includes(vehicleType);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg }}>
      <Card>
        <Text variant="subtitle">{t('profileSettings:vehicle.title')}</Text>
        <View style={styles.chipRow}>
          {relevantVehicleTypes.map((type) => (
            <Pressable
              key={type}
              onPress={() => setVehicleType(type)}
              style={[styles.chip, vehicleType === type && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: vehicleType === type }}
            >
              <Text variant="caption" style={{ color: vehicleType === type ? colors.primaryFg : colors.fg }}>
                {VEHICLE_LABELS[type]}
              </Text>
            </Pressable>
          ))}
        </View>
        {isMotorized ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Input label={t('profileSettings:vehicle.plate')} value={plate} onChangeText={setPlate} autoCapitalize="characters" />
            <Input label={t('profileSettings:vehicle.model')} value={model} onChangeText={setModel} />
            <Input label={t('profileSettings:vehicle.color')} value={color} onChangeText={setColor} />
          </View>
        ) : null}
      </Card>

      <Card>
        <Text variant="subtitle">{t('profileSettings:distance.title')}</Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {t('profileSettings:distance.description')}
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <Input
            label={t('profileSettings:distance.label')}
            value={distanceKm}
            onChangeText={setDistanceKm}
            keyboardType="decimal-pad"
            error={distanceError}
          />
        </View>
      </Card>

      <Button label={t('profileSettings:save')} onPress={() => void saveSettings()} loading={savingSettings} disabled={!!distanceError} />

      <Card>
        <Text variant="subtitle">{t('profileSettings:documents.title')}</Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2, marginBottom: spacing.md }}>
          {t('profileSettings:documents.description')}
        </Text>
        {DRIVER_DOCUMENT_TYPES.map((type) => {
          const existing = documents.filter((d) => d.type === type).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0];
          const busy = uploadingType === type;
          return (
            <View key={type} style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text variant="body">{PARTNER_DOCUMENT_LABELS[type]}</Text>
                {existing ? (
                  <Badge
                    label={DOCUMENT_STATUS_LABELS[existing.status]}
                    tone={STATUS_TONE[existing.status] ?? 'neutral'}
                    style={{ marginTop: 4 }}
                  />
                ) : (
                  <Text variant="caption" color="muted">
                    {t('profileSettings:documents.none')}
                  </Text>
                )}
              </View>
              <Button
                label={busy ? t('profileSettings:documents.progress', { percent: Math.round(uploadProgress * 100) }) : existing ? t('profileSettings:documents.replace') : t('profileSettings:documents.upload')}
                variant="outline"
                size="md"
                fullWidth={false}
                loading={busy}
                onPress={() => void pickAndUpload(type)}
              />
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
