import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Bell, ChevronsUpDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useHubEmbed } from '../lib/hub-embed';
import { IconButton } from './button';
import { Avatar, Breadcrumbs, Kbd, type BreadcrumbItem } from './display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipProvider,
} from './overlays';
import { toneClass, type Tone } from '../lib/tones';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Compteur (commandes en attente, tickets…). */
  badge?: number | string;
  badgeTone?: 'brand' | 'neutral';
  /** Module désactivé par la formule : visible mais verrouillé. */
  locked?: boolean;
}

export interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  email?: string;
  role?: string;
  avatarUrl?: string | null;
}

/** Rendu d'un lien de navigation : permet de brancher le routeur de l'application. */
export type RenderLink = (props: { href: string; className: string; children: ReactNode; onClick?: () => void; 'aria-current'?: 'page' }) => ReactNode;

const defaultRenderLink: RenderLink = ({ href, className, children, onClick, ...rest }) => (
  <a href={href} className={className} onClick={onClick} {...rest}>
    {children}
  </a>
);

/** Textes du shell : le français par défaut, l'application injecte la langue courante. */
export interface ShellLabels {
  openMenu: string;
  closeMenu: string;
  expandMenu: string;
  collapseMenu: string;
  filterMenu: string;
  mainNavigation: string;
  menuTitle: string;
  noSection: string;
  search: string;
  notifications: string;
  /** Titre accessible du bouton quand des notifications sont non lues. */
  notificationsUnread: (count: number) => string;
  markAllRead: string;
  noNotifications: string;
  viewAllNotifications: string;
  signOut: string;
}

export const DEFAULT_SHELL_LABELS: ShellLabels = {
  openMenu: 'Ouvrir le menu',
  closeMenu: 'Fermer le menu',
  expandMenu: 'Déplier le menu',
  collapseMenu: 'Replier le menu',
  filterMenu: 'Filtrer le menu',
  mainNavigation: 'Navigation principale',
  menuTitle: 'Menu',
  noSection: 'Aucune rubrique.',
  search: 'Rechercher',
  notifications: 'Notifications',
  notificationsUnread: (count) => `Notifications (${count} non lues)`,
  markAllRead: 'Tout marquer comme lu',
  noNotifications: 'Aucune notification.',
  viewAllNotifications: 'Voir toutes les notifications',
  signOut: 'Se déconnecter',
};

interface ShellContextValue {
  labels: ShellLabels;
  dir: 'ltr' | 'rtl';
}

const ShellContext = createContext<ShellContextValue>({ labels: DEFAULT_SHELL_LABELS, dir: 'ltr' });

/** Textes et direction du shell courant (dans un descendant d'AppShell). */
export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

const STORAGE_KEY = 'golink:sidebar-collapsed';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- Sidebar */

interface SidebarProps {
  brand: ReactNode;
  brandCollapsed: ReactNode;
  nav: NavGroup[];
  activeId?: string;
  collapsed: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  renderLink: RenderLink;
  onNavigate?: () => void;
  onClose?: () => void;
  searchable: boolean;
}

function SidebarContent({
  brand,
  brandCollapsed,
  nav,
  activeId,
  collapsed,
  header,
  footer,
  renderLink,
  onNavigate,
  onClose,
  searchable,
}: SidebarProps) {
  const { labels, dir } = useShell();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return nav;
    return nav
      .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(needle)) }))
      .filter((group) => group.items.length > 0);
  }, [nav, query]);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className={cn('flex h-16 shrink-0 items-center px-4', collapsed ? 'justify-center px-0' : 'justify-between')}>
        {collapsed ? brandCollapsed : brand}
        {onClose && (
          <IconButton label={labels.closeMenu} onClick={onClose} className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg">
            <X />
          </IconButton>
        )}
      </div>

      {header && !collapsed && <div className="shrink-0 px-3 pb-3">{header}</div>}

      {searchable && !collapsed && (
        <div className="shrink-0 px-3 pb-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-sidebar-border bg-white/[0.03] px-2.5 text-sidebar-muted transition-colors focus-within:border-white/20 focus-within:bg-white/[0.06]">
            <Search className="size-3.5 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.filterMenu}
              aria-label={labels.filterMenu}
              className="w-full bg-transparent text-sm text-sidebar-fg outline-none placeholder:text-sidebar-muted/80"
            />
          </label>
        </div>
      )}

      <nav aria-label={labels.mainNavigation} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.12)_transparent]">
        {groups.map((group, groupIndex) => (
          <div key={group.id} className={cn(groupIndex > 0 && 'mt-5')}>
            {group.label &&
              (collapsed ? (
                groupIndex > 0 && <div className="mx-auto mb-3 h-px w-6 bg-sidebar-border" />
              ) : (
                <p className="mb-1.5 px-2.5 font-mono text-3xs font-medium uppercase tracking-eyebrow text-sidebar-muted/80">
                  {group.label}
                </p>
              ))}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const active = item.id === activeId;
                const link = renderLink({
                  href: item.href,
                  onClick: onNavigate,
                  'aria-current': active ? 'page' : undefined,
                  className: cn(
                    'group relative flex h-9 items-center gap-3 rounded-lg text-[0.8125rem] font-medium transition-colors duration-150',
                    collapsed ? 'justify-center px-0' : 'px-2.5',
                    active ? 'bg-sidebar-active text-sidebar-fg' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg',
                    item.locked && 'opacity-50',
                  ),
                  children: (
                    <>
                      {active && (
                        <span aria-hidden="true" className="absolute -start-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-e-full bg-primary" />
                      )}
                      <span
                        className={cn(
                          'relative flex shrink-0 items-center [&_svg]:size-[18px] [&_svg]:stroke-[1.75]',
                          active ? 'text-primary' : 'text-sidebar-muted group-hover:text-sidebar-fg',
                        )}
                      >
                        {item.icon}
                        {collapsed && item.badge !== undefined && item.badge !== 0 && (
                          <span className="absolute -end-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
                        )}
                      </span>
                      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.badge !== undefined && item.badge !== 0 && (
                        <span
                          className={cn(
                            'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-2xs font-medium num',
                            item.badgeTone === 'neutral' ? 'bg-white/10 text-sidebar-fg' : 'bg-primary text-primary-fg',
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </>
                  ),
                });
                return (
                  <li key={item.id}>
                    <Tooltip content={item.label} side={dir === 'rtl' ? 'left' : 'right'} disabled={!collapsed}>
                      {link}
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className="px-2.5 py-6 text-center text-xs text-sidebar-muted">{labels.noSection}</p>}
      </nav>

      {footer && <div className="shrink-0 border-t border-sidebar-border p-3">{footer}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Topbar */

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  time: string;
  unread?: boolean;
  tone?: Tone;
  icon?: ReactNode;
  onClick?: () => void;
}

export function NotificationsButton({
  items,
  onMarkAllRead,
  onViewAll,
}: {
  items: NotificationItem[];
  onMarkAllRead?: () => void;
  onViewAll?: () => void;
}) {
  const { labels } = useShell();
  const unread = items.filter((item) => item.unread).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? labels.notificationsUnread(unread) : labels.notifications}
          className="relative grid size-9 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[9px] font-semibold leading-4 text-primary-fg ring-2 ring-canvas num">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-display text-sm font-semibold">{labels.notifications}</p>
          {onMarkAllRead && unread > 0 && (
            <button type="button" onClick={onMarkAllRead} className="text-xs font-medium text-primary-soft-fg hover:underline">
              {labels.markAllRead}
            </button>
          )}
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-fg-subtle">{labels.noNotifications}</li>}
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onClick}
                className={cn('flex w-full gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-2', item.unread && 'bg-primary-soft/25')}
              >
                <span
                  className={cn(
                    toneClass[item.tone ?? 'neutral'],
                    'grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4',
                  )}
                >
                  {item.icon ?? <Bell />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{item.title}</span>
                    {item.unread && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
                  </span>
                  {item.description && <span className="mt-0.5 block text-xs text-fg-muted">{item.description}</span>}
                  <span className="mt-1 block font-mono text-2xs text-fg-subtle">{item.time}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="w-full border-t border-border px-4 py-2.5 text-center text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {labels.viewAllNotifications}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function UserMenu({ user, children, onSignOut }: { user: ShellUser; children?: ReactNode; onSignOut?: () => void }) {
  const { labels } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg p-1 pe-2 text-start transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          <span className="hidden min-w-0 leading-tight xl:block">
            <span className="block max-w-36 truncate text-sm font-medium text-fg" title={user.name}>{user.name}</span>
            {user.role && <span className="block max-w-36 truncate text-2xs text-fg-subtle" title={user.role}>{user.role}</span>}
          </span>
          <ChevronsUpDown className="hidden size-3.5 text-fg-subtle xl:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={user.name} src={user.avatarUrl} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            {user.email && <p className="truncate text-xs text-fg-subtle">{user.email}</p>}
          </div>
        </div>
        {children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}
        {onSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<LogOut />} destructive onSelect={onSignOut}>
              {labels.signOut}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* --------------------------------------------------------------- AppShell */

export interface AppShellProps {
  /** Logo complet (sidebar dépliée). */
  brand: ReactNode;
  /** Symbole seul (sidebar repliée). */
  brandCollapsed: ReactNode;
  nav: NavGroup[];
  activeId?: string;
  renderLink?: RenderLink;
  /** Bloc sous le logo (sélecteur d'établissement…). */
  sidebarHeader?: ReactNode;
  /** Bloc en pied de sidebar (formule, aide…). */
  sidebarFooter?: ReactNode;
  /** Champ de filtrage des rubriques dans la sidebar. */
  sidebarSearch?: boolean;
  breadcrumbs?: BreadcrumbItem[];
  /** Ouvre la recherche globale (bouton ⌘K de la barre supérieure). */
  onSearch?: () => void;
  searchPlaceholder?: string;
  /** Textes du shell dans la langue courante (français par défaut). */
  labels?: Partial<ShellLabels>;
  /** Sens d'écriture : inverse la sidebar, les tiroirs et les icônes directionnelles. */
  dir?: 'ltr' | 'rtl';
  /** Éléments à droite de la barre supérieure, avant notifications et profil. */
  topbarActions?: ReactNode;
  notifications?: ReactNode;
  userMenu?: ReactNode;
  /** Bandeau au-dessus du contenu (impersonation, maintenance…). */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * Structure applicative : sidebar repliable à groupes (tiroir sur mobile),
 * barre supérieure avec fil d'Ariane, recherche ⌘K, notifications et profil.
 */
export function AppShell({
  brand,
  brandCollapsed,
  nav,
  activeId,
  renderLink = defaultRenderLink,
  sidebarHeader,
  sidebarFooter,
  sidebarSearch = false,
  breadcrumbs,
  onSearch,
  searchPlaceholder = 'Rechercher…',
  labels: labelOverrides,
  dir = 'ltr',
  topbarActions,
  notifications,
  userMenu,
  banner,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const labels = useMemo<ShellLabels>(() => ({ ...DEFAULT_SHELL_LABELS, ...labelOverrides }), [labelOverrides]);
  const shell = useMemo<ShellContextValue>(() => ({ labels, dir }), [labels, dir]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Stockage indisponible (navigation privée) : préférence non conservée.
    }
  }, [collapsed]);

  // Texte coupé (points de suspension, line-clamp) : le texte complet apparaît en info-bulle au survol / focus.
  useEffect(() => {
    const reveal = (event: Event) => {
      let el = event.target instanceof HTMLElement ? event.target : null;
      for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (el.title || el.dataset.noAutoTitle !== undefined) return;
        const style = getComputedStyle(el);
        const clampedLines = style.getPropertyValue('-webkit-line-clamp');
        const cutWide = style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
        const cutTall = clampedLines !== '' && clampedLines !== 'none' && el.scrollHeight > el.clientHeight + 1;
        if (cutWide || cutTall) {
          el.title = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          return;
        }
      }
    };
    document.addEventListener('pointerover', reveal, { passive: true });
    document.addEventListener('focusin', reveal);
    return () => {
      document.removeEventListener('pointerover', reveal);
      document.removeEventListener('focusin', reveal);
    };
  }, []);

  const sidebarProps = { brand, brandCollapsed, nav, activeId, header: sidebarHeader, footer: sidebarFooter, renderLink, searchable: sidebarSearch };

  return (
    <ShellContext.Provider value={shell}>
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh bg-canvas text-fg">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 border-e border-sidebar-border transition-[width] duration-300 ease-out lg:block',
            collapsed ? 'w-[68px]' : 'w-64',
          )}
        >
          <SidebarContent {...sidebarProps} collapsed={collapsed} />
        </aside>

        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out lg:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 start-0 z-50 w-[min(288px,86vw)] shadow-xl outline-none data-[state=open]:animate-sheet-left-in data-[state=closed]:animate-sheet-left-out lg:hidden">
              <DialogPrimitive.Title className="sr-only">{labels.menuTitle}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{labels.mainNavigation}</DialogPrimitive.Description>
              <SidebarContent
                {...sidebarProps}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
                onClose={() => setMobileOpen(false)}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-canvas/85 px-3 backdrop-blur-xl sm:px-5">
            <IconButton label={labels.openMenu} className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu />
            </IconButton>
            <span className="lg:hidden">{brandCollapsed}</span>
            <IconButton
              label={collapsed ? labels.expandMenu : labels.collapseMenu}
              className="hidden lg:inline-flex"
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <PanelLeftOpen className="rtl:-scale-x-100" /> : <PanelLeftClose className="rtl:-scale-x-100" />}
            </IconButton>
            {breadcrumbs && (
              <>
                <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <Breadcrumbs items={breadcrumbs} className="hidden min-w-0 text-sm sm:flex" />
              </>
            )}
            <div className="ms-auto flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
              {onSearch && (
                <>
                  <button
                    type="button"
                    onClick={onSearch}
                    className="hidden h-9 w-40 min-w-0 shrink items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-fg-subtle shadow-xs transition-colors hover:border-border-strong hover:text-fg-muted md:flex lg:w-48 xl:w-64 2xl:w-80"
                  >
                    <Search className="size-4" />
                    <span className="min-w-0 flex-1 truncate text-start" title={searchPlaceholder}>{searchPlaceholder}</span>
                    <Kbd className="hidden xl:inline-flex">{isMac ? '⌘ K' : 'Ctrl K'}</Kbd>
                  </button>
                  <IconButton label={labels.search} className="md:hidden" onClick={onSearch}>
                    <Search />
                  </IconButton>
                </>
              )}
              {topbarActions}
              {notifications}
              {userMenu && <span className="mx-1 hidden h-6 w-px bg-border sm:block" />}
              {userMenu}
            </div>
          </header>
          {banner}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </TooltipProvider>
    </ShellContext.Provider>
  );
}

/** Conteneur de page : largeur maximale et marges cohérentes. */
export function PageContainer({ className, children, wide }: { className?: string; children: ReactNode; wide?: boolean }) {
  // Intégré dans un hub : la largeur et les marges sont déjà posées par le PageContainer du hub.
  const embedded = useHubEmbed();
  if (embedded) return <div className={className}>{children}</div>;
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', wide ? 'max-w-(--container-page)' : 'max-w-7xl', className)}>
      {children}
    </div>
  );
}
