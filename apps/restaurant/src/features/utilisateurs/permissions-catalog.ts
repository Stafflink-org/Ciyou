// Libellés et regroupement des permissions du personnel, pour les écrans de rôles.
import type { RestaurantPermission, StaffRole } from '@golink/shared';

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: Array<{ key: RestaurantPermission; label: string; description: string }>;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'service',
    label: 'Service et commandes',
    permissions: [
      { key: 'dashboard.view', label: 'Tableau de bord', description: 'Voir l’accueil et les indicateurs du jour.' },
      { key: 'orders.view', label: 'Voir les commandes', description: 'Consulter les commandes et leur détail.' },
      { key: 'orders.manage', label: 'Traiter les commandes', description: 'Accepter, préparer, marquer prêtes, ouvrir ou mettre en pause.' },
      { key: 'orders.cancel', label: 'Annuler des commandes', description: 'Refuser ou annuler une commande acceptée.' },
      { key: 'couriers.manage', label: 'Gérer les livreurs', description: 'Livreurs du restaurant et préférences.' },
    ],
  },
  {
    id: 'carte',
    label: 'Carte et stocks',
    permissions: [
      { key: 'menu.view', label: 'Voir la carte', description: 'Produits, options et disponibilités.' },
      { key: 'menu.edit', label: 'Modifier la carte', description: 'Créer et modifier produits, prix, sections.' },
      { key: 'stock.edit', label: 'Gérer les stocks', description: 'Ruptures, quantités et ajustements.' },
    ],
  },
  {
    id: 'clients',
    label: 'Clients et communication',
    permissions: [
      { key: 'customers.view', label: 'Voir les clients', description: 'Historique et fiches clients (données masquées).' },
      { key: 'customers.manage', label: 'Gérer les clients', description: 'Notes, étiquettes, blocage.' },
      { key: 'reviews.reply', label: 'Répondre aux avis', description: 'Réponses publiques aux avis clients.' },
      { key: 'messages.use', label: 'Messagerie', description: 'Échanger avec clients et livreurs.' },
      { key: 'marketing.manage', label: 'Marketing', description: 'Codes promo, campagnes, fidélité.' },
      { key: 'support.use', label: 'Support GoLink', description: 'Ouvrir et suivre des demandes au support.' },
    ],
  },
  {
    id: 'finances',
    label: 'Finances',
    permissions: [
      { key: 'finance.view', label: 'Finances', description: 'Chiffre d’affaires, versements, abonnement.' },
      { key: 'invoices.view', label: 'Factures', description: 'Télécharger les factures GoLink.' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    permissions: [
      { key: 'settings.manage', label: 'Paramètres de l’établissement', description: 'Profil, horaires, paiements, documents.' },
      { key: 'zones.manage', label: 'Zones de livraison', description: 'Secteurs et frais des livreurs du restaurant.' },
      { key: 'team.view', label: 'Voir l’équipe', description: 'Liste des membres et des rôles.' },
      { key: 'team.manage', label: 'Gérer les accès', description: 'Inviter, modifier les rôles, retirer un accès.' },
    ],
  },
  {
    id: 'rh',
    label: 'Équipe et RH',
    permissions: [
      { key: 'planning.view', label: 'Voir le planning', description: 'Consulter les plannings publiés.' },
      { key: 'planning.manage', label: 'Gérer le planning', description: 'Créer et publier les plannings.' },
      { key: 'timeclock.self', label: 'Pointer', description: 'Enregistrer ses propres heures.' },
      { key: 'timeclock.manage', label: 'Gérer les pointages', description: 'Corriger et valider les heures.' },
      { key: 'absences.self', label: 'Demander des absences', description: 'Congés et absences personnelles.' },
      { key: 'absences.manage', label: 'Valider les absences', description: 'Accepter ou refuser les demandes.' },
      { key: 'payroll.view', label: 'Voir la paie', description: 'Consulter les bulletins.' },
      { key: 'payroll.manage', label: 'Gérer la paie', description: 'Préparer et valider les bulletins.' },
      { key: 'tasks.view', label: 'Voir les tâches', description: 'Tâches assignées à l’équipe.' },
      { key: 'tasks.manage', label: 'Gérer les tâches', description: 'Créer et attribuer des tâches.' },
      { key: 'documents.view', label: 'Documents d’équipe', description: 'Consulter les documents partagés.' },
      { key: 'documents.manage', label: 'Gérer les documents', description: 'Déposer et partager des documents.' },
      { key: 'haccp.record', label: 'Relevés HACCP', description: 'Températures, nettoyage, réceptions.' },
      { key: 'haccp.manage', label: 'Plan HACCP', description: 'Équipements, plans et vérifications.' },
    ],
  },
];

export const PERMISSION_LABELS = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.label])),
) as Record<RestaurantPermission, string>;

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: 'Tous les droits, y compris la signature du contrat et l’abonnement.',
  manager: 'Pilote l’établissement au quotidien : tout sauf la validation de la paie.',
  kitchen: 'Traite les commandes, gère les ruptures et les relevés HACCP.',
  service: 'Traite les commandes, échange avec les clients et les livreurs.',
  accountant: 'Consulte les finances, factures et prépare la paie.',
  employee: 'Accès personnel : planning, pointage, absences, tâches.',
  custom: 'Droits choisis sur mesure pour ce membre.',
};
