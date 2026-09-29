// Petits composants de l'écran Dispatch : compte à rebours d'une offre, ligne
// d'information, avatar de statut.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Text } from '../../ui/Text';

export function Countdown({ untilMillis, onExpire }: { untilMillis: number; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = untilMillis - now;
  useEffect(() => {
    if (remainingMs <= 0) onExpire?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs <= 0]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const isUrgent = seconds <= 5;

  return (
    <View style={[styles.badge, isUrgent && styles.badgeUrgent]}>
      <Text variant="bodyStrong" style={{ color: isUrgent ? colors.white : colors.ink }}>
        {seconds > 0 ? `${seconds}s` : 'Expiré'}
      </Text>
    </View>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: colors.warningSoft, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeUrgent: { backgroundColor: colors.danger },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
});
