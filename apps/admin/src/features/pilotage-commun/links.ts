// Adresse de la fiche d'un élément (alerte, résultat de recherche, activité) dans
// le super admin. Les rubriques cibles suivent les conventions d'URL du cahier.
import type { EntityRef, PlatformAlert, SearchHitType } from '@golink/shared';

const BY_TYPE: Partial<Record<EntityRef['type'] | SearchHitType, string>> = {
  restaurant: 'restaurants',
  driver: 'livreurs',
  client: 'clients',
  order: 'commandes',
  payout: 'finance/reversements',
  ticket: 'support',
  review: 'avis',
  promotion: 'promotions',
  city: 'villes',
  zone: 'zones',
};

// Factures, abonnements et groupes de restaurants n'ont pas de route de détail dédiée
// (`/factures/:id`, `/abonnements/:id`, `/restaurants/groupes/:id` n'existent pas) : la fiche
// s'ouvre dans un panneau sur la page liste, sélectionné par paramètre de requête (convention
// déjà utilisée par SubscriptionsPage.tsx et GroupsPage.tsx).
const BY_QUERY_PARAM: Partial<Record<EntityRef['type'] | SearchHitType, { path: string; param: string }>> = {
  invoice: { path: 'facturation', param: 'facture' },
  subscription: { path: 'abonnements', param: 'abonnement' },
  restaurant_group: { path: 'restaurants/groupes', param: 'groupe' },
};

export function entityHref(ref: Pick<EntityRef, 'type' | 'id'>): string | null {
  const byQuery = BY_QUERY_PARAM[ref.type as keyof typeof BY_QUERY_PARAM];
  if (byQuery) return `/${byQuery.path}?${byQuery.param}=${encodeURIComponent(ref.id)}`;
  const base = BY_TYPE[ref.type as keyof typeof BY_TYPE];
  return base ? `/${base}/${encodeURIComponent(ref.id)}` : null;
}

/** Lien d'une alerte : l'élément concerné, ou la rubrique de traitement. */
export function alertHref(alert: Pick<PlatformAlert, 'kind' | 'target'>): string | null {
  switch (alert.kind) {
    case 'service_down':
      return '/sante';
    case 'gdpr_request':
      return `/rgpd/${encodeURIComponent(alert.target.id)}`;
    case 'restaurant_to_validate':
      return `/restaurants/${encodeURIComponent(alert.target.id)}`;
    case 'driver_to_validate':
      return `/livreurs/${encodeURIComponent(alert.target.id)}`;
    case 'menu_quality':
      return alert.target.type === 'restaurant' ? entityHref(alert.target) : '/qualite-cartes';
    case 'fraud_signal':
      return alert.target.type === 'other' ? '/fraude' : entityHref(alert.target);
    default:
      return entityHref(alert.target);
  }
}
