// Gains (onglet, golink-maquette/v2/livreur-admin.md §1.3/§1.6) : semaine en
// cours, versements récents, relevé — lecture réelle de `driverEarnings`
// (jamais la formule fictive « 4,50 € + 0,80 €/article » de la maquette).
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { Badge } from '../../ui/Badge';
import { Card } from '../../ui/Card';
import { Text } from '../../ui/Text';
import { summarizeEarnings, useDriverEarnings } from './hooks';

const money = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const KIND_LABEL: Record<string, string> = {
  delivery: 'Course',
  bonus: 'Prime',
  hourly_guarantee: 'Garantie horaire',
  referral: 'Parrainage',
  adjustment: 'Ajustement',
};

export function EarningsScreen() {
  const { user } = useAuth();
  const { data, loading } = useDriverEarnings(user?.uid ?? null);
  const summary = summarizeEarnings(data);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Text variant="eyebrow" color="muted">
        Cette semaine
      </Text>
      <Text variant="display" style={{ marginTop: 4 }}>
        {money(summary.weekTotalCents)}
      </Text>
      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text variant="caption" color="muted">
            Courses
          </Text>
          <Text variant="subtitle">{summary.weekDeliveries}</Text>
        </View>
        <View style={styles.kpi}>
          <Text variant="caption" color="muted">
            Pourboires
          </Text>
          <Text variant="subtitle">{money(summary.weekTipsCents)}</Text>
        </View>
      </View>

      <Text variant="subtitle" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Relevé récent
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : data.length === 0 ? (
        <Card>
          <Text variant="body" color="muted" align="center">
            Aucun gain enregistré pour le moment. Passez en ligne dans Dispatch pour recevoir des courses.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {data.map((entry) => (
            <Card key={entry.id} padded>
              <View style={styles.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{KIND_LABEL[entry.kind] ?? entry.kind}</Text>
                  <Text variant="caption" color="muted">
                    {entry.earnedAt.toDate().toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="bodyStrong">{money(entry.amountCents + entry.tipCents)}</Text>
                  {entry.tipCents > 0 ? (
                    <Badge label={`dont ${money(entry.tipCents)} pourboire`} tone="primary" style={{ marginTop: 4 }} />
                  ) : null}
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  kpiRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  kpi: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  entryRow: { flexDirection: 'row', alignItems: 'center' },
});
