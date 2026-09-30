import { ReceiptText } from 'lucide-react';
import { defineModule } from '@/app/define-module';

// Sans permission de rubrique : chaque salarié y retrouve ses propres bulletins ;
// la gestion de la paie reste réservée aux droits payroll.view / payroll.manage.
export default defineModule({
  id: 'paie',
  nav: { group: 'equipe', label: 'Paie', icon: <ReceiptText />, order: 50, keywords: ['bulletins', 'salaires', 'fiches de paie', 'cotisations', 'net', 'brut'], feature: 'payroll' },
  routes: [
    { path: 'equipe/paie', lazy: () => import('./PaiePage').then((m) => ({ Component: m.PaiePage })) },
    { path: 'equipe/paie/reglages', lazy: () => import('./PayrollSettingsPage').then((m) => ({ Component: m.PayrollSettingsPage })) },
  ],
});
