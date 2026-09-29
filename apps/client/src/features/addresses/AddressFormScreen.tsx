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

type Props = NativeStackScreenProps<MainStackParamList, 'AddressForm'>;

export function AddressFormScreen({ route, navigation }: Props) {
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
      toast.show('Indiquez une adresse.', 'danger');
      return;
    }
    setSaving(true);
    try {
      const input = { label, line1, details, floor, doorCode, instructions };
      if (addressId) {
        await update(addressId, input);
        toast.show('Adresse modifiée');
      } else {
        await create(input, false);
        toast.show('Adresse ajoutée');
      }
      navigation.goBack();
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  if (addressId && loading) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="title">{addressId ? "Modifier l'adresse" : 'Nouvelle adresse'}</Text>
      <Input label="Étiquette" placeholder="Domicile, Bureau…" value={label} onChangeText={setLabel} />
      <Input label="Adresse" placeholder="12 rue de la Paix, 54400 Longwy" value={line1} onChangeText={setLine1} />
      <Input label="Complément" placeholder="2e étage, digicode…" value={details} onChangeText={setDetails} />
      <Input label="Étage" placeholder="2" value={floor} onChangeText={setFloor} />
      <Input label="Code d'accès" placeholder="A1234" value={doorCode} onChangeText={setDoorCode} />
      <Input label="Instructions pour le livreur" placeholder="Sonner à l'interphone Dupont" value={instructions} onChangeText={setInstructions} multiline />
      <Button label="Enregistrer" onPress={save} loading={saving} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
