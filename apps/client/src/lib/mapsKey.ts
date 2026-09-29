// Distribution de la clé Google Maps (docs/CONTRATS_APPS_MOBILES.md §23) : appel de la
// Cloud Function publique `getPublicRuntimeConfig` (sans authentification), qui renvoie
// la clé « web » (restreinte par référent HTTP). Cette clé convient au test Expo web de
// ce lot ; une vraie app native (development build) aura besoin de la clé mobile dédiée,
// qui n'est PAS distribuée par cet endpoint (voir §23.4) — non couverte par ce lot,
// documentée dans docs/CONTRAT_MODULES.md §11.
import { useEffect, useState } from 'react';
import { callFunction } from './firestore';

interface PublicRuntimeConfig {
  googleMapsWebKey: string | null;
  mapsConfigured: boolean;
}

const getPublicRuntimeConfig = callFunction<Record<string, never>, PublicRuntimeConfig>('getPublicRuntimeConfig');

let cached: string | null | undefined; // undefined = pas encore chargé, null = non configurée/échec.

export function useGoogleMapsWebKey(): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) return;
    let cancelled = false;
    getPublicRuntimeConfig({})
      .then((config) => {
        if (cancelled) return;
        cached = config.googleMapsWebKey;
        setKey(cached);
      })
      .catch(() => {
        if (cancelled) return;
        cached = null;
        setKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return key;
}
