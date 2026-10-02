// Filet de sécurité global : sans cela, toute erreur JS pendant le rendu d'un écran (donnée
// incomplète, accès à un champ manquant…) fait planter l'app ENTIÈREMENT, sans aucun message ni
// trace exploitable côté utilisateur — exactement les plantages remontés en test (TestFlight).
// Affiche un écran de récupération (« Réessayer » redémonte les enfants) et le détail technique
// de l'erreur (message + pile), pour qu'un plantage devienne un rapport de bug exploitable au lieu
// d'un redémarrage silencieux de l'app.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

interface Props {
  children: ReactNode;
  /** Préfixe affiché dans le titre (ex. nom de l'écran), pour distinguer plusieurs limites imbriquées. */
  label?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null, info: null });

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={{ fontSize: 40 }}>⚠️</Text>
          <Text variant="title" align="center" style={{ marginTop: spacing.md }}>
            Une erreur est survenue
          </Text>
          <Text variant="body" color="muted" align="center" style={{ marginTop: spacing.sm }}>
            {this.props.label ? `Écran : ${this.props.label}` : 'Désolé, quelque chose s’est mal passé.'}
          </Text>
          <View style={styles.detailBox}>
            <Text variant="caption" color="muted" style={styles.mono}>
              {error.name}: {error.message}
            </Text>
            {error.stack ? (
              <Text variant="caption" color="subtle" style={[styles.mono, { marginTop: spacing.sm }]}>
                {error.stack}
              </Text>
            ) : null}
            {info?.componentStack ? (
              <Text variant="caption" color="subtle" style={[styles.mono, { marginTop: spacing.sm }]}>
                {info.componentStack}
              </Text>
            ) : null}
          </View>
          <Button label="Réessayer" onPress={this.reset} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xxl * 1.5, alignItems: 'center' },
  detailBox: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    maxHeight: 280,
  },
  mono: { fontFamily: 'monospace' as const },
});
