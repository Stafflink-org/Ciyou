// Chargeur Google Maps JS (API « Maps JavaScript », distincte de l'embed utilisé par
// RouteMap) — variante native : react-native-maps ne passe pas par ce chargeur web, ce
// composant ne fait donc rien ici. Voir googleMapsLoader.web.tsx pour la vraie implémentation.
import type { ReactNode } from 'react';

export function GoogleMapsLoaderProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useGoogleMapsLoaded(): { isLoaded: boolean; loadError: Error | undefined } {
  return { isLoaded: true, loadError: undefined };
}
