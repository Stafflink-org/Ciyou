import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { LogOut, Moon, Store, Sun } from 'lucide-react';
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
import { labelOf, type UserNotification } from '@golink/shared';
import {
  LanguageMenu,
  NavigationProgress,
  NotificationsMenu,
  moduleCommands,
  useActiveModule,
  useAuth,
  useDocumentTitle,
  useModuleNav,
  useShellI18n,
} from '@golink/web';
import { useAppColorMode } from '@/app/color-mode';
import { MODULES } from '@/app/modules';
import { NAV_GROUPS } from '@/app/navigation';
import { ImpersonationBanner } from '@/auth/Impersonation';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { RestaurantSwitcher } from './RestaurantSwitcher';
import { ServiceStatus } from './ServiceStatus';
import { AnnouncementsBanner } from './AnnouncementsBanner';

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
      return `/messagerie/${link.target}`;
    case 'page':
      return link.target.startsWith('/') ? link.target : null;
    default:
      return null;
  }
}

/** Structure connectée du back-office restaurant : sidebar des modules, barre supérieure, ⌘K. */
export function Shell() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { restaurant, restaurants, member, roles, can, setRestaurantId } = useRestaurantAccess();
  const { mode, toggle } = useAppColorMode();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { t, locale, dir, labels, moduleLabel, groupLabel } = useShellI18n();

  const check = useCallback((permission: string) => can(permission as Parameters<typeof can>[0]), [can]);
  const nav = useModuleNav(MODULES, NAV_GROUPS, check);
  const active = useActiveModule(MODULES);
  const group = NAV_GROUPS.find((item) => item.id === active?.nav.group);

  useDocumentTitle(active ? `${moduleLabel(active.id, active.nav.label)} · ${restaurant.name} · GoLink` : `${restaurant.name} · GoLink`);
  useCommandShortcut(useCallback(() => setPaletteOpen((open) => !open), []));

  const go = useCallback((href: string) => navigate(href), [navigate]);
  const commands = useMemo<CommandGroup[]>(() => {
    const groups = moduleCommands(MODULES, NAV_GROUPS, check, go, locale);
    const switchable = restaurants.filter((item) => item.id !== restaurant.id);
    if (switchable.length > 0) {
      groups.push({
        heading: t('accueil:shell.establishments'),
        items: switchable.map((item) => ({
          id: `restaurant:${item.id}`,
          label: t('accueil:shell.switchTo', { name: item.name }),
          description: item.address.city,
          icon: <Store />,
          onSelect: () => setRestaurantId(item.id),
        })),
      });
    }
    groups.push({
      heading: t('shell.preferences'),
      items: [
        {
          id: 'mode',
          label: mode === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark'),
          icon: mode === 'dark' ? <Sun /> : <Moon />,
          keywords: ['thème', 'sombre', 'clair', 'nuit'],
          onSelect: toggle,
        },
        { id: 'signout', label: t('shell.signOut'), icon: <LogOut />, onSelect: () => void signOut() },
      ],
    });
    return groups;
  }, [check, go, restaurants, restaurant.id, setRestaurantId, mode, toggle, signOut, locale, t]);

  const displayName = member.displayName || user?.displayName || user?.email || t('shell.myAccount');
  const role = roles[restaurant.id] ?? member.role;

  return (
    <>
      <NavigationProgress />
      <AppShell
        brand={<Logo size={30} caption={t('auth:caption')} />}
        brandCollapsed={<LogoMark size={30} />}
        nav={nav}
        activeId={active?.id}
        renderLink={renderLink}
        labels={labels}
        dir={dir}
        sidebarHeader={<RestaurantSwitcher />}
        sidebarSearch={nav.reduce((count, item) => count + item.items.length, 0) > 8}
        breadcrumbs={
          active
            ? group?.label && group.label !== active.nav.label
              ? [{ label: groupLabel(group.id, group.label) }, { label: moduleLabel(active.id, active.nav.label) }]
              : [{ label: moduleLabel(active.id, active.nav.label) }]
            : undefined
        }
        onSearch={() => setPaletteOpen(true)}
        searchPlaceholder={t('shell.commandPlaceholder')}
        topbarActions={<ServiceStatus />}
        banner={<ImpersonationBanner />}
        notifications={user && <NotificationsMenu db={db} uid={user.uid} resolveLink={notificationHref} onNavigate={go} />}
        userMenu={
          <UserMenu
            user={{ name: displayName, email: user?.email ?? undefined, role: labelOf('STAFF_ROLE_LABELS', role, locale), avatarUrl: user?.photoURL }}
            onSignOut={() => void signOut()}
          >
            <LanguageMenu />
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={mode === 'dark' ? <Sun /> : <Moon />} onSelect={toggle}>
              {mode === 'dark' ? t('shell.lightMode') : t('shell.darkMode')}
            </DropdownMenuItem>
          </UserMenu>
        }
      >
        {/* Changer d'établissement remonte la page : aucun état ne fuit d'un établissement à l'autre. */}
        <AnnouncementsBanner key={`annonces-${restaurant.id}`} />
        <Outlet key={restaurant.id} />
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={commands}
        placeholder={t('shell.commandPlaceholder')}
        emptyLabel={t('actions.empty')}
      />
    </>
  );
}
