import { Banknote, Landmark, ListChecks, Receipt, Settings2 } from 'lucide-react';
import { SubNav } from '../argent-commun/components';

export function PaiementsNav() {
  return (
    <SubNav
      items={[
        { to: '/paiements', label: 'Transactions', icon: <Receipt />, end: true },
        { to: '/paiements/moyens', label: 'Moyens et pourboires', icon: <Settings2 /> },
        { to: '/paiements/especes', label: 'Espèces', icon: <Banknote /> },
        { to: '/paiements/prestataires', label: 'Prestataires', icon: <Landmark /> },
        { to: '/paiements/regles', label: 'Frais et remboursements', icon: <ListChecks /> },
      ]}
    />
  );
}
