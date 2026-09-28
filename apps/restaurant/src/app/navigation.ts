import type { NavGroupDefinition } from '@golink/web';

/** Groupes de la sidebar, dans l'ordre d'affichage. */
export const NAV_GROUPS = [
  { id: 'pilotage', label: 'Pilotage' },
  { id: 'commandes', label: 'Commandes' },
  { id: 'carte', label: 'Carte & menu' },
  { id: 'clients', label: 'Clients & livreurs' },
  { id: 'equipe', label: 'Équipe & RH' },
  { id: 'finances', label: 'Paiement' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'messagerie', label: 'Assistance' },
  { id: 'configuration', label: 'Configuration' },
] as const satisfies readonly NavGroupDefinition[];

export type RestaurantNavGroup = (typeof NAV_GROUPS)[number]['id'];
