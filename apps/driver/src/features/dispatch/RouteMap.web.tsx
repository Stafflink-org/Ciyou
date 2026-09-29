// Carte et itinéraire réels — version web (Expo web, testée pour ce lot). Metro résout
// ce fichier `.web.tsx` à la place de `RouteMap.tsx` sur la cible web : un simple
// <iframe> (react-native-webview ne cible pas le web) chargeant Google Maps Embed
// Directions avec la clé « web » distribuée par `getPublicRuntimeConfig`
// (docs/CONTRATS_APPS_MOBILES.md §23). Repli clair si la clé n'est pas configurée.
import { View } from 'react-native';
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
      <View style={{ height, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text variant="body" color="muted" align="center">
          Cartographie non configurée, contactez votre administrateur.
        </Text>
      </View>
    );
  }
  const url = buildEmbedUrl(apiKey, origin, destination);
  return (
    <View style={{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
      <iframe title="Itinéraire" src={url} style={{ border: 0, width: '100%', height: '100%' }} loading="lazy" />
    </View>
  );
}
