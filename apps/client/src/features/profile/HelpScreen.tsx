// Aide / support (§19 client.md) — FAQ statique (aucune collection FAQ dédiée
// trouvée côté serveur) + accès réel au support (`Support`/`TicketDetail`,
// tâche `cdc-mobile-recompte` : ouverture de ticket et chat désormais réels,
// `functions/src/messaging/client/support.ts`).
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';

type Props = NativeStackScreenProps<MainStackParamList, 'Help'>;

const FAQ: { q: string; a: string }[] = [
  { q: 'Ma commande est en retard, que faire ?', a: 'Consultez le suivi de commande : le statut et la position du livreur (si assigné) s’y actualisent en temps réel.' },
  { q: 'Comment modifier ou annuler une commande ?', a: 'Une commande déjà envoyée ne peut plus être modifiée depuis l’application ; contactez le restaurant ou l’assistance rapidement après l’envoi.' },
  { q: 'Un article est manquant ou différent', a: 'Depuis le détail de la commande concernée, vous pouvez signaler le problème à l’assistance.' },
  { q: 'Comment supprimer mon compte ?', a: 'Contactez l’assistance par e-mail : votre demande sera traitée conformément à notre politique de confidentialité.' },
];

export function HelpScreen({ navigation }: Props) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="title">Aide</Text>
      <Text variant="body" color="muted" style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
        Questions fréquentes et contact de l'assistance Ciyou Eats.
      </Text>

      <View style={{ gap: spacing.sm }}>
        {FAQ.map((item) => (
          <Card key={item.q}>
            <Text variant="bodyStrong">{item.q}</Text>
            <Text variant="body" color="muted" style={{ marginTop: 4 }}>
              {item.a}
            </Text>
          </Card>
        ))}
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Text variant="bodyStrong">Nous contacter</Text>
        <Text variant="body" color="muted" style={{ marginTop: 4 }}>
          Ouvrez une demande : notre équipe vous répond directement dans l'application.
        </Text>
        <Button label="Contacter le support" onPress={() => navigation.navigate('Support', undefined)} style={{ marginTop: spacing.md }} />
        <Button label="Envoyer un e-mail" variant="outline" onPress={() => Linking.openURL('mailto:support@ciyou-eats.com')} style={{ marginTop: spacing.sm }} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
