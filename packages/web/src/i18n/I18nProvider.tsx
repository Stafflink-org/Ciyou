import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { COLLECTIONS, labelOf, type LabelTableName, type Locale } from '@golink/shared';
import { useAuth } from '../auth/AuthProvider';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  addResources,
  detectBrowserLocale,
  directionOf,
  i18nVersion,
  isSupportedLocale,
  readStoredLocale,
  setCurrentLocale,
  storeLocale,
  subscribeI18n,
  translate,
  type TranslateVars,
  type TranslationTree,
} from './core';
import frCommon from './fr/common.json';
import enCommon from './en/common.json';
import arCommon from './ar/common.json';

addResources('fr', 'common', frCommon as TranslationTree);
addResources('en', 'common', enCommon as TranslationTree);
addResources('ar', 'common', arCommon as TranslationTree);

// La langue est posée sur le module dès le premier rendu (avant les effets) : les
// appels non React (errorMessage…) et le premier affichage utilisent déjà la bonne langue.
const initialLocale: Locale = readStoredLocale() ?? detectBrowserLocale() ?? DEFAULT_LOCALE;
setCurrentLocale(initialLocale, true);

export interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  locales: readonly Locale[];
  /** Change la langue : appliquée tout de suite, enregistrée sur le profil de l'utilisateur connecté. */
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Langue de l'interface. Priorité : préférence du profil (users/{uid}.locale),
 * puis choix mémorisé sur cet appareil, puis langue du navigateur, puis français.
 * Pose lang et dir (rtl pour l'arabe) sur <html>. À placer sous AuthProvider.
 */
export function I18nProvider({ db, children }: { db: Firestore; children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Langue choisie à la main avant la fin de lecture du profil : elle prime sur celui-ci.
  const chosen = useRef(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getDoc(doc(db, COLLECTIONS.users, uid))
      .then((snapshot) => {
        const stored: unknown = snapshot.data()?.locale;
        if (!cancelled && !chosen.current && isSupportedLocale(stored)) {
          setCurrentLocale(stored);
          setLocaleState(stored);
        }
      })
      .catch(() => {
        // Profil illisible : on garde la langue détectée.
      });
    return () => {
      cancelled = true;
    };
  }, [db, uid]);

  // Synchrone avant le rendu des enfants : pas de flash de la mauvaise langue ou direction.
  setCurrentLocale(locale, true);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = directionOf(locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (!isSupportedLocale(next)) return;
      chosen.current = true;
      setLocaleState(next);
      storeLocale(next);
      if (uid) void updateDoc(doc(db, COLLECTIONS.users, uid), { locale: next }).catch(() => undefined);
    },
    [db, uid],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: directionOf(locale), locales: SUPPORTED_LOCALES, setLocale }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useLocale doit être utilisé sous <I18nProvider>.');
  return value;
}

export interface Translation extends I18nContextValue {
  /** t('actions.save'), t('accueil:titre'), t('common:jours', { count: 2 }). */
  t: (key: string, vars?: TranslateVars) => string;
  /** Libellé d'une énumération (statut, rôle…) : label('ORDER_STATUS_LABELS', 'new'). */
  label: (table: LabelTableName, key: string) => string;
}

/** Traduction dans la langue courante ; se rafraîchit au changement de langue ou de ressources. */
export function useTranslation(namespace = 'common'): Translation {
  const context = useLocale();
  const version = useSyncExternalStore(subscribeI18n, i18nVersion);
  const { locale } = context;
  return useMemo(
    () => ({
      ...context,
      t: (key: string, vars?: TranslateVars) => translate(key, vars, locale, namespace),
      label: (table: LabelTableName, key: string) => labelOf(table, key, locale),
    }),
    // version : de nouvelles ressources (addResources) doivent recréer t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, locale, namespace, version],
  );
}
