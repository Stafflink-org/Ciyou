// Panneaux annexes de la course active (mission lot 2, points 4-6) : client absent,
// messagerie avec le commerce, espèces détenues (livreur salarié). Composants
// autonomes, montés seulement quand pertinents par DispatchScreen.
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import type { Conversation, ConversationMessage, DriverPrivate, Order, WithId } from '@golink/shared';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Input } from '../../ui/Input';
import { Text } from '../../ui/Text';
import { useToast } from '../../ui/Toast';
import { errorMessage, toDate } from '../../lib/firestore';
import { closeCustomerAbsent, logCustomerCall, markDriverArrived, sendConversationMessage } from './hooks';

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

function formatClock(d: Date | null): string {
  return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Bouton + suivi « client absent » — visible une fois la course récupérée (§ décisions client n°25). */
export function CustomerAbsentPanel({ orderId, order }: { orderId: string; order: WithId<Order> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const absence = order.customerAbsence;
  const waitUntilMs = absence?.waitUntil ? toDate(absence.waitUntil)?.getTime() ?? null : null;
  const [now, setNow] = useState(() => Date.now());
  // Rafraîchit l'affichage du compte à rebours d'attente chaque seconde tant qu'il est actif.
  useEffect(() => {
    if (!waitUntilMs) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitUntilMs]);
  const canClose = Boolean(waitUntilMs) && now >= (waitUntilMs ?? Infinity);
  const remainingSec = waitUntilMs ? Math.max(0, Math.ceil((waitUntilMs - now) / 1000)) : 0;

  const arrive = async () => {
    setBusy(true);
    try {
      await markDriverArrived({ orderId });
      toast.show('Arrivée signalée : le client en est informé.');
    } catch (err) {
      toast.show(errorMessage(err, 'Impossible de signaler votre arrivée.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const call = async () => {
    setBusy(true);
    try {
      await logCustomerCall({ orderId });
      // Le numéro réel du client est masqué côté app (protection des données) : la mise en
      // relation téléphonique effective (proxy d'appel) n'est pas câblée dans ce lot — voir
      // docs/CONTRAT_MODULES.md §11. On trace l'appel comme l'exige la fonction serveur.
      toast.show('Appel enregistré. Contactez le client au numéro communiqué à la commande si besoin.');
    } catch (err) {
      toast.show(errorMessage(err, 'Impossible d’enregistrer l’appel.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      await closeCustomerAbsent({ orderId });
      toast.show('Commande clôturée : client absent.');
    } catch (err) {
      toast.show(errorMessage(err, 'Impossible de clôturer la commande.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (!absence) {
    return (
      <Button label="Client absent" variant="outline" onPress={arrive} loading={busy} style={{ marginTop: spacing.sm }} />
    );
  }

  return (
    <Card style={{ marginTop: spacing.md, backgroundColor: colors.warningSoft }}>
      <Text variant="bodyStrong">Client absent</Text>
      <Text variant="caption" color="muted" style={{ marginTop: 4 }}>
        Arrivé à {formatClock(toDate(absence.arrivedAt))} · {absence.calls} appel{absence.calls > 1 ? 's' : ''}
        {order.customerPhoneMasked ? ` · ${order.customerPhoneMasked}` : ''}
      </Text>
      {!canClose ? (
        <Text variant="caption" style={{ marginTop: 4 }}>
          Patientez encore {remainingSec}s avant de pouvoir clôturer.
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Button label="Appeler le client" variant="outline" size="md" fullWidth={false} onPress={call} loading={busy} style={{ flex: 1 }} />
        <Button label="Clôturer" size="md" fullWidth={false} onPress={close} loading={busy} disabled={!canClose} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

/** Fil de messagerie commerce ↔ livreur pour la course en cours (conversations/{id}, sans réinvention). */
export function MessagingPanel({
  uid,
  displayName,
  conversation,
  messages,
  loading,
}: {
  uid: string;
  displayName: string;
  conversation: WithId<Conversation> | null;
  messages: WithId<ConversationMessage>[];
  loading: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!conversation || !text.trim()) return;
    setSending(true);
    try {
      await sendConversationMessage(conversation.id, uid, displayName, text.trim());
      setText('');
    } catch (err) {
      toast.show(errorMessage(err, 'Message non envoyé.'), 'danger');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card style={{ marginTop: spacing.md }}>
      <Text variant="eyebrow" color="primary">
        Messagerie avec le commerce
      </Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} />
      ) : !conversation ? (
        <Text variant="body" color="muted" style={{ marginTop: 6 }}>
          Aucune conversation pour l’instant. Le commerce peut vous écrire depuis son espace dès que vous êtes attribué à la course.
        </Text>
      ) : (
        <>
          <ScrollView style={styles.thread} contentContainerStyle={{ gap: 6 }}>
            {messages.length === 0 ? (
              <Text variant="caption" color="muted">
                Aucun message pour l’instant.
              </Text>
            ) : (
              messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.senderId === uid ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text variant="caption" color={m.senderId === uid ? 'inverted' : 'default'} style={{ opacity: 0.7 }}>
                    {m.senderName ?? (m.senderRole === 'restaurant' ? 'Commerce' : 'Vous')}
                  </Text>
                  <Text variant="body" color={m.senderId === uid ? 'inverted' : 'default'}>
                    {m.text}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Input value={text} onChangeText={setText} placeholder="Écrire au commerce…" maxLength={2000} />
            </View>
            <Button label="Envoyer" size="md" fullWidth={false} onPress={send} loading={sending} disabled={!text.trim()} />
          </View>
        </>
      )}
    </Card>
  );
}

/** Solde d'espèces détenu — livreurs salariés d'un commerce uniquement (drivers/{uid}.type === 'restaurant'). */
export function CashBalanceCard({ driverPrivate }: { driverPrivate: WithId<DriverPrivate> | null }) {
  if (!driverPrivate) return null;
  return (
    <Card style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="eyebrow" color="primary">
          Espèces détenues
        </Text>
        <Badge label={driverPrivate.cashBalanceCents > driverPrivate.cashLimitCents ? 'Plafond dépassé' : 'À reverser'} tone={driverPrivate.cashBalanceCents > driverPrivate.cashLimitCents ? 'danger' : 'neutral'} />
      </View>
      <Text variant="title" style={{ marginTop: 6 }}>
        {money(driverPrivate.cashBalanceCents)}
      </Text>
      <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
        Plafond {money(driverPrivate.cashLimitCents)} · à remettre à votre commerce
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  thread: { maxHeight: 220, marginTop: spacing.sm },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: '85%' },
  bubbleMine: { backgroundColor: colors.ink, alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: colors.surfaceAlt, alignSelf: 'flex-start' },
});
