// Configuration publique distribuée par le serveur (Cloud Function getPublicRuntimeConfig,
// tâche « maps-settings ») : clé Google Maps « web » et futurs identifiants publics. Modèle
// à suivre par les futures apps mobiles (voir docs/CONTRATS_APPS_MOBILES.md). Remplace
// l'ancien usage de VITE_GOOGLE_MAPS_API_KEY (build-time) par un appel au démarrage,
// avec un cache en mémoire pour ne jamais rappeler le serveur à chaque écran.
import { useEffect, useState } from 'react';
import type { Functions } from 'firebase/functions';
import { callable } from '../firestore/mutations';

export interface PublicRuntimeConfig {
  /** Clé Google Maps « web », ou `null` si non configurée côté super admin. */
  googleMapsWebKey: string | null;
  mapsConfigured: boolean;
}

const EMPTY_CONFIG: PublicRuntimeConfig = { googleMapsWebKey: null, mapsConfigured: false };

let cached: PublicRuntimeConfig | null = null;
let inFlight: Promise<PublicRuntimeConfig> | null = null;

/**
 * Charge la configuration publique une seule fois par session (cache en mémoire, jamais
 * dans le stockage du navigateur). En cas d'échec réseau, renvoie une configuration vide
 * plutôt que de faire planter l'application appelante — celle-ci doit alors afficher un
 * repli (« Cartographie non configurée, contactez votre administrateur »).
 */
export function loadRuntimeConfig(functions: Functions): Promise<PublicRuntimeConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    const call = callable<Record<string, never>, PublicRuntimeConfig>(functions, 'getPublicRuntimeConfig');
    inFlight = call({})
      .then((config) => {
        cached = config;
        return config;
      })
      .catch(() => EMPTY_CONFIG)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Efface le cache (tests, ou après une modification des réglages par le super admin). */
export function resetRuntimeConfigCache(): void {
  cached = null;
  inFlight = null;
}

/** Configuration publique déjà chargée (ou `null` tant que le premier appel n'est pas revenu). */
export function useRuntimeConfig(functions: Functions): PublicRuntimeConfig | null {
  const [config, setConfig] = useState<PublicRuntimeConfig | null>(cached);
  useEffect(() => {
    if (cached) {
      setConfig(cached);
      return;
    }
    let active = true;
    void loadRuntimeConfig(functions).then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, [functions]);
  return config;
}
