import { ChartColumn } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'chiffre-affaires',
  nav: {
    group: 'finances',
    label: 'États du CA',
    icon: <ChartColumn />,
    order: 20,
    hidden: true, // regroupé dans le hub Paiement (features/paiement)
    keywords: ['chiffre d’affaires', 'journal', 'TVA', 'comptabilité', 'ventes par jour'],
  },
  permission: 'finance.view',
  routes: [
    { path: 'chiffre-affaires', lazy: () => import('./ChiffreAffairesPage').then((page) => ({ Component: page.ChiffreAffairesPage })) },
  ],
});
