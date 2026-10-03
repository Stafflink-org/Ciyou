// Chargeur Google Maps JS (API « Maps JavaScript », distincte de l'embed utilisé par RouteMap)
// — variante web, montée UNE SEULE FOIS à la racine de l'app. `@react-google-maps/api` garde un
// chargeur global par page : il refuse d'être réinitialisé avec des options différentes,
// y compris sur un remontage propre d'un composant qui l'appellerait lui-même (ex. navigation
// entre onglets) — observé en pratique sur OrdersMap avant ce correctif. Solution : un seul
// appel à `useJsApiLoader`, pour toute la durée de vie de la page, exposé par contexte aux
// composants qui en ont besoin (OrdersMap) plutôt qu'appelé depuis chacun d'eux.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { useGoogleMapsRuntime } from './mapsKey';

interface LoaderState {
  isLoaded: boolean;
  loadError: Error | undefined;
}

const GoogleMapsLoaderContext = createContext<LoaderState>({ isLoaded: false, loadError: undefined });

function ReadyLoader({ apiKey, children }: { apiKey: string; children: ReactNode }) {
  const options = useMemo(() => ({ id: 'ciyou-driver-maps', googleMapsApiKey: apiKey }), [apiKey]);
  const { isLoaded, loadError } = useJsApiLoader(options);
  const value = useMemo(() => ({ isLoaded, loadError }), [isLoaded, loadError]);
  return <GoogleMapsLoaderContext.Provider value={value}>{children}</GoogleMapsLoaderContext.Provider>;
}

export function GoogleMapsLoaderProvider({ children }: { children: ReactNode }) {
  const { key } = useGoogleMapsRuntime();
  // Le chargeur n'est monté (et `useJsApiLoader` appelé) qu'une fois la clé réellement connue —
  // jamais avec une clé vide le temps qu'elle arrive, qui compterait comme un premier appel à
  // « verrouiller » puis entrerait en conflit avec le vrai.
  if (!key) return <GoogleMapsLoaderContext.Provider value={{ isLoaded: false, loadError: undefined }}>{children}</GoogleMapsLoaderContext.Provider>;
  return <ReadyLoader apiKey={key}>{children}</ReadyLoader>;
}

export function useGoogleMapsLoaded(): LoaderState {
  return useContext(GoogleMapsLoaderContext);
}
