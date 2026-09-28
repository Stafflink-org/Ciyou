// Fournisseur i18n minimal (FR uniquement, voir `core.ts`). Prêt à recevoir un
// sélecteur de langue et EN/AR dans un lot ultérieur sans changer sa forme.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type TranslateVars } from './core';

interface I18nContextValue {
  locale: 'fr';
  t: (key: string, vars?: TranslateVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useMemo<I18nContextValue>(() => ({ locale: 'fr', t: translate }), []);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslation doit être utilisé sous <I18nProvider>.');
  return value;
}
