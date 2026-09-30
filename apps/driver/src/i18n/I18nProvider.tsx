// Fournisseur i18n de l'app livreur — même socle que `apps/client/src/i18n`
// (voir ce fichier pour le détail des choix RTL/AsyncStorage). Ce lot livre le
// socle complet (FR/EN/AR + sélecteur dans Profil) ; la bascule écran par
// écran des textes en dur reste à faire pour cette app (priorité donnée à
// l'app client, voir docs/CONTRAT_MODULES.md et le point d'avancement de la
// tâche mobile-i18n-en-ar).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale } from '@golink/shared';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  addResources,
  directionOf,
  i18nVersion,
  isSupportedLocale,
  setCurrentLocale,
  subscribeI18n,
  translate,
  type TranslateVars,
} from './core';
import frCommon from './fr/common.json';
import enCommon from './en/common.json';
import arCommon from './ar/common.json';
import frDispatch from './fr/dispatch.json';
import enDispatch from './en/dispatch.json';
import arDispatch from './ar/dispatch.json';
import frEarnings from './fr/earnings.json';
import enEarnings from './en/earnings.json';
import arEarnings from './ar/earnings.json';
import frHistory from './fr/history.json';
import enHistory from './en/history.json';
import arHistory from './ar/history.json';
import frProfileSettings from './fr/profileSettings.json';
import enProfileSettings from './en/profileSettings.json';
import arProfileSettings from './ar/profileSettings.json';
import frProfile from './fr/profile.json';
import enProfile from './en/profile.json';
import arProfile from './ar/profile.json';
import frLegal from './fr/legal.json';
import enLegal from './en/legal.json';
import arLegal from './ar/legal.json';
import frSupport from './fr/support.json';
import enSupport from './en/support.json';
import arSupport from './ar/support.json';
import frPayments from './fr/payments.json';
import enPayments from './en/payments.json';
import arPayments from './ar/payments.json';

addResources('fr', 'common', frCommon);
addResources('en', 'common', enCommon);
addResources('ar', 'common', arCommon);
addResources('fr', 'dispatch', frDispatch);
addResources('en', 'dispatch', enDispatch);
addResources('ar', 'dispatch', arDispatch);
addResources('fr', 'earnings', frEarnings);
addResources('en', 'earnings', enEarnings);
addResources('ar', 'earnings', arEarnings);
addResources('fr', 'history', frHistory);
addResources('en', 'history', enHistory);
addResources('ar', 'history', arHistory);
addResources('fr', 'profileSettings', frProfileSettings);
addResources('en', 'profileSettings', enProfileSettings);
addResources('ar', 'profileSettings', arProfileSettings);
addResources('fr', 'profile', frProfile);
addResources('en', 'profile', enProfile);
addResources('ar', 'profile', arProfile);
addResources('fr', 'legal', frLegal);
addResources('en', 'legal', enLegal);
addResources('ar', 'legal', arLegal);
addResources('fr', 'support', frSupport);
addResources('en', 'support', enSupport);
addResources('ar', 'support', arSupport);
addResources('fr', 'payments', frPayments);
addResources('en', 'payments', enPayments);
addResources('ar', 'payments', arPayments);

const STORAGE_KEY = 'golink-driver:locale';

export interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  locales: readonly Locale[];
  setLocale: (locale: Locale) => void;
  restartRecommended: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Voir `apps/client/src/i18n/I18nProvider.tsx` : `I18nManager.forceRTL` est un
 * no-op sur react-native-web, on pose donc `document.documentElement.dir`
 * directement sur web ; sur natif, `I18nManager.forceRTL` reste utilisé mais
 * n'y prend effet qu'après redémarrage de l'app. */
function applyDirection(locale: Locale): boolean {
  const rtl = directionOf(locale) === 'rtl';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = locale;
    }
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(rtl);
    return false;
  }
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(rtl);
  return true;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [restartRecommended, setRestartRecommended] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !isSupportedLocale(stored)) return;
        setCurrentLocale(stored);
        setLocaleState(stored);
        applyDirection(stored);
      })
      .catch(() => undefined)
      .finally(() => {
        ready.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  setCurrentLocale(locale, true);

  const setLocale = useCallback((next: Locale) => {
    if (!isSupportedLocale(next)) return;
    setLocaleState(next);
    setCurrentLocale(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
    const needsRestart = applyDirection(next);
    setRestartRecommended(needsRestart);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: directionOf(locale), locales: SUPPORTED_LOCALES, setLocale, restartRecommended }),
    [locale, setLocale, restartRecommended],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useLocale doit être utilisé sous <I18nProvider>.');
  return value;
}

export interface Translation extends I18nContextValue {
  t: (key: string, vars?: TranslateVars) => string;
}

export function useTranslation(namespace = 'common'): Translation {
  const context = useLocale();
  const version = useSyncExternalStore(subscribeI18n, i18nVersion);
  const { locale } = context;
  return useMemo(
    () => ({
      ...context,
      t: (key: string, vars?: TranslateVars) => translate(key, vars, locale, namespace),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, locale, namespace, version],
  );
}
