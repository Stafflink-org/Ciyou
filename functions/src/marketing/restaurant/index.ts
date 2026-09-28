// Marketing du back-office restaurant : promotions, campagnes, fidélité.
export { createPromotion, updatePromotion } from './promotions';
export { saveProductOffer, toggleProductOffer, deleteProductOffer } from './offers';
export { cancelCampaign, dispatchScheduledCampaigns, estimateCampaignAudience, scheduleCampaign } from './campaigns';
export { saveLoyaltyProgram } from './loyalty';
