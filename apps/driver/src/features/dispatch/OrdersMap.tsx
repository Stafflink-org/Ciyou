// Carte multi-commandes — version native (iOS/Android, development build). react-native-maps
// (SDK natif, pas un simple embed comme RouteMap) : sur iOS, fournisseur Apple Maps par défaut,
// aucune clé requise ; sur Android, nécessite une clé Google Maps dédiée dans app.json
// (expo.android.config.googleMaps.apiKey) — clé mobile distincte de la clé « web » de
// RouteMap, pas encore distribuée (voir lib/mapsKey.ts) : sans elle, Android affiche la carte
// avec un filigrane « for development purposes only », les pins restant fonctionnels.
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors, radius } from '../../theme/tokens';
import { Text } from '../../ui/Text';
import { useTranslation } from '../../i18n/I18nProvider';
import { regionFor, type OrderPin } from './OrdersMap.shared';

export interface OrdersMapProps {
  /** Ignoré sur natif (Apple Maps par défaut sur iOS, SDK natif sur Android) : présent
   * uniquement pour garder la même signature que la variante web. */
  apiKey?: string | null;
  pins: OrderPin[];
  onSelect: (id: string) => void;
  height?: number;
}

export function OrdersMap({ pins, onSelect, height = 220 }: OrdersMapProps) {
  const { t } = useTranslation('dispatch');
  if (pins.length === 0) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text variant="body" color="muted" align="center">
          {t('ordersMap.empty')}
        </Text>
      </View>
    );
  }
  const region = regionFor(pins);
  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: region.lat, longitude: region.lng, latitudeDelta: region.latDelta, longitudeDelta: region.lngDelta }}
      >
        {pins.map((pin) => (
          <Marker key={pin.id} coordinate={{ latitude: pin.lat, longitude: pin.lng }} title={pin.label} onPress={() => onSelect(pin.id)} />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  fallback: { borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
