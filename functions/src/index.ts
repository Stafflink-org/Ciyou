import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';

initializeApp();

// Toutes les fonctions tournent en Europe, au plus près de la base Firestore.
setGlobalOptions({ region: 'europe-west1', maxInstances: 20 });
