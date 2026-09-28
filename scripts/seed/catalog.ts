// Référentiel de démonstration : villes et zones, restaurants (issus de la
// maquette, répartis entre Longwy, Metz et Luxembourg), visuels, noms.
import type { LatLng, PlanCode } from '@golink/shared';
import menusJson from './data/menus.json' with { type: 'json' };

// ------------------------------------------------------------------ Villes

export interface CitySeed {
  id: string;
  countryId: 'FR' | 'LU';
  name: string;
  postalCode: string;
  center: LatLng;
  /** Ouverte au public (commandes). */
  launched: boolean;
  /** Visible dans le super admin et ouverte aux inscriptions. */
  active: boolean;
  managerKey?: string;
}

export const CITIES: CitySeed[] = [
  { id: 'longwy', countryId: 'FR', name: 'Longwy', postalCode: '54400', center: { lat: 49.5197, lng: 5.7667 }, launched: true, active: true },
  { id: 'metz', countryId: 'FR', name: 'Metz', postalCode: '57000', center: { lat: 49.1193, lng: 6.1757 }, launched: true, active: true, managerKey: 'cityMetz' },
  { id: 'thionville', countryId: 'FR', name: 'Thionville', postalCode: '57100', center: { lat: 49.3579, lng: 6.1683 }, launched: false, active: true },
  { id: 'luxembourg', countryId: 'LU', name: 'Luxembourg', postalCode: 'L-1111', center: { lat: 49.6116, lng: 6.1319 }, launched: true, active: true },
  { id: 'esch-sur-alzette', countryId: 'LU', name: 'Esch-sur-Alzette', postalCode: 'L-4001', center: { lat: 49.4958, lng: 5.9806 }, launched: false, active: false },
];

/** Secteurs des zones : centre (disque) puis couronnes par orientation. */
export const ZONE_LAYOUT: Array<{ suffix: string; label: string; color: string; from: number; to: number } | { suffix: 'centre'; label: string; color: string }> = [
  { suffix: 'centre', label: 'Centre', color: '#e8784b' },
  { suffix: 'nord', label: 'Nord', color: '#19343b', from: -60, to: 60 },
  { suffix: 'sud-est', label: 'Sud-Est', color: '#6e9d8b', from: 60, to: 180 },
  { suffix: 'sud-ouest', label: 'Sud-Ouest', color: '#9b85ba', from: 180, to: 300 },
];

// ------------------------------------------------------------------ Restaurants

export interface RestaurantSeed {
  id: string;
  name: string;
  cityId: string;
  cuisine: string;
  cuisineIds: string[];
  description: string;
  accent: string;
  mark: string;
  rating: number;
  etaMinutes: { min: number; max: number };
  prepMinutes: number;
  address: { line1: string; postalCode: string; city: string; countryCode: 'FR' | 'LU' };
  location: LatLng;
  plan: PlanCode;
  priceLevel: 1 | 2 | 3 | 4;
  /** Commandes moyennes par jour en rythme de croisière. */
  dailyOrders: number;
  /** Profil horaire : repas (midi / soir) ou café (matinée / goûter). */
  profile: 'meals' | 'cafe';
  pickupShare: number;
  deliveredBy: 'platform' | 'restaurant' | 'both';
  cover: string;
  groupId?: string;
  sellsAlcohol?: boolean;
  negotiatedCommissionBps?: number;
  status?: 'active' | 'onboarding';
}

export const RESTAURANTS: RestaurantSeed[] = [
  {
    id: 'mina-kitchen', name: 'Mina Kitchen', cityId: 'longwy', cuisine: 'Levantine · Cuisine levantine', cuisineIds: ['libanais', 'mediterraneen'],
    description: 'Une cuisine levantine généreuse, faite maison avec des produits de saison.', accent: '#e8784b', mark: 'MK', rating: 4.8,
    etaMinutes: { min: 22, max: 32 }, prepMinutes: 18, address: { line1: '8 Place Darche', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
    location: { lat: 49.5214, lng: 5.7629 }, plan: 'pro', priceLevel: 2, dailyOrders: 9, profile: 'meals', pickupShare: 0.18, deliveredBy: 'platform',
    cover: '1599487488170-d11ec9c172f0', groupId: 'maison-haddad',
  },
  {
    id: 'onda-pasta-club', name: 'Onda Pasta Club', cityId: 'metz', cuisine: 'Italienne · Pâtes fraîches', cuisineIds: ['italien', 'pates'],
    description: 'Pâtes fraîches façonnées chaque matin et recettes inspirées de l’Italie.', accent: '#e2b84d', mark: 'OP', rating: 4.7,
    etaMinutes: { min: 28, max: 38 }, prepMinutes: 20, address: { line1: '14 Rue Taison', postalCode: '57000', city: 'Metz', countryCode: 'FR' },
    location: { lat: 49.1196, lng: 6.176 }, plan: 'pro', priceLevel: 2, dailyOrders: 8, profile: 'meals', pickupShare: 0.2, deliveredBy: 'platform',
    cover: '1621996346565-e3dbc646d9a9', groupId: 'maison-haddad', sellsAlcohol: true,
  },
  {
    id: 'kumo-ramen', name: 'Kumo Ramen', cityId: 'luxembourg', cuisine: 'Japonaise · Ramen', cuisineIds: ['japonais', 'ramen'],
    description: 'Bouillons mijotés longuement, nouilles fraîches et garnitures maison.', accent: '#6e9d8b', mark: 'KR', rating: 4.9,
    etaMinutes: { min: 18, max: 28 }, prepMinutes: 15, address: { line1: '18 Rue de la Poste', postalCode: 'L-2346', city: 'Luxembourg', countryCode: 'LU' },
    location: { lat: 49.6109, lng: 6.1296 }, plan: 'premium', priceLevel: 2, dailyOrders: 10, profile: 'meals', pickupShare: 0.15, deliveredBy: 'platform',
    cover: '1569718212165-3a8278d5f624', negotiatedCommissionBps: 2200,
  },
  {
    id: 'lune-coffee', name: 'Lune Coffee', cityId: 'longwy', cuisine: 'Café · Brunch', cuisineIds: ['cafe', 'brunch'],
    description: 'Café de spécialité, douceurs artisanales et brunch toute la journée.', accent: '#9b85ba', mark: 'LC', rating: 4.6,
    etaMinutes: { min: 15, max: 25 }, prepMinutes: 10, address: { line1: '27 Avenue de Saintignon', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
    location: { lat: 49.5176, lng: 5.77 }, plan: 'basic', priceLevel: 2, dailyOrders: 5, profile: 'cafe', pickupShare: 0.35, deliveredBy: 'platform',
    cover: '1484723091739-30a097e8f929', groupId: 'maison-haddad',
  },
  {
    id: 'beldi-bowls', name: 'Beldi Bowls', cityId: 'luxembourg', cuisine: 'Marocaine · Bowls', cuisineIds: ['marocain', 'healthy'],
    description: 'Des bols colorés aux épices douces, légumes du marché et céréales bio.', accent: '#c87c62', mark: 'BB', rating: 4.8,
    etaMinutes: { min: 25, max: 35 }, prepMinutes: 15, address: { line1: '45 Avenue de la Gare', postalCode: 'L-1611', city: 'Luxembourg', countryCode: 'LU' },
    location: { lat: 49.604, lng: 6.134 }, plan: 'pro', priceLevel: 2, dailyOrders: 6, profile: 'meals', pickupShare: 0.2, deliveredBy: 'platform',
    cover: '1546069901-ba9599a7e63c',
  },
  {
    id: 'santo-smash', name: 'Santo Smash', cityId: 'metz', cuisine: 'Américaine · Burgers', cuisineIds: ['burgers', 'americain'],
    description: 'Burgers smashés minute, viande française et pommes de terre croustillantes.', accent: '#577b90', mark: 'SS', rating: 4.5,
    etaMinutes: { min: 30, max: 40 }, prepMinutes: 15, address: { line1: '22 Rue Serpenoise', postalCode: '57000', city: 'Metz', countryCode: 'FR' },
    location: { lat: 49.1171, lng: 6.1735 }, plan: 'basic', priceLevel: 2, dailyOrders: 8, profile: 'meals', pickupShare: 0.15, deliveredBy: 'platform',
    cover: '1568901346375-23c9450c58cd',
  },
  {
    id: 'nami-sushi-bar', name: 'Nami Sushi Bar', cityId: 'luxembourg', cuisine: 'Japonaise · Sushi', cuisineIds: ['japonais', 'sushi'],
    description: 'Sushis et makis préparés à la commande avec du poisson soigneusement choisi.', accent: '#d58f9d', mark: 'NS', rating: 4.9,
    etaMinutes: { min: 35, max: 45 }, prepMinutes: 22, address: { line1: '7 Grand-Rue', postalCode: 'L-1661', city: 'Luxembourg', countryCode: 'LU' },
    location: { lat: 49.6114, lng: 6.1291 }, plan: 'premium', priceLevel: 3, dailyOrders: 8, profile: 'meals', pickupShare: 0.2, deliveredBy: 'platform',
    cover: '1579871494447-9811cf80d66c', sellsAlcohol: true,
  },
  {
    id: 'rue-12-bakery', name: 'Rue 12 Bakery', cityId: 'longwy', cuisine: 'Boulangerie · Pâtisserie', cuisineIds: ['boulangerie', 'desserts'],
    description: 'Pains au levain, viennoiseries pur beurre et pâtisseries du jour.', accent: '#c39d6b', mark: 'R12', rating: 4.7,
    etaMinutes: { min: 20, max: 30 }, prepMinutes: 8, address: { line1: '12 Rue Stanislas', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
    location: { lat: 49.519, lng: 5.7655 }, plan: 'basic', priceLevel: 1, dailyOrders: 4, profile: 'cafe', pickupShare: 0.4, deliveredBy: 'platform',
    cover: '1509440159596-0249088772ff',
  },
  {
    id: 'casa-arepa', name: 'Casa Arepa', cityId: 'longwy', cuisine: 'Vénézuélienne · Street food', cuisineIds: ['street-food', 'latino'],
    description: 'Arepas dorées et garnies, inspirées des recettes familiales vénézuéliennes.', accent: '#d77c4d', mark: 'CA', rating: 4.8,
    etaMinutes: { min: 25, max: 35 }, prepMinutes: 15, address: { line1: '41 Avenue du 8 Mai 1945', postalCode: '54400', city: 'Longwy', countryCode: 'FR' },
    location: { lat: 49.5205, lng: 5.772 }, plan: 'basic', priceLevel: 1, dailyOrders: 5, profile: 'meals', pickupShare: 0.2, deliveredBy: 'both',
    cover: '1529006557810-274b9b2fc783',
  },
  {
    id: 'le-petit-pho', name: 'Le Petit Pho', cityId: 'metz', cuisine: 'Vietnamienne · Cuisine maison', cuisineIds: ['vietnamien', 'asiatique'],
    description: 'Cuisine vietnamienne parfumée, herbes fraîches et bouillons cuits maison.', accent: '#5e9b83', mark: 'PF', rating: 4.7,
    etaMinutes: { min: 24, max: 34 }, prepMinutes: 15, address: { line1: '9 Place Saint-Louis', postalCode: '57000', city: 'Metz', countryCode: 'FR' },
    location: { lat: 49.118, lng: 6.1789 }, plan: 'pro', priceLevel: 2, dailyOrders: 6, profile: 'meals', pickupShare: 0.18, deliveredBy: 'platform',
    cover: '1582878826629-29b7ad1cdc43',
  },
];

/** Inscriptions récentes en attente de validation (file « à traiter » du super admin). */
export const PENDING_RESTAURANTS: RestaurantSeed[] = [
  {
    id: 'maison-pita', name: 'Maison Pita', cityId: 'thionville', cuisine: 'Grecque · Pitas', cuisineIds: ['grec', 'street-food'],
    description: 'Pitas garnies, souvlakis et mezze grecs faits minute.', accent: '#4f7cac', mark: 'MP', rating: 0,
    etaMinutes: { min: 25, max: 35 }, prepMinutes: 15, address: { line1: '16 Rue de Paris', postalCode: '57100', city: 'Thionville', countryCode: 'FR' },
    location: { lat: 49.3576, lng: 6.1655 }, plan: 'basic', priceLevel: 1, dailyOrders: 0, profile: 'meals', pickupShare: 0.2, deliveredBy: 'platform',
    cover: '1623855244183-52fd8d3ce2f7', status: 'onboarding',
  },
  {
    id: 'brasserie-des-remparts', name: 'Brasserie des Remparts', cityId: 'metz', cuisine: 'Française · Brasserie', cuisineIds: ['francais'],
    description: 'Cuisine de brasserie lorraine, plats du jour et desserts maison.', accent: '#8a5a44', mark: 'BR', rating: 0,
    etaMinutes: { min: 30, max: 45 }, prepMinutes: 25, address: { line1: '5 Rue des Remparts', postalCode: '57000', city: 'Metz', countryCode: 'FR' },
    location: { lat: 49.1215, lng: 6.1702 }, plan: 'pro', priceLevel: 3, dailyOrders: 0, profile: 'meals', pickupShare: 0.2, deliveredBy: 'platform',
    cover: '1600891964599-f61ba0e24092', status: 'onboarding',
  },
];

export const CUISINES: Array<{ id: string; name: string; icon: string }> = [
  { id: 'libanais', name: 'Libanais', icon: 'utensils' },
  { id: 'mediterraneen', name: 'Méditerranéen', icon: 'leaf' },
  { id: 'italien', name: 'Italien', icon: 'pizza' },
  { id: 'pates', name: 'Pâtes', icon: 'utensils-crossed' },
  { id: 'japonais', name: 'Japonais', icon: 'fish' },
  { id: 'ramen', name: 'Ramen', icon: 'soup' },
  { id: 'sushi', name: 'Sushi', icon: 'fish' },
  { id: 'cafe', name: 'Café', icon: 'coffee' },
  { id: 'brunch', name: 'Brunch', icon: 'egg-fried' },
  { id: 'marocain', name: 'Marocain', icon: 'flame' },
  { id: 'healthy', name: 'Healthy', icon: 'salad' },
  { id: 'burgers', name: 'Burgers', icon: 'beef' },
  { id: 'americain', name: 'Américain', icon: 'sandwich' },
  { id: 'boulangerie', name: 'Boulangerie', icon: 'croissant' },
  { id: 'desserts', name: 'Desserts', icon: 'cake-slice' },
  { id: 'street-food', name: 'Street food', icon: 'sandwich' },
  { id: 'latino', name: 'Latino', icon: 'flame' },
  { id: 'vietnamien', name: 'Vietnamien', icon: 'soup' },
  { id: 'asiatique', name: 'Asiatique', icon: 'soup' },
  { id: 'grec', name: 'Grec', icon: 'utensils' },
  { id: 'francais', name: 'Français', icon: 'chef-hat' },
];

// ------------------------------------------------------------------ Menus

export interface MenuSeed {
  sections: Array<{ name: string }>;
  optionGroups: Array<{
    key: string;
    name: string;
    min: number;
    max: number;
    multiple: boolean;
    options: Array<{ key: string; name: string; priceCents: number }>;
  }>;
  products: Array<{
    key: string;
    name: string;
    section: string;
    priceCents: number;
    stock: number | null;
    description: string;
    groups: string[];
    vat: 'food' | 'soft_drink';
  }>;
}

export const MENUS = menusJson as Record<string, MenuSeed>;

/** Menus courts des restaurants en cours d'inscription. */
export const PENDING_MENUS: Record<string, MenuSeed> = {
  'maison-pita': {
    sections: [{ name: 'Pitas' }, { name: 'Accompagnements' }, { name: 'Boissons' }],
    optionGroups: [],
    products: [
      { key: 'p1', name: 'Pita souvlaki poulet', section: 'Pitas', priceCents: 950, stock: null, description: 'Poulet mariné, tzatziki, tomate, oignon et frites.', groups: [], vat: 'food' },
      { key: 'p2', name: 'Pita gyros porc', section: 'Pitas', priceCents: 990, stock: null, description: 'Gyros grillé, tzatziki et oignons rouges.', groups: [], vat: 'food' },
      { key: 'p3', name: 'Frites à l’origan', section: 'Accompagnements', priceCents: 400, stock: null, description: 'Frites maison, feta émiettée et origan.', groups: [], vat: 'food' },
      { key: 'p4', name: 'Limonade grecque', section: 'Boissons', priceCents: 350, stock: null, description: 'Citron pressé et menthe.', groups: [], vat: 'soft_drink' },
    ],
  },
  'brasserie-des-remparts': {
    sections: [{ name: 'Plats' }, { name: 'Desserts' }],
    optionGroups: [],
    products: [
      { key: 'p1', name: 'Quiche lorraine et salade', section: 'Plats', priceCents: 1450, stock: null, description: 'Quiche maison, salade verte et vinaigrette à la moutarde.', groups: [], vat: 'food' },
      { key: 'p2', name: 'Bouchée à la reine', section: 'Plats', priceCents: 1790, stock: null, description: 'Feuilleté, volaille, champignons et sauce crémée.', groups: [], vat: 'food' },
      { key: 'p3', name: 'Tarte aux mirabelles', section: 'Desserts', priceCents: 690, stock: null, description: 'Mirabelles de Lorraine sur pâte sablée.', groups: [], vat: 'food' },
    ],
  },
};

// ------------------------------------------------------------------ Visuels

/** Photo Unsplash (licence libre), recadrée. */
export function unsplash(id: string, width: number, height: number): string {
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&fit=crop&q=80&auto=format`;
}

/** Photos de plats associées par mots-clés (vérifiées une à une). */
const PRODUCT_PHOTOS: Array<[RegExp, string]> = [
  [/ramen|miso|shoyu/i, '1569718212165-3a8278d5f624'],
  [/pho|bún|bo bun|soupe/i, '1582878826629-29b7ad1cdc43'],
  [/yakisoba|nouilles/i, '1585032226651-759b368d7246'],
  [/sushi|maki|nigiri|california|plateau|sashimi|chirashi/i, '1579871494447-9811cf80d66c'],
  [/burger|smash/i, '1568901346375-23c9450c58cd'],
  [/frites|patacones|onion/i, '1573080496219-bb080dd4f877'],
  [/tagliatelle|rigatoni|ravioli|gnocchi|lasagne|pâtes/i, '1621996346565-e3dbc646d9a9'],
  [/bowl|couscous|quinoa/i, '1546069901-ba9599a7e63c'],
  [/salade|taboulé|fattouche/i, '1607330289024-1535c6b4e1c1'],
  [/kefta|brochette|chawarma|poulet za/i, '1599487488170-d11ec9c172f0'],
  [/wrap|arepa|bánh mì|pita/i, '1631515243349-e0cb75fb8d3a'],
  [/cookie/i, '1558961363-fa8fdf82db35'],
  [/pancake|brioche|tartine|œufs|granola/i, '1484723091739-30a097e8f929'],
  [/cappuccino|flat white|café/i, '1495474472287-4d71bcdd2085'],
  [/baguette|pain de campagne|pain/i, '1509440159596-0249088772ff'],
  [/riz/i, '1603133872878-684f208fb84b'],
];

export function productPhoto(name: string): string | null {
  const match = PRODUCT_PHOTOS.find(([pattern]) => pattern.test(name));
  return match ? match[1] : null;
}

export const BANNER_PHOTOS = ['1504674900247-0877df9cc836', '1540189549336-e6e99c3679fe', '1555396273-367ea4eb4db5', '1414235077428-338989a2e8c0'];

// ------------------------------------------------------------------ Noms

export const FIRST_NAMES = [
  'Camille', 'Yanis', 'Zoé', 'Thomas', 'Léa', 'Hugo', 'Inès', 'Lucas', 'Chloé', 'Nathan', 'Manon', 'Adam', 'Sarah', 'Louis',
  'Emma', 'Gabriel', 'Jade', 'Raphaël', 'Louise', 'Arthur', 'Alice', 'Jules', 'Lina', 'Noah', 'Rose', 'Mohamed', 'Anna',
  'Ethan', 'Julia', 'Sacha', 'Nora', 'Théo', 'Mila', 'Paul', 'Lou', 'Karim', 'Amel', 'Sofiane', 'Clara', 'Maxime', 'Elsa',
  'Luca', 'Maëlle', 'Kevin', 'Sophie', 'Marc', 'Laura', 'Julien', 'Aurélie', 'Nicolas', 'Pedro', 'Ana', 'Mateus', 'Joana',
];

export const LAST_NAMES = [
  'Dubois', 'Benali', 'Martin', 'Leroy', 'Bernard', 'Petit', 'Durand', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre',
  'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Muller',
  'Schmit', 'Weber', 'Hoffmann', 'Wagner', 'Klein', 'Da Silva', 'Pereira', 'Ferreira', 'Rodrigues', 'Haddad', 'Mansour',
  'Diallo', 'Traoré', 'Nguyen', 'Tran', 'Rossi', 'Colin', 'Mercier', 'Blanc', 'Guerin', 'Faure', 'Andre', 'Kieffer', 'Reding',
];

/** Rues par ville pour les adresses des clients. */
export const STREETS: Record<string, string[]> = {
  longwy: ['Rue de Metz', 'Avenue de Saintignon', 'Rue Stanislas', 'Rue du Général Leclerc', 'Rue de la Chiers', 'Rue Carnot', 'Rue de Lorraine', 'Rue des Récollets'],
  metz: ['Rue Serpenoise', 'Rue des Clercs', 'Rue Taison', 'Avenue Foch', 'Rue Mazelle', 'Rue du Pont des Morts', 'Rue Mozart', 'Boulevard Paixhans'],
  luxembourg: ['Avenue de la Liberté', 'Rue de Hollerich', 'Boulevard Royal', 'Rue de Strasbourg', 'Avenue Pasteur', 'Rue du Fossé', 'Route d’Arlon', 'Rue de Bonnevoie'],
};
