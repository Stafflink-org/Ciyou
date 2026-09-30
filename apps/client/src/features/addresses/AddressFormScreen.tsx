// Formulaire d'adresse (`AddressFormScreen`, feuille modale, §18.1) — ajout ou
// modification réelle d'une adresse de `users/{uid}/addresses`.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { useAddress, useAddressActions } from './hooks';
import { useTranslation } from '../../i18n/I18nProvider';

type Props = NativeStackScreenProps<MainStackParamList, 'AddressForm'>;

export function AddressFormScreen({ route, navigation }: Props) {
  const { t } = useTranslation('addresses');
  const addressId = route.params?.addressId;
  const { data: existing, loading } = useAddress(addressId);
  const { create, update } = useAddressActions();
  const toast = useToast();

  const [label, setLabel] = useState('');
  const [line1, setLine1] = useState('');
  const [details, setDetails] = useState('');
  const [floor, setFloor] = useState('');
  const [doorCode, setDoorCode] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setLabel(existing.label);
      setLine1(existing.line1);
      setDetails(existing.details ?? '');
      setFloor(existing.floor ?? '');
      setDoorCode(existing.doorCode ?? '');
      setInstructions(existing.instructions ?? '');
    }
  }, [existing]);

  const save = async () => {
    if (!line1.trim()) {
      toast.show(t('addresses:form.missingLine1'), 'danger');
      return;
    }
    setSaving(true);
    try {
      const input = { label, line1, details, floor, doorCode, instructions };
      if (addressId) {
        await update(addressId, input);
        toast.show(t('addresses:form.updated'));
      } else {
        await create(input, false);
        toast.show(t('addresses:form.created'));
      }
      navigation.goBack();
    } catch (error) {
      toast.show(errorMessage(error, t), 'danger');
    } finally {
      setSaving(false);
    }
  };

  if (addressId && loading) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="title">{addressId ? t('addresses:form.editTitle') : t('addresses:form.newTitle')}</Text>
      <Input label={t('addresses:form.labelField')} placeholder={t('addresses:form.labelPlaceholder')} value={label} onChangeText={setLabel} />
      <Input label={t('addresses:form.line1Field')} placeholder={t('addresses:form.line1Placeholder')} value={line1} onChangeText={setLine1} />
      <Input label={t('addresses:form.detailsField')} placeholder={t('addresses:form.detailsPlaceholder')} value={details} onChangeText={setDetails} />
      <Input label={t('addresses:form.floorField')} placeholder={t('addresses:form.floorPlaceholder')} value={floor} onChangeText={setFloor} />
      <Input label={t('addresses:form.doorCodeField')} placeholder={t('addresses:form.doorCodePlaceholder')} value={doorCode} onChangeText={setDoorCode} />
      <Input label={t('addresses:form.instructionsField')} placeholder={t('addresses:form.instructionsPlaceholder')} value={instructions} onChangeText={setInstructions} multiline />
      <Button label={t('addresses:form.save')} onPress={save} loading={saving} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
