import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@golink/ui';
import { RouteTabs } from '../_croissance/ui';

/** En-tête commun : programme de fidélité et parrainages (cahier §19). */
export function LoyaltyLayout({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Croissance · Toute la plateforme"
        title="Fidélité et parrainage"
        description="Faire revenir les clients et recruter par le bouche-à-oreille : règles de points, récompenses des parrains et des filleuls."
        actions={actions}
      >
        <RouteTabs
          tabs={[
            { to: '/fidelite', label: 'Programme de fidélité', end: true },
            { to: '/fidelite/parrainage', label: 'Parrainage' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
