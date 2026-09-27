// Adresse de la fiche d'un élément (alerte, résultat de recherche, activité) dans
// le super admin. Les rubriques cibles suivent les conventions d'URL du cahier.
import type { EntityRef, PlatformAlert, SearchHitType } from '@golink/shared';

const BY_TYPE: Partial<Record<EntityRef['type'] | SearchHitType, string>> = {
  restaurant: 'restaurants',
  restaurant_group: 'restaurants/groupes',
  driver: 'livreurs',
  client: 'clients',
  order: 'commandes',
  invoice: 'factures',
  payout: 'reversements',
  refund: 'remboursements',
  ticket: 'support',
  review: 'avis',
  promotion: 'promotions',
  subscription: 'abonnements',
  city: 'villes',
  zone: 'zones',
};

export function entityHref(ref: Pick<EntityRef, 'type' | 'id'>): string | null {
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
