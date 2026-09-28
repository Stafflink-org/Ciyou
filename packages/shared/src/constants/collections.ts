// Noms des collections Firestore. Référence unique : aucun nom de collection ne
// doit être écrit en dur ailleurs. Détail des documents : docs/SCHEMA_FIRESTORE.md.

/** Collections racine. */
export const COLLECTIONS = {
  // Plateforme et marchés
  settings: 'settings',
  settingsHistory: 'settingsHistory',
  countries: 'countries',
  cities: 'cities',
  zones: 'zones',
  surgeRules: 'surgeRules',
  featureFlags: 'featureFlags',
  integrations: 'integrations',
  appVersions: 'appVersions',
  serviceStatus: 'serviceStatus',
  incidents: 'incidents',
  counters: 'counters',
  // Affichage app client et contenus
  cuisineCategories: 'cuisineCategories',
  homeSections: 'homeSections',
  banners: 'banners',
  sponsoredPlacements: 'sponsoredPlacements',
  pages: 'pages',
  helpArticles: 'helpArticles',
  /** Catalogue des emplacements de mise en avant payante (prix, durée, capacité). */
  sponsoredOffers: 'sponsoredOffers',
  /** Termes du filtre automatique des avis (insultes, données personnelles). */
  moderationTerms: 'moderationTerms',
  /** Suivi qualité : restaurants et livreurs dont la note baisse. */
  ratingWatch: 'ratingWatch',
  // Utilisateurs
  users: 'users',
  userPrivate: 'userPrivate',
  walletTransactions: 'walletTransactions',
  loyaltyAccounts: 'loyaltyAccounts',
  loyaltyTransactions: 'loyaltyTransactions',
  referrals: 'referrals',
  // Restaurants
  restaurantGroups: 'restaurantGroups',
  restaurants: 'restaurants',
  partnerDocuments: 'partnerDocuments',
  menuIssues: 'menuIssues',
  posConnections: 'posConnections',
  // Livreurs
  drivers: 'drivers',
  driverPrivate: 'driverPrivate',
  driverLocations: 'driverLocations',
  driverSessions: 'driverSessions',
  driverSanctions: 'driverSanctions',
  driverEarnings: 'driverEarnings',
  identityChecks: 'identityChecks',
  dispatchOffers: 'dispatchOffers',
  // Commandes
  orders: 'orders',
  orderFinancials: 'orderFinancials',
  /** Réclamations des clients (photo obligatoire, contrôles automatiques). */
  orderClaims: 'orderClaims',
  // Argent
  payments: 'payments',
  refunds: 'refunds',
  ledgerEntries: 'ledgerEntries',
  payouts: 'payouts',
  payoutHolds: 'payoutHolds',
  paymentProviders: 'paymentProviders',
  cashMovements: 'cashMovements',
  referralCodes: 'referralCodes',
  invoices: 'invoices',
  taxReports: 'taxReports',
  plans: 'plans',
  subscriptions: 'subscriptions',
  commissionRules: 'commissionRules',
  // Croissance et communication
  promotions: 'promotions',
  promotionRedemptions: 'promotionRedemptions',
  campaigns: 'campaigns',
  messageTemplates: 'messageTemplates',
  notificationLogs: 'notificationLogs',
  announcements: 'announcements',
  prospects: 'prospects',
  salesCommissions: 'salesCommissions',
  // Support, avis, messagerie
  supportTickets: 'supportTickets',
  ticketReasons: 'ticketReasons',
  cannedResponses: 'cannedResponses',
  reviews: 'reviews',
  contentReports: 'contentReports',
  conversations: 'conversations',
  // Administration, sécurité, conformité
  admins: 'admins',
  adminRoles: 'adminRoles',
  adminSessions: 'adminSessions',
  auditLogs: 'auditLogs',
  securityAlerts: 'securityAlerts',
  platformAlerts: 'platformAlerts',
  internalNotes: 'internalNotes',
  savedFilters: 'savedFilters',
  impersonationSessions: 'impersonationSessions',
  bulkJobs: 'bulkJobs',
  scheduledReports: 'scheduledReports',
  fraudCases: 'fraudCases',
  blocklist: 'blocklist',
  legalDocuments: 'legalDocuments',
  legalAcceptances: 'legalAcceptances',
  gdprRequests: 'gdprRequests',
  trash: 'trash',
  backups: 'backups',
  backupRestores: 'backupRestores',
  statsDaily: 'statsDaily',
  /** File des agrégats à recalculer (ville × jour), alimentée par les écritures de commandes. */
  statsQueue: 'statsQueue',
  /** Secrets de double authentification des administrateurs (Cloud Functions uniquement). */
  adminSecrets: 'adminSecrets',
  /** Clé Azure Translator chiffrée (Cloud Functions uniquement, jamais relue par le navigateur). */
  translatorSecrets: 'translatorSecrets',
  /** Cache des traductions (clé = hash(texte+source+cible)) : ne retraduit jamais deux fois le même texte. */
  translations: 'translations',
  /** Clés Google Maps chiffrées (web + mobile), Cloud Functions uniquement (tâche « maps-settings »). */
  mapsSecrets: 'mapsSecrets',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Sous-collections, par document parent. */
export const SUBCOLLECTIONS = {
  users: {
    addresses: 'addresses',
    favorites: 'favorites',
    notifications: 'notifications',
    devices: 'devices',
    paymentMethods: 'paymentMethods',
    consents: 'consents',
  },
  restaurants: {
    private: 'private',
    settings: 'settings',
    deliveryZones: 'deliveryZones',
    sections: 'sections',
    products: 'products',
    options: 'options',
    optionGroups: 'optionGroups',
    stockMovements: 'stockMovements',
    members: 'members',
    staffRoles: 'staffRoles',
    customers: 'customers',
    couriers: 'couriers',
    dailyStats: 'dailyStats',
    announcementReads: 'announcementReads',
    /** Offres automatiques sur un plat (« 1 acheté, 1 offert », « Le 2e à -50 % »), distinctes des campagnes. */
    productOffers: 'productOffers',
    // Gestion d'entreprise
    employees: 'employees',
    employeeDocuments: 'employeeDocuments',
    availabilities: 'availabilities',
    shifts: 'shifts',
    shiftTemplates: 'shiftTemplates',
    shiftChangeRequests: 'shiftChangeRequests',
    timeEntries: 'timeEntries',
    weekValidations: 'weekValidations',
    absences: 'absences',
    payslips: 'payslips',
    tasks: 'tasks',
    taskTemplates: 'taskTemplates',
    documents: 'documents',
    staffDirectory: 'staffDirectory',
    checklistTemplates: 'checklistTemplates',
    checklistRuns: 'checklistRuns',
    // HACCP
    haccpEquipments: 'haccpEquipments',
    haccpTemperatureLogs: 'haccpTemperatureLogs',
    haccpReceptions: 'haccpReceptions',
    haccpNonConformities: 'haccpNonConformities',
    haccpCleaningTasks: 'haccpCleaningTasks',
    haccpCleaningLogs: 'haccpCleaningLogs',
    haccpPestVisits: 'haccpPestVisits',
    haccpPestReports: 'haccpPestReports',
    haccpPersonnelChecks: 'haccpPersonnelChecks',
    haccpDocuments: 'haccpDocuments',
    haccpAudits: 'haccpAudits',
    haccpExports: 'haccpExports',
    // Marketing et relation client (profil social, messages automatiques, réponses types)
    marketing: 'marketing',
    replyTemplates: 'replyTemplates',
  },
  timeEntries: { history: 'history' },
  tasks: { comments: 'comments' },
  orders: { events: 'events' },
  conversations: { messages: 'messages' },
  supportTickets: { messages: 'messages' },
  /** Historique des versions publiées d'une page d'information. */
  pages: { versions: 'versions' },
  prospects: { activities: 'activities' },
  customers: { notes: 'notes' },
} as const;

/** Documents à identifiant fixe de la collection `settings`. */
export const SETTINGS_DOCS = {
  general: 'general',
  branding: 'branding',
  orderRules: 'orderRules',
  dispatch: 'dispatch',
  payments: 'payments',
  refunds: 'refunds',
  loyalty: 'loyalty',
  referral: 'referral',
  promotions: 'promotions',
  display: 'display',
  support: 'support',
  security: 'security',
  retention: 'retention',
  maintenance: 'maintenance',
  payouts: 'payouts',
  /** Seuils des alertes par exception du tableau de bord. */
  monitoring: 'monitoring',
  /** Relances des abonnements impayés. */
  dunning: 'dunning',
  /** Mini CRM : rémunération des commerciaux, relances. */
  crm: 'crm',
  /** Garde-fous des campagnes marketing des restaurants (fréquence, plage d'envoi). */
  campaignRules: 'campaignRules',
  /** Validation automatique des commerces (décision client n° 14). */
  merchantValidation: 'merchantValidation',
  /** Envoi réel ou simulé des messages automatiques (e-mail, SMS, push). */
  notificationDelivery: 'notificationDelivery',
  /** Seuils réglables de la détection automatique de fraude (§28). */
  fraud: 'fraud',
  /** Réglages publics de la traduction automatique (Azure Translator) : jamais la clé. */
  translator: 'translator',
  /** Réglages publics de la cartographie (Google Maps) : jamais les clés (tâche « maps-settings »). */
  maps: 'maps',
  /** Limites et seuils techniques (exports, imports, alerte d'ancienneté des espèces des livreurs de commerce). */
  limits: 'limits',
} as const;
export type SettingsDocId = (typeof SETTINGS_DOCS)[keyof typeof SETTINGS_DOCS];

/** Documents à identifiant fixe de `restaurants/{rid}/settings`. */
export const RESTAURANT_SETTINGS_DOCS = {
  orders: 'orders',
  hours: 'hours',
  payments: 'payments',
  loyalty: 'loyalty',
  notifications: 'notifications',
  payroll: 'payroll',
  haccp: 'haccp',
} as const;
export type RestaurantSettingsDocId = (typeof RESTAURANT_SETTINGS_DOCS)[keyof typeof RESTAURANT_SETTINGS_DOCS];

/** Documents à identifiant fixe de `restaurants/{rid}/private`. */
export const RESTAURANT_PRIVATE_DOCS = {
  commercial: 'commercial',
  legal: 'legal',
} as const;

/** Documents à identifiant fixe de `restaurants/{rid}/marketing`. */
export const RESTAURANT_MARKETING_DOCS = {
  social: 'social',
  autoMessages: 'autoMessages',
} as const;
export type RestaurantMarketingDocId = (typeof RESTAURANT_MARKETING_DOCS)[keyof typeof RESTAURANT_MARKETING_DOCS];

/** Construction des chemins les plus utilisés. */
export const paths = {
  user: (uid: string) => `${COLLECTIONS.users}/${uid}`,
  userSub: (uid: string, sub: keyof typeof SUBCOLLECTIONS.users) => `${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.users[sub]}`,
  restaurant: (rid: string) => `${COLLECTIONS.restaurants}/${rid}`,
  restaurantSub: (rid: string, sub: keyof typeof SUBCOLLECTIONS.restaurants) =>
    `${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants[sub]}`,
  restaurantSettings: (rid: string, doc: RestaurantSettingsDocId) =>
    `${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.settings}/${doc}`,
  member: (rid: string, uid: string) => `${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.members}/${uid}`,
  order: (orderId: string) => `${COLLECTIONS.orders}/${orderId}`,
  orderEvents: (orderId: string) => `${COLLECTIONS.orders}/${orderId}/${SUBCOLLECTIONS.orders.events}`,
  conversationMessages: (id: string) => `${COLLECTIONS.conversations}/${id}/${SUBCOLLECTIONS.conversations.messages}`,
  ticketMessages: (id: string) => `${COLLECTIONS.supportTickets}/${id}/${SUBCOLLECTIONS.supportTickets.messages}`,
  settings: (doc: SettingsDocId) => `${COLLECTIONS.settings}/${doc}`,
  admin: (uid: string) => `${COLLECTIONS.admins}/${uid}`,
  /** Notes internes d'un client du restaurant (CRM). */
  customerNotes: (rid: string, uid: string) =>
    `${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.customers}/${uid}/${SUBCOLLECTIONS.customers.notes}`,
} as const;

/** Chemins Cloud Storage. */
export const STORAGE_PATHS = {
  restaurantPublic: (rid: string) => `restaurants/${rid}/public`,
  restaurantPrivate: (rid: string) => `restaurants/${rid}/private`,
  restaurantTeam: (rid: string) => `restaurants/${rid}/team`,
  driverPrivate: (uid: string) => `drivers/${uid}/private`,
  driverPublic: (uid: string) => `drivers/${uid}/public`,
  userAvatar: (uid: string) => `users/${uid}/avatar`,
  ticketAttachments: (ticketId: string) => `support/${ticketId}`,
  /** Photos jointes à une réclamation de commande (déposées par le client). */
  claimPhotos: (uid: string) => `claims/${uid}`,
  conversationAttachments: (conversationId: string) => `conversations/${conversationId}`,
  invoices: (invoiceId: string) => `invoices/${invoiceId}`,
  platformPublic: 'platform/public',
  exports: 'exports',
} as const;
