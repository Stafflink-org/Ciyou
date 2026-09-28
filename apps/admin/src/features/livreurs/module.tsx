import { Bike } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useDriversToReviewCount } from './lib';

export default defineModule({
  id: 'livreurs',
  nav: {
    group: 'acteurs',
    label: 'Livreurs',
    icon: <Bike />,
    order: 20,
    badge: useDriversToReviewCount,
    keywords: ['coursiers', 'flotte', 'inscriptions', 'documents', 'selfie', 'sanctions', 'rémunération', 'attribution', 'dispatch'],
  },
  permission: 'drivers.view',
  routes: [
    { path: 'livreurs', lazy: () => import('./DriversPage').then((m) => ({ Component: m.DriversPage })) },
    { path: 'livreurs/validation', lazy: () => import('./ApplicationsPage').then((m) => ({ Component: m.ApplicationsPage })) },
    { path: 'livreurs/documents', lazy: () => import('./DocumentsPage').then((m) => ({ Component: m.DocumentsPage })) },
    { path: 'livreurs/identite', lazy: () => import('./IdentityPage').then((m) => ({ Component: m.IdentityPage })) },
    { path: 'livreurs/sanctions', lazy: () => import('./SanctionsPage').then((m) => ({ Component: m.SanctionsPage })) },
    { path: 'livreurs/remuneration', lazy: () => import('./PayRulesPage').then((m) => ({ Component: m.PayRulesPage })) },
    { path: 'livreurs/attribution', lazy: () => import('./DispatchRulesPage').then((m) => ({ Component: m.DispatchRulesPage })) },
    { path: 'livreurs/:driverId', lazy: () => import('./DriverPage').then((m) => ({ Component: m.DriverPage })) },
  ],
});
