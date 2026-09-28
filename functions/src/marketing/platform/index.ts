// Croissance pilotée par le super admin : promotions, fidélité et parrainage,
// communication (envois, annonces, messages automatiques), prospection.
export { createPlatformPromotion, setPromotionStatus } from './promotions';
export { updateGrowthSettings } from './settings';
export { estimatePlatformAudience, savePlatformCampaign, sendCampaign } from './campaigns';
export { publishAnnouncement } from './announcements';
export { updateMessageTemplate } from './templates';
export { decideReferral, onFirstOrderReferral, onRestaurantActivatedReferral } from './referrals';
export { applyReferralCode, applyRestaurantReferralCode, getRestaurantReferralLink } from './referral-links';
export { decideSalesCommission, getSalesTeam, logProspectActivity, moveProspect, prospectFollowUpReminders, saveProspect } from './crm';
export { expireLoyalty, redeemLoyaltyPoints } from './loyalty';
