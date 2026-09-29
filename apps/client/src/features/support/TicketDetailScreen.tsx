// Fil d'une demande (`TicketDetailScreen`) — chat réel avec le support
// (`supportTickets/{id}/messages`, réponses via `replyToClientTicket`).
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { errorMessage } from '../../lib/firestore';
import { markTicketRead, replyToClientTicket, useTicket, useTicketMessages } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'TicketDetail'>;

export function TicketDetailScreen({ route }: Props) {
  const { ticketId } = route.params;
  const ticket = useTicket(ticketId);
  const messages = useTicketMessages(ticketId);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (ticket.data && ticket.data.unreadByRequester > 0) void markTicketRead(ticketId);
  }, [ticket.data, ticketId]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await replyToClientTicket({ ticketId, body: body.trim() });
      setBody('');
    } catch (error) {
      toast.show(errorMessage(error), 'danger');
    } finally {
      setSending(false);
    }
  };

  if (ticket.loading || messages.loading) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton style={{ height: 60, borderRadius: 16 }} />
        <Skeleton style={{ height: 60, borderRadius: 16, marginLeft: 40 }} />
      </View>
    );
  }

  if (!ticket.data) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Text variant="body" color="muted">
          Cette demande est introuvable.
        </Text>
      </View>
    );
  }

  const closed = ticket.data.status === 'closed';

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        <Card style={{ marginBottom: spacing.sm }}>
          <Text variant="bodyStrong">{ticket.data.subject}</Text>
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            {ticket.data.number}
          </Text>
        </Card>
        {messages.error ? (
          <Text variant="caption" color="danger">
            {errorMessage(messages.error)}
          </Text>
        ) : null}
        {messages.data.map((m) => (
          <View key={m.id} style={[styles.bubbleRow, m.authorType === 'requester' && styles.bubbleRowMine]}>
            <View style={[styles.bubble, m.authorType === 'requester' ? styles.bubbleMine : styles.bubbleTheirs]}>
              {m.authorType !== 'requester' ? (
                <Text variant="caption" color="muted" style={{ marginBottom: 2 }}>
                  {m.authorType === 'system' ? 'Ciyou Eats' : 'Support Ciyou Eats'}
                </Text>
              ) : null}
              <Text variant="body" color={m.authorType === 'requester' ? 'inverted' : 'default'}>
                {m.body}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
      {closed ? (
        <View style={styles.composer}>
          <Badge label="Demande fermée" tone="neutral" />
        </View>
      ) : (
        <View style={styles.composer}>
          <View style={{ flex: 1 }}>
            <Input placeholder="Votre message…" value={body} onChangeText={setBody} multiline />
          </View>
          <Button label="Envoyer" onPress={send} loading={sending} disabled={!body.trim()} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: colors.ink, borderTopRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.canvas },
});
