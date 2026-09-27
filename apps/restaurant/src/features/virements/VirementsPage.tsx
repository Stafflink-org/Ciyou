import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { orderBy, query, where, limit } from 'firebase/firestore';
import { AlertTriangle, ArrowDownToLine, Banknote, CalendarClock, CheckCircle2, Clock, FileDown, Landmark, ShieldAlert, Wallet } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatCard,
  StatusPill,
  Timeline,
  createColumnHelper,
  formatDate,
  formatNumber,
  type DataTableFilter,
} from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import {
  COLLECTIONS,
  PAYOUT_STATUS_LABELS,
  RESTAURANT_PRIVATE_DOCS,
  paths,
  type LedgerEntry,
  type Payout,
  type PayoutStatus,
  type RestaurantCommercial,
  type WithId,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { ExportMenu, type ExportFormat } from '../finances/components/ExportMenu';
import { Callout, DetailRow, ErrorPanel } from '../finances/components/States';
import { downloadCsv, downloadXlsx, type Sheet as ExportSheet } from '../finances/lib/export';
import { LEDGER_LABELS, PAYOUT_TONES, eur, plural } from '../finances/lib/format';
import { createPdf, generatedFooter } from '../finances/lib/pdf';
import { downloadStatementPdf } from './statement';

const column = createColumnHelper<WithId<Payout>>();
const day = (value: string) => formatDate(new Date(`${value}T12:00:00`));
const FREQUENCY: Record<string, string> = { weekly: 'Hebdomadaire', biweekly: 'Toutes les deux semaines', monthly: 'Mensuelle' };

function periodLabel(payout: Payout): string {
  const start = new Date(`${payout.periodStart}T12:00:00`);
  const end = new Date(`${payout.periodEnd}T12:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  return `${start.toLocaleDateString('fr-FR', { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })} – ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function deductions(payout: Payout): number {
  return payout.refundsChargedCents - payout.adjustmentsCents + payout.cashDeductedCents;
}

export function StatusOfPayout({ status }: { status: PayoutStatus }) {
  return (
    <StatusPill tone={PAYOUT_TONES[status]} pulse={status === 'processing'}>
      {PAYOUT_STATUS_LABELS[status]}
    </StatusPill>
  );
}

/** Historique des reversements : statut, relevé détaillé PDF, retenues. */
export function VirementsPage() {
  useDocumentTitle('Virements · GoLink Restaurant');
  const navigate = useNavigate();
  const { payoutId } = useParams();
  const { restaurant, restaurantId } = useRestaurantAccess();

  const payouts = useCollection<Payout>(
    query(
      collectionAt(COLLECTIONS.payouts),
      where('beneficiaryType', '==', 'restaurant'),
      where('beneficiaryId', '==', restaurantId),
      orderBy('scheduledFor', 'desc'),
      limit(156),
    ),
  );
  const commercial = useDoc<RestaurantCommercial>(docAt(`${paths.restaurantSub(restaurantId, 'private')}/${RESTAURANT_PRIVATE_DOCS.commercial}`));

  const list = payouts.data;
  const upcoming = [...list].filter((p) => p.status === 'scheduled' || p.status === 'processing').sort((a, b) => (toDate(a.scheduledFor)?.getTime() ?? 0) - (toDate(b.scheduledFor)?.getTime() ?? 0));
  const next = upcoming[0];
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const paidThisYear = list.filter((p) => p.status === 'paid' && (toDate(p.paidAt)?.getTime() ?? 0) >= yearStart.getTime());
  const problems = list.filter((p) => p.status === 'failed' || p.status === 'on_hold');
  const retained = list.reduce((sum, p) => sum + (p.status === 'cancelled' ? 0 : p.refundsChargedCents), 0);
  const selected = list.find((p) => p.id === payoutId) ?? null;

  const columns = useMemo(
    () => [
      column.accessor('periodStart', {
        header: 'Période',
        cell: (info) => (
          <div>
            <p className="whitespace-nowrap text-sm font-medium text-fg">{periodLabel(info.row.original)}</p>
            <p className="text-xs text-fg-subtle">{plural(Math.round(info.row.original.entriesCount / 2), 'commande')}</p>
          </div>
        ),
      }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusOfPayout status={info.getValue()} /> }),
      column.accessor('grossCents', { header: 'Ventes', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{eur(info.getValue())}</span> }),
      column.accessor('commissionCents', {
        header: 'Commission',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">− {eur(info.getValue())}</span>,
      }),
      column.accessor((row) => deductions(row), {
        id: 'retenues',
        header: 'Retenues',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() ? `− ${eur(info.getValue())}` : '—'}</span>,
      }),
      column.accessor('netCents', { header: 'Net versé', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm font-semibold num">{eur(info.getValue())}</span> }),
      column.accessor((row) => toDate(row.paidAt ?? row.scheduledFor)?.getTime() ?? 0, {
        id: 'date',
        header: 'Date',
        meta: { className: 'hidden lg:table-cell' },
        cell: (info) => {
          const payout = info.row.original;
          const date = toDate(payout.paidAt ?? payout.scheduledFor);
          return (
            <span className="whitespace-nowrap text-sm text-fg-muted">
              {payout.paidAt ? 'Payé le ' : 'Prévu le '}
              {date ? formatDate(date) : '—'}
            </span>
          );
        },
      }),
    ],
    [],
  );

  const filters: DataTableFilter<WithId<Payout>>[] = [
    {
      id: 'status',
      label: 'Statut',
      options: (Object.keys(PAYOUT_STATUS_LABELS) as PayoutStatus[]).filter((s) => list.some((p) => p.status === s)).map((s) => ({ value: s, label: PAYOUT_STATUS_LABELS[s] })),
      getValue: (row) => row.status,
    },
  ];

  async function exportData(format: ExportFormat) {
    const stem = `virements-${restaurantId}-${new Date().toISOString().slice(0, 10)}`;
    const sheet: ExportSheet = {
      name: 'Virements',
      columns: [
        { header: 'Début', kind: 'date', width: 12 },
        { header: 'Fin', kind: 'date', width: 12 },
        { header: 'Statut', width: 12 },
        { header: 'Ventes', kind: 'money' },
        { header: 'Commission TTC', kind: 'money', width: 16 },
        { header: 'Remboursements imputés', kind: 'money', width: 22 },
        { header: 'Ajustements', kind: 'money' },
        { header: 'Net versé', kind: 'money' },
        { header: 'Date prévue', kind: 'date', width: 12 },
        { header: 'Date de paiement', kind: 'date', width: 16 },
        { header: 'Référence', width: 30 },
      ],
      rows: list.map((p) => [
        p.periodStart,
        p.periodEnd,
        PAYOUT_STATUS_LABELS[p.status],
        p.grossCents,
        p.commissionCents,
        p.refundsChargedCents,
        p.adjustmentsCents,
        p.netCents,
        toDate(p.scheduledFor),
        toDate(p.paidAt),
        p.providerTransferId ?? '',
      ]),
    };
    if (format === 'csv') return downloadCsv(sheet, stem);
    if (format === 'xlsx') return downloadXlsx([sheet], stem, { title: `Virements · ${restaurant.name}`, subtitle: `Export du ${new Date().toLocaleDateString('fr-FR')}` });
    const pdf = await createPdf({ title: 'Historique des virements', subtitle: [restaurant.name, `${plural(list.length, 'reversement')}`], footer: generatedFooter(restaurant.name) });
    pdf.table({
      head: ['Période', 'Statut', 'Ventes', 'Commission', 'Retenues', 'Net'],
      body: list.map((p) => [periodLabel(p), PAYOUT_STATUS_LABELS[p.status], eur(p.grossCents), eur(p.commissionCents), eur(deductions(p)), eur(p.netCents)]),
      rightAligned: [2, 3, 4, 5],
    });
    pdf.save(stem);
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Finances"
        title="Virements"
        description="Vos reversements GoLink, leur statut et le relevé détaillé de chaque période."
        actions={<ExportMenu onExport={exportData} disabled={payouts.loading || list.length === 0} />}
      />

      {payouts.error ? (
        <ErrorPanel error={payouts.error} />
      ) : (
        <div className="space-y-6">
          {commercial.data?.payoutsBlocked && (
            <Callout tone="danger" icon={<ShieldAlert />} title="Vos reversements sont suspendus">
              {commercial.data.payoutsBlockedReason ?? 'Contactez le support GoLink pour connaître la marche à suivre.'} Les montants restent dus et seront versés dès la levée du blocage.
            </Callout>
          )}
          {problems.map((p) => (
            <Callout
              key={p.id}
              tone={p.status === 'failed' ? 'danger' : 'amber'}
              icon={<AlertTriangle />}
              title={`${p.status === 'failed' ? 'Virement échoué' : 'Virement bloqué'} · ${periodLabel(p)} · ${eur(p.netCents)}`}
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate(`/virements/${p.id}`)}>
                  Voir le détail
                </Button>
              }
            >
              {p.failureReason ?? (p.status === 'on_hold' ? 'Reversement suspendu dans l’attente d’un document ou d’une vérification.' : 'La banque a refusé le virement.')}
            </Callout>
          ))}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Prochain virement"
              value={next ? eur(next.netCents) : '—'}
              icon={<CalendarClock />}
              loading={payouts.loading}
              footer={next ? `${PAYOUT_STATUS_LABELS[next.status]} · prévu le ${formatDate(toDate(next.scheduledFor) ?? new Date())}` : 'Aucun virement en attente.'}
            />
            <StatCard
              label={`Versé en ${new Date().getFullYear()}`}
              value={eur(paidThisYear.reduce((s, p) => s + p.netCents, 0))}
              icon={<CheckCircle2 />}
              tone="success"
              loading={payouts.loading}
              footer={plural(paidThisYear.length, 'virement payé', 'virements payés')}
            />
            <StatCard
              label="En attente"
              value={eur(upcoming.reduce((s, p) => s + p.netCents, 0) + problems.reduce((s, p) => s + p.netCents, 0))}
              icon={<Clock />}
              tone="amber"
              loading={payouts.loading}
              footer="Programmés, en cours, bloqués ou échoués"
            />
            <StatCard
              label="Retenues"
              value={eur(retained)}
              icon={<Wallet />}
              tone="danger"
              loading={payouts.loading}
              footer="Remboursements imputés sur l’historique affiché"
            />
          </div>

          <Card>
            <CardHeader
              icon={<Landmark />}
              title="Compte de versement"
              description="Reversements par virement Stripe Connect sur le compte bancaire de l’établissement."
              actions={
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/versements">Gérer</Link>
                </Button>
              }
            />
            <CardContent className="grid gap-4 pt-3 sm:grid-cols-3">
              {commercial.loading ? (
                <Skeleton className="h-10 w-full sm:col-span-3" />
              ) : (
                <>
                  <div>
                    <p className="text-xs text-fg-subtle">Fréquence</p>
                    <p className="mt-0.5 text-sm font-medium text-fg">{FREQUENCY[commercial.data?.payoutFrequency ?? 'weekly']}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">Compte de paiement</p>
                    <div className="mt-1">
                      <StatusPill tone={commercial.data?.stripeAccountStatus === 'enabled' ? 'success' : 'amber'}>
                        {commercial.data?.stripeAccountStatus === 'enabled' ? 'Actif' : 'À compléter'}
                      </StatusPill>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">Calendrier</p>
                    <p className="mt-0.5 text-sm text-fg">Semaine close le dimanche, virement sous 3 jours ouvrés</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <DataTable
            data={list}
            columns={columns}
            getRowId={(row) => row.id}
            loading={payouts.loading}
            filters={filters}
            searchable={false}
            itemLabel="virements"
            pageSize={10}
            onRowClick={(row) => navigate(`/virements/${row.id}`)}
            emptyState={
              <EmptyState compact icon={<Banknote />} title="Aucun virement pour le moment" description="Votre premier reversement sera programmé après votre première semaine de ventes livrées." />
            }
          />
        </div>
      )}

      <Sheet open={Boolean(payoutId)} onOpenChange={(open) => !open && navigate('/virements')}>
        <SheetContent className="sm:max-w-xl">
          {selected ? (
            <PayoutDetail payout={selected} restaurantId={restaurantId} />
          ) : (
            <>
              <SheetHeader title="Virement" />
              <SheetBody>{payouts.loading ? <Skeleton className="h-40 w-full" /> : <EmptyState compact title="Virement introuvable" description="Ce reversement n’existe pas ou n’appartient pas à cet établissement." />}</SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function PayoutDetail({ payout, restaurantId }: { payout: WithId<Payout>; restaurantId: string }) {
  const [showAll, setShowAll] = useState(false);
  const entries = useCollection<LedgerEntry>(
    query(
      collectionAt(COLLECTIONS.ledgerEntries),
      where('accountType', '==', 'restaurant'),
      where('accountId', '==', restaurantId),
      where('payoutId', '==', payout.id),
      orderBy('createdAt', 'asc'),
      limit(2000),
    ),
  );
  const pdf = useMutation(downloadStatementPdf, { success: 'Relevé téléchargé.' });
  const byType = new Map<string, { count: number; cents: number }>();
  for (const entry of entries.data) {
    const acc = byType.get(entry.type) ?? { count: 0, cents: 0 };
    acc.count += 1;
    acc.cents += entry.amountCents;
    byType.set(entry.type, acc);
  }
  const created = toDate(payout.createdAt);
  const scheduled = toDate(payout.scheduledFor);
  const paid = toDate(payout.paidAt);
  const lines = showAll ? entries.data : entries.data.slice(0, 12);

  return (
    <>
      <SheetHeader title={`Virement du ${periodLabel(payout)}`} description={`Semaine du ${day(payout.periodStart)} au ${day(payout.periodEnd)}`} icon={<Banknote />} />
      <SheetBody className="space-y-6">
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-fg-subtle">Net du reversement</p>
              <p className="mt-1 font-display text-3xl font-semibold tracking-display text-fg num">{eur(payout.netCents)}</p>
            </div>
            <StatusOfPayout status={payout.status} />
          </div>
          {payout.failureReason && <p className="mt-3 rounded-lg bg-danger-soft p-2.5 text-sm text-danger-soft-fg">{payout.failureReason}</p>}
        </div>

        <section>
          <p className="eyebrow mb-2">Calcul</p>
          <div className="divide-y divide-border">
            <DetailRow label="Ventes livrées" hint="Après remises que vous financez" value={eur(payout.grossCents)} />
            <DetailRow label="Commission GoLink TTC" value={`− ${eur(payout.commissionCents)}`} />
            <DetailRow label="Remboursements imputés" value={payout.refundsChargedCents ? `− ${eur(payout.refundsChargedCents)}` : eur(0)} />
            {payout.adjustmentsCents !== 0 && <DetailRow label="Ajustements" value={eur(payout.adjustmentsCents)} />}
            {payout.cashDeductedCents > 0 && <DetailRow label="Espèces déjà encaissées" value={`− ${eur(payout.cashDeductedCents)}`} />}
            <DetailRow label="Net versé" value={eur(payout.netCents)} strong />
          </div>
        </section>

        <section>
          <p className="eyebrow mb-3">Suivi</p>
          <Timeline
            items={[
              { id: 'created', title: 'Relevé établi', time: created ? formatDate(created) : undefined, tone: 'neutral' },
              { id: 'scheduled', title: payout.status === 'on_hold' ? 'Virement bloqué' : 'Virement programmé', time: scheduled ? formatDate(scheduled) : undefined, tone: payout.status === 'on_hold' ? 'danger' : 'info' },
              ...(payout.status === 'failed' ? [{ id: 'failed', title: 'Virement refusé par la banque', description: payout.failureReason ?? undefined, tone: 'danger' as const }] : []),
              ...(paid ? [{ id: 'paid', title: 'Virement payé', time: formatDate(paid), description: payout.providerTransferId ? `Référence ${payout.providerTransferId}` : undefined, tone: 'success' as const }] : []),
            ]}
          />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow">Mouvements</p>
            <span className="text-xs text-fg-subtle">{plural(entries.data.length, 'ligne')}</span>
          </div>
          {entries.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : entries.error ? (
            <ErrorPanel compact error={entries.error} />
          ) : entries.data.length === 0 ? (
            <EmptyState compact title="Aucun mouvement rattaché" description="Le détail sera disponible à la clôture de la période." />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {[...byType.entries()].map(([type, value]) => (
                  <span key={type} className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-muted">
                    {LEDGER_LABELS[type] ?? type} · <span className="font-mono text-fg num">{eur(value.cents)}</span>
                  </span>
                ))}
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {lines.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-fg">{entry.description}</p>
                      <p className="text-xs text-fg-subtle">
                        {day(entry.bookingDate)} · {LEDGER_LABELS[entry.type] ?? entry.type}
                      </p>
                    </div>
                    <span className={entry.amountCents < 0 ? 'shrink-0 font-mono text-fg-muted num' : 'shrink-0 font-mono text-fg num'}>{eur(entry.amountCents)}</span>
                  </li>
                ))}
              </ul>
              {entries.data.length > 12 && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Réduire' : `Afficher les ${formatNumber(entries.data.length)} lignes`}
                </Button>
              )}
            </>
          )}
        </section>
      </SheetBody>
      <SheetFooter>
        <Button variant="primary" leftIcon={<FileDown />} loading={pdf.loading} onClick={() => void pdf.mutate(payout.id)}>
          Télécharger le relevé PDF
        </Button>
        <Button
          variant="secondary"
          leftIcon={<ArrowDownToLine />}
          disabled={entries.data.length === 0}
          onClick={() =>
            downloadCsv(
              {
                name: 'Mouvements',
                columns: [{ header: 'Date', kind: 'date' }, { header: 'Mouvement' }, { header: 'Libellé' }, { header: 'TVA incluse', kind: 'money' }, { header: 'Montant', kind: 'money' }],
                rows: entries.data.map((e) => [e.bookingDate, LEDGER_LABELS[e.type] ?? e.type, e.description, e.vatCents ?? null, e.amountCents]),
              },
              `mouvements-${payout.id}`,
            )
          }
        >
          Mouvements CSV
        </Button>
      </SheetFooter>
    </>
  );
}
