// Marketing du back-office restaurant : promotions, campagnes, fidélité.
export { createPromotion, updatePromotion } from './promotions';
export { cancelCampaign, dispatchScheduledCampaigns, estimateCampaignAudience, scheduleCampaign } from './campaigns';
export { saveLoyaltyProgram } from './loyalty';
