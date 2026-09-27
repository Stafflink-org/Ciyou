// Documents des livreurs (cahier §6) : vérification des pièces déposées, suivi des
// expirations (relances J-30 / J-7 puis blocage automatique), pièces expirées.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { FileCheck2, FileClock, FileWarning, ShieldCheck } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, SegmentedControl, createColumnHelper, formatDate } from '@golink/ui';
import {
  COLLECTIONS,
  DOCUMENT_STATUS_LABELS,
  PARTNER_DOCUMENT_LABELS,
  driverDocumentRequirements,
  type PartnerDocument,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection } from '@/lib/firestore';
import { useNames, useScopedDrivers } from '../_operations/hooks';
import { LoadError } from '../_operations/ui';
import { DocumentReviewDialog } from './dialogs';
import { todayIso } from './lib';
import { DriversShell } from './shell';

type View = 'pending' | 'expiring' | 'expired' | 'rejected';
type Row = WithId<PartnerDocument>;
const col = createColumnHelper<Row>();

function plusDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
}

export function DocumentsPage() {
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const navigate = useNavigate();
  const names = useNames();
  const [view, setView] = useState<View>('pending');
  const [review, setReview] = useState<Row | null>(null);
  const today = todayIso();
  const allowed = can('drivers.validate');

  const q = useMemo(() => {
    if (!allowed) return null;
    const base = collection(db, COLLECTIONS.partnerDocuments);
    if (view === 'expiring') return query(base, where('ownerType', '==', 'driver'), where('status', '==', 'approved'), where('expiresAt', '<=', plusDays(today, 30)), orderBy('expiresAt', 'asc'), limit(300));
    return query(base, where('ownerType', '==', 'driver'), where('status', '==', view === 'pending' ? 'pending' : view), orderBy('createdAt', 'desc'), limit(300));
  }, [view, today, allowed]);
  const docs = useCollection<PartnerDocument>(q);
  const rows = useMemo(() => docs.data.filter((d) => !geo.cityIds || (d.cityId && geo.cityIds.includes(d.cityId))), [docs.data, geo.cityIds]);
  const drivers = useScopedDrivers();
  const driverName = (id: string) => {
    const d = drivers.data.find((x) => x.id === id);
    return d ? `${d.firstName} ${d.lastName}` : 'Livreur';
  };
  const reviewedDriver = review ? drivers.data.find((d) => d.id === review.ownerId) : null;
  const reviewExpires = reviewedDriver ? (driverDocumentRequirements(reviewedDriver).find((r) => r.type === review?.type)?.expires ?? false) : false;

  const columns = useMemo(
    () => [
      col.accessor((d) => driverName(d.ownerId), {
        id: 'driver',
        header: 'Livreur',
        cell: ({ row }) => (
          <button type="button" className="text-left font-medium text-fg hover:underline" onClick={(e) => (e.stopPropagation(), navigate(`/livreurs/${row.original.ownerId}`))}>
            {driverName(row.original.ownerId)}
            <span className="block text-2xs font-normal text-fg-subtle">{names.city(row.original.cityId)}</span>
          </button>
        ),
      }),
      col.accessor((d) => PARTNER_DOCUMENT_LABELS[d.type], { id: 'type', header: 'Document' }),
      col.accessor((d) => d.createdAt?.toMillis?.() ?? 0, {
        id: 'created',
        header: 'Déposé le',
        cell: ({ row }) => {
          const at = toDate(row.original.createdAt);
          return <span className="font-mono text-xs text-fg-muted">{at ? formatDate(at) : '—'}</span>;
        },
      }),
      col.accessor((d) => d.expiresAt ?? '', {
        id: 'expires',
        header: 'Expiration',
        cell: ({ row }) => {
          const e = row.original.expiresAt;
          if (!e) return <span className="text-fg-subtle">—</span>;
          const late = e < today;
          const days = Math.round((Date.parse(e) - Date.parse(today)) / 86_400_000);
          return (
            <span className={`font-mono text-xs ${late ? 'text-danger' : days <= 7 ? 'text-warning' : 'text-fg-muted'}`}>
              {e.split('-').reverse().join('/')}
              {!late && view === 'expiring' && <span className="ml-1.5 text-fg-subtle">J-{days}</span>}
            </span>
          );
        },
      }),
      col.accessor((d) => d.remindersSent, {
        id: 'reminders',
        header: 'Relances',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-xs num">{info.getValue()}</span>,
      }),
      col.accessor('status', {
        header: 'État',
        cell: ({ row }) => (
          <Badge size="sm" tone={row.original.status === 'pending' ? 'info' : row.original.status === 'approved' ? 'amber' : 'danger'}>
            {view === 'expiring' ? 'Expire bientôt' : DOCUMENT_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      }),
      col.display({
        id: 'action',
        header: '',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <Button size="xs" variant={row.original.status === 'pending' ? 'primary' : 'secondary'} onClick={(e) => (e.stopPropagation(), setReview(row.original))}>
            {row.original.status === 'pending' ? 'Vérifier' : 'Voir'}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers.data, names, today, view],
  );

  if (!allowed) {
    return (
      <DriversShell documentTitle="Documents des livreurs" title="Documents" description="Pièces justificatives des livreurs.">
        <EmptyState icon={<ShieldCheck />} title="Accès réservé" description="La vérification des documents n’entre pas dans vos droits." />
      </DriversShell>
    );
  }

  return (
    <DriversShell
      documentTitle="Documents des livreurs"
      title="Documents"
      description="Pièces à vérifier et échéances : un document obligatoire expiré bloque automatiquement le compte."
    >
      <div className="mb-4">
        <SegmentedControl
          aria-label="Filtrer les documents"
          value={view}
          onValueChange={(v) => setView(v as View)}
          options={[
            { value: 'pending', label: 'À vérifier', icon: <FileCheck2 /> },
            { value: 'expiring', label: 'Expirent sous 30 jours', icon: <FileClock /> },
            { value: 'expired', label: 'Expirés', icon: <FileWarning /> },
            { value: 'rejected', label: 'Refusés' },
          ]}
        />
      </div>
      {docs.error ? (
        <LoadError error={docs.error} />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(d) => d.id}
          loading={docs.loading}
          searchPlaceholder="Livreur, type de document…"
          itemLabel="documents"
          pageSize={15}
          onRowClick={setReview}
          filters={[
            {
              id: 'type',
              label: 'Type',
              options: [...new Set(rows.map((r) => r.type))].map((t) => ({ value: t, label: PARTNER_DOCUMENT_LABELS[t] })),
              getValue: (d) => d.type,
            },
          ]}
          emptyState={
            <EmptyState
              icon={<FileCheck2 />}
              title={view === 'pending' ? 'Aucun document en attente' : view === 'expiring' ? 'Aucune échéance proche' : 'Rien à signaler'}
              description={view === 'pending' ? 'Les pièces déposées depuis l’application livreur arrivent ici.' : 'Les relances et blocages sont automatiques.'}
            />
          }
        />
      )}
      <DocumentReviewDialog
        open={Boolean(review)}
        onOpenChange={(o) => !o && setReview(null)}
        document={review}
        expires={reviewExpires}
        driverName={review ? driverName(review.ownerId) : ''}
      />
    </DriversShell>
  );
}
