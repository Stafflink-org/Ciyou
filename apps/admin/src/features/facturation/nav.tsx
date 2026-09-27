import { FileText, Landmark, Percent } from 'lucide-react';
import { SubNav } from '../argent-commun/components';

export function FacturationNav() {
  return (
    <SubNav
      items={[
        { to: '/facturation', label: 'Factures et avoirs', icon: <FileText />, end: true },
        { to: '/facturation/declarations', label: 'Déclarations et exports', icon: <Landmark />, permission: 'tax.reports' },
        { to: '/facturation/tva', label: 'TVA et numérotation', icon: <Percent /> },
      ]}
    />
  );
}
