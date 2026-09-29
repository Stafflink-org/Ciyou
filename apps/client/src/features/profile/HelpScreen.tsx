// Aide / support (§19 client.md) — contenu réel statique (aucune collection
// FAQ dédiée trouvée côté serveur pour ce lot) : questions fréquentes et
// contact, pas de billetterie support (aucune Cloud Function d'ouverture de
// ticket appelable directement par ce lot — `openTicket` existe côté serveur
// mais son branchement complet, avec pièces jointes, est hors périmètre ici).
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';

const FAQ: { q: string; a: string }[] = [
  { q: 'Ma commande est en retard, que faire ?', a: 'Consultez le suivi de commande : le statut et la position du livreur (si assigné) s’y actualisent en temps réel.' },
  { q: 'Comment modifier ou annuler une commande ?', a: 'Une commande déjà envoyée ne peut plus être modifiée depuis l’application ; contactez le restaurant ou l’assistance rapidement après l’envoi.' },
  { q: 'Un article est manquant ou différent', a: 'Depuis le détail de la commande concernée, vous pouvez signaler le problème à l’assistance.' },
  { q: 'Comment supprimer mon compte ?', a: 'Contactez l’assistance par e-mail : votre demande sera traitée conformément à notre politique de confidentialité.' },
];

export function HelpScreen() {
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
          support@ciyou-eats.com
        </Text>
        <Button label="Envoyer un e-mail" variant="outline" onPress={() => Linking.openURL('mailto:support@ciyou-eats.com')} style={{ marginTop: spacing.md }} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
