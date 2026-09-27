import type { Tone } from './tones';

export interface StatusMeta {
  label: string;
  tone: Tone;
  pulse?: boolean;
}

/** Libellés et tons des statuts de commande (clés = statuts stockés en base). */
export const ORDER_STATUS: Record<string, StatusMeta> = {
  pending: { label: 'Nouvelle', tone: 'brand', pulse: true },
  accepted: { label: 'Acceptée', tone: 'neutral' },
  preparing: { label: 'En préparation', tone: 'amber' },
  ready: { label: 'Prête', tone: 'teal' },
  picked_up: { label: 'Récupérée', tone: 'plum' },
  delivering: { label: 'En livraison', tone: 'info', pulse: true },
  delivered: { label: 'Livrée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  refunded: { label: 'Remboursée', tone: 'neutral' },
};

/** Statuts de compte partagés (restaurants, livreurs, clients, abonnements). */
export const ACCOUNT_STATUS: Record<string, StatusMeta> = {
  active: { label: 'Actif', tone: 'success' },
  online: { label: 'En ligne', tone: 'success', pulse: true },
  offline: { label: 'Hors ligne', tone: 'neutral' },
  paused: { label: 'En pause', tone: 'amber' },
  pending: { label: 'En attente', tone: 'info' },
  onboarding: { label: 'Inscription en cours', tone: 'info' },
  suspended: { label: 'Suspendu', tone: 'danger' },
  banned: { label: 'Banni', tone: 'danger' },
  trial: { label: 'Essai', tone: 'plum' },
  past_due: { label: 'Impayé', tone: 'danger' },
  cancelled: { label: 'Résilié', tone: 'neutral' },
  draft: { label: 'Brouillon', tone: 'neutral' },
};
