import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, getDocs, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { BookOpenText, ChevronLeft, ChevronRight, Download, SlidersHorizontal, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@golink/ui';
import { COLLECTIONS, LEDGER_ACCOUNT_TYPE_LABELS, LEDGER_ENTRY_TYPE_LABELS, type LedgerAccountType, type LedgerEntry } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { errorMessage, usePagedQuery } from '@/lib/firestore';
import { ActionDialog, ErrorPanel, Money } from '../argent-commun/components';
import { downloadCsv, downloadXlsx, type Sheet } from '../argent-commun/export';
import { addDays, day, isoDay, plural } from '../argent-commun/format';
import { scopeConstraints, useDirectory } from '../argent-commun/hooks';
import { AdjustmentDialog, BeneficiaryPicker } from './dialogs';
import { FinanceNav } from './nav';

type AccountFilter = 'all' | 'restaurant' | 'driver' | 'driver_cash' | 'platform';

const TYPE_TONES: Partial<Record<LedgerEntry['type'], 'danger' | 'amber' | 'success' | 'info' | 'plum' | 'neutral'>> = {
  refund_charge: 'danger',
  manual_adjustment: 'amber',
  payout: 'success',
  payout_reversal: 'danger',
  commission: 'info',
  cash_collected: 'plum',
  cash_remitted: 'plum',
};

/** Grand livre (cahier §15 « Historique ») : chaque mouvement d'argent, consultable et exportable. */
export function LedgerPage() {
  useDocumentTitle('Grand livre · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const [account, setAccount] = useState<AccountFilter>('all');
  const [beneficiary, setBeneficiary] = useState<string | undefined>();
  const [dialog, setDialog] = useState<null | 'export' | 'adjust'>(null);
  const [range, setRange] = useState({ from: `${isoDay(new Date()).slice(0, 7)}-01`, to: isoDay(new Date()) });
  const pickerType: 'restaurant' | 'driver' | null = account === 'restaurant' ? 'restaurant' : account === 'driver' || account === 'driver_cash' ? 'driver' : null;

  const q = useMemo(() => {
    const constraints: QueryConstraint[] = [];
    if (account !== 'all') constraints.push(where('accountType', '==', account));
    if (beneficiary && pickerType) constraints.push(where('accountId', '==', beneficiary));
    else constraints.push(...scopeConstraints(geo));
    return query(collection(db, COLLECTIONS.ledgerEntries), ...constraints, orderBy('createdAt', 'desc'));
  }, [account, beneficiary, pickerType, geo.cityIds, geo.countryId]);
  const paged = usePagedQuery<LedgerEntry>(q, { pageSize: 25 });

  const accountName = (e: LedgerEntry) => {
    if (e.accountType === 'restaurant') return directory.name('restaurant', e.accountId);
    if (e.accountType === 'driver' || e.accountType === 'driver_cash') return directory.name('driver', e.accountId);
    if (e.accountType === 'platform') return 'GoLink';
    return e.accountId;
  };

  async function exportRange(format: 'csv' | 'xlsx'): Promise<boolean> {
    try {
      const constraints: QueryConstraint[] = [where('bookingDate', '>=', range.from), where('bookingDate', '<=', range.to)];
      if (geo.cityIds) constraints.unshift(where('cityId', 'in', geo.cityIds.slice(0, 30)));
      else if (geo.countryId) constraints.unshift(where('countryId', '==', geo.countryId));
      const snap = await getDocs(query(collection(db, COLLECTIONS.ledgerEntries), ...constraints, orderBy('bookingDate', 'asc'), limit(20_000)));
      const entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as LedgerEntry) })).filter((e) => (account === 'all' || e.accountType === account) && (!beneficiary || e.accountId === beneficiary));
      if (!entries.length) {
        toast.info('Aucun mouvement sur cette période.');
        return false;
      }
      const sheet: Sheet = {
        name: 'Grand livre',
        columns: [
          { header: 'Date comptable', kind: 'date', width: 14 },
          { header: 'Compte', width: 16 },
          { header: 'Titulaire', width: 28 },
          { header: 'Mouvement', width: 24 },
          { header: 'Libellé', width: 40 },
          { header: 'Montant', kind: 'money', width: 14 },
          { header: 'dont TVA', kind: 'money' },
          { header: 'Commande', width: 14 },
          { header: 'Reversement', width: 34 },
          { header: 'Motif', width: 30 },
          { header: 'Pays' },
          { header: 'Ville', width: 14 },
          { header: 'Référence', width: 30 },
        ],
        rows: entries.map((e) => [
          e.bookingDate,
          LEDGER_ACCOUNT_TYPE_LABELS[e.accountType],
          accountName(e),
          LEDGER_ENTRY_TYPE_LABELS[e.type],
          e.description,
          e.amountCents,
          e.vatCents ?? null,
          e.orderId ?? '',
          e.payoutId ?? '',
          e.reason ?? '',
          e.countryId,
          e.cityId ?? '',
          e.id,
        ]),
        totals: ['Total', '', '', '', `${entries.length} mouvements`, entries.reduce((s, e) => s + e.amountCents, 0), entries.reduce((s, e) => s + (e.vatCents ?? 0), 0), '', '', '', '', '', ''],
      };
      const name = `golink-grand-livre-${range.from}-${range.to}`;
      if (format === 'csv') downloadCsv(sheet, name);
      else await downloadXlsx([sheet], name, { title: 'GoLink · Grand livre', subtitle: `${geo.label} · du ${day(range.from)} au ${day(range.to)}` });
      toast.success(`${plural(entries.length, 'mouvement')} exporté${entries.length > 1 ? 's' : ''}`);
      return true;
    } catch (error) {
      toast.error(errorMessage(error, 'L’export a échoué.'));
      return false;
    }
  }

  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('xlsx');

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Grand livre"
        description="Chaque mouvement financier des commerces, des livreurs et de la plateforme. Les lignes ne sont jamais modifiées : une correction passe par un ajustement motivé."
        actions={
          <>
            <Button variant="secondary" size="sm" leftIcon={<Download />} onClick={() => setDialog('export')}>
              Exporter
            </Button>
            {can('finance.adjust') && (
              <Button variant="primary" size="sm" leftIcon={<SlidersHorizontal />} onClick={() => setDialog('adjust')}>
                Ajustement manuel
              </Button>
            )}
          </>
        }
      >
        <FinanceNav />
      </PageHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div data-scroll-ok className="-mx-4 max-w-full overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <SegmentedControl
              aria-label="Compte"
              value={account}
              onValueChange={(v) => {
                setAccount(v as AccountFilter);
                setBeneficiary(undefined);
              }}
              options={[
                { value: 'all', label: 'Tous' },
                { value: 'restaurant', label: 'Commerces' },
                { value: 'driver', label: 'Livreurs' },
                { value: 'driver_cash', label: 'Espèces' },
                { value: 'platform', label: 'Plateforme' },
              ]}
            />
          </div>
          {pickerType && (
            <div className="flex w-full items-center gap-2 sm:w-80">
              <BeneficiaryPicker type={pickerType} value={beneficiary} onChange={setBeneficiary} />
              {beneficiary && (
                <Button variant="ghost" size="sm" aria-label="Effacer" onClick={() => setBeneficiary(undefined)}>
                  <X />
                </Button>
              )}
            </div>
          )}
        </div>

        {paged.error ? (
          <ErrorPanel error={paged.error} onRetry={paged.refresh} />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Compte</TableHead>
                    <TableHead>Mouvement</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Reversement</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.loading
                    ? Array.from({ length: 10 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                      ))
                    : paged.data.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-fg-muted">{day(e.bookingDate)}</TableCell>
                          <TableCell>
                            <p className="max-w-48 truncate text-fg">{accountName(e)}</p>
                            <p className="text-xs text-fg-subtle">{LEDGER_ACCOUNT_TYPE_LABELS[e.accountType as LedgerAccountType]}</p>
                          </TableCell>
                          <TableCell><Badge size="sm" tone={TYPE_TONES[e.type] ?? 'neutral'}>{LEDGER_ENTRY_TYPE_LABELS[e.type]}</Badge></TableCell>
                          <TableCell>
                            <p className="max-w-72 truncate text-fg">{e.description}</p>
                            {e.reason && <p className="max-w-72 truncate text-xs text-fg-subtle">Motif : {e.reason}</p>}
                          </TableCell>
                          <TableCell>
                            {e.payoutId ? (
                              <Link to={`/finance/reversements/${e.payoutId}`} className="font-mono text-xs text-primary-soft-fg hover:underline">
                                {e.payoutId.length > 26 ? `${e.payoutId.slice(0, 26)}…` : e.payoutId}
                              </Link>
                            ) : (
                              <Badge size="sm" tone="info" variant="outline">À reverser</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right"><Money cents={e.amountCents} signed /></TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
            {!paged.loading && paged.data.length === 0 && <EmptyState icon={<BookOpenText />} title="Aucun mouvement" description="Aucun mouvement ne correspond à ces filtres." />}
            {(paged.hasNext || paged.hasPrevious) && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <p className="text-sm text-fg-muted">Page {paged.page + 1}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" leftIcon={<ChevronLeft />} disabled={!paged.hasPrevious} onClick={paged.previous}>Précédente</Button>
                  <Button size="sm" variant="secondary" rightIcon={<ChevronRight />} disabled={!paged.hasNext} onClick={paged.next}>Suivante</Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <ActionDialog
        open={dialog === 'export'}
        onOpenChange={(o) => setDialog(o ? 'export' : null)}
        icon={<Download />}
        title="Exporter le grand livre"
        description={`Mouvements du périmètre « ${geo.label} »${account !== 'all' ? `, comptes ${LEDGER_ACCOUNT_TYPE_LABELS[account as LedgerAccountType].toLowerCase()}` : ''}${beneficiary && pickerType ? `, ${directory.name(pickerType, beneficiary)}` : ''}.`}
        confirmLabel="Exporter"
        requireReason={false}
        disabled={!range.from || !range.to || range.from > range.to}
        onSubmit={() => exportRange(exportFormat)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Du">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </FormField>
          <FormField label="Au">
            <Input type="date" value={range.to} min={range.from} max={isoDay(new Date())} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Mois en cours', from: `${isoDay(new Date()).slice(0, 7)}-01`, to: isoDay(new Date()) },
            { label: '30 derniers jours', from: addDays(isoDay(new Date()), -29), to: isoDay(new Date()) },
            { label: 'Depuis le 1er janvier', from: `${isoDay(new Date()).slice(0, 4)}-01-01`, to: isoDay(new Date()) },
          ].map((p) => (
            <Button key={p.label} type="button" size="xs" variant="soft" onClick={() => setRange({ from: p.from, to: p.to })}>
              {p.label}
            </Button>
          ))}
        </div>
        <FormField label="Format">
          <SegmentedControl aria-label="Format" value={exportFormat} onValueChange={(v) => setExportFormat(v as 'csv' | 'xlsx')} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }]} />
        </FormField>
      </ActionDialog>
      <AdjustmentDialog open={dialog === 'adjust'} onOpenChange={(o) => setDialog(o ? 'adjust' : null)} />
    </PageContainer>
  );
}
