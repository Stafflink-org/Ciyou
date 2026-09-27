import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { ShieldBan, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  StatusPill,
  createColumnHelper,
  formatDate,
} from '@golink/ui';
import { COLLECTIONS, PAYOUT_HOLD_REASON_LABELS, type PayoutHold, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { releasePayoutHold } from '../argent-commun/api';
import { ActionDialog, ErrorPanel } from '../argent-commun/components';
import { inGeo, useDirectory } from '../argent-commun/hooks';
import { HoldDialog } from './dialogs';
import { FinanceNav } from './nav';

type Hold = WithId<PayoutHold & { beneficiaryName?: string | null; cityId?: string | null; countryId?: string | null; releaseReason?: string | null }>;
const col = createColumnHelper<Hold>();

/** Blocages de reversement (cahier §15) : fraude, litige, document manquant, impayé. */
export function HoldsPage() {
  useDocumentTitle('Blocages de reversement · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const [view, setView] = useState<'active' | 'released'>('active');
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const q = useMemo(() => query(collection(db, COLLECTIONS.payoutHolds), orderBy('createdAt', 'desc'), limit(300)), []);
  const { data, loading, error } = useCollection<Hold>(q);
  const release = useMutation(releasePayoutHold, { success: (r) => `Blocage levé${r.payoutsReleased ? ` : ${r.payoutsReleased} reversement${r.payoutsReleased > 1 ? 's' : ''} reprogrammé${r.payoutsReleased > 1 ? 's' : ''}` : ''}` });

  const rows = useMemo(
    () =>
      data
        .map((h) => {
          const entry = directory.get(h.beneficiaryType, h.beneficiaryId);
          return { ...h, beneficiaryName: h.beneficiaryName ?? entry?.name ?? h.beneficiaryId, cityId: h.cityId ?? entry?.cityId ?? null, countryId: h.countryId ?? entry?.countryId ?? null };
        })
        .filter((h) => (view === 'active' ? h.active : !h.active) && inGeo(geo, h)),
    [data, directory, view, geo],
  );
  const activeCount = data.filter((h) => h.active).length;

  const columns = useMemo(
    () => [
      col.accessor('beneficiaryName', {
        header: 'Bénéficiaire',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{info.row.original.beneficiaryType === 'restaurant' ? 'Commerce' : 'Livreur'}</p>
          </div>
        ),
      }),
      col.accessor('reason', { header: 'Motif', cell: (info) => <Badge tone={info.getValue() === 'fraud' ? 'danger' : info.getValue() === 'unpaid_subscription' ? 'amber' : 'plum'}>{PAYOUT_HOLD_REASON_LABELS[info.getValue()]}</Badge> }),
      col.accessor('details', { header: 'Précisions', cell: (info) => <p className="line-clamp-2 max-w-sm text-fg-muted" title={String(info.getValue() ?? '')}>{info.getValue() ?? '—'}</p> }),
      col.accessor((h) => toDate(h.createdAt)?.getTime() ?? 0, { id: 'since', header: 'Depuis', cell: (info) => <span className="whitespace-nowrap text-fg-muted">{info.getValue() ? formatDate(info.getValue()) : '—'}</span> }),
      col.accessor('active', {
        header: 'État',
        cell: (info) =>
          info.getValue() ? (
            <StatusPill tone="danger" pulse>Actif</StatusPill>
          ) : (
            <div>
              <StatusPill tone="success">Levé</StatusPill>
              {toDate(info.row.original.releasedAt) && <p className="mt-1 text-2xs text-fg-subtle">le {formatDate(toDate(info.row.original.releasedAt) as Date)}</p>}
            </div>
          ),
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: (info) =>
          info.row.original.active && can('finance.hold') ? (
            <Button size="sm" variant="secondary" leftIcon={<ShieldCheck />} onClick={(e) => { e.stopPropagation(); setReleasing(info.row.original); }}>
              Lever
            </Button>
          ) : null,
      }),
    ],
    [can],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Blocages de reversement"
        description="Suspendre les reversements d’un commerce ou d’un livreur en cas de fraude, de litige ou de document manquant. L’argent reste dû et sera versé à la levée."
        actions={can('finance.hold') ? <Button variant="primary" size="sm" leftIcon={<ShieldBan />} onClick={() => setCreating(true)}>Nouveau blocage</Button> : undefined}
      >
        <FinanceNav />
      </PageHeader>

      <div className="space-y-4">
        <SegmentedControl
          aria-label="État"
          value={view}
          onValueChange={(v) => setView(v as 'active' | 'released')}
          options={[
            { value: 'active', label: 'Actifs', count: activeCount },
            { value: 'released', label: 'Levés' },
          ]}
        />
        {error ? (
          <ErrorPanel error={error} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(h) => h.id}
            itemLabel="blocages"
            searchPlaceholder="Rechercher un bénéficiaire…"
            emptyState={
              <EmptyState
                icon={<ShieldCheck />}
                title={view === 'active' ? 'Aucun blocage actif' : 'Aucun blocage levé'}
                description={view === 'active' ? 'Tous les reversements suivent leur calendrier.' : 'L’historique des blocages levés apparaîtra ici.'}
              />
            }
          />
        )}
      </div>

      <HoldDialog open={creating} onOpenChange={setCreating} />
      <ActionDialog
        open={Boolean(releasing)}
        onOpenChange={(o) => !o && setReleasing(null)}
        icon={<ShieldCheck />}
        title={releasing ? `Lever le blocage de ${releasing.beneficiaryName}` : 'Lever le blocage'}
        description="Les reversements bloqués redeviennent programmés et seront versés au prochain passage du calendrier."
        confirmLabel="Lever le blocage"
        onSubmit={async (reason) => Boolean(releasing && (await release.mutate({ holdId: releasing.id, reason })))}
      />
    </PageContainer>
  );
}
