import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@golink/ui';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { RouteTabs } from '../_croissance/ui';

/** En-tête commun de la rubrique Notifications et envois (cahier §20). */
export function CommunicationLayout({ actions, children, title = 'Notifications et envois', description }: { actions?: ReactNode; children: ReactNode; title?: string; description?: string }) {
  const geo = useGeoScope();
  const { can } = useAdminAccess();
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Croissance · ${geo.label}`}
        title={title}
        description={description ?? 'Push, e-mail et SMS aux clients, restaurants et livreurs, messages automatiques et consentement marketing.'}
        actions={actions}
      >
        <RouteTabs
          tabs={[
            { to: '/communication', label: 'Envois', end: true },
            { to: '/communication/messages-automatiques', label: 'Messages automatiques', hidden: !can('templates.edit') },
            { to: '/communication/journal', label: 'Journal des envois' },
            { to: '/communication/consentements', label: 'Consentement marketing', hidden: !can('customers.view') },
            { to: '/communication/regles', label: 'Règles des campagnes' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
