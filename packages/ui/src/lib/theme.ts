import { useCallback, useEffect, useState } from 'react';

export type AppTheme = 'restaurant' | 'admin';
export type ColorMode = 'light' | 'dark';

const MODE_KEY = 'golink:color-mode';

/** Applique le thème de l'application sur <html> (à appeler avant le premier rendu). */
export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
}

function readMode(): ColorMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Stockage indisponible : on utilise le défaut clair.
  }
  // Défaut clair sur tout le backoffice (resto ET super admin) — charte Ciyou Eats transmise
  // par le client (document "Points à corriger", 30/09/2026). Le sombre reste disponible via
  // le sélecteur de chaque application et mémorisé une fois choisi (remplace l'ancien défaut
  // sombre du resto, lui-même un retour client plus ancien du même jour — redemandé explicitement
  // depuis : clair par défaut partout, bascule sombre généralisée au super admin aussi).
  return 'light';
}

/**
 * Mode clair / sombre du thème, mémorisé par navigateur — commun au backoffice resto et au
 * super admin (chacun bascule indépendamment, même clé de stockage partagée).
 */
export function useColorMode(): { mode: ColorMode; setMode: (mode: ColorMode) => void; toggle: () => void } {
  const [mode, setModeState] = useState<ColorMode>(readMode);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'dark') root.dataset.mode = 'dark';
    else delete root.dataset.mode;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Préférence non conservée si le stockage est bloqué.
    }
  }, [mode]);

  const toggle = useCallback(() => setModeState((current) => (current === 'dark' ? 'light' : 'dark')), []);
  return { mode, setMode: setModeState, toggle };
}
