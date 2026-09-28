import { Wallet } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'paiement',
  nav: {
    group: 'finances',
    label: 'Paiement',
    icon: <Wallet />,
    order: 10,
    keywords: [
      'finances',
      'chiffre d’affaires',
      'commission',
      'virements',
      'factures',
      'compte de versement',
      'abonnement',
      'reversement',
      'net à percevoir',
    ],
  },
  // Aucune permission au niveau du hub : chaque onglet applique la sienne (finance.view,
  // invoices.view) et se masque si le membre connecté ne l'a pas.
  routes: [{ path: 'paiement', lazy: () => import('./PaiementPage').then((m) => ({ Component: m.PaiementPage })) }],
});
