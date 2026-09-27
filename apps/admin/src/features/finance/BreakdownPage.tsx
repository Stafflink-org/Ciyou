import { useMemo, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { ChevronLeft, ChevronRight, FileText, Receipt, Search, SplitSquareHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatDateTime,
} from '@golink/ui';
import { COLLECTIONS, PAYMENT_METHOD_LABELS, parseOrderNumber, type Invoice, type OrderFinancials, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, toDate, useDoc, useMutation, usePagedQuery } from '@/lib/firestore';
import { issueCustomerReceipt } from '../argent-commun/api';
import { Callout, DetailRow, ErrorPanel, Money } from '../argent-commun/components';
import { bps, eur } from '../argent-commun/format';
import { scopeConstraints, useDirectory } from '../argent-commun/hooks';
import { downloadInvoicePdf } from '../facturation/invoice-pdf';
import { FinanceNav } from './nav';

type Row = WithId<OrderFinancials>;

const SOURCE_LABELS: Record<OrderFinancials['commissionSource'], string> = {
  market: 'barème du pays',
  city: 'taux de la ville',
  plan: 'taux de la formule',
  negotiated: 'taux négocié',
  group: 'taux du groupe',
  subscription: 'abonnement (aucune commission)',
};

/** Répartition par commande (cahier §15) : qui reçoit quoi sur chaque commande livrée. */
export function BreakdownPage() {
  useDocumentTitle('Répartition par commande · GoLink Admin');
  const geo = useGeoScope();
  const directory = useDirectory();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const orderNumber = parseOrderNumber(search);

  const q = useMemo(() => {
    const base = collection(db, COLLECTIONS.orderFinancials);
    if (orderNumber) return query(base, where('orderNumber', '==', orderNumber));
    return query(base, ...scopeConstraints(geo), orderBy('deliveredAt', 'desc'));
  }, [orderNumber, geo.cityIds, geo.countryId]);
  const paged = usePagedQuery<OrderFinancials>(q, { pageSize: 20 });

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Répartition par commande" description="Montant payé, part du commerce, part du livreur, commission, frais de paiement, remises et qui les finance.">
        <FinanceNav />
      </PageHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-full sm:w-80"
            leading={<Search />}
            placeholder="Numéro de commande (GL-10482)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Rechercher une commande"
          />
          {search && !orderNumber && <p className="text-sm text-fg-subtle">Saisissez un numéro complet, par exemple GL-10482.</p>}
        </div>

        {paged.error ? (
          <ErrorPanel error={paged.error} onRetry={paged.refresh} />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Commande</TableHead>
                    <TableHead>Commerce</TableHead>
                    <TableHead className="text-right">Payé par le client</TableHead>
                    <TableHead className="text-right">Part commerce</TableHead>
                    <TableHead className="text-right">Livreur</TableHead>
                    <TableHead className="text-right">Commission HT</TableHead>
                    <TableHead className="text-right">Frais paiement</TableHead>
                    <TableHead className="text-right">Remises</TableHead>
                    <TableHead className="text-right">Marge GoLink</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.loading
                    ? Array.from({ length: 8 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                      ))
                    : paged.data.map((row) => {
                        const s = row.settlement;
                        const promo = s.platform.promoCostCents + s.restaurant.discountFundedCents;
                        return (
                          <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                            <TableCell>
                              <p className="font-mono font-medium text-fg">{row.orderNumber}</p>
                              <p className="text-xs text-fg-subtle">{toDate(row.deliveredAt) ? formatDateTime(toDate(row.deliveredAt) as Date) : '—'}</p>
                            </TableCell>
                            <TableCell className="max-w-48 truncate">{directory.name('restaurant', row.restaurantId)}</TableCell>
                            <TableCell className="text-right"><Money cents={s.customerPaidCents} className="font-medium text-fg" /></TableCell>
                            <TableCell className="text-right"><Money cents={s.restaurant.payoutCents} /></TableCell>
                            <TableCell className="text-right">{s.courier ? <Money cents={s.courier.totalCents} /> : <span className="text-fg-subtle">—</span>}</TableCell>
                            <TableCell className="text-right"><Money cents={s.platform.commissionHtCents} /><span className="ml-1 text-2xs text-fg-subtle">{bps(row.commissionBps)}</span></TableCell>
                            <TableCell className="text-right"><Money cents={s.payment.totalCents} muted /></TableCell>
                            <TableCell className="text-right">{promo ? <Money cents={-promo} /> : <span className="text-fg-subtle">—</span>}</TableCell>
                            <TableCell className="text-right"><Money cents={row.finalMarginCents} signed /></TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </div>
            {!paged.loading && paged.data.length === 0 && (
              <EmptyState icon={<SplitSquareHorizontal />} title={orderNumber ? `Aucune répartition pour ${orderNumber}` : 'Aucune commande livrée'} description={orderNumber ? 'La commande n’est peut-être pas encore livrée, ou elle est hors de votre périmètre.' : 'Les répartitions sont enregistrées à la livraison de chaque commande.'} />
            )}
            {!orderNumber && (paged.hasNext || paged.hasPrevious) && (
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

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg">{selected && <BreakdownSheet row={selected} restaurantName={directory.name('restaurant', selected.restaurantId)} />}</SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function BreakdownSheet({ row, restaurantName }: { row: Row; restaurantName: string }) {
  const can = useCan();
  const s = row.settlement;
  const receiptId = (row as Row & { receiptInvoiceId?: string }).receiptInvoiceId ?? `rec-${row.orderId}`;
  const receipt = useDoc<Invoice>(docAt(`${COLLECTIONS.invoices}/${receiptId}`));
  const issue = useMutation(issueCustomerReceipt, { success: (r) => (r.created ? 'Justificatif émis' : 'Justificatif déjà émis') });
  const refundsTotal = row.refunds.reduce((sum, r) => sum + r.amountCents, 0);
  return (
    <>
      <SheetHeader title={`Commande ${row.orderNumber}`} description={`${restaurantName} · ${toDate(row.deliveredAt) ? formatDateTime(toDate(row.deliveredAt) as Date) : ''}`} icon={<SplitSquareHorizontal />} />
      <SheetBody className="space-y-6">
        <section>
          <h3 className="eyebrow mb-1">Client</h3>
          <div className="divide-y divide-border">
            <DetailRow label="Payé par le client" value={eur(s.customerPaidCents)} strong hint={PAYMENT_METHOD_LABELS[s.payment.method]} />
            {s.platform.promoCostCents > 0 && <DetailRow label="Remise financée par GoLink" value={eur(s.platform.promoCostCents)} />}
            {s.restaurant.discountFundedCents > 0 && <DetailRow label="Remise financée par le commerce" value={eur(s.restaurant.discountFundedCents)} />}
          </div>
        </section>
        <section>
          <h3 className="eyebrow mb-1">Commerce</h3>
          <div className="divide-y divide-border">
            <DetailRow label="Articles TTC" value={eur(s.restaurant.grossCents)} />
            <DetailRow label={`Commission (${bps(row.commissionBps)}, ${SOURCE_LABELS[row.commissionSource]})`} hint={`Assiette ${eur(s.restaurant.commissionBaseCents)} · HT ${eur(s.restaurant.commissionHtCents)} + TVA ${eur(s.restaurant.commissionVatCents)}`} value={`− ${eur(s.restaurant.commissionTtcCents)}`} />
            {s.restaurant.deliveryFeeCents > 0 && <DetailRow label="Frais de livraison conservés" value={`+ ${eur(s.restaurant.deliveryFeeCents)}`} />}
            {(s.restaurant.tipCents ?? 0) > 0 && <DetailRow label="Pourboire pour son livreur" value={`+ ${eur(s.restaurant.tipCents ?? 0)}`} />}
            {s.restaurant.paymentFeeCents > 0 && <DetailRow label="Frais de paiement" value={`− ${eur(s.restaurant.paymentFeeCents)}`} />}
            <DetailRow label="Part du commerce" value={eur(s.restaurant.payoutCents)} strong />
          </div>
        </section>
        {s.courier && (
          <section>
            <h3 className="eyebrow mb-1">Livreur</h3>
            <div className="divide-y divide-border">
              {s.courier.flatCents ? <DetailRow label="Forfait course" value={eur(s.courier.flatCents)} /> : <DetailRow label="Prise en charge et remise" value={eur(s.courier.pickupCents + s.courier.dropoffCents)} />}
              {s.courier.distanceCents > 0 && <DetailRow label="Distance" value={eur(s.courier.distanceCents)} />}
              {s.courier.surgeBonusCents > 0 && <DetailRow label="Bonus heure de pointe" value={eur(s.courier.surgeBonusCents)} />}
              {s.courier.tipCents > 0 && <DetailRow label="Pourboire (100 %)" value={eur(s.courier.tipCents)} />}
              <DetailRow label="Total livreur" value={eur(s.courier.totalCents)} strong />
            </div>
          </section>
        )}
        <section>
          <h3 className="eyebrow mb-1">GoLink</h3>
          <div className="divide-y divide-border">
            <DetailRow label="Commission HT" value={eur(s.platform.commissionHtCents)} />
            {s.platform.serviceFeeHtCents + s.platform.smallOrderFeeHtCents + s.platform.deliveryFeeHtCents > 0 && (
              <DetailRow label="Frais clients HT" value={eur(s.platform.serviceFeeHtCents + s.platform.smallOrderFeeHtCents + s.platform.deliveryFeeHtCents)} />
            )}
            <DetailRow label="Frais de paiement Stripe" hint={s.payment.payer === 'restaurant' ? 'Refacturés au commerce' : 'À la charge de GoLink'} value={eur(s.payment.totalCents)} />
            <DetailRow label="TVA due" value={eur(s.platform.vatDueCents)} />
            {refundsTotal > 0 && <DetailRow label="Remboursements (part GoLink)" value={`− ${eur(row.refunds.reduce((sum, r) => sum + r.platformCents, 0))}`} />}
            <DetailRow label="Marge nette" value={eur(row.finalMarginCents)} strong tone={row.finalMarginCents < 0 ? 'danger' : undefined} />
          </div>
        </section>
        {row.refunds.length > 0 && (
          <Callout tone="amber" title={`Remboursé : ${eur(refundsTotal)}`}>
            Imputé au commerce : {eur(row.refunds.reduce((sum, r) => sum + r.restaurantCents, 0))} (déduit de son prochain reversement).
          </Callout>
        )}
        <section className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-fg-subtle" />
              <div>
                <p className="text-sm font-medium text-fg">Justificatif client</p>
                <p className="text-xs text-fg-subtle">{receipt.loading ? 'Recherche…' : receipt.data ? `N° ${receipt.data.number}` : 'Pas encore émis'}</p>
              </div>
            </div>
            {receipt.data ? (
              <div className="flex items-center gap-2">
                {receipt.data.status === 'credited' && <Badge tone="neutral" size="sm">Annulé par avoir</Badge>}
                <Button size="sm" variant="secondary" leftIcon={<FileText />} onClick={() => receipt.data && void downloadInvoicePdf(receipt.data)}>
                  PDF
                </Button>
              </div>
            ) : (
              can('invoices.issue') && !receipt.loading && (
                <Button variant="primary" size="sm" loading={issue.loading} onClick={() => void issue.mutate({ orderId: row.orderId })}>
                  Émettre
                </Button>
              )
            )}
          </div>
        </section>
      </SheetBody>
    </>
  );
}
