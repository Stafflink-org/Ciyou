// Types de navigation — reflètent le schéma de client.md §18.2 (pile racine,
// pile d'authentification, onglets principaux). Un seul fichier de types pour
// que les lots suivants ajoutent leurs paramètres d'écran sans dupliquer la
// structure.

/** Pile affichée tant que l'utilisateur n'est pas connecté (§18.1, §18.2). */
export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  VerifyCode: undefined;
};

/** Barre d'onglets du cœur de l'app (`MainTabs`). */
export type MainTabsParamList = {
  Home: undefined;
  Search: { query?: string; foodType?: string; kind?: string; category?: string } | undefined;
  Orders: undefined;
  Favorites: undefined;
  Profile: undefined;
};

/** Pile principale connectée : onglets + écrans empilés (fiche, panier, tunnel…). */
export type MainStackParamList = {
  MainTabs: undefined;
  Restaurant: { restaurantId: string };
  Product: { productId: string; restaurantId: string; lineId?: string };
  Cart: undefined;
  Checkout: undefined;
  Confirmation: { orderId: string };
  Tracking: { orderId: string };
  OrderDetail: { orderId: string };
  Notifications: undefined;
  Addresses: undefined;
  AddressForm: { addressId?: string } | undefined;
  Promotions: undefined;
  EditProfile: undefined;
  PaymentMethods: undefined;
  Help: undefined;
  RateOrder: { orderId: string };
  Support: { orderId?: string } | undefined;
  TicketDetail: { ticketId: string };
  Referral: undefined;
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
