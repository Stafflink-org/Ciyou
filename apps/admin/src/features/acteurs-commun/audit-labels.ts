// Libellés français des actions du journal d'audit affichées dans les fiches
// restaurant et client (historique des modifications).
import type { Tone } from '@golink/ui';

const LABELS: Record<string, { label: string; tone: Tone }> = {
  'restaurant.signup': { label: 'Inscription en ligne', tone: 'info' },
  'restaurant.created': { label: 'Fiche créée par l’équipe', tone: 'info' },
  'restaurants.imported': { label: 'Import en masse', tone: 'info' },
  'restaurant.approved': { label: 'Dossier validé', tone: 'success' },
  'restaurant.rejected': { label: 'Dossier refusé', tone: 'danger' },
  'restaurant.documents_requested': { label: 'Documents demandés', tone: 'amber' },
  'restaurant.documents_reminded': { label: 'Relance documents', tone: 'amber' },
  'restaurant.documents_completed': { label: 'Dossier complété', tone: 'info' },
  'restaurant.documents_blocked': { label: 'Blocage : document expiré', tone: 'danger' },
  'restaurant.documents_unblocked': { label: 'Blocage documentaire levé', tone: 'success' },
  'restaurant.suspended': { label: 'Suspension temporaire', tone: 'danger' },
  'restaurant.closed': { label: 'Fermeture définitive', tone: 'danger' },
  'restaurant.reactivated': { label: 'Réactivation', tone: 'success' },
  'restaurant.commercial_updated': { label: 'Conditions commerciales modifiées', tone: 'brand' },
  'restaurant.profile_updated': { label: 'Fiche modifiée', tone: 'neutral' },
  'restaurant.impersonation_started': { label: '« Voir comme » ouvert', tone: 'plum' },
  'restaurant.impersonation_ended': { label: '« Voir comme » terminé', tone: 'plum' },
  'restaurant.partner_contract_accepted': { label: 'Contrat partenaire signé', tone: 'success' },
  'document.submitted': { label: 'Document déposé', tone: 'info' },
  'document.approved': { label: 'Document validé', tone: 'success' },
  'document.rejected': { label: 'Document refusé', tone: 'danger' },
  'customer.credited': { label: 'Avoir crédité', tone: 'brand' },
  'customer.blocked': { label: 'Compte bloqué', tone: 'danger' },
  'customer.unblocked': { label: 'Compte débloqué', tone: 'success' },
  'customer.deleted': { label: 'Compte supprimé (RGPD)', tone: 'danger' },
  'restaurant.customer_blocked': { label: 'Bloqué par un commerce', tone: 'amber' },
  'restaurant.customer_unblocked': { label: 'Débloqué par un commerce', tone: 'neutral' },
  'restaurant.auto_paused': { label: 'Pause automatique', tone: 'amber' },
  'restaurant.commission_negotiated': { label: 'Commission négociée', tone: 'brand' },
  'restaurant.delivery_zone_created': { label: 'Zone de livraison créée', tone: 'neutral' },
  'restaurant.delivery_zone_deleted': { label: 'Zone de livraison supprimée', tone: 'neutral' },
  'restaurant.hours_updated': { label: 'Horaires modifiés', tone: 'neutral' },
  'restaurant.member_invited': { label: 'Membre de l’équipe invité', tone: 'neutral' },
  'restaurant.member_permissions_updated': { label: 'Droits d’un membre modifiés', tone: 'neutral' },
  'restaurant.member_revoked': { label: 'Accès d’un membre retiré', tone: 'amber' },
  'restaurant.notification_settings_updated': { label: 'Notifications modifiées', tone: 'neutral' },
  'restaurant.order_settings_updated': { label: 'Réglages de commande modifiés', tone: 'neutral' },
  'restaurant.payment_settings_updated': { label: 'Moyens de paiement modifiés', tone: 'neutral' },
  'menu.imported': { label: 'Carte importée', tone: 'info' },
  'payout.held': { label: 'Reversements bloqués', tone: 'danger' },
  'payroll.computed': { label: 'Paie calculée', tone: 'neutral' },
  'haccp.register_exported': { label: 'Registre HACCP exporté', tone: 'neutral' },
  'absence.rejected': { label: 'Absence refusée', tone: 'neutral' },
  'schedule.published': { label: 'Planning publié', tone: 'neutral' },
  'subscription.change_scheduled': { label: 'Changement de formule programmé', tone: 'brand' },
  'subscription.plan_changed': { label: 'Formule changée', tone: 'brand' },
  'time_entry.corrected': { label: 'Pointage corrigé', tone: 'neutral' },
  'time_week.reopened': { label: 'Semaine de pointage rouverte', tone: 'neutral' },
  'time_week.validated': { label: 'Semaine de pointage validée', tone: 'neutral' },
};

const ENTITIES: Record<string, string> = {
  restaurant: 'Commerce',
  customer: 'Client',
  document: 'Document',
  menu: 'Carte',
  product: 'Produit',
  order: 'Commande',
  payout: 'Reversement',
  invoice: 'Facture',
  subscription: 'Abonnement',
  member: 'Membre',
  refund: 'Remboursement',
};

const VERBS: Record<string, string> = {
  created: 'créé',
  updated: 'modifié',
  deleted: 'supprimé',
  approved: 'approuvé',
  rejected: 'refusé',
  validated: 'validé',
  published: 'publié',
  exported: 'exporté',
  imported: 'importé',
  computed: 'calculé',
  corrected: 'corrigé',
  reopened: 'rouvert',
  invited: 'invité',
  blocked: 'bloqué',
  unblocked: 'débloqué',
  suspended: 'suspendu',
  held: 'bloqué',
  released: 'débloqué',
  paid: 'payé',
  cancelled: 'annulé',
};

export function auditActionLabel(action: string): { label: string; tone: Tone } {
  const known = LABELS[action];
  if (known) return known;
  if (action.startsWith('restaurants.bulk_')) return { label: 'Action groupée', tone: 'brand' };
  const [entity = '', event = ''] = action.split('.');
  const words = event.split('_');
  const verb = VERBS[words[words.length - 1] ?? ''];
  const subject = ENTITIES[entity] ?? 'Action';
  return { label: verb ? `${subject} : ${verb}` : `${subject} : ${event.replace(/_/g, ' ')}`, tone: 'neutral' };
}

/** Rendu lisible d'une valeur avant / après. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join(', ') : '—';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k} : ${formatAuditValue(v)}`)
      .join(' · ');
  }
  return String(value);
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Statut',
  onboardingStatus: 'Validation',
  planCode: 'Formule',
  billingMode: 'Facturation',
  negotiatedCommission: 'Commission négociée',
  allowedPaymentMethods: 'Paiements',
  payoutFrequency: 'Reversements',
  until: 'Jusqu’au',
  expiresAt: 'Expiration',
  amountCents: 'Montant',
  balanceAfterCents: 'Solde',
  name: 'Nom',
  address: 'Adresse',
  zoneIds: 'Zones',
  deliveredBy: 'Livraison',
  fulfillmentModes: 'Modes',
  sessionId: 'Session',
  durationMinutes: 'Durée (min)',
  minutes: 'Durée (min)',
};

/** Libellé d'un champ modifié (clé technique si inconnue). */
export function auditFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** Valeur d'un champ : montants en centimes et taux en points de base rendus lisibles. */
export function formatAuditField(key: string, value: unknown): string {
  if (typeof value === 'number' && key.endsWith('Cents')) return (value / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  if (typeof value === 'number' && key.endsWith('Bps')) return `${(value / 100).toLocaleString('fr-FR')} %`;
  return formatAuditValue(value);
}
