// Carte et itinéraire réels — version web (Expo web, testée pour ce lot). Metro résout
// ce fichier `.web.tsx` à la place de `RouteMap.tsx` sur la cible web : un simple
// <iframe> (react-native-webview ne cible pas le web) chargeant Google Maps Embed
// Directions avec la clé « web » distribuée par `getPublicRuntimeConfig`
// (docs/CONTRATS_APPS_MOBILES.md §23). Repli clair si la clé n'est pas configurée, et
// (mission lot 3, point 4) message FR si la clé existe mais que l'API « Maps Embed »
// précise n'est pas activée côté Google Cloud (`mapsEmbedActivated`, vérifié serveur par
// `getPublicRuntimeConfig`/`functions/src/platform/maps.ts`) au lieu de l'erreur brute de
// Google affichée dans l'iframe.
import { View } from 'react-native';
import type { LatLng } from './RouteMap.shared';
import { buildEmbedUrl } from './RouteMap.shared';
import { colors, radius } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { useTranslation } from '../../i18n/I18nProvider';

export interface RouteMapProps {
  apiKey: string | null | undefined;
  /** true/false vérifié côté serveur, `null` si jamais vérifiable (ne bloque jamais l'affichage). */
  embedActivated?: boolean | null;
  origin: LatLng;
  destination: LatLng;
  height?: number;
}

function Fallback({ height, message }: { height: number; message: string }) {
  return (
    <View style={{ height, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Text variant="body" color="muted" align="center">
        {message}
      </Text>
    </View>
  );
}

export function RouteMap({ apiKey, embedActivated, origin, destination, height = 220 }: RouteMapProps) {
  const { t } = useTranslation('dispatch');
  if (!apiKey) return <Fallback height={height} message={t('routeMap.notConfigured')} />;
  if (embedActivated === false) {
    return <Fallback height={height} message={t('routeMap.embedDisabled')} />;
  }
  const url = buildEmbedUrl(apiKey, origin, destination);
  return (
    <View style={{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
      <iframe title="Itinéraire" src={url} style={{ border: 0, width: '100%', height: '100%' }} loading="lazy" />
    </View>
  );
}
