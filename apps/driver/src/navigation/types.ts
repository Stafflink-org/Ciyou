// Types de navigation de l'app livreur — même schéma que
// apps/client/src/navigation/types.ts, adapté aux 4 écrans du lot 1 (Dispatch,
// Gains, Historique, Profil) et à la pile d'authentification restreinte
// (pas d'inscription en libre-service, voir auth/AuthContext.tsx).

/** Pile affichée tant que le livreur n'est pas connecté. */
export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  ForgotPassword: undefined;
};

/** Barre d'onglets du cœur de l'app (`MainTabs`). */
export type MainTabsParamList = {
  Dispatch: undefined;
  Earnings: undefined;
  History: undefined;
  Profile: undefined;
};

/** Pile principale connectée : onglets + écrans empilés (détail course…). */
export type MainStackParamList = {
  MainTabs: undefined;
  OrderDetail: { orderId: string };
  ProfileSettings: undefined;
  Gdpr: undefined;
};

/** Pile racine : bascule Auth ⇄ Main selon la session (`RootNavigator`). */
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

declare global {
  // Permet à `useNavigation()` d'inférer les routes sans générique explicite.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends MainStackParamList, AuthStackParamList {}
  }
}
