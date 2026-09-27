// Socle : comptes, rôles et claims, invitations, inscription des restaurants.
export { onUserCreate, setUserRole } from './users';
export { onAdminWrite, onAdminRoleWrite, onMemberWrite } from './claims-sync';
export { acceptInvitation, inviteAdmin, inviteRestaurantMember } from './invitations';
export { restaurantSignup } from './signup';
