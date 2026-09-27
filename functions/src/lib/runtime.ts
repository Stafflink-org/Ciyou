// Options communes à toutes les fonctions v2. Importé en premier par index.ts,
// avant toute déclaration de fonction.
import { setGlobalOptions } from 'firebase-functions/v2';
import { FIREBASE_REGION } from '@golink/shared';

// Toutes les fonctions tournent en Europe, au plus près de la base Firestore.
setGlobalOptions({ region: FIREBASE_REGION, maxInstances: 20 });
