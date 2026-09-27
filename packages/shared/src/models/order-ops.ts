// Entrées et sorties des Cloud Functions du domaine commandes (placeOrder,
// acceptOrder, rejectOrder…), partagées par les apps et les fonctions.
import type { FulfillmentMode, PaymentMethod, PaymentStatus, OrderStatus, CancelReason } from '../constants/enums';
import type { OrderIssueCategory, OrderRejectReason } from '../constants/order-ops';
import type { Cents } from '../pricing/money';

/** Option choisie pour une ligne de panier. */
export interface CartOptionInput {
  optionId: string;
  groupId: string;
  quantity?: number;
}

/** Ligne de panier envoyée par l'app client : le prix est toujours recalculé côté serveur. */
export interface CartLineInput {
  productId: string;
  quantity: number;
  options?: CartOptionInput[];
  comment?: string | null;
}

export interface PlaceOrderInput {
  restaurantId: string;
  fulfillment: FulfillmentMode;
  lines: CartLineInput[];
  /** Adresse enregistrée du client (livraison). */
  addressId?: string | null;
  paymentMethod: PaymentMethod;
  /** Moyen de paiement Stripe (pm_…) confirmé côté serveur ; carte, Apple Pay, Google Pay. */
  paymentMethodId?: string | null;
  /** Code promo saisi ; sans code, l'offre automatique la plus avantageuse est appliquée. */
  promoCode?: string | null;
  /** Régler avec le solde d'avoirs Ciyou Eats (tout ou partie de la commande). */
  useWallet?: boolean;
  tipCents?: Cents;
  customerNote?: string | null;
  /** Commande programmée (ISO 8601). */
  scheduledFor?: string | null;
  ageConfirmed?: boolean;
  source?: 'client_ios' | 'client_android' | 'client_web';
  /** Identifiant unique généré par l'app : un double envoi renvoie la même commande. */
  clientRequestId: string;
  /**
   * Total affiché au client au moment de valider (dernier devis obtenu par l'app) : revalidé à
   * ±2 centimes avant le paiement ; au-delà, `total_changed` (§A3) sans vider le panier.
   */
  expectedTotalCents?: Cents | null;
  /** Empreinte de l'appareil (si l'app la fournit) : consultée sur la liste de blocage (§28). */
  deviceId?: string | null;
  /** Version de l'application appelante (§30, mise à jour forcée). */
  appVersion?: string | null;
}

export interface PlaceOrderResult {
  orderId: string;
  number: string;
  status: OrderStatus;
  totalCents: Cents;
  chargedCents: Cents;
  payment: {
    status: PaymentStatus;
    /** Secret à confirmer par l'app quand une authentification forte est requise. */
    clientSecret?: string | null;
  };
}

export interface AcceptOrderInput {
  orderId: string;
  /** Temps de préparation annoncé (minutes). */
  prepMinutes: number;
}

export interface RejectOrderInput {
  orderId: string;
  reason: OrderRejectReason;
  details?: string | null;
}

export interface ExtendPrepTimeInput {
  orderId: string;
  minutes: number;
}

export interface CancelOrderInput {
  orderId: string;
  reason: CancelReason;
  /** Motif détaillé, conservé dans la fiche et le journal d'audit. */
  details: string;
  /** Remise en stock des articles (par défaut oui). */
  restock?: boolean;
}

export interface CancelOrderResult {
  refundCents: Cents;
  refundId: string | null;
}

export interface ConfirmPickupInput {
  orderId: string;
  code: string;
}

export interface CompleteOrderInput {
  orderId: string;
  /** Code de remise communiqué par le client (livraisons avec code). */
  code?: string | null;
}

export interface OrderIdInput {
  orderId: string;
}

export interface AssignOwnCourierInput {
  orderId: string;
  driverId: string;
}

export interface RequestCourierResult {
  assigned: boolean;
  driverName: string | null;
  distanceMeters: number | null;
}

export interface ReportOrderIssueInput {
  orderId: string;
  category: OrderIssueCategory;
  message: string;
}

export interface ReportOrderIssueResult {
  ticketId: string;
  ticketNumber: string;
}
