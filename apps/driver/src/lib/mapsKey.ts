// Distribution de la clé Google Maps (docs/CONTRATS_APPS_MOBILES.md §23) : appel de la
// Cloud Function publique `getPublicRuntimeConfig` (sans authentification), qui renvoie
// la clé « web » (restreinte par référent HTTP) ainsi que l'état vérifié côté serveur de
// l'API « Maps Embed » (mission lot 3, point 4 : repli FR clair si la clé existe mais que
// cette API précise n'est pas activée, cas réel rencontré au lot 2 — voir
// docs/CONTRAT_MODULES.md §11 bis/ter). Cette clé convient au test Expo web de ce lot ;
// une vraie app native (development build) aura besoin de la clé mobile dédiée, qui n'est
// PAS distribuée par cet endpoint (voir §23.4) — non couverte par ce lot.
import { useEffect, useState } from 'react';
import { callFunction } from './firestore';

interface PublicRuntimeConfig {
  googleMapsWebKey: string | null;
  mapsConfigured: boolean;
  mapsEmbedActivated: boolean | null;
}

const getPublicRuntimeConfig = callFunction<Record<string, never>, PublicRuntimeConfig>('getPublicRuntimeConfig');

export interface MapsRuntimeState {
  key: string | null | undefined; // undefined = pas encore chargé.
  embedActivated: boolean | null;
}

let cached: MapsRuntimeState | undefined;

export function useGoogleMapsRuntime(): MapsRuntimeState {
  const [state, setState] = useState<MapsRuntimeState>(cached ?? { key: undefined, embedActivated: null });

  useEffect(() => {
    if (cached !== undefined) return;
    let cancelled = false;
    getPublicRuntimeConfig({})
      .then((config) => {
        if (cancelled) return;
        cached = { key: config.googleMapsWebKey, embedActivated: config.mapsEmbedActivated };
        setState(cached);
      })
      .catch(() => {
        if (cancelled) return;
        cached = { key: null, embedActivated: null };
        setState(cached);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Conservé pour compatibilité : ne renvoie que la clé (voir useGoogleMapsRuntime pour l'état complet). */
export function useGoogleMapsWebKey(): string | null | undefined {
  return useGoogleMapsRuntime().key;
}
