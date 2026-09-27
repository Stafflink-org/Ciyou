// Lectures et éléments partagés du mini CRM.
import { useMemo, type ReactNode } from 'react';
import { collection, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { PageContainer, PageHeader } from '@golink/ui';
import { COLLECTIONS, PROSPECT_STAGES, type Prospect, type ProspectStage, type SalesCommission, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';
import { RouteTabs } from '../_croissance/ui';

export type ProspectRow = WithId<Prospect>;
export const OPEN_STAGES: ProspectStage[] = PROSPECT_STAGES.filter((s) => s !== 'signed_up' && s !== 'lost');

/** Prospects du périmètre géographique choisi, les plus récemment modifiés d'abord. */
export function useProspects() {
  const geo = useGeoScope();
  const q = useMemo(() => {
    const scope: QueryConstraint[] = [];
    if (geo.cityIds) scope.push(geo.cityIds.length === 1 ? where('cityId', '==', geo.cityIds[0]) : where('cityId', 'in', geo.cityIds.length ? geo.cityIds.slice(0, 30) : ['__aucune__']));
    else if (geo.countryId) scope.push(where('countryId', '==', geo.countryId));
    return query(collection(db, COLLECTIONS.prospects), ...scope, orderBy('updatedAt', 'desc'), limit(500));
  }, [geo.cityIds, geo.countryId]);
  return useCollection<Prospect>(q);
}

/** Commissions visibles : toutes (responsable d'équipe, finance) ou les siennes. */
export function useCommissions() {
  const { can } = useAdminAccess();
  const { user } = useAuth();
  const all = can('crm.manage_team') || can('finance.view');
  const q = useMemo(() => {
    if (all) return query(collection(db, COLLECTIONS.salesCommissions), orderBy('createdAt', 'desc'), limit(500));
    if (!user) return null;
    return query(collection(db, COLLECTIONS.salesCommissions), where('salesRepId', '==', user.uid), orderBy('createdAt', 'desc'), limit(200));
  }, [all, user]);
  return { ...useCollection<SalesCommission>(q), all };
}

export function isOverdue(p: Pick<Prospect, 'stage' | 'nextFollowUpAt'>, now: number): boolean {
  const at = toMillis(p.nextFollowUpAt);
  return OPEN_STAGES.includes(p.stage) && at !== null && at < now;
}

export function isDueToday(p: Pick<Prospect, 'stage' | 'nextFollowUpAt'>, now: number): boolean {
  const at = toMillis(p.nextFollowUpAt);
  if (!OPEN_STAGES.includes(p.stage) || at === null) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return at <= end.getTime();
}

/** En-tête commun du mini CRM (cahier §21). */
export function CrmLayout({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const geo = useGeoScope();
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Croissance · ${geo.label}`}
        title="Prospection"
        description="Suivi des restaurants démarchés : étapes, notes, relances, résultats et commissions des commerciaux."
        actions={actions}
      >
        <RouteTabs
          tabs={[
            { to: '/prospection', label: 'Pipeline', end: true },
            { to: '/prospection/commerciaux', label: 'Commerciaux et commissions' },
          ]}
        />
      </PageHeader>
      {children}
    </PageContainer>
  );
}
