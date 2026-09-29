// Livreurs : réglages du profil (justificatifs). Le véhicule et la distance maximale
// sont écrits directement par l'app (firebase/rules/drivers.rules, self-service),
// sans Cloud Function dédiée — seul le dépôt de justificatifs (Storage + vérification)
// exige un traitement serveur.
export { uploadDriverDocument } from './documents';
