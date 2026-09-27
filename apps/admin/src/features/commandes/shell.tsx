// En-tête commun des pages Commandes (vision globale, cahier §8).
import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { OpsTabs } from '../_operations/ui';
import { useActiveOrders } from './hooks';

export function OrdersShell({ title, description, actions, children, documentTitle }: { title: string; description: string; actions?: ReactNode; children: ReactNode; documentTitle: string }) {
  useDocumentTitle(`${documentTitle} · GoLink Admin`);
  const geo = useGeoScope();
  const active = useActiveOrders().data.filter((o) => o.status !== 'scheduled').length;
  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Opérations · ${geo.label}`} title={title} description={description} actions={actions}>
        <OpsTabs
          tabs={[
            { to: '/commandes', label: 'Toutes les commandes', end: true },
            { to: '/commandes/direct', label: 'En direct', count: active },
            { to: '/commandes/anomalies', label: 'Anomalies' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
