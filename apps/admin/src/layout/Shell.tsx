import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { LogOut, Moon, Sun } from 'lucide-react';
import {
  AppShell,
  CommandPalette,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Logo,
  LogoMark,
  UserMenu,
  useCommandShortcut,
  type CommandGroup,
  type RenderLink,
} from '@golink/ui';
import { labelOf, type AdminPermission, type UserNotification } from '@golink/shared';
import {
  LanguageMenu,
  NavigationProgress,
  NotificationsMenu,
  moduleCommands,
  useActiveModule,
  useAuth,
  useBranding,
  useDocumentTitle,
  useModuleNav,
  useShellI18n,
} from '@golink/web';
import { MODULES } from '@/app/modules';
import { NAV_GROUPS } from '@/app/navigation';
import { useAdminAccess } from '@/auth/AdminAccess';
import { PaletteSearchResults } from '@/features/recherche/PaletteResults';
import { db } from '@/lib/firebase';
import { useAppColorMode } from '@/app/color-mode';
import { GeoScopeProvider, GeoScopeSelector } from './GeoScope';
import { ImpersonationBanner } from './Impersonation';

/** Logo du menu : celui du réglage « Marque » s'il est renseigné, sinon le logo Ciyou Eats. */
function BrandLogo({ caption }: { caption: string }) {
  const { logoUrl, platformName } = useBranding(db);
  if (!logoUrl) return <Logo size={30} caption={caption} />;
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src={logoUrl} alt={platformName ?? 'Logo'} className="h-8 w-auto max-w-40 object-contain" />
      <span className="font-mono text-3xs uppercase tracking-eyebrow opacity-60">{caption}</span>
    </span>
  );
}

const renderLink: RenderLink = ({ href, className, children, onClick, ...rest }) => (
  <Link to={href} className={className} onClick={onClick} aria-current={rest['aria-current']}>
    {children}
  </Link>
);

/** Adresse interne ouverte depuis une notification. */
function notificationHref(link: NonNullable<UserNotification['link']>): string | null {
  switch (link.type) {
    case 'order':
      return `/commandes/${link.target}`;
    case 'ticket':
      return `/support/${link.target}`;
    case 'page':
      return link.target.startsWith('/') ? link.target : null;
    default:
      return null;
  }
}

/** Structure connectée du super admin : sidebar des modules, périmètre, recherche ⌘K. */
export function Shell() {
  // Le périmètre enveloppe toute la structure : les pastilles des modules (hooks appelés
  // par la sidebar) peuvent ainsi lire le filtre pays / ville.
  return (
    <GeoScopeProvider>
      <ShellLayout />
    </GeoScopeProvider>
  );
}

function ShellLayout() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { admin, can } = useAdminAccess();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { t, locale, dir, labels, moduleLabel, groupLabel } = useShellI18n();
  const { mode, toggle } = useAppColorMode();
  // Saisie de la palette : relayée à la recherche universelle (globalSearch).
  const [paletteSearch, setPaletteSearch] = useState('');

  const check = useCallback((permission: string) => can(permission as AdminPermission), [can]);
  const nav = useModuleNav(MODULES, NAV_GROUPS, check);
  const active = useActiveModule(MODULES);
  const group = NAV_GROUPS.find((item) => item.id === active?.nav.group);

  useDocumentTitle(active ? `${moduleLabel(active.id, active.nav.label)} · Ciyou Eats Admin` : 'Ciyou Eats Admin');
  useCommandShortcut(useCallback(() => setPaletteOpen((open) => !open), []));

  const go = useCallback((href: string) => navigate(href), [navigate]);
  const commands = useMemo<CommandGroup[]>(
    () => [
      ...moduleCommands(MODULES, NAV_GROUPS, check, go, locale),
      {
        heading: t('shell.preferences'),
        items: [
          {
            id: 'mode',
            label: mode === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark'),
            icon: mode === 'dark' ? <Sun /> : <Moon />,
            keywords: ['thème', 'sombre', 'clair', 'nuit'],
            onSelect: toggle,
          },
        ],
      },
      {
        heading: t('shell.account'),
        items: [{ id: 'signout', label: t('shell.signOut'), icon: <LogOut />, onSelect: () => void signOut() }],
      },
    ],
    [check, go, signOut, locale, t, mode, toggle],
  );

  return (
    <>
      <NavigationProgress />
      <AppShell
        brand={<BrandLogo caption={t('auth:caption')} />}
        brandCollapsed={<LogoMark size={30} />}
        nav={nav}
        activeId={active?.id}
        renderLink={renderLink}
        labels={labels}
        dir={dir}
        sidebarSearch={nav.reduce((count, item) => count + item.items.length, 0) > 10}
        breadcrumbs={
          active
            ? group?.label && group.label !== active.nav.label
              ? [{ label: groupLabel(group.id, group.label) }, { label: moduleLabel(active.id, active.nav.label) }]
              : [{ label: moduleLabel(active.id, active.nav.label) }]
            : undefined
        }
        onSearch={() => setPaletteOpen(true)}
        searchPlaceholder={t('accueil:shell.searchPlaceholder')}
        topbarActions={<GeoScopeSelector />}
        notifications={user && <NotificationsMenu db={db} uid={user.uid} resolveLink={notificationHref} onNavigate={go} />}
        userMenu={
          <UserMenu
            user={{
              name: admin.displayName || user?.displayName || admin.email,
              email: admin.email,
              role: labelOf('ADMIN_ROLE_LABELS', admin.role, locale),
              avatarUrl: user?.photoURL,
            }}
            onSignOut={() => void signOut()}
          >
            <LanguageMenu />
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={mode === 'dark' ? <Sun /> : <Moon />} onSelect={toggle}>
              {mode === 'dark' ? t('shell.lightMode') : t('shell.darkMode')}
            </DropdownMenuItem>
          </UserMenu>
        }
        banner={<ImpersonationBanner />}
      >
        <Outlet />
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          if (!open) setPaletteSearch('');
        }}
        groups={commands}
        placeholder={t('accueil:shell.palettePlaceholder')}
        emptyLabel={t('actions.empty')}
        search={paletteSearch}
        onSearchChange={setPaletteSearch}
        resultsFirst={paletteSearch.trim().length >= 2 && can('search.use')}
      >
        <PaletteSearchResults
          query={paletteSearch}
          enabled={paletteOpen && can('search.use')}
          onNavigate={(href) => {
            setPaletteOpen(false);
            setPaletteSearch('');
            void navigate(href);
          }}
        />
      </CommandPalette>
    </>
  );
}
