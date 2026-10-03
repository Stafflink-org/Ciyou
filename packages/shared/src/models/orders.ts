// Commandes (collection racine), journal d'événements et répartition financière.
// La commande est créée et modifiée uniquement par Cloud Functions : les montants
// sont recalculés côté serveur avec le moteur de tarification.
import type {
  CancelReason,
  FulfillmentMode,
  OrderActor,
  OrderEventType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductSaleUnit,
  VatCategory,
} from '../constants/enums';
import type { Bps, Cents } from '../pricing/money';
import type { CurrencyCode } from '../pricing/currency';
import type { DiscountBreakdown, Settlement, VatLine } from '../pricing/types';
import type { GeoPoint, Localized, PostalAddress, Timestamp } from './common';

export interface OrderItemOption {
  optionId: string;
  groupId: string;
  groupName: string;
  name: string;
  priceCents: Cents;
  quantity: number;
}

/** Ligne de commande : instantané du produit au moment de la commande. */
export interface OrderItem {
  lineId: string;
  productId: string;
  name: string;
  imageUrl?: string | null;
  unitPriceCents: Cents;
  quantity: number;
  options: OrderItemOption[];
  optionsPriceCents: Cents;
  totalCents: Cents;
  vatCategory: VatCategory;
  containsAlcohol: boolean;
  /** Vente au poids ou à prix variable (absent = à l'unité). */
  saleUnit?: ProductSaleUnit;
  pricePerKgCents?: Cents | null;
  /** Poids commandé, puis poids réel pesé (grammes). */
  weightGrams?: number | null;
  actualWeightGrams?: number | null;
  /** Prix final de la ligne après pesée ou ajustement (prix variable). */
  finalTotalCents?: Cents | null;
  comment?: string | null;
  /** Remplacement ou retrait décidé en cours de préparation. */
  adjustment?: {
    type: 'removed' | 'replaced' | 'quantity_reduced';
    replacementName?: string | null;
    refundCents: Cents;
    at: Timestamp;
    by: string;
  } | null;
}

/** Montants TTC de la commande (copie du devis faisant foi). */
export interface OrderAmounts {
  subtotalCents: Cents;
  serviceFeeCents: Cents;
  smallOrderFeeCents: Cents;
  deliveryFeeCents: Cents;
  surgeFeeCents: Cents;
  discount: DiscountBreakdown;
  tipCents: Cents;
  walletAppliedCents: Cents;
  totalCents: Cents;
  /** Montant réellement débité sur le moyen de paiement (total − avoir utilisé). */
  chargedCents: Cents;
  refundedCents: Cents;
  itemsVat: VatLine[];
  currency: CurrencyCode;
}

export interface OrderPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  paymentId?: string | null;
  /** Libellé masqué affiché (« Visa ···· 4242 »). */
  label?: string | null;
  paidAt?: Timestamp | null;
}

export interface OrderDelivery {
  address: PostalAddress & { label?: string | null; details?: string | null; instructions?: string | null };
  geo: GeoPoint;
  zoneId?: string | null;
  distanceMeters: number;
  deliveredBy: 'platform' | 'restaurant';
  driverId?: string | null;
  driverName?: string | null;
  driverPhoneMasked?: string | null;
  driverVehicle?: string | null;
  /** Heure promise au client (bornes). */
  promisedFrom?: Timestamp | null;
  promisedTo?: Timestamp | null;
  estimatedArrivalAt?: Timestamp | null;
  /** Posé une fois la notification « arrivée imminente » (≈1 min avant `estimatedArrivalAt`)
   * envoyée au client, pour ne l'envoyer qu'une fois (document client « Points à corriger »,
   * App livreur #2). */
  arrivalReminderSentAt?: Timestamp | null;
  proof?: { type: 'photo' | 'code' | 'signature' | 'handover'; value?: string | null; at: Timestamp; geo?: GeoPoint | null } | null;
  /** Code à 4 chiffres pour la remise en main propre (alcool, montants élevés). */
  handoverCodeRequired: boolean;
  /** Code à 4 chiffres communiqué par le commerce au livreur à la récupération (lot 2 driver,
   * pas une exigence client écrite — mesure de bon sens documentée dans CONTRAT_MODULES.md §11).
   * Optionnel et rétrocompatible : absent sur les commandes créées avant ce champ, dans ce cas
   * `markOrderPickedUp` ne demande aucun code. */
  collectionCode?: string | null;
  collectionVerified?: boolean;
  /** Demande de livreur (manuelle ou automatique avant la fin de préparation). */
  courierRequestedAt?: Timestamp | null;
  /** État de l'attribution : recherche en cours, attribuée, aucun livreur disponible. */
  dispatchStatus?: 'searching' | 'assigned' | 'unavailable' | null;
  dispatchAttempts?: number;
  /** Tour d'attribution en cours et rayon de recherche associé (moteur avancé). */
  dispatchRound?: number;
  dispatchRadiusMeters?: number | null;
  /** Proposition en attente de réponse du livreur (mode « propositions successives »). */
  dispatchOfferId?: string | null;
  /** Bonus heure de pointe promis au livreur à la commande (zone en surcharge) : réappliqué au règlement final. */
  courierSurgeBonusCents?: number | null;
  /** Commande passée à une heure de pointe réglée (§6) : réappliqué au règlement final (`courier.peakBonusCents`). */
  courierIsPeak?: boolean;
}

/** orders/{orderId} : lisible par le client, le restaurant, le livreur assigné et les admins. */
export interface Order extends Localized {
  /** Numéro lisible, ex. GL-10482 (compteur `counters/orders`). */
  number: string;
  cityId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantGroupId?: string | null;
  customerId: string;
  customerName: string;
  customerPhoneMasked?: string | null;
  status: OrderStatus;
  fulfillment: FulfillmentMode;
  items: OrderItem[];
  itemsCount: number;
  amounts: OrderAmounts;
  payment: OrderPayment;
  promotionId?: string | null;
  promoCode?: string | null;
  delivery?: OrderDelivery | null;
  pickupCode?: string | null;
  pickupVerified: boolean;
  /** Note du client au restaurant. */
  customerNote?: string | null;
  /** Commande programmée. */
  scheduledFor?: Timestamp | null;
  /** Clôture « client absent » : sans remboursement, livreur et commerce payés. */
  closedAs?: 'customer_absent' | null;
  /** Attente du client à l'arrivée du livreur (temps d'attente, appels, clôture). */
  customerAbsence?: import('./automations').CustomerAbsence | null;
  /** Remplacements proposés au client pour un article indisponible, par ligne. */
  itemProposals?: Record<string, import('./automations').ItemProposal> | null;
  /** Date limite la plus proche parmi les propositions en attente (tâche planifiée). */
  proposalDeadline?: Timestamp | null;
  prepMinutes: number;
  prepExtendedMinutes: number;
  containsAlcohol: boolean;
  ageConfirmed: boolean;
  /** Horodatage de chaque étape (chronologie pour les litiges). */
  timeline: Partial<Record<OrderStatus, Timestamp>> & { placedAt: Timestamp };
  acceptDeadline?: Timestamp | null;
  cancellation?: {
    reason: CancelReason;
    details?: string | null;
    by: OrderActor;
    byUid?: string | null;
    at: Timestamp;
    refundCents: Cents;
    /** Part du remboursement imputée au restaurant (règles d'imputation). */
    restaurantChargeCents?: Cents;
  } | null;
  /** Indicateurs posés par Cloud Function pour le suivi et la détection d'anomalies. */
  flags: {
    late: boolean;
    lateMinutes: number;
    refunded: boolean;
    disputed: boolean;
    fraudSuspected: boolean;
    firstOrder: boolean;
  };
  reviewId?: string | null;
  ticketIds: string[];
  conversationId?: string | null;
  source: { app: 'client_ios' | 'client_android' | 'client_web' | 'admin' | 'pos'; appVersion?: string | null };
  /** Livreur assigné, au premier niveau pour les requêtes et les règles de lecture. */
  driverId?: string | null;
  searchKeywords: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Part du restaurant (estimée à la commande, recalculée à l'annulation) : visible du restaurant. */
  restaurantSettlement?: Settlement['restaurant'] | null;
  /** Taux de commission appliqué et son origine. */
  commission?: { bps: number; source: 'market' | 'city' | 'plan' | 'negotiated' | 'group' | 'subscription'; billingMode?: 'commission' | 'subscription' | 'hybrid' } | null;
  /** Identifiant d'envoi de l'app client (anti double commande). */
  clientRequestId?: string | null;
  /** Traitements déjà appliqués par les triggers (idempotence). */
  processed?: {
    salesCounted?: boolean;
    /** Commande manquée déjà comptée (pause automatique). */
    missCounted?: boolean;
    /** Avoir de retard déjà traité (crédité ou écarté). */
    lateCreditDone?: boolean;
    /** Messages automatiques déjà émis (clé = message, idempotence). */
    notified?: Record<string, boolean>;
  } | null;
  /** Commande de démonstration ou de test (simulateur). */
  test?: boolean;
}

/** orders/{orderId}/events/{eventId} : chronologie complète et historique des actions (non modifiable). */
export interface OrderEvent {
  type: OrderEventType;
  from?: OrderStatus | null;
  to?: OrderStatus | null;
  actor: OrderActor;
  actorId?: string | null;
  actorName?: string | null;
  message?: string | null;
  data?: Record<string, string | number | boolean | null> | null;
  /** Visible par le client dans son suivi. */
  visibleToCustomer: boolean;
  at: Timestamp;
}

/** orderFinancials/{orderId} : répartition complète (finance et super admin uniquement). */
export interface OrderFinancials extends Localized {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  driverId?: string | null;
  commissionBps: Bps;
  commissionSource: 'market' | 'city' | 'plan' | 'negotiated' | 'group' | 'subscription';
  settlement: Settlement;
  refunds: Array<{ refundId: string; amountCents: Cents; restaurantCents: Cents; courierCents: Cents; platformCents: Cents }>;
  /** Marge après remboursements. */
  finalMarginCents: Cents;
  restaurantPayoutId?: string | null;
  driverPayoutId?: string | null;
  deliveredAt?: Timestamp | null;
  computedAt: Timestamp;
}
