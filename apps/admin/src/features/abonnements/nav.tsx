import { BellRing, Layers, Percent, Repeat } from 'lucide-react';
import { SubNav } from '../argent-commun/components';
import { useUnpaidSubscriptionsCount } from './hooks';

export function AbonnementsNav() {
  const unpaid = useUnpaidSubscriptionsCount();
  return (
    <SubNav
      items={[
        { to: '/abonnements', label: 'Abonnements', icon: <Repeat />, end: true },
        { to: '/abonnements/formules', label: 'Formules', icon: <Layers /> },
        { to: '/abonnements/commissions', label: 'Commissions', icon: <Percent /> },
        { to: '/abonnements/relances', label: 'Impayés et relances', icon: <BellRing />, count: unpaid },
      ]}
    />
  );
}
