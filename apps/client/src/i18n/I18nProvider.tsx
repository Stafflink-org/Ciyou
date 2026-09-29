// Fournisseur i18n de l'app client — FR/EN/AR avec RTL réel. Même forme
// d'API que `packages/web/src/i18n/I18nProvider.tsx` (`useTranslation()`,
// `t('ns:cle')`, `locale`/`locales`/`setLocale`) ; le sens d'écriture est posé
// via `I18nManager` (React Native) au lieu de `dir` (CSS web) : sur mobile
// natif, `I18nManager.forceRTL` ne prend effet qu'après redémarrage de l'app
// (limitation documentée dans docs/CONTRAT_MODULES.md) — sur Expo web, le
// rendu RTL est immédiat (comme le web classique), donc testable à l'écran
// sans redémarrage.
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
import frAuth from './fr/auth.json';
import enAuth from './en/auth.json';
import arAuth from './ar/auth.json';
import frHome from './fr/home.json';
import enHome from './en/home.json';
import arHome from './ar/home.json';
import frProfile from './fr/profile.json';
import enProfile from './en/profile.json';
import arProfile from './ar/profile.json';

addResources('fr', 'common', frCommon);
addResources('en', 'common', enCommon);
addResources('ar', 'common', arCommon);
addResources('fr', 'auth', frAuth);
addResources('en', 'auth', enAuth);
addResources('ar', 'auth', arAuth);
addResources('fr', 'home', frHome);
addResources('en', 'home', enHome);
addResources('ar', 'home', arHome);
addResources('fr', 'profile', frProfile);
addResources('en', 'profile', enProfile);
addResources('ar', 'profile', arProfile);

const STORAGE_KEY = 'golink-client:locale';

export interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  locales: readonly Locale[];
  /** Changement de langue immédiat. Sur mobile natif, le RTL de l'arabe ne
   * s'applique visuellement qu'après relance de l'app (I18nManager) ; le
   * texte se traduit tout de suite dans tous les cas. */
  setLocale: (locale: Locale) => void;
  /** Vrai juste après un changement de langue vers/depuis l'arabe sur mobile
   * natif : l'appelant peut inviter à relancer l'app pour un RTL complet. */
  restartRecommended: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Pose le sens d'écriture. Sur Expo web, `I18nManager.forceRTL` de
 * react-native-web est un no-op (constaté à l'écran : le texte se traduisait
 * mais la mise en page ne se miroitait pas) — on pose donc directement
 * `document.documentElement.dir`, ce que react-native-web respecte nativement
 * pour la mise en page flex (comportement CSS standard : `flexDirection:
 * 'row'` suit le sens d'écriture du document). Sur mobile natif,
 * `I18nManager.forceRTL` reste la bonne API mais n'y prend effet qu'après
 * redémarrage de l'app (limitation RN documentée, aucun contournement propre
 * sans module natif dédié) : on prévient alors l'utilisateur.
 */
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

  // Chargement de la préférence mémorisée sur l'appareil (AsyncStorage est
  // asynchrone : on démarre en français puis on bascule dès que lue).
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

  // Synchrone avant le rendu des enfants : pas de flash de la mauvaise langue.
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
  /** t('actions.save'), t('home:titre'), t('common:jours', { count: 2 }). */
  t: (key: string, vars?: TranslateVars) => string;
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
    }),
    // version : de nouvelles ressources (addResources) doivent recréer t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, locale, namespace, version],
  );
}
