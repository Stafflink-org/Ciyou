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
  // Défaut restaurant : clair, quelle que soit la préférence système ;
  // le sombre reste disponible via le sélecteur et mémorisé une fois choisi.
  return 'light';
}

/**
 * Mode clair / sombre du thème restaurant, mémorisé par navigateur.
 * Le thème admin est sombre en permanence et n'utilise pas ce mode.
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
