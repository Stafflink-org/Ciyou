// Cloud Functions des rubriques Croissance (domaine marketing).
import type {
  CampaignChannel,
  CampaignSettings,
  CampaignStatus,
  CrmSettings,
  FulfillmentMode,
  LoyaltySettings,
  PlanCode,
  PromotionFunding,
  PromotionKind,
  PromotionScope,
  PromotionSettings,
  PromotionStatus,
  PromotionTarget,
  ProspectStage,
  ReferralSettings,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

type Values<T> = Omit<T, 'updatedAt' | 'updatedBy'>;

export interface PromotionInput {
  promotionId?: string | null;
  scope: PromotionScope;
  countryId: string | null;
  cityIds: string[];
  restaurantIds: string[];
  title: string;
  description: string | null;
  code: string | null;
  kind: PromotionKind;
  value: number;
  maxDiscountCents: number | null;
  minSubtotalCents: number;
  funding: PromotionFunding;
  restaurantShareBps: number | null;
  target: PromotionTarget;
  inactiveDays: number | null;
  modes: FulfillmentMode[];
  totalUsageLimit: number | null;
  perCustomerLimit: number;
  startsAt: number;
  endsAt: number | null;
  showcase: boolean;
  publish: boolean;
}

export const createPlatformPromotion = callFunctionWithReason<PromotionInput, { promotionId: string; status: PromotionStatus }>('createPlatformPromotion', { title: 'Enregistrer l’offre', description: 'Remise financée par la plateforme : indiquez le motif.' });

export type PromotionAction = 'approve' | 'reject' | 'pause' | 'resume' | 'end';
export const setPromotionStatus = callFunction<{ promotionId: string; action: PromotionAction; reason?: string | null }, { promotionId: string; status: PromotionStatus }>(
  'setPromotionStatus',
);

export type GrowthSettingsInput =
  | { section: 'promotions'; values: Omit<Values<PromotionSettings>, 'capsEnabled'> & { capsEnabled: boolean }; reason: string }
  | { section: 'loyalty'; values: Required<Values<LoyaltySettings>>; reason: string }
  | { section: 'referral'; values: Values<ReferralSettings>; reason: string }
  | { section: 'crm'; values: Values<CrmSettings>; reason: string }
  | { section: 'campaignRules'; values: Values<CampaignSettings>; reason: string };
export const updateGrowthSettings = callFunction<GrowthSettingsInput, { section: string }>('updateGrowthSettings');

export interface AudienceInput {
  userType: 'client' | 'restaurant' | 'driver';
  countryIds: string[] | null;
  cityIds: string[] | null;
  planCodes: PlanCode[] | null;
  restaurantIds: string[] | null;
  segment: 'all' | 'new' | 'inactive' | 'loyal';
  inactiveDays: number | null;
  marketing: boolean;
}

export const estimatePlatformAudience = callFunction<{ channel: CampaignChannel; audience: AudienceInput }, { matched: number; reachable: number }>(
  'estimatePlatformAudience',
);

export interface CampaignInput {
  campaignId?: string | null;
  mode: 'draft' | 'schedule' | 'send_now' | 'test' | 'cancel';
  name: string;
  channel: CampaignChannel;
  title: string;
  body: string;
  emailSubject: string | null;
  link: { type: 'restaurant' | 'promotion' | 'page' | 'url'; target: string } | null;
  audience: AudienceInput;
  scheduledAt: number | null;
}
export interface CampaignStats {
  targeted: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}
export const savePlatformCampaign = callFunctionWithReason<CampaignInput, { campaignId: string | null; status: CampaignStatus; stats: CampaignStats }>('savePlatformCampaign', { title: 'Programmer, envoyer ou annuler cet envoi', description: 'Envoi de masse : le motif est conservé dans le journal d’audit.' }, (input) => input.mode === 'draft' || input.mode === 'test');

export type AnnouncementInput =
  | {
      action: 'save';
      announcementId?: string | null;
      audience: 'restaurants' | 'drivers';
      countryIds: string[] | null;
      cityIds: string[] | null;
      planCodes: PlanCode[] | null;
      title: string;
      body: string;
      severity: 'info' | 'important' | 'maintenance';
      link: string | null;
      publishAt: number | null;
      expiresAt: number | null;
      requiresAcknowledgement: boolean;
    }
  | { action: 'archive'; announcementId: string; reason: string };
export const publishAnnouncement = callFunction<AnnouncementInput, { announcementId: string }>('publishAnnouncement');

export interface TemplateInput {
  key: string;
  active: boolean;
  channels: Array<'push' | 'email' | 'sms' | 'in_app'>;
  subject: string | null;
  title: string;
  body: string;
}
export const updateMessageTemplate = callFunctionWithReason<TemplateInput, { key: string }>('updateMessageTemplate', { title: 'Modifier ce message automatique' });

export const decideReferral = callFunction<{ referralId: string; decision: 'reject' | 'mark_paid'; reason: string }, { referralId: string }>('decideReferral');

export interface ProspectInput {
  prospectId?: string | null;
  name: string;
  countryId: string;
  cityId: string;
  cuisine: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  source: 'field' | 'inbound' | 'referral' | 'event' | 'import' | 'other';
  ownerId: string;
  estimatedMonthlyOrders: number | null;
  nextFollowUpAt: number | null;
  notes: string | null;
}
export const saveProspect = callFunction<ProspectInput, { prospectId: string }>('saveProspect');
export const moveProspect = callFunction<
  { prospectId: string; toStage: ProspectStage; summary?: string | null; lostReason?: string | null; restaurantId?: string | null; nextFollowUpAt?: number | null },
  { prospectId: string; stage: ProspectStage }
>('moveProspect');
export const logProspectActivity = callFunction<
  { prospectId: string; type: 'call' | 'email' | 'visit' | 'demo' | 'note'; summary: string; nextFollowUpAt: number | null },
  { prospectId: string }
>('logProspectActivity');

export interface SalesRep {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  cityIds: string[];
}
export const getSalesTeam = callFunction<Record<string, never>, { reps: SalesRep[] }>('getSalesTeam');
export const decideSalesCommission = callFunction<{ commissionId: string; decision: 'approve' | 'pay' | 'cancel'; reason?: string | null }, { commissionId: string }>(
  'decideSalesCommission',
);
