import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CalendarClock, Download } from 'lucide-react';
import { PageContainer, PageHeader, Tabs, TabsList, TabsTrigger } from '@golink/ui';
import { useGeoScope } from '@/layout/GeoScope';

/** En-tête commun : exports à la demande et rapports programmés (cahier §4). */
export function ReportsLayout({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const geo = useGeoScope();
  const tab = pathname.startsWith('/rapports/programmes') ? 'programmes' : 'exports';
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Rapports · ${geo.label}`}
        title="Rapports et exports"
        description="Extractions filtrées pour la comptabilité, les associés ou les investisseurs, et récapitulatifs envoyés automatiquement par e-mail."
        actions={actions}
      />
      <Tabs value={tab} onValueChange={(v) => void navigate(v === 'programmes' ? '/rapports/programmes' : '/rapports')}>
        <TabsList className="mb-6">
          <TabsTrigger value="exports" icon={<Download />}>
            Exports
          </TabsTrigger>
          <TabsTrigger value="programmes" icon={<CalendarClock />}>
            Rapports programmés
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {children}
    </PageContainer>
  );
}
