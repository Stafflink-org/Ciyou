import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { AlertOctagon, CreditCard, Percent, Receipt, Undo2 } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatDateTime,
} from '@golink/ui';
import { COLLECTIONS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, type Payment, type PaymentStatus, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useInfiniteCollection } from '@/lib/firestore';
import { Callout, DetailRow, ErrorPanel, ExportMenu, Money } from '../argent-commun/components';
import { downloadCsv, downloadXlsx, type Sheet as ExportSheet } from '../argent-commun/export';
import { eur, plural, ratio } from '../argent-commun/format';
import { scopeConstraints, useDirectory } from '../argent-commun/hooks';
import { PAYMENT_STATUS } from '../argent-commun/status';
import { PaiementsNav } from './nav';

type Row = WithId<Payment>;
const col = createColumnHelper<Row>();
type View = 'all' | 'failed' | 'refunded' | 'requires_action';

const PURPOSE_LABELS: Record<Payment['purpose'], string> = {
  order: 'Commande',
  subscription: 'Abonnement',
  sponsored_placement: 'Mise en avant',
};

const FAILURE_LABELS: Record<string, string> = {
  card_declined: 'Carte refusée',
  insufficient_funds: 'Provision insuffisante',
  expired_card: 'Carte expirée',
  incorrect_cvc: 'Cryptogramme incorrect',
  authentication_required: 'Authentification 3-D Secure requise',
  processing_error: 'Erreur de traitement',
};

/** Paiements (cahier §14) : suivi des encaissements, des paiements refusés et des remboursements. */
export function TransactionsPage() {
  useDocumentTitle('Paiements · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const [view, setView] = useState<View>('all');
  const [selected, setSelected] = useState<Row | null>(null);

  const statuses: PaymentStatus[] | null = view === 'failed' ? ['failed'] : view === 'refunded' ? ['refunded', 'partially_refunded'] : view === 'requires_action' ? ['requires_action'] : null;
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.payments), ...(statuses ? [where('status', statuses.length > 1 ? 'in' : '==', statuses.length > 1 ? statuses : statuses[0])] : []), ...scopeConstraints(geo), orderBy('createdAt', 'desc')),
    [view, geo.cityIds, geo.countryId],
  );
  const list = useInfiniteCollection<Payment>(q, { pageSize: 200 });
  // Indicateurs des 30 derniers jours : lecture dédiée, indépendante du filtre et de la pagination.
  const [since] = useState(() => new Date(Date.now() - 30 * 86_400_000));
  const recentQuery = useMemo(
    () => query(collection(db, COLLECTIONS.payments), ...scopeConstraints(geo), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(5000)),
    [geo.cityIds, geo.countryId, since],
  );
  const recentState = useCollection<Payment>(recentQuery);

  const stats = useMemo(() => {
    const recent = recentState.data;
    const paid = recent.filter((p) => ['paid', 'partially_refunded', 'refunded'].includes(p.status));
    const failed = recent.filter((p) => p.status === 'failed');
    return {
      paid: paid.reduce((s, p) => s + p.amountCents, 0),
      paidCount: paid.length,
      failed: failed.length,
      failedAmount: failed.reduce((s, p) => s + p.amountCents, 0),
      failRate: recent.length ? failed.length / recent.length : 0,
      refunded: recent.reduce((s, p) => s + p.refundedCents, 0),
      fees: paid.reduce((s, p) => s + p.feeCents, 0),
    };
  }, [recentState.data]);

  const payer = (p: Payment) => (p.payerType === 'restaurant' ? directory.name('restaurant', p.payerId) : p.restaurantId ? `Client · ${directory.name('restaurant', p.restaurantId)}` : 'Client');

  const columns = useMemo(
    () => [
      col.accessor((r) => toDate(r.createdAt)?.getTime() ?? 0, { id: 'date', header: 'Date', cell: (info) => <span className="whitespace-nowrap text-fg-muted">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span> }),
      col.accessor((r) => payer(r), {
        id: 'payer',
        header: 'Objet',
        cell: (info) => (
          <div className="min-w-0">
            <p className="max-w-64 truncate text-fg">{PURPOSE_LABELS[info.row.original.purpose]}{info.row.original.orderId ? ` ${info.row.original.orderId}` : ''}</p>
            <p className="max-w-64 truncate text-xs text-fg-subtle">{info.getValue()}</p>
          </div>
        ),
      }),
      col.accessor('method', {
        header: 'Moyen',
        cell: (info) => (
          <div>
            <p className="text-fg">{PAYMENT_METHOD_LABELS[info.getValue()]}</p>
            {info.row.original.cardLabel && <p className="font-mono text-xs text-fg-subtle">{info.row.original.cardLabel}</p>}
          </div>
        ),
      }),
      col.accessor('amountCents', { header: 'Montant', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="font-medium text-fg" /> }),
      col.accessor('feeCents', { header: 'Frais', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} muted /> }),
      col.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={info.getValue()} map={PAYMENT_STATUS} />
            {info.getValue() === 'failed' && (info.row.original.failureMessage || info.row.original.failureCode) && (
              <span className="line-clamp-1 max-w-52 text-2xs text-danger" title={String(FAILURE_LABELS[info.row.original.failureCode ?? ''] ?? info.row.original.failureMessage ?? '')}>{FAILURE_LABELS[info.row.original.failureCode ?? ''] ?? info.row.original.failureMessage}</span>
            )}
            {info.row.original.refundedCents > 0 && info.getValue() !== 'refunded' && <span className="text-2xs text-fg-subtle">Remboursé {eur(info.row.original.refundedCents)}</span>}
          </div>
        ),
      }),
    ],
    [directory],
  );

  async function onExport(format: 'csv' | 'xlsx' | 'pdf') {
    const sheet: ExportSheet = {
      name: 'Paiements',
      columns: [
        { header: 'Date', kind: 'date', width: 18 },
        { header: 'Objet', width: 16 },
        { header: 'Référence', width: 20 },
        { header: 'Payeur', width: 30 },
        { header: 'Moyen', width: 16 },
        { header: 'Montant', kind: 'money' },
        { header: 'Frais', kind: 'money' },
        { header: 'Remboursé', kind: 'money' },
        { header: 'Statut', width: 18 },
        { header: 'Motif d’échec', width: 30 },
        { header: 'Tentatives', kind: 'number' },
      ],
      rows: list.data.map((p) => [toDate(p.createdAt) ?? null, PURPOSE_LABELS[p.purpose], p.orderId ?? p.subscriptionId ?? '', payer(p), PAYMENT_METHOD_LABELS[p.method], p.amountCents, p.feeCents, p.refundedCents, PAYMENT_STATUS_LABELS[p.status], p.failureMessage ?? '', p.attempts]),
    };
    if (format === 'csv') downloadCsv(sheet, 'golink-paiements');
    else await downloadXlsx([sheet], 'golink-paiements', { title: 'GoLink · Paiements', subtitle: geo.label });
  }

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Paiements" description="Encaissements des commandes et des abonnements, paiements refusés ou en erreur, remboursements.">
        <PaiementsNav />
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Encaissé sur 30 jours" icon={<CreditCard />} tone="brand" loading={recentState.loading} value={eur(stats.paid)} footer={plural(stats.paidCount, 'paiement')} />
          <StatCard label="Paiements refusés (30 j)" icon={<AlertOctagon />} tone="danger" loading={recentState.loading} value={String(stats.failed)} footer={`${eur(stats.failedAmount)} non encaissés`} onClick={() => setView('failed')} />
          <StatCard label="Taux d’échec" icon={<Percent />} tone="amber" loading={recentState.loading} value={ratio(stats.failRate)} footer="Sur les paiements des 30 derniers jours" />
          <StatCard label="Remboursé (30 j)" icon={<Undo2 />} tone="neutral" loading={recentState.loading} value={eur(stats.refunded)} footer={`Frais de paiement : ${eur(stats.fees)}`} onClick={() => setView('refunded')} />
        </div>

        <div data-scroll-ok className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <SegmentedControl
            aria-label="Filtre"
            value={view}
            onValueChange={(v) => setView(v as View)}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'failed', label: 'Refusés' },
              { value: 'requires_action', label: 'Action requise' },
              { value: 'refunded', label: 'Remboursés' },
            ]}
          />
        </div>

        {list.error ? (
          <ErrorPanel error={list.error} />
        ) : (
          <>
            <DataTable
              data={list.data}
              columns={columns}
              loading={list.loading}
              getRowId={(r) => r.id}
              onRowClick={setSelected}
              itemLabel="paiements"
              pageSize={15}
              searchPlaceholder="Commande, commerce, carte…"
              filters={[
                { id: 'method', label: 'Moyen', options: Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })), getValue: (r) => r.method },
                { id: 'purpose', label: 'Objet', options: Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label })), getValue: (r) => r.purpose },
              ]}
              toolbar={<ExportMenu onExport={onExport} disabled={!list.data.length} />}
              emptyState={<EmptyState icon={<Receipt />} title={view === 'failed' ? 'Aucun paiement refusé' : 'Aucun paiement'} description="Aucun paiement ne correspond à ce filtre dans votre périmètre." />}
            />
            {list.hasMore && (
              <div className="flex justify-center">
                <Button variant="secondary" size="sm" loading={list.loadingMore} onClick={list.loadMore}>Charger des paiements plus anciens</Button>
              </div>
            )}
          </>
        )}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {selected && (
            <>
              <SheetHeader title={`${PURPOSE_LABELS[selected.purpose]} · ${eur(selected.amountCents)}`} description={toDate(selected.createdAt) ? formatDateTime(toDate(selected.createdAt) as Date) : ''} icon={<CreditCard />} />
              <SheetBody className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.status} map={PAYMENT_STATUS} />
                  <Badge tone="neutral" size="sm">{selected.provider === 'stripe' ? 'Stripe' : selected.provider === 'cash' ? 'Espèces' : 'Avoir GoLink'}</Badge>
                </div>
                {selected.status === 'failed' && (
                  <Callout tone="danger" title={FAILURE_LABELS[selected.failureCode ?? ''] ?? 'Paiement refusé'}>
                    {selected.failureMessage ?? 'Aucun détail transmis par le prestataire.'} {plural(selected.attempts, 'tentative')}.
                  </Callout>
                )}
                <div className="divide-y divide-border">
                  <DetailRow label="Payeur" value={<span className="font-sans">{payer(selected)}</span>} />
                  <DetailRow label="Moyen" value={<span className="font-sans">{PAYMENT_METHOD_LABELS[selected.method]}{selected.cardLabel ? ` · ${selected.cardLabel}` : ''}</span>} />
                  <DetailRow label="Montant" value={eur(selected.amountCents)} strong />
                  <DetailRow label="Frais de paiement" value={eur(selected.feeCents)} />
                  <DetailRow label="Remboursé" value={eur(selected.refundedCents)} />
                  <DetailRow label="Tentatives" value={String(selected.attempts)} />
                  {selected.providerIntentId && <DetailRow label="Intention Stripe" value={<span className="break-all text-xs">{selected.providerIntentId}</span>} />}
                  {selected.providerChargeId && <DetailRow label="Paiement Stripe" value={<span className="break-all text-xs">{selected.providerChargeId}</span>} />}
                </div>
                {selected.orderId && can('finance.view') && (
                  <Button asChild variant="secondary" size="sm">
                    <Link to={`/finance/repartition`}>Voir la répartition des commandes</Link>
                  </Button>
                )}
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
