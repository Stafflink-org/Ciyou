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
import frSearch from './fr/search.json';
import enSearch from './en/search.json';
import arSearch from './ar/search.json';
import frRestaurant from './fr/restaurant.json';
import enRestaurant from './en/restaurant.json';
import arRestaurant from './ar/restaurant.json';
import frProduct from './fr/product.json';
import enProduct from './en/product.json';
import arProduct from './ar/product.json';
import frCart from './fr/cart.json';
import enCart from './en/cart.json';
import arCart from './ar/cart.json';
import frCheckout from './fr/checkout.json';
import enCheckout from './en/checkout.json';
import arCheckout from './ar/checkout.json';
import frConfirmation from './fr/confirmation.json';
import enConfirmation from './en/confirmation.json';
import arConfirmation from './ar/confirmation.json';
import frTracking from './fr/tracking.json';
import enTracking from './en/tracking.json';
import arTracking from './ar/tracking.json';
import frOrders from './fr/orders.json';
import enOrders from './en/orders.json';
import arOrders from './ar/orders.json';
import frFavorites from './fr/favorites.json';
import enFavorites from './en/favorites.json';
import arFavorites from './ar/favorites.json';
import frNotifications from './fr/notifications.json';
import enNotifications from './en/notifications.json';
import arNotifications from './ar/notifications.json';
import frAddresses from './fr/addresses.json';
import enAddresses from './en/addresses.json';
import arAddresses from './ar/addresses.json';
import frEditProfile from './fr/editProfile.json';
import enEditProfile from './en/editProfile.json';
import arEditProfile from './ar/editProfile.json';
import frPaymentMethods from './fr/paymentMethods.json';
import enPaymentMethods from './en/paymentMethods.json';
import arPaymentMethods from './ar/paymentMethods.json';
import frHelp from './fr/help.json';
import enHelp from './en/help.json';
import arHelp from './ar/help.json';
import frPromotions from './fr/promotions.json';
import enPromotions from './en/promotions.json';
import arPromotions from './ar/promotions.json';
import frReferral from './fr/referral.json';
import enReferral from './en/referral.json';
import arReferral from './ar/referral.json';
import frSupport from './fr/support.json';
import enSupport from './en/support.json';
import arSupport from './ar/support.json';
import frLegal from './fr/legal.json';
import enLegal from './en/legal.json';
import arLegal from './ar/legal.json';
import frGdpr from './fr/gdpr.json';
import enGdpr from './en/gdpr.json';
import arGdpr from './ar/gdpr.json';

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
addResources('fr', 'search', frSearch);
addResources('en', 'search', enSearch);
addResources('ar', 'search', arSearch);
addResources('fr', 'restaurant', frRestaurant);
addResources('en', 'restaurant', enRestaurant);
addResources('ar', 'restaurant', arRestaurant);
addResources('fr', 'product', frProduct);
addResources('en', 'product', enProduct);
addResources('ar', 'product', arProduct);
addResources('fr', 'cart', frCart);
addResources('en', 'cart', enCart);
addResources('ar', 'cart', arCart);
addResources('fr', 'checkout', frCheckout);
addResources('en', 'checkout', enCheckout);
addResources('ar', 'checkout', arCheckout);
addResources('fr', 'confirmation', frConfirmation);
addResources('en', 'confirmation', enConfirmation);
addResources('ar', 'confirmation', arConfirmation);
addResources('fr', 'tracking', frTracking);
addResources('en', 'tracking', enTracking);
addResources('ar', 'tracking', arTracking);
addResources('fr', 'orders', frOrders);
addResources('en', 'orders', enOrders);
addResources('ar', 'orders', arOrders);
addResources('fr', 'favorites', frFavorites);
addResources('en', 'favorites', enFavorites);
addResources('ar', 'favorites', arFavorites);
addResources('fr', 'notifications', frNotifications);
addResources('en', 'notifications', enNotifications);
addResources('ar', 'notifications', arNotifications);
addResources('fr', 'addresses', frAddresses);
addResources('en', 'addresses', enAddresses);
addResources('ar', 'addresses', arAddresses);
addResources('fr', 'editProfile', frEditProfile);
addResources('en', 'editProfile', enEditProfile);
addResources('ar', 'editProfile', arEditProfile);
addResources('fr', 'paymentMethods', frPaymentMethods);
addResources('en', 'paymentMethods', enPaymentMethods);
addResources('ar', 'paymentMethods', arPaymentMethods);
addResources('fr', 'help', frHelp);
addResources('en', 'help', enHelp);
addResources('ar', 'help', arHelp);
addResources('fr', 'promotions', frPromotions);
addResources('en', 'promotions', enPromotions);
addResources('ar', 'promotions', arPromotions);
addResources('fr', 'referral', frReferral);
addResources('en', 'referral', enReferral);
addResources('ar', 'referral', arReferral);
addResources('fr', 'support', frSupport);
addResources('en', 'support', enSupport);
addResources('ar', 'support', arSupport);
addResources('fr', 'legal', frLegal);
addResources('en', 'legal', enLegal);
addResources('ar', 'legal', arLegal);
addResources('fr', 'gdpr', frGdpr);
addResources('en', 'gdpr', enGdpr);
addResources('ar', 'gdpr', arGdpr);

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
