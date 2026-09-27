// Liaison entre le moteur de traduction et le shell des back-offices : textes du
// kit @golink/ui, libellés de navigation, sélecteur de langue du menu utilisateur.
import { useCallback, useMemo } from 'react';
import { Languages } from 'lucide-react';
import { cn, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, type ShellLabels } from '@golink/ui';
import type { Locale } from '@golink/shared';
import { hasTranslation, isSupportedLocale, translate } from './core';
import { useTranslation } from './I18nProvider';

/** Libellé traduit ou, à défaut, le libellé français d'origine (jamais une clé brute). */
export function translateOr(key: string, fallback: string, locale?: Locale): string {
  return hasTranslation(key, locale) ? translate(key, undefined, locale) : fallback;
}

/**
 * Tout ce dont un shell a besoin pour parler la langue courante : textes du kit,
 * sens d'écriture, libellés de rubriques (namespace « nav », clés modules.<id> et
 * groups.<id>, avec repli sur le libellé français déclaré par le module).
 */
export function useShellI18n() {
  const { t, locale, dir } = useTranslation();
  const labels = useMemo<ShellLabels>(
    () => ({
      openMenu: t('shell.openMenu'),
      closeMenu: t('shell.closeMenu'),
      expandMenu: t('shell.expandMenu'),
      collapseMenu: t('shell.collapseMenu'),
      filterMenu: t('shell.filterMenu'),
      mainNavigation: t('shell.mainNavigation'),
      menuTitle: t('shell.menuTitle'),
      noSection: t('shell.noSection'),
      search: t('shell.search'),
      notifications: t('shell.notifications'),
      notificationsUnread: (count: number) => t('shell.notificationsUnread', { count }),
      markAllRead: t('shell.markAllRead'),
      noNotifications: t('shell.noNotifications'),
      viewAllNotifications: t('shell.viewAllNotifications'),
      signOut: t('shell.signOut'),
    }),
    [t],
  );
  const moduleLabel = useCallback((id: string, fallback: string) => translateOr(`nav:modules.${id}`, fallback, locale), [locale]);
  const groupLabel = useCallback((id: string, fallback: string) => translateOr(`nav:groups.${id}`, fallback, locale), [locale]);
  return { t, locale, dir, labels, moduleLabel, groupLabel };
}

/** Sélecteur de langue à placer dans le menu utilisateur (enfant de <UserMenu>). */
export function LanguageMenu() {
  const { t, locale, locales, setLocale } = useTranslation();
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <Languages className="size-3" aria-hidden="true" />
        {t('shell.language')}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={locale} onValueChange={(value) => isSupportedLocale(value) && setLocale(value)}>
        {locales.map((code) => (
          <DropdownMenuRadioItem key={code} value={code} lang={code}>
            {t(`language.names.${code}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** Sélecteur de langue compact pour les pages d'accès (sans menu utilisateur). */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, locale, locales, setLocale } = useTranslation();
  return (
    <div role="group" aria-label={t('language.label')} className={cn('flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-fg', className)}>
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          title={t(`language.names.${code}`)}
          onClick={() => setLocale(code)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium uppercase transition-colors',
            code === locale ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
