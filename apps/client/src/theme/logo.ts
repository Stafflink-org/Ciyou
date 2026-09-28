// Logo Ciyou Eats, partagé avec les back-offices : les fichiers sources vivent
// dans `packages/ui/src/assets` (déjà utilisés par apps/restaurant et
// apps/admin) — on les réutilise tels quels via un chemin relatif plutôt que
// d'en dupliquer une copie dans apps/client (une seule source d'image à jour).
// `@golink/ui` lui-même n'est pas ajouté en dépendance : ce paquet est du
// Tailwind/DOM, inutilisable par Metro pour le reste de son contenu.
export const LOGO_MARK = require('../../../../packages/ui/src/assets/logo-mark.png');
export const LOGO_FULL = require('../../../../packages/ui/src/assets/logo-full.png');
