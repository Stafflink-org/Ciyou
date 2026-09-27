// Textes par défaut des messages automatiques envoyés par la plateforme (collection
// `messageTemplates`). Le super admin les modifie ; si un gabarit manque en base, le
// serveur retombe sur ces valeurs. Variables entre doubles accolades.
import type { PlatformMessageKey } from '../models/automations';

export interface PlatformMessageDefault {
  key: PlatformMessageKey;
  event: string;
  audience: 'client' | 'restaurant' | 'driver' | 'admin';
  channels: Array<'push' | 'email' | 'sms' | 'in_app'>;
  subject: string | null;
  title: string;
  body: string;
  variables: string[];
  /** Catégorie du centre de notifications. */
  category: 'order' | 'promotion' | 'account' | 'announcement' | 'support' | 'payout' | 'document';
}

export const PLATFORM_MESSAGE_DEFAULTS: Record<PlatformMessageKey, PlatformMessageDefault> = {
  order_confirmed: {
    key: 'order_confirmed', event: 'Commande acceptée', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'order',
    title: 'Commande confirmée', body: '{{restaurantName}} prépare votre commande {{orderNumber}}.', variables: ['restaurantName', 'orderNumber'],
  },
  order_ready_pickup: {
    key: 'order_ready_pickup', event: 'Commande prête au retrait', audience: 'client', channels: ['push', 'sms'], subject: null, category: 'order',
    title: 'Votre commande est prête', body: 'Votre commande {{orderNumber}} vous attend chez {{restaurantName}}. Code de retrait : {{code}}.', variables: ['restaurantName', 'orderNumber', 'code'],
  },
  order_picked_up: {
    key: 'order_picked_up', event: 'Livreur en route', audience: 'client', channels: ['push'], subject: null, category: 'order',
    title: 'Votre commande arrive', body: '{{driverName}} est en route, arrivée estimée à {{eta}}.', variables: ['driverName', 'eta'],
  },
  order_delivered: {
    key: 'order_delivered', event: 'Commande livrée', audience: 'client', channels: ['push', 'email'], subject: 'Votre commande GoLink a été livrée', category: 'order',
    title: 'Bon appétit !', body: 'Votre commande {{orderNumber}} a été livrée. Notez votre expérience.', variables: ['orderNumber'],
  },
  order_cancelled: {
    key: 'order_cancelled', event: 'Commande annulée', audience: 'client', channels: ['push', 'email'], subject: 'Votre commande GoLink a été annulée', category: 'order',
    title: 'Commande annulée', body: 'Votre commande {{orderNumber}} a été annulée : {{reason}}. Vous êtes remboursé de {{amount}}.', variables: ['orderNumber', 'reason', 'amount'],
  },
  order_customer_absent: {
    key: 'order_customer_absent', event: 'Client absent : commande clôturée', audience: 'client', channels: ['push', 'email'], subject: 'Votre commande {{orderNumber}} n’a pas pu être remise', category: 'order',
    title: 'Commande non remise', body: 'Le livreur a patienté {{waitMinutes}} minutes sans réponse : votre commande {{orderNumber}} est clôturée. Conformément aux conditions d’utilisation, elle n’est pas remboursée.', variables: ['orderNumber', 'waitMinutes'],
  },
  refund_issued: {
    key: 'refund_issued', event: 'Remboursement', audience: 'client', channels: ['email', 'in_app'], subject: 'Remboursement de votre commande GoLink', category: 'order',
    title: 'Remboursement effectué', body: 'Nous vous avons remboursé {{amount}} pour la commande {{orderNumber}}.', variables: ['amount', 'orderNumber'],
  },
  late_credit_issued: {
    key: 'late_credit_issued', event: 'Avoir de retard', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'order',
    title: 'Un avoir pour votre retard', body: 'Votre commande {{orderNumber}} est arrivée avec {{lateMinutes}} minutes de retard : {{amount}} ont été ajoutés à votre solde GoLink, valables jusqu’au {{date}}.', variables: ['orderNumber', 'lateMinutes', 'amount', 'date'],
  },
  item_replacement_proposed: {
    key: 'item_replacement_proposed', event: 'Remplacement proposé', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'order',
    title: 'Un article est indisponible', body: '{{restaurantName}} n’a plus « {{itemName}} » pour la commande {{orderNumber}}. Accepter « {{replacementName}} » à la place ? Sans réponse dans {{minutes}} minutes, l’article est retiré et remboursé.', variables: ['restaurantName', 'orderNumber', 'itemName', 'replacementName', 'minutes'],
  },
  item_removed: {
    key: 'item_removed', event: 'Article retiré et remboursé', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'order',
    title: 'Article retiré de votre commande', body: '« {{itemName}} » est indisponible et a été retiré de la commande {{orderNumber}}. {{amount}} vous sont remboursés.', variables: ['orderNumber', 'itemName', 'amount'],
  },
  claim_received: {
    key: 'claim_received', event: 'Réclamation reçue', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'support',
    title: 'Réclamation reçue', body: 'Nous avons bien reçu votre réclamation pour la commande {{orderNumber}}. Notre équipe l’examine et vous répond rapidement.', variables: ['orderNumber'],
  },
  claim_decided: {
    key: 'claim_decided', event: 'Réponse à une réclamation', audience: 'client', channels: ['push', 'email', 'in_app'], subject: 'Réponse à votre réclamation {{orderNumber}}', category: 'support',
    title: 'Réponse à votre réclamation', body: 'Réclamation sur la commande {{orderNumber}} : {{decision}}', variables: ['orderNumber', 'decision'],
  },
  restaurant_new_order: {
    key: 'restaurant_new_order', event: 'Nouvelle commande', audience: 'restaurant', channels: ['push', 'in_app'], subject: null, category: 'order',
    title: 'Nouvelle commande', body: 'Commande {{orderNumber}} : {{itemsCount}} articles, {{total}}.', variables: ['orderNumber', 'itemsCount', 'total'],
  },
  restaurant_approved: {
    key: 'restaurant_approved', event: 'Compte validé', audience: 'restaurant', channels: ['email'], subject: 'Bienvenue sur GoLink', category: 'account',
    title: 'Bienvenue sur GoLink', body: 'Votre établissement {{restaurantName}} est validé : vous pouvez ouvrir aux commandes.', variables: ['restaurantName'],
  },
  restaurant_auto_approved: {
    key: 'restaurant_auto_approved', event: 'Compte validé automatiquement', audience: 'restaurant', channels: ['email', 'in_app'], subject: '{{restaurantName}} est en ligne sur GoLink', category: 'account',
    title: 'Votre dossier est validé', body: 'Vos pièces sont complètes et valides : {{restaurantName}} est validé automatiquement. Vous pouvez ouvrir aux commandes.', variables: ['restaurantName'],
  },
  restaurant_documents_missing: {
    key: 'restaurant_documents_missing', event: 'Documents manquants', audience: 'restaurant', channels: ['email'], subject: 'Documents à compléter pour {{restaurantName}}', category: 'document',
    title: 'Documents à compléter', body: '{{restaurantName}} : merci de déposer {{documents}} pour finaliser votre dossier.', variables: ['restaurantName', 'documents'],
  },
  restaurant_inactivity_warning: {
    key: 'restaurant_inactivity_warning', event: 'Alerte d’inactivité', audience: 'restaurant', channels: ['email', 'in_app'], subject: '{{restaurantName}} : aucune commande depuis {{days}} jours', category: 'account',
    title: 'Aucune commande depuis {{days}} jours', body: 'Aucune commande n’a été passée chez {{restaurantName}} depuis le {{date}} ({{days}} jours). Sans activité d’ici le {{removalDate}}, l’établissement sera retiré de GoLink. Rouvrez vos commandes et vérifiez votre carte pour rester visible.', variables: ['restaurantName', 'date', 'days', 'removalDate'],
  },
  restaurant_removed_inactive: {
    key: 'restaurant_removed_inactive', event: 'Retrait pour inactivité', audience: 'restaurant', channels: ['email', 'in_app'], subject: '{{restaurantName}} a été retiré de GoLink', category: 'account',
    title: 'Établissement retiré de la plateforme', body: '{{restaurantName}} est retiré de GoLink après {{days}} jours sans commande. Vos données légales sont conservées ; contactez le support pour être réactivé.', variables: ['restaurantName', 'days'],
  },
  restaurant_auto_paused: {
    key: 'restaurant_auto_paused', event: 'Pause automatique', audience: 'restaurant', channels: ['push', 'email', 'in_app'], subject: '{{restaurantName}} est en pause', category: 'account',
    title: 'Commandes en pause', body: '{{restaurantName}} est en pause après {{count}} commandes non acceptées d’affilée. Rouvrez les commandes quand l’équipe est prête.', variables: ['restaurantName', 'count'],
  },
  restaurant_document_expiring: {
    key: 'restaurant_document_expiring', event: 'Document bientôt expiré', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Document à renouveler', category: 'document',
    title: 'Document à renouveler', body: 'Votre {{documentType}} expire le {{date}}.', variables: ['documentType', 'date'],
  },
  restaurant_payout_paid: {
    key: 'restaurant_payout_paid', event: 'Reversement effectué', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Votre reversement GoLink de {{amount}} est en route', category: 'payout',
    title: 'Votre reversement est en route', body: '{{amount}} ont été virés pour la période {{period}}. Ventes : {{sales}} ; commission GoLink : {{commission}} ; remboursements imputés : {{refunds}} ; frais, abonnement et ajustements : {{adjustments}}. Référence : {{reference}}.', variables: ['amount', 'period', 'sales', 'commission', 'refunds', 'adjustments', 'reference'],
  },
  invoice_available: {
    key: 'invoice_available', event: 'Facture disponible', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Facture {{invoiceNumber}} disponible', category: 'payout',
    title: 'Facture disponible', body: 'Votre facture {{invoiceNumber}} de {{amount}} ({{period}}) est disponible dans votre espace. {{settlement}}', variables: ['invoiceNumber', 'amount', 'period', 'settlement'],
  },
  subscription_payment_due: {
    key: 'subscription_payment_due', event: 'Abonnement impayé (relance)', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Abonnement GoLink : {{amount}} restent à régler', category: 'payout',
    title: 'Règlement de votre abonnement en attente', body: 'La facture {{invoiceNumber}} ({{amount}}) n’a pas pu être retenue sur vos reversements : votre solde à reverser est insuffisant. Elle sera retenue dès vos prochaines ventes, ou réglez-la par virement. Sans régularisation avant le {{date}}, certaines fonctions seront restreintes.', variables: ['invoiceNumber', 'amount', 'date'],
  },
  subscription_restricted: {
    key: 'subscription_restricted', event: 'Abonnement restreint', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Fonctions restreintes sur {{restaurantName}}', category: 'payout',
    title: 'Certaines fonctions sont restreintes', body: 'Faute de règlement de votre abonnement ({{amount}} dus), ces fonctions sont coupées : {{features}}. Vos commandes continuent. Régularisez pour tout rétablir immédiatement.', variables: ['restaurantName', 'amount', 'features'],
  },
  subscription_suspended: {
    key: 'subscription_suspended', event: 'Abonnement suspendu', audience: 'restaurant', channels: ['email', 'in_app'], subject: '{{restaurantName}} : abonnement suspendu', category: 'payout',
    title: 'Abonnement suspendu', body: 'Le délai de régularisation est écoulé : votre abonnement est suspendu et {{restaurantName}} ne reçoit plus de nouvelles commandes. Réglez {{amount}} pour être rétabli.', variables: ['restaurantName', 'amount'],
  },
  subscription_restored: {
    key: 'subscription_restored', event: 'Abonnement rétabli', audience: 'restaurant', channels: ['email', 'in_app'], subject: 'Votre abonnement GoLink est rétabli', category: 'payout',
    title: 'Abonnement rétabli', body: 'Merci : votre abonnement est à jour et toutes les fonctions de {{restaurantName}} sont de nouveau disponibles.', variables: ['restaurantName'],
  },
  cash_limit_reached: {
    key: 'cash_limit_reached', event: 'Plafond d’espèces atteint', audience: 'restaurant', channels: ['push', 'in_app'], subject: null, category: 'payout',
    title: 'Plafond d’espèces atteint', body: '{{driverName}} détient {{amount}} en espèces (plafond {{limit}}). Il ne reçoit plus de course payée en espèces tant que vous n’avez pas enregistré sa remise.', variables: ['driverName', 'amount', 'limit'],
  },
  driver_approved: {
    key: 'driver_approved', event: 'Livreur validé', audience: 'driver', channels: ['push', 'email'], subject: 'Votre compte livreur GoLink est validé', category: 'account',
    title: 'Vous pouvez commencer', body: 'Votre compte livreur est validé. Passez en ligne pour recevoir des courses.', variables: [],
  },
  driver_payout_paid: {
    key: 'driver_payout_paid', event: 'Paiement livreur', audience: 'driver', channels: ['push', 'email'], subject: 'Votre paiement GoLink est envoyé', category: 'payout',
    title: 'Paiement envoyé', body: '{{amount}} ont été virés pour la période {{period}}.', variables: ['amount', 'period'],
  },
  zone_emergency_closure: {
    key: 'zone_emergency_closure', event: 'Fermeture d’urgence d’une zone', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'announcement',
    title: 'Livraison momentanément suspendue', body: '{{message}}', variables: ['message'],
  },
  referral_rewarded: {
    key: 'referral_rewarded', event: 'Parrainage récompensé', audience: 'client', channels: ['push', 'in_app'], subject: null, category: 'account',
    title: 'Parrainage récompensé', body: '{{amount}} ont été ajoutés à votre solde GoLink. Merci !', variables: ['amount', 'role'],
  },
};
