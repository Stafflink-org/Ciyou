// Système de modules des back-offices : chaque rubrique vit dans
// src/features/<id>/module.tsx et exporte par défaut un AppModule. Le routeur, la
// sidebar et la recherche ⌘K les découvrent via import.meta.glob : ajouter une
// rubrique ne demande aucune modification du shell.
import type { ReactNode } from 'react';
import { Outlet, useMatches, type RouteObject } from 'react-router';
import type { CommandGroup, NavGroup } from '@golink/ui';
import type { Locale } from '@golink/shared';
import { getLocale } from '../i18n/core';
import { translateOr } from '../i18n/shell';
import { useLocale } from '../i18n/I18nProvider';
import { useFeatureCheck, usePermissionCheck } from '../auth/guards';
import { AccessDeniedPanel, FeatureNotIncludedPanel } from '../screens/StatusScreens';

export interface ModuleNav<G extends string = string> {
  /** Groupe de la sidebar (identifiant déclaré dans app/navigation.ts). */
  group: G;
  label: string;
  /** Icône lucide-react, ex. <House />. */
  icon: ReactNode;
  /** Position dans le groupe (croissante). */
  order: number;
  /**
   * Compteur du menu (commandes en attente, tickets…). C'est un hook React :
   * il est appelé à chaque rendu du shell, pour chaque module, dans un ordre fixe.
   * Renvoyer undefined, null ou 0 masque la pastille.
   */
  badge?: () => number | string | null | undefined;
  /** Lien du menu ; par défaut, le chemin de la première route du module. */
  href?: string;
  /** Termes supplémentaires pour la recherche ⌘K. */
  keywords?: string[];
  /**
   * Rubrique regroupée dans un hub (Paiement, Marketing, Paramètres…) : absente de la
   * sidebar, mais toujours présente dans la palette ⌘K, le fil d'Ariane et sa route
   * directe. Faux par défaut (aucun changement pour les modules existants).
   */
  hidden?: boolean;
  /**
   * Fonctionnalité de formule requise (`PlanFeatureKey` de `@golink/shared`), en plus de la
   * permission. Absente : rubrique toujours visible pour qui a la permission (comportement
   * inchangé). Un `FeatureProvider` doit être monté au-dessus du shell pour que ce soit vérifié ;
   * sans lui (ex. super admin), `useFeatureCheck()` renvoie toujours vrai.
   */
  feature?: string;
}

export interface AppModule<G extends string = string, P extends string = string> {
  /** Identifiant unique, égal au nom du dossier features/<id>. */
  id: string;
  nav: ModuleNav<G>;
  /**
   * Routes du module, relatives à la racine de l'application (« commandes »,
   * « commandes/:orderId », ou { index: true } pour l'accueil). Préférer `lazy`
   * pour que chaque rubrique soit chargée à la demande.
   */
  routes: RouteObject[];
  /** Permission requise pour voir la rubrique et ouvrir ses routes. */
  permission?: P;
}

export interface NavGroupDefinition<G extends string = string> {
  id: G;
  label: string;
}

interface ModuleHandle {
  moduleId: string;
}

/**
 * Valide et ordonne les modules trouvés par import.meta.glob :
 * export par défaut présent, id égal au dossier, id unique, groupe connu.
 */
export function collectModules<M extends AppModule>(
  found: Record<string, { default?: M }>,
  groups: readonly NavGroupDefinition[],
): M[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const seen = new Set<string>();
  const modules: M[] = [];
  for (const [file, exports] of Object.entries(found)) {
    const module = exports.default;
    const folder = file.split('/').at(-2);
    if (!module) throw new Error(`${file} : export par défaut (defineModule) manquant.`);
    if (module.id !== folder) throw new Error(`${file} : l'id « ${module.id} » doit être égal au nom du dossier « ${folder} ».`);
    if (seen.has(module.id)) throw new Error(`Module en double : ${module.id}.`);
    if (!groupIds.has(module.nav.group)) throw new Error(`${file} : groupe de navigation inconnu « ${module.nav.group} ».`);
    if (module.routes.length === 0) throw new Error(`${file} : aucune route déclarée.`);
    seen.add(module.id);
    modules.push(module);
  }
  return modules.sort((a, b) => a.nav.order - b.nav.order || a.nav.label.localeCompare(b.nav.label, 'fr'));
}

/** Lien de menu d'un module. */
export function moduleHref(module: AppModule): string {
  if (module.nav.href) return module.nav.href;
  const first = module.routes[0];
  if (!first || first.index || !first.path) return '/';
  return `/${first.path.replace(/^\/+/, '').replace(/\/?\*$/, '')}`;
}

/** Contrôle de permission puis de formule d'un module, en tête de ses routes. */
function ModuleGate({ permission, feature }: { permission?: string; feature?: string }) {
  const can = usePermissionCheck();
  const hasFeature = useFeatureCheck();
  if (permission && !can(permission)) return <AccessDeniedPanel />;
  // Rubrique visible par permission mais absente de la formule active (ex. lien direct, favori) :
  // état cohérent plutôt qu'un plantage — message clair renvoyant vers l'abonnement.
  if (feature && !hasFeature(feature)) return <FeatureNotIncludedPanel />;
  return <Outlet />;
}

/** Routes de tous les modules, chacune derrière le contrôle de permission et de formule de son module. */
export function moduleRoutes(modules: readonly AppModule[]): RouteObject[] {
  return modules.map((module) => ({
    id: `module:${module.id}`,
    element: <ModuleGate permission={module.permission} feature={module.nav.feature} />,
    handle: { moduleId: module.id } satisfies ModuleHandle,
    children: module.routes,
  }));
}

/** Module de la route courante (fil d'Ariane, titre, élément actif du menu). */
export function useActiveModule<M extends AppModule>(modules: readonly M[]): M | null {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as Partial<ModuleHandle> | undefined;
    if (handle?.moduleId) return modules.find((module) => module.id === handle.moduleId) ?? null;
  }
  return null;
}

const noBadge = () => undefined;

/** Groupes de la sidebar : rubriques autorisées, ordonnées, avec leurs compteurs. */
export function useModuleNav<M extends AppModule>(
  modules: readonly M[],
  groups: readonly NavGroupDefinition[],
  can: (permission: string) => boolean,
): NavGroup[] {
  const { locale } = useLocale();
  const hasFeature = useFeatureCheck();
  // Nombre d'appels constant : la liste des modules est figée au chargement de l'application.
  const badges = modules.map((module) => (module.nav.badge ?? noBadge)());
  return groups
    .map((group) => ({
      id: group.id,
      label: translateOr(`nav:groups.${group.id}`, group.label, locale),
      items: modules.flatMap((module, index) => {
        if (
          module.nav.group !== group.id ||
          module.nav.hidden ||
          (module.permission && !can(module.permission)) ||
          (module.nav.feature && !hasFeature(module.nav.feature))
        )
          return [];
        const badge = badges[index];
        return [
          {
            id: module.id,
            label: translateOr(`nav:modules.${module.id}`, module.nav.label, locale),
            href: moduleHref(module),
            icon: module.nav.icon,
            badge: badge === null || badge === undefined || badge === 0 ? undefined : badge,
          },
        ];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Entrées de navigation de la palette ⌘K, par groupe. */
export function moduleCommands(
  modules: readonly AppModule[],
  groups: readonly NavGroupDefinition[],
  can: (permission: string) => boolean,
  navigate: (href: string) => void,
  locale: Locale = getLocale(),
  hasFeature: (feature: string) => boolean = () => true,
): CommandGroup[] {
  return groups
    .map((group) => ({
      heading: translateOr(`nav:groups.${group.id}`, group.label, locale),
      items: modules
        .filter(
          (module) =>
            module.nav.group === group.id &&
            (!module.permission || can(module.permission)) &&
            (!module.nav.feature || hasFeature(module.nav.feature)),
        )
        .map((module) => ({
          id: `nav:${module.id}`,
          label: translateOr(`nav:modules.${module.id}`, module.nav.label, locale),
          description: translateOr(`nav:groups.${group.id}`, group.label, locale),
          icon: module.nav.icon,
          keywords: module.nav.keywords,
          onSelect: () => navigate(moduleHref(module)),
        })),
    }))
    .filter((group) => group.items.length > 0);
}
