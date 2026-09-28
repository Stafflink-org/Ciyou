// Espace de noms « common », français. Les écrans de ce lot écrivent encore
// leur texte en dur (voir la note de `../core.ts`) ; ce fichier amorce le
// socle pour les lots suivants (recherche, panier, checkout…), qui devront y
// verser leurs propres clés plutôt que du texte en dur.
export const fr = {
  errors: {
    default: 'Une erreur est survenue. Réessayez dans un instant.',
    'wrong-password': 'E-mail ou mot de passe incorrect.',
    'user-not-found': 'Aucun compte ne correspond à cet e-mail.',
    'email-already-in-use': 'Un compte existe déjà avec cet e-mail.',
    'weak-password': 'Choisissez un mot de passe d’au moins 6 caractères.',
  },
  common: {
    loading: 'Chargement…',
    retry: 'Réessayer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    seeAll: 'Voir tout',
  },
};
