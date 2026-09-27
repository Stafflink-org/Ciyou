import { ArrowLeftRight, BookOpenText, LayoutGrid, ShieldBan, SplitSquareHorizontal } from 'lucide-react';
import { SubNav } from '../argent-commun/components';
import { useFailedPayoutsCount } from './hooks';

export function FinanceNav() {
  const failed = useFailedPayoutsCount();
  return (
    <SubNav
      items={[
        { to: '/finance', label: 'Vue d’ensemble', icon: <LayoutGrid />, end: true },
        { to: '/finance/reversements', label: 'Reversements', icon: <ArrowLeftRight />, count: failed },
        { to: '/finance/repartition', label: 'Répartition par commande', icon: <SplitSquareHorizontal /> },
        { to: '/finance/grand-livre', label: 'Grand livre', icon: <BookOpenText /> },
        { to: '/finance/blocages', label: 'Blocages', icon: <ShieldBan /> },
      ]}
    />
  );
}
