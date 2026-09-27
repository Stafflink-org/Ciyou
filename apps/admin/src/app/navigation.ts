import type { NavGroupDefinition } from '@golink/web';

/** Groupes de la sidebar, dans l'ordre du cahier des fonctionnalités (A à F). */
export const NAV_GROUPS = [
  { id: 'pilotage', label: 'Pilotage' },
  { id: 'acteurs', label: 'Acteurs' },
  { id: 'operations', label: 'Opérations' },
  { id: 'argent', label: 'Argent' },
  { id: 'croissance', label: 'Croissance' },
  { id: 'plateforme', label: 'Plateforme & sécurité' },
] as const satisfies readonly NavGroupDefinition[];

export type AdminNavGroup = (typeof NAV_GROUPS)[number]['id'];
