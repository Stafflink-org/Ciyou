// Adresses (`AddressesScreen`, §15 client.md) — liste réelle, adresse par
// défaut, suppression, ajout/modification (via `AddressFormScreen`).
import { Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { PlaceholderScreen } from '../shared/PlaceholderScreen';
import { useAddresses, useAddressActions, useDefaultAddressId } from './hooks';
import { errorMessage } from '../../lib/firestore';

type Props = NativeStackScreenProps<MainStackParamList, 'Addresses'>;

export function AddressesScreen({ navigation }: Props) {
  const { data: addresses, loading } = useAddresses();
  const defaultAddressId = useDefaultAddressId();
  const { remove, setDefault } = useAddressActions();
  const toast = useToast();

  if (loading) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton style={{ height: 84, borderRadius: 16 }} />
        <Skeleton style={{ height: 84, borderRadius: 16 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {addresses.length === 0 ? (
        <PlaceholderScreen icon="📍" title="Aucune adresse enregistrée" note="Ajoutez une adresse pour aller plus vite au moment de commander." />
      ) : (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          {addresses.map((a) => (
            <Card key={a.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <View style={styles.labelRow}>
                    <Text variant="bodyStrong">{a.label}</Text>
                    {a.id === defaultAddressId ? <Badge label="Par défaut" tone="primary" /> : null}
                  </View>
                  <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                    {a.line1}
                    {a.details ? ` · ${a.details}` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable onPress={() => navigation.navigate('AddressForm', { addressId: a.id })}>
                  <Text variant="bodyStrong" color="primary">
                    Modifier
                  </Text>
                </Pressable>
                {a.id !== defaultAddressId ? (
                  <Pressable onPress={() => setDefault(a.id).catch((e) => toast.show(errorMessage(e), 'danger'))}>
                    <Text variant="bodyStrong" color="primary">
                      Définir par défaut
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    remove(a.id)
                      .then(() => toast.show('Adresse supprimée'))
                      .catch((e) => toast.show(errorMessage(e), 'danger'))
                  }
                >
                  <Text variant="bodyStrong" color="danger">
                    Supprimer
                  </Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      )}
      <View style={styles.footer}>
        <Button label="Ajouter une adresse" onPress={() => navigation.navigate('AddressForm')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footer: { padding: spacing.lg },
});
