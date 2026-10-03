// Carte multi-commandes — version web (Expo web / navigateur). @react-google-maps/api (API JS
// Google Maps, pas un simple embed) : utilise la clé « web » déjà distribuée par
// `getPublicRuntimeConfig` (voir RouteMap côté commerce). Nécessite l'activation de « Maps
// JavaScript API » sur cette clé côté Google Cloud (distincte de « Maps Embed API ») — repli
// clair si la clé est absente ou si le chargement échoue, jamais d'écran cassé.
//
// Le chargeur lui-même (`useJsApiLoader`) est monté une seule fois à la racine de l'app
// (`lib/googleMapsLoader.web.tsx`), jamais ici : la bibliothèque refuse d'être réinitialisée,
// y compris sur un remontage propre de ce composant (navigation entre onglets) — ce composant
// se contente de lire son état par contexte.
import { View } from 'react-native';
import { GoogleMap, Marker } from '@react-google-maps/api';
import { colors } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { useTranslation } from '../../i18n/I18nProvider';
import { useGoogleMapsLoaded } from '../../lib/googleMapsLoader';
import { regionFor, type OrderPin } from './OrdersMap.shared';

export interface OrdersMapProps {
  apiKey?: string | null;
  pins: OrderPin[];
  onSelect: (id: string) => void;
  height?: number;
}

const wrapStyle = (height: number) => ({ height, borderRadius: 16, overflow: 'hidden' as const, backgroundColor: colors.surfaceAlt });
const fallbackStyle = (height: number) => ({ height, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 16 });

export function OrdersMap({ apiKey, pins, onSelect, height = 220 }: OrdersMapProps) {
  const { t } = useTranslation('dispatch');
  const { isLoaded, loadError } = useGoogleMapsLoaded();

  if (pins.length === 0) {
    return (
      <View style={fallbackStyle(height)}>
        <Text variant="body" color="muted" align="center">
          {t('ordersMap.empty')}
        </Text>
      </View>
    );
  }
  if (!apiKey) {
    return (
      <View style={fallbackStyle(height)}>
        <Text variant="body" color="muted" align="center">
          {t('routeMap.notConfigured')}
        </Text>
      </View>
    );
  }
  if (loadError) {
    return (
      <View style={fallbackStyle(height)}>
        <Text variant="body" color="muted" align="center">
          {t('routeMap.embedDisabled')}
        </Text>
      </View>
    );
  }
  if (!isLoaded) return <View style={fallbackStyle(height)} />;

  const region = regionFor(pins);
  return (
    <View style={wrapStyle(height)}>
      <GoogleMap
        center={{ lat: region.lat, lng: region.lng }}
        zoom={13}
        mapContainerStyle={{ width: '100%', height: '100%' }}
        options={{ disableDefaultUI: true, zoomControl: true }}
      >
        {pins.map((pin) => (
          <Marker key={pin.id} position={{ lat: pin.lat, lng: pin.lng }} title={pin.label} onClick={() => onSelect(pin.id)} />
        ))}
      </GoogleMap>
    </View>
  );
}
