// Carte et itinéraire réels (mission lot 2, point 2) — version native (iOS/Android,
// development build). Utilise Google Maps Embed Directions (une simple URL, pas de SDK
// natif à intégrer pour ce lot) affichée dans une WebView. La clé vient de la Cloud
// Function publique `getPublicRuntimeConfig` (docs/CONTRATS_APPS_MOBILES.md §23) — c'est
// la clé « web », pas encore la clé mobile dédiée (§23.4, non distribuée par cet
// endpoint) : suffisant pour ce lot (testé sur Expo web), à revoir pour une vraie
// app native. Repli clair si la clé n'est pas configurée (jamais d'écran cassé).
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { LatLng } from './RouteMap.shared';
import { buildEmbedUrl } from './RouteMap.shared';
import { colors, radius } from '../../theme/tokens';
import { Text } from '../../ui/Text';

export interface RouteMapProps {
  apiKey: string | null | undefined;
  origin: LatLng;
  destination: LatLng;
  height?: number;
}

export function RouteMap({ apiKey, origin, destination, height = 220 }: RouteMapProps) {
  if (!apiKey) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text variant="body" color="muted" align="center">
          Cartographie non configurée, contactez votre administrateur.
        </Text>
      </View>
    );
  }
  const url = buildEmbedUrl(apiKey, origin, destination);
  return (
    <View style={[styles.wrap, { height }]}>
      <WebView source={{ uri: url }} style={styles.webview} originWhitelist={['*']} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  webview: { flex: 1, backgroundColor: colors.surfaceAlt },
  fallback: { borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
