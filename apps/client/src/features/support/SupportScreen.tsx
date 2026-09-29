// Support (`SupportScreen`, §13 cahier super admin) — liste réelle des demandes
// du client (`supportTickets`, `requesterId==uid`) + ouverture d'une nouvelle
// demande (`createClientTicket`). Complète HelpScreen (FAQ statique) : ici,
// c'est un vrai fil avec l'équipe Ciyou Eats.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge, type BadgeTone } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { CATEGORY_LABELS, createClientTicket, useMyTickets, type TicketCategory } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'Support'>;

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  waiting_customer: 'En attente de vous',
  resolved: 'Résolue',
  closed: 'Fermée',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'primary',
  in_progress: 'primary',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

const CATEGORIES: TicketCategory[] = ['order', 'account', 'payment', 'other'];

export function SupportScreen({ navigation, route }: Props) {
  const tickets = useMyTickets();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('order');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 5 || body.trim().length < 10) {
      toast.show('Précisez l’objet et décrivez votre demande (10 caractères au moins).', 'danger');
      return;
    }
    setSending(true);
    try {
      const result = await createClientTicket({ category, subject: subject.trim(), body: body.trim(), orderId: route.params?.orderId ?? null });
      toast.show(`Demande ${result.number} envoyée au support.`);
      setCreating(false);
      setSubject('');
      setBody('');
      navigation.navigate('TicketDetail', { ticketId: result.ticketId });
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="eyebrow" color="muted">
        ASSISTANCE
      </Text>
      <Text variant="title" style={{ marginBottom: 4 }}>
        Support Ciyou Eats
      </Text>
      <Text variant="body" color="muted">
        Une question sur une commande, un paiement ou votre compte ? Écrivez-nous, nous répondons directement ici.
      </Text>

      {!creating ? (
        <Button label="Nouvelle demande" onPress={() => setCreating(true)} style={{ marginTop: spacing.sm }} />
      ) : (
        <Card style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          <Text variant="bodyStrong">Nouvelle demande</Text>
          <View style={styles.chipsRow}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
                <Text variant="caption" color={category === c ? 'inverted' : 'muted'}>
                  {CATEGORY_LABELS[c]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Input label="Objet" placeholder="Ex. Ma commande n'est jamais arrivée" value={subject} onChangeText={setSubject} maxLength={120} />
          <Input label="Votre message" placeholder="Décrivez votre demande…" value={body} onChangeText={setBody} multiline numberOfLines={4} maxLength={1500} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Annuler" variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }} />
            <Button label="Envoyer" onPress={submit} loading={sending} style={{ flex: 1 }} />
          </View>
        </Card>
      )}

      <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>
        Vos demandes
      </Text>
      {tickets.loading ? (
        <Skeleton style={{ height: 72, borderRadius: 16 }} />
      ) : tickets.data.length === 0 ? (
        <Text variant="body" color="muted">
          Aucune demande pour le moment.
        </Text>
      ) : (
        tickets.data.map((t) => (
          <Card key={t.id} onPress={() => navigation.navigate('TicketDetail', { ticketId: t.id })} style={{ marginBottom: 0 }}>
            <View style={styles.row}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {t.subject}
              </Text>
              <Badge label={STATUS_LABELS[t.status] ?? t.status} tone={STATUS_TONE[t.status] ?? 'neutral'} />
            </View>
            <Text variant="caption" color="muted" style={{ marginTop: 4 }} numberOfLines={1}>
              {t.number} · {t.lastMessagePreview}
            </Text>
            {t.unreadByRequester > 0 ? <Badge label={`${t.unreadByRequester} nouvelle(s) réponse(s)`} tone="primary" style={{ marginTop: spacing.xs }} /> : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  row: { flexDirection: 'row', alignItems: 'center' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  chipActive: { backgroundColor: colors.ink },
});
