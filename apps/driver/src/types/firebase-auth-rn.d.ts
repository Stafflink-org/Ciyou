// Complément de types pour `@firebase/auth` : `getReactNativePersistence` existe
// bien à l'exécution sur la condition d'export « react-native » du paquet
// (`dist/rn/index.rn.d.ts`), mais la condition « types » du package.json de
// `@firebase/auth` est résolue en premier par TypeScript (ordre des clés de
// `exports`) et pointe vers `auth-public.d.ts`, qui ne déclare pas cette
// fonction spécifique à React Native. Ce fichier complète la déclaration du
// module (fusion de déclarations) plutôt que de contourner le typage avec
// `@ts-ignore` dans `lib/firebase.ts`. Copie fidèle de
// apps/client/src/types/firebase-auth-rn.d.ts.
import type { Persistence } from '@firebase/auth';

declare module '@firebase/auth' {
  export function getReactNativePersistence(storage: unknown): Persistence;
}
