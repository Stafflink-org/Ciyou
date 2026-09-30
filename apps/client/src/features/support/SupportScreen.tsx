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
import { useTranslation } from '../../i18n/I18nProvider';
import { createClientTicket, useMyTickets, type TicketCategory } from './hooks';

type Props = NativeStackScreenProps<MainStackParamList, 'Support'>;

const STATUS_KEYS: Record<string, string> = {
  open: 'status.open',
  in_progress: 'status.in_progress',
  waiting_customer: 'status.waiting_customer',
  resolved: 'status.resolved',
  closed: 'status.closed',
};
const CATEGORY_KEYS: Record<TicketCategory, string> = {
  order: 'category.order',
  account: 'category.account',
  payment: 'category.payment',
  other: 'category.other',
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
  const { t } = useTranslation('support');
  const tickets = useMyTickets();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('order');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 5 || body.trim().length < 10) {
      toast.show(t('support:validation'), 'danger');
      return;
    }
    setSending(true);
    try {
      const result = await createClientTicket({ category, subject: subject.trim(), body: body.trim(), orderId: route.params?.orderId ?? null });
      toast.show(t('support:sent', { number: result.number }));
      setCreating(false);
      setSubject('');
      setBody('');
      navigation.navigate('TicketDetail', { ticketId: result.ticketId });
    } catch (error) {
      toast.show(errorMessage(error, t), 'danger');
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <Text variant="eyebrow" color="muted">
        {t('support:eyebrow')}
      </Text>
      <Text variant="title" style={{ marginBottom: 4 }}>
        {t('support:title')}
      </Text>
      <Text variant="body" color="muted">
        {t('support:intro')}
      </Text>

      {!creating ? (
        <Button label={t('support:newRequest')} onPress={() => setCreating(true)} style={{ marginTop: spacing.sm }} />
      ) : (
        <Card style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          <Text variant="bodyStrong">{t('support:newRequest')}</Text>
          <View style={styles.chipsRow}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
                <Text variant="caption" color={category === c ? 'inverted' : 'muted'}>
                  {t(`support:${CATEGORY_KEYS[c]}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('support:subject')} placeholder={t('support:subjectPlaceholder')} value={subject} onChangeText={setSubject} maxLength={120} />
          <Input label={t('support:message')} placeholder={t('support:messagePlaceholder')} value={body} onChangeText={setBody} multiline numberOfLines={4} maxLength={1500} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label={t('support:cancel')} variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }} />
            <Button label={t('support:send')} onPress={submit} loading={sending} style={{ flex: 1 }} />
          </View>
        </Card>
      )}

      <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>
        {t('support:yourRequests')}
      </Text>
      {tickets.loading ? (
        <Skeleton style={{ height: 72, borderRadius: 16 }} />
      ) : tickets.data.length === 0 ? (
        <Text variant="body" color="muted">
          {t('support:noRequests')}
        </Text>
      ) : (
        tickets.data.map((ticket) => (
          <Card key={ticket.id} onPress={() => navigation.navigate('TicketDetail', { ticketId: ticket.id })} style={{ marginBottom: 0 }}>
            <View style={styles.row}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {ticket.subject}
              </Text>
              <Badge label={STATUS_KEYS[ticket.status] ? t(`support:${STATUS_KEYS[ticket.status]}`) : ticket.status} tone={STATUS_TONE[ticket.status] ?? 'neutral'} />
            </View>
            <Text variant="caption" color="muted" style={{ marginTop: 4 }} numberOfLines={1}>
              {ticket.number} · {ticket.lastMessagePreview}
            </Text>
            {ticket.unreadByRequester > 0 ? <Badge label={t('support:newReplies', { count: ticket.unreadByRequester })} tone="primary" style={{ marginTop: spacing.xs }} /> : null}
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
