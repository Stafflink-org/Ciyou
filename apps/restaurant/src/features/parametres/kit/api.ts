// Appels serveur des rubriques de configuration (Cloud Functions du domaine restaurant).
import type {
  LatLng,
  MerchantType,
  PlanCode,
  RestaurantAlertKey,
  RestaurantNotificationSound,
  RestaurantPermission,
  StaffRole,
  TimeRange,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';

type WithRestaurant<T> = T & { restaurantId: string };

export interface ProfileInput {
  section: 'profile';
  name?: string;
  description: string | null;
  phone: string;
  email: string;
  merchantType?: MerchantType;
  cuisineIds: string[];
  tags: string[];
  priceLevel: 1 | 2 | 3 | 4;
  labels: string[];
  allergenNotice: string | null;
}

export interface AddressInput {
  section: 'address';
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  location: LatLng;
  placeId: string | null;
}

export interface LegalInput {
  section: 'legal';
  legalName: string;
  legalForm: string | null;
  siret: string;
  vatNumber: string | null;
  rcsCity: string | null;
  shareCapitalCents: number | null;
  registeredAddress: { line1: string; line2: string | null; postalCode: string; city: string };
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  managerBirthDate: string | null;
  alcoholLicenseNumber: string | null;
  taxIdentificationNumber: string | null;
}

export interface OrdersInput {
  section: 'orders';
  prepMinutes: number;
  maxConcurrentOrders: number;
  minOrderCents: number;
  delivery: boolean;
  pickup: boolean;
  dineIn: boolean;
  autoAccept: boolean;
  autoPrint: boolean;
  scheduledOrders: boolean;
  scheduledLeadMinutes: number;
  scheduledMaxDays: number;
  pickupInstructions: string | null;
  dineInInstructions: string | null;
  deliveredBy: 'platform' | 'restaurant' | 'both';
}

export interface HoursInput {
  section: 'hours';
  days: Array<{ day: number; open: boolean; slots: TimeRange[] }>;
  exceptions: Array<{ date: string; closed: boolean; slots?: TimeRange[]; label: string | null }>;
}

export interface PaymentsInput {
  section: 'payments';
  online: boolean;
  onDelivery: boolean;
  onPickup: boolean;
  methods: { card: boolean; apple_pay: boolean; google_pay: boolean; cash: boolean; meal_voucher: boolean };
}

export interface NotificationsInput {
  section: 'notifications';
  newOrderSound: boolean;
  sound: RestaurantNotificationSound;
  volume: number;
  repeatUntilAccepted: boolean;
  emailDailySummary: boolean;
  emailWeeklyReport: boolean;
  emailInvoices: boolean;
  emailRecipients: string[];
  smsOnNewOrder: boolean;
  smsNumbers: string[];
  alerts: Record<RestaurantAlertKey, { inApp: boolean; email: boolean }>;
}

export interface PauseInput {
  section: 'pause';
  minutes: number | null;
  reason: string | null;
}

export type SettingsInput = WithRestaurant<
  ProfileInput | AddressInput | LegalInput | OrdersInput | HoursInput | PaymentsInput | NotificationsInput | PauseInput
>;

export const updateRestaurantSettings = callFunction<SettingsInput, { section: string; changed: string[] }>('updateRestaurantSettings');

export interface ZoneInput {
  restaurantId: string;
  zoneId?: string;
  name: string;
  type: 'radius' | 'polygon';
  radiusMeters: number | null;
  polygon: LatLng[] | null;
  feeCents: number;
  minOrderCents: number | null;
  freeAboveCents: number | null;
  deliveryMinutes: number | null;
  enabled: boolean;
  color: string;
  order?: number;
}

export const saveDeliveryZone = callFunction<ZoneInput, { zoneId: string }>('saveDeliveryZone');
export const deleteDeliveryZone = callFunction<{ restaurantId: string; zoneId: string }, { deleted: boolean }>('deleteDeliveryZone');

export interface InviteInput {
  restaurantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Exclude<StaffRole, 'owner'>;
  customRoleId?: string;
}

export const inviteRestaurantMember = callFunction<InviteInput, { uid: string; newAccount: boolean; emailSent: boolean }>('inviteRestaurantMember');

export const setMemberPermissions = callFunction<
  {
    restaurantId: string;
    uid: string;
    role: Exclude<StaffRole, 'owner'>;
    customRoleId?: string | null;
    permissions?: RestaurantPermission[] | null;
    reactivate?: boolean;
  },
  { role: StaffRole; permissions: RestaurantPermission[] }
>('setMemberPermissions');

export const revokeMember = callFunction<{ restaurantId: string; uid: string; reason: string }, { revoked: boolean }>('revokeMember');

export const saveStaffRole = callFunction<
  { restaurantId: string; roleId?: string; name: string; description: string | null; permissions: RestaurantPermission[] },
  { roleId: string; membersUpdated: number }
>('saveStaffRole');

export const deleteStaffRole = callFunction<{ restaurantId: string; roleId: string }, { deleted: boolean }>('deleteStaffRole');

export const uploadDocument = callFunction<
  {
    restaurantId: string;
    type: string;
    storagePath: string;
    fileName: string;
    number: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
  },
  { documentId: string }
>('uploadDocument');

export const acceptPartnerContract = callFunction<
  { restaurantId: string; documentId: string; signatureName: string; accept: true },
  { version: string }
>('acceptPartnerContract');

export const changePlan = callFunction<
  { restaurantId: string; planCode: PlanCode; reason: string | null },
  { status: 'applied' | 'scheduled' | 'cancelled'; planCode: PlanCode; effectiveAt: number | null; trial: boolean }
>('changePlan');

export const createConnectAccountSession = callFunction<{ restaurantId: string }, { clientSecret: string; expiresAt: number }>(
  'createConnectAccountSession',
);
export const refreshConnectAccountStatus = callFunction<{ restaurantId: string }, { status: 'pending' | 'restricted' | 'enabled' | null }>(
  'refreshConnectAccountStatus',
);
