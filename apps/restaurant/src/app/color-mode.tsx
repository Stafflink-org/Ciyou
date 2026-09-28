import { createContext, useContext, type ReactNode } from 'react';
import { useColorMode, type ColorMode } from '@golink/ui';

interface ColorModeValue {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeValue | null>(null);

/** Mode clair / sombre partagé par toute l'application (une seule source d'état). */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  return <ColorModeContext.Provider value={useColorMode()}>{children}</ColorModeContext.Provider>;
}

export function useAppColorMode(): ColorModeValue {
  const value = useContext(ColorModeContext);
  if (!value) throw new Error('useAppColorMode doit être utilisé sous <ColorModeProvider>.');
  return value;
}
