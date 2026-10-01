// Restaurants : validation, suspension, conditions commerciales, qualité.
// Les fonctions de ce module sont exportées ici et ré-exportées par src/index.ts.
export {};
export { addCustomerNote, deleteCustomerNote, setCustomerBlocked } from './customers';
export { inviteOwnCourier, updateCourier } from './couriers';
// Configuration de l'établissement (back-office restaurant, rubriques « Configuration »).
export { updateRestaurantSettings } from './settings';
export { onRestaurantSettingsWrite, resumePausedRestaurants } from './settings-sync';
export { onRestaurantProfileWritten } from './profile-audit';
export { onFeatureFlagWrite } from './feature-sync';
export { deleteDeliveryZone, saveDeliveryZone } from './zones';
export { deleteStaffRole, revokeMember, saveStaffRole, setMemberPermissions } from './members';
export { acceptPartnerContract, onDocumentUploaded, uploadDocument } from './documents';
export { applyPendingPlanChanges, changePlan } from './plan';
export { runMerchantValidationCheck, updateMerchantValidation } from './auto-validation';
export { runMerchantAutomations, runMerchantLifecycleNow } from './lifecycle';
