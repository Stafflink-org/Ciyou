// En-tête commun des pages de la rubrique Livreurs (titre, onglets avec compteurs).
import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { OpsTabs } from '../_operations/ui';
import { useApplicationsQueue, usePendingDriverDocuments, useSubmittedChecks } from './lib';

export function DriversShell({ title, description, actions, children, documentTitle }: { title: string; description: string; actions?: ReactNode; children: ReactNode; documentTitle: string }) {
  useDocumentTitle(`${documentTitle} · GoLink Admin`);
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const validate = can('drivers.validate');
  const applications = useApplicationsQueue(validate).data.filter((d) => d.onboardingStatus === 'pending').length;
  const documents = usePendingDriverDocuments(validate).data.filter((d) => !geo.cityIds || (d.cityId && geo.cityIds.includes(d.cityId))).length;
  const selfies = useSubmittedChecks(validate).data.length;
  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Acteurs · ${geo.label}`} title={title} description={description} actions={actions}>
        <OpsTabs
          tabs={[
            { to: '/livreurs', label: 'Tous les livreurs', end: true },
            { to: '/livreurs/validation', label: 'Inscriptions', count: applications, hidden: !validate },
            { to: '/livreurs/documents', label: 'Documents', count: documents, hidden: !validate },
            { to: '/livreurs/identite', label: 'Vérification d’identité', count: selfies, hidden: !validate },
            { to: '/livreurs/sanctions', label: 'Sanctions' },
            { to: '/livreurs/remuneration', label: 'Rémunération' },
            { to: '/livreurs/attribution', label: 'Attribution des courses' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
