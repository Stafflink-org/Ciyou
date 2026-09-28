import {
  AlertTriangle,
  BarChart3,
  Bike,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChefHat,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  FileText,
  Gauge,
  Gift,
  Globe2,
  Headphones,
  HeartPulse,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  Megaphone,
  MessageSquare,
  Percent,
  Plug,
  Receipt,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  Target,
  ToggleRight,
  UserCog,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import type { NavGroup } from '@golink/ui';

// Données fictives de la vitrine du kit (développement uniquement).

export const adminNav: NavGroup[] = [
  {
    id: 'pilotage',
    label: 'Pilotage',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', href: '#', icon: <LayoutDashboard /> },
      { id: 'analytics', label: 'Analytics', href: '#', icon: <BarChart3 /> },
      { id: 'reports', label: 'Rapports & exports', href: '#', icon: <FileText /> },
    ],
  },
  {
    id: 'reseau',
    label: 'Réseau',
    items: [
      { id: 'restaurants', label: 'Restaurants', href: '#', icon: <Store />, badge: 12 },
      { id: 'drivers', label: 'Livreurs', href: '#', icon: <Bike />, badge: 5 },
      { id: 'customers', label: 'Clients', href: '#', icon: <Users /> },
    ],
  },
  {
    id: 'operations',
    label: 'Opérations',
    items: [
      { id: 'orders', label: 'Commandes', href: '#', icon: <ClipboardList /> },
      { id: 'rules', label: 'Règles automatiques', href: '#', icon: <Workflow /> },
      { id: 'zones', label: 'Zones & villes', href: '#', icon: <MapIcon /> },
      { id: 'display', label: 'Affichage app client', href: '#', icon: <Smartphone /> },
      { id: 'reviews', label: 'Avis & notes', href: '#', icon: <Star /> },
      { id: 'support', label: 'Support & litiges', href: '#', icon: <Headphones />, badge: 4 },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { id: 'payments', label: 'Paiements', href: '#', icon: <CreditCard /> },
      { id: 'payouts', label: 'Reversements', href: '#', icon: <Wallet /> },
      { id: 'invoicing', label: 'Facturation & TVA', href: '#', icon: <Receipt /> },
      { id: 'plans', label: 'Abonnements & commissions', href: '#', icon: <Percent /> },
    ],
  },
  {
    id: 'croissance',
    label: 'Croissance',
    items: [
      { id: 'promotions', label: 'Promotions', href: '#', icon: <Megaphone /> },
      { id: 'loyalty', label: 'Fidélité & parrainage', href: '#', icon: <Gift /> },
      { id: 'notifications', label: 'Notifications', href: '#', icon: <Bell /> },
      { id: 'crm', label: 'Acquisition', href: '#', icon: <Target /> },
    ],
  },
  {
    id: 'plateforme',
    label: 'Plateforme',
    items: [
      { id: 'settings', label: 'Paramètres', href: '#', icon: <Settings /> },
      { id: 'countries', label: 'Multi-pays', href: '#', icon: <Globe2 /> },
      { id: 'features', label: 'Fonctionnalités', href: '#', icon: <ToggleRight /> },
      { id: 'integrations', label: 'Intégrations', href: '#', icon: <Plug /> },
      { id: 'admins', label: 'Administrateurs', href: '#', icon: <UserCog /> },
      { id: 'audit', label: 'Sécurité & audit', href: '#', icon: <ScrollText /> },
      { id: 'fraud', label: 'Anti-fraude', href: '#', icon: <ShieldAlert /> },
      { id: 'gdpr', label: 'RGPD & conformité', href: '#', icon: <ShieldCheck /> },
      { id: 'health', label: 'Santé plateforme', href: '#', icon: <HeartPulse /> },
      { id: 'backups', label: 'Données & sauvegardes', href: '#', icon: <Database /> },
    ],
  },
];

export const restaurantNav: NavGroup[] = [
  {
    id: 'service',
    items: [
      { id: 'dashboard', label: 'Accueil', href: '#', icon: <LayoutDashboard /> },
      { id: 'orders', label: 'Commandes', href: '#', icon: <ClipboardList />, badge: 3 },
    ],
  },
  {
    id: 'carte',
    label: 'Carte',
    items: [
      { id: 'menu', label: 'Carte & produits', href: '#', icon: <BookOpen /> },
      { id: 'stocks', label: 'Stocks', href: '#', icon: <Boxes /> },
      { id: 'promotions', label: 'Promotions', href: '#', icon: <Megaphone /> },
    ],
  },
  {
    id: 'equipe',
    label: 'Équipe',
    items: [
      { id: 'staff', label: 'Employés', href: '#', icon: <Users /> },
      { id: 'planning', label: 'Planning', href: '#', icon: <CalendarDays /> },
      { id: 'clock', label: 'Pointages', href: '#', icon: <Clock /> },
      { id: 'tasks', label: 'Tâches', href: '#', icon: <ListChecks /> },
      { id: 'haccp', label: 'HACCP', href: '#', icon: <ChefHat /> },
    ],
  },
  {
    id: 'gestion',
    label: 'Gestion',
    items: [
      { id: 'finance', label: 'Finances', href: '#', icon: <Landmark /> },
      { id: 'performance', label: 'Performance', href: '#', icon: <Gauge /> },
      { id: 'messages', label: 'Messagerie', href: '#', icon: <MessageSquare />, badge: 2, badgeTone: 'neutral' },
      { id: 'access', label: 'Rôles & accès', href: '#', icon: <KeyRound /> },
      { id: 'settings', label: 'Paramètres', href: '#', icon: <Settings /> },
    ],
  },
];

export interface DemoRestaurant {
  id: string;
  name: string;
  city: string;
  plan: 'Essentiel' | 'Pro' | 'Premium';
  status: 'active' | 'paused' | 'onboarding' | 'suspended';
  orders: number;
  revenue: number;
  rating: number;
  cancelRate: number;
}

export const restaurants: DemoRestaurant[] = [
  { id: 'r1', name: 'Mina Kitchen', city: 'Paris', plan: 'Premium', status: 'active', orders: 1284, revenue: 38420.5, rating: 4.8, cancelRate: 0.012 },
  { id: 'r2', name: 'Onda Pasta Club', city: 'Lyon', plan: 'Pro', status: 'active', orders: 942, revenue: 24188, rating: 4.6, cancelRate: 0.021 },
  { id: 'r3', name: 'Kumo Ramen', city: 'Luxembourg', plan: 'Premium', status: 'active', orders: 1107, revenue: 35902.4, rating: 4.9, cancelRate: 0.008 },
  { id: 'r4', name: 'Lune Coffee', city: 'Paris', plan: 'Essentiel', status: 'paused', orders: 214, revenue: 3920, rating: 4.4, cancelRate: 0.031 },
  { id: 'r5', name: 'Beldi Bowls', city: 'Marseille', plan: 'Pro', status: 'active', orders: 688, revenue: 15870.9, rating: 4.5, cancelRate: 0.019 },
  { id: 'r6', name: 'Santo Smash', city: 'Lille', plan: 'Pro', status: 'suspended', orders: 402, revenue: 9602, rating: 3.7, cancelRate: 0.094 },
  { id: 'r7', name: 'Nami Sushi Bar', city: 'Luxembourg', plan: 'Premium', status: 'active', orders: 876, revenue: 29870.2, rating: 4.7, cancelRate: 0.015 },
  { id: 'r8', name: 'Rue 12 Bakery', city: 'Bordeaux', plan: 'Essentiel', status: 'onboarding', orders: 0, revenue: 0, rating: 0, cancelRate: 0 },
  { id: 'r9', name: 'Casa Arepa', city: 'Nantes', plan: 'Essentiel', status: 'active', orders: 318, revenue: 6120.5, rating: 4.3, cancelRate: 0.026 },
  { id: 'r10', name: 'Le Petit Pho', city: 'Paris', plan: 'Pro', status: 'active', orders: 1023, revenue: 21406.8, rating: 4.6, cancelRate: 0.017 },
  { id: 'r11', name: 'Golden Tandoor', city: 'Esch-sur-Alzette', plan: 'Pro', status: 'onboarding', orders: 0, revenue: 0, rating: 0, cancelRate: 0 },
  { id: 'r12', name: 'Brasserie Kirchberg', city: 'Luxembourg', plan: 'Premium', status: 'active', orders: 1490, revenue: 52318, rating: 4.8, cancelRate: 0.011 },
];

export const revenueSeries = [
  { day: '1 sept.', gmv: 41200, commissions: 6180 },
  { day: '4 sept.', gmv: 43850, commissions: 6577 },
  { day: '7 sept.', gmv: 40120, commissions: 6018 },
  { day: '10 sept.', gmv: 46900, commissions: 7035 },
  { day: '13 sept.', gmv: 52310, commissions: 7846 },
  { day: '16 sept.', gmv: 49870, commissions: 7480 },
  { day: '19 sept.', gmv: 55420, commissions: 8313 },
  { day: '22 sept.', gmv: 58960, commissions: 8844 },
  { day: '25 sept.', gmv: 61240, commissions: 9186 },
];

export const cityOrders = [
  { city: 'Paris', orders: 8420 },
  { city: 'Luxembourg', orders: 6130 },
  { city: 'Lyon', orders: 4210 },
  { city: 'Marseille', orders: 2890 },
  { city: 'Lille', orders: 1760 },
];

export const orderChannels = [
  { label: 'Carte bancaire', value: 18420 },
  { label: 'Apple Pay / Google Pay', value: 7310 },
  { label: 'Titres-restaurant', value: 3120 },
  { label: 'Crédit fidélité', value: 1480 },
];

export const alerts = [
  { id: 'a1', tone: 'danger' as const, icon: <AlertTriangle />, title: 'Taux d’annulation anormal', description: 'Santo Smash · 9,4 % sur 7 jours (moyenne réseau 1,8 %)', time: 'il y a 12 min' },
  { id: 'a2', tone: 'amber' as const, icon: <Bike />, title: 'Zone en manque de livreurs', description: 'Luxembourg-Gare · 3 livreurs en ligne pour 21 commandes', time: 'il y a 26 min' },
  { id: 'a3', tone: 'info' as const, icon: <Building2 />, title: '12 restaurants à valider', description: 'Documents KBIS et hygiène reçus', time: 'il y a 1 h' },
];

export const sparkUp = [12, 14, 13, 17, 16, 19, 22, 21, 24, 27, 26, 30];
export const sparkFlat = [42, 44, 41, 43, 45, 42, 44, 46, 43, 45, 44, 46];
export const sparkDown = [3.1, 2.9, 3.0, 2.6, 2.7, 2.4, 2.2, 2.3, 2.0, 1.9, 1.8, 1.8];
