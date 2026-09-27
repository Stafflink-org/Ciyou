import { useCallback, useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * État conservé dans le navigateur (préférence d'affichage, dernier établissement
 * ouvert…). Sans stockage disponible (navigation privée), il reste en mémoire.
 */
export function usePersistentState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key, fallback) }));
  const value = state.key === key ? state.value : read(key, fallback);

  const update = useCallback(
    (next: T) => {
      setState({ key, value: next });
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Stockage indisponible : la valeur n'est pas conservée entre les visites.
      }
    },
    [key],
  );
  return [value, update];
}

/** Titre de l'onglet du navigateur. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
