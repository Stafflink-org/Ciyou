import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, BadgeCheck, Building2, Download, FileWarning, Landmark, Send, ShieldBan, ShieldCheck, SlidersHorizontal, UserRound, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  StatusBadge,
  Timeline,
  createColumnHelper,
  formatDate,
  formatDateTime,
  toast,
  type TimelineItem,
} from '@golink/ui';
import {
  COLLECTIONS,
  LEDGER_ENTRY_TYPE_LABELS,
  PAYOUT_HOLD_REASON_LABELS,
  PAYOUT_STATUS_LABELS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type DriverPrivate,
  type LedgerEntry,
  type Payout,
  type PayoutHold,
  type RestaurantCommercial,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, errorMessage, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { cancelPayout, executePayout, generateStatement, markPayoutPaidManually, releasePayoutHold, verifyPayoutAccount } from '../argent-commun/api';
import { ActionDialog, Callout, DetailRow, ErrorPanel, Money } from '../argent-commun/components';
import { day, eur, periodLabel, plural } from '../argent-commun/format';
import { createPdf, generatedFooter } from '../argent-commun/pdf';
import { PAYOUT_STATUS } from '../argent-commun/status';
import { AdjustmentDialog, HoldDialog } from './dialogs';

type Entry = WithId<LedgerEntry>;
const col = createColumnHelper<Entry>();

const STRIPE_STATUS: Record<string, { label: string; tone: 'success' | 'amber' | 'danger' | 'neutral' }> = {
  enabled: { label: 'Compte Stripe actif', tone: 'success' },
  restricted: { label: 'Compte Stripe incomplet', tone: 'amber' },
  pending: { label: 'Inscription Stripe en cours', tone: 'amber' },
};

/** Détail d'un reversement : décomposition, mouvements, compte de paiement, actions. */
export function PayoutPage() {
  const { payoutId = '' } = useParams();
  const can = useCan();
  const payoutState = useDoc<Payout>(docAt(`${COLLECTIONS.payouts}/${payoutId}`));
  const payout = payoutState.data;
  useDocumentTitle(`${payout ? `Reversement ${payout.beneficiaryName}` : 'Reversement'} · GoLink Admin`);

  const entriesQuery = useMemo(() => query(collection(db, COLLECTIONS.ledgerEntries), where('payoutId', '==', payoutId), orderBy('createdAt', 'asc'), limit(3000)), [payoutId]);
  const entries = useCollection<LedgerEntry>(entriesQuery);
  const commercial = useDoc<RestaurantCommercial>(
    payout?.beneficiaryType === 'restaurant' ? docAt(`${COLLECTIONS.restaurants}/${payout.beneficiaryId}/${SUBCOLLECTIONS.restaurants.private}/${RESTAURANT_PRIVATE_DOCS.commercial}`) : null,
  );
  const driverPrivate = useDoc<DriverPrivate>(payout?.beneficiaryType === 'driver' ? docAt(`${COLLECTIONS.driverPrivate}/${payout.beneficiaryId}`) : null);
  const holdsQuery = useMemo(() => (payout ? query(collection(db, COLLECTIONS.payoutHolds), where('beneficiaryId', '==', payout.beneficiaryId), where('active', '==', true), limit(5)) : null), [payout?.beneficiaryId]);
  const holds = useCollection<PayoutHold>(holdsQuery);
  const [dialog, setDialog] = useState<null | 'pay' | 'cancel' | 'hold' | 'adjust' | 'release' | 'manual' | 'verify'>(null);
  const [reference, setReference] = useState('');
  const [exporting, setExporting] = useState(false);

  const pay = useMutation(executePayout, { success: (r) => (r.status === 'paid' ? 'Virement émis' : r.status === 'on_hold' ? 'Reversement bloqué : virement non émis' : 'Virement refusé : voir le motif') });
  const cancel = useMutation(cancelPayout, { success: 'Reversement annulé' });
  const release = useMutation(releasePayoutHold, { success: 'Blocage levé : les reversements reprennent' });
  const manual = useMutation(markPayoutPaidManually, { success: 'Virement enregistré' });
  const verify = useMutation(verifyPayoutAccount, { success: 'Compte de paiement vérifié' });

  const columns = useMemo(
    () => [
      col.accessor('bookingDate', { header: 'Date', cell: (info) => <span className="whitespace-nowrap text-fg-muted">{day(info.getValue())}</span> }),
      col.accessor('type', { header: 'Mouvement', cell: (info) => <Badge tone={info.getValue() === 'manual_adjustment' ? 'amber' : info.getValue() === 'refund_charge' ? 'danger' : 'neutral'} size="sm">{LEDGER_ENTRY_TYPE_LABELS[info.getValue()]}</Badge> }),
      col.accessor('description', {
        header: 'Libellé',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate text-fg">{info.getValue()}</p>
            {info.row.original.reason && <p className="truncate text-xs text-fg-subtle">Motif : {info.row.original.reason}</p>}
          </div>
        ),
      }),
      col.accessor('amountCents', { header: 'Montant', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} signed /> }),
    ],
    [],
  );

  if (payoutState.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-6 h-16 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </PageContainer>
    );
  }
  if (payoutState.error) return <PageContainer wide><ErrorPanel error={payoutState.error} /></PageContainer>;
  if (!payout) {
    return (
      <PageContainer wide>
        <EmptyState icon={<FileWarning />} title="Reversement introuvable" description="Il a peut-être été annulé ou l’adresse est incomplète." action={<Button asChild variant="secondary" size="sm" leftIcon={<ArrowLeft />}><Link to="/finance/reversements">Retour aux reversements</Link></Button>} />
      </PageContainer>
    );
  }

  const beneficiary = { type: payout.beneficiaryType, id: payout.beneficiaryId, name: payout.beneficiaryName };
  const stripeId = payout.beneficiaryType === 'restaurant' ? commercial.data?.stripeAccountId : driverPrivate.data?.stripeAccountId;
  // Sans identifiant de compte connecté, aucun virement n'est possible, quel que soit le statut enregistré.
  const stripe = stripeId ? (payout.beneficiaryType === 'restaurant' ? commercial.data?.stripeAccountStatus : driverPrivate.data?.stripeAccountStatus) : null;
  const hold = holds.data[0] ?? null;
  // Pays sans Stripe : virement à la main sur un compte local vérifié, référence bancaire saisie ensuite.
  const isManual = payout.provider === 'manual';
  const localAccount = payout.beneficiaryType === 'restaurant' ? commercial.data?.payoutAccount : driverPrivate.data?.payoutAccount;
  const payable = ['scheduled', 'failed'].includes(payout.status);
  const sumType = (types: string[]) => entries.data.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amountCents, 0);

  const timeline: TimelineItem[] = [
    { id: 'created', title: 'Reversement calculé', description: `${plural(payout.entriesCount, 'mouvement')} du ${day(payout.periodStart)} au ${day(payout.periodEnd)}`, time: toDate(payout.createdAt) ? formatDateTime(toDate(payout.createdAt) as Date) : undefined, tone: 'neutral' },
    { id: 'scheduled', title: 'Versement prévu', description: toDate(payout.scheduledFor) ? formatDate(toDate(payout.scheduledFor) as Date) : '—', tone: 'info' },
    ...(payout.status === 'on_hold' ? [{ id: 'hold', title: 'Bloqué', description: hold ? `${PAYOUT_HOLD_REASON_LABELS[hold.reason]}${hold.details ? ` — ${hold.details}` : ''}` : 'Blocage actif', tone: 'plum' as const }] : []),
    ...(payout.status === 'failed' ? [{ id: 'failed', title: 'Virement en échec', description: payout.failureReason ?? 'Motif inconnu', tone: 'danger' as const, time: toDate(payout.updatedAt) ? formatDateTime(toDate(payout.updatedAt) as Date) : undefined }] : []),
    ...(payout.status === 'paid' ? [{ id: 'paid', title: 'Virement émis', description: payout.providerTransferId ? `Transfert ${payout.providerTransferId}` : undefined, tone: 'success' as const, time: toDate(payout.paidAt) ? formatDateTime(toDate(payout.paidAt) as Date) : undefined }] : []),
    ...(payout.status === 'cancelled' ? [{ id: 'cancelled', title: 'Reversement annulé', description: payout.failureReason ?? undefined, tone: 'neutral' as const }] : []),
  ];

  async function downloadStatement() {
    if (!payout) return;
    setExporting(true);
    try {
      const pdf = await createPdf({
        title: 'Relevé de reversement',
        subtitle: [payout.beneficiaryName, `Période du ${day(payout.periodStart)} au ${day(payout.periodEnd)}`, `Réf. ${payoutId}`],
        footer: generatedFooter('GoLink'),
        caption: 'FINANCE',
      });
      if (payout.beneficiaryType === 'restaurant') {
        const st = await generateStatement({ payoutId });
        pdf.columns([
          { title: 'Émetteur', lines: [st.issuer.legalName, st.issuer.address, st.issuer.registrationNumber, st.issuer.vatNumber ? `TVA ${st.issuer.vatNumber}` : ''].filter(Boolean) },
          { title: 'Bénéficiaire', lines: [st.restaurant.legalName ?? st.restaurant.name, st.restaurant.address, st.restaurant.siret ? `SIRET ${st.restaurant.siret}` : '', st.restaurant.ibanMasked ? `IBAN ${st.restaurant.ibanMasked}` : ''].filter(Boolean) },
        ]);
      }
      pdf.kpis([
        { label: payout.beneficiaryType === 'restaurant' ? 'Ventes' : 'Gains', value: eur(payout.grossCents) },
        { label: 'Commission', value: eur(payout.commissionCents) },
        { label: 'Remboursements', value: eur(payout.refundsChargedCents) },
        { label: 'Net versé', value: eur(payout.netCents), accent: true },
      ]);
      pdf.table({
        head: ['Date', 'Mouvement', 'Libellé', 'Montant'],
        body: entries.data.map((e) => [day(e.bookingDate), LEDGER_ENTRY_TYPE_LABELS[e.type], e.description, eur(e.amountCents)]),
        foot: ['', '', 'Total', eur(entries.data.reduce((s, e) => s + e.amountCents, 0))],
        rightAligned: [3],
        columnWidths: { 0: 26, 1: 38, 3: 28 },
      });
      if (payout.status === 'paid') pdf.stamp(PAYOUT_STATUS_LABELS.paid, 'success');
      else if (payout.status === 'failed') pdf.stamp(PAYOUT_STATUS_LABELS.failed, 'danger');
      pdf.save(`releve-${payoutId}`);
    } catch (error) {
      toast.error(errorMessage(error, 'Le relevé n’a pas pu être généré.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Reversements', href: '/finance/reversements' }, { label: payout.beneficiaryName }]}
        eyebrow={payout.beneficiaryType === 'restaurant' ? 'Reversement commerce' : 'Reversement livreur'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {payout.beneficiaryName}
            <StatusBadge status={payout.status} map={PAYOUT_STATUS} />
          </span>
        }
        description={`Période ${periodLabel(payout.periodStart, payout.periodEnd)} · ${plural(payout.entriesCount, 'mouvement')}`}
        actions={
          <>
            <Button variant="secondary" size="sm" leftIcon={<Download />} loading={exporting} onClick={() => void downloadStatement()} disabled={entries.loading}>
              Relevé PDF
            </Button>
            {can('finance.adjust') && (
              <Button variant="secondary" size="sm" leftIcon={<SlidersHorizontal />} onClick={() => setDialog('adjust')}>
                Ajustement
              </Button>
            )}
            {can('finance.payouts') && payable && !isManual && (
              <Button variant="primary" size="sm" leftIcon={<Send />} onClick={() => setDialog('pay')}>
                {payout.status === 'failed' ? 'Relancer le virement' : 'Verser maintenant'}
              </Button>
            )}
            {can('finance.payouts') && payable && isManual && (
              <Button variant="primary" size="sm" leftIcon={<Send />} disabled={!localAccount?.verified} onClick={() => { setReference(''); setDialog('manual'); }}>
                Marquer comme viré
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isManual && payable && (
            <Callout tone="info" icon={<Landmark />} title="Virement manuel (pays sans Stripe)">
              {localAccount
                ? `Compte ${localAccount.accountMasked} au nom de ${localAccount.holderName} (${localAccount.currency}) — ${localAccount.verified ? 'vérifié' : 'à vérifier avant de virer'}. Effectuez le virement depuis la banque, puis enregistrez la référence.`
                : 'Le bénéficiaire n’a pas encore enregistré de compte de paiement local : demandez-lui de le renseigner.'}{' '}
              {localAccount && !localAccount.verified && can('finance.payouts') && (
                <Button size="sm" variant="secondary" leftIcon={<ShieldCheck />} onClick={() => setDialog('verify')}>Vérifier le compte</Button>
              )}
            </Callout>
          )}
          {payout.status === 'failed' && (
            <Callout tone="danger" title="Virement en échec">
              {payout.failureReason ?? 'Motif inconnu.'} Corrigez la cause puis relancez le virement.
            </Callout>
          )}
          {payout.status === 'on_hold' && (
            <Callout
              tone="plum"
              icon={<ShieldBan />}
              title="Reversements bloqués"
              action={hold && can('finance.hold') ? <Button size="sm" variant="secondary" onClick={() => setDialog('release')}>Lever le blocage</Button> : undefined}
            >
              {hold ? `${PAYOUT_HOLD_REASON_LABELS[hold.reason]}${hold.details ? ` — ${hold.details}` : ''}` : 'Un blocage est actif sur ce bénéficiaire.'}
            </Callout>
          )}
          <Card>
            <CardHeader title="Décomposition" description="Du brut au net versé" divided />
            <CardContent className="divide-y divide-border py-1">
              <DetailRow label={payout.beneficiaryType === 'restaurant' ? 'Ventes (articles, livraison propre)' : 'Gains de courses et bonus'} value={eur(payout.grossCents)} />
              {payout.tipsCents > 0 && <DetailRow label="Pourboires (100 % au livreur)" value={`+ ${eur(payout.tipsCents)}`} tone="success" />}
              {payout.commissionCents > 0 && <DetailRow label="Commission GoLink TTC" value={`− ${eur(payout.commissionCents)}`} />}
              {sumType(['payment_fee']) !== 0 && <DetailRow label="Frais de paiement" hint="Déduits du reversement (décision client)" value={`− ${eur(Math.abs(sumType(['payment_fee'])))}`} />}
              {payout.refundsChargedCents > 0 && <DetailRow label="Remboursements imputés" value={`− ${eur(payout.refundsChargedCents)}`} tone="danger" />}
              {payout.cashDeductedCents !== 0 && <DetailRow label="Espèces déjà encaissées" value={`− ${eur(payout.cashDeductedCents)}`} />}
              {sumType(['manual_adjustment']) !== 0 && <DetailRow label="Ajustements manuels" value={eur(sumType(['manual_adjustment']))} />}
              <DetailRow label="Net à verser" value={eur(payout.netCents)} strong />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Mouvements du grand livre" description="Chaque ligne reprise dans ce reversement" divided />
            <CardContent className="p-0">
              {entries.error ? (
                <div className="p-5"><ErrorPanel error={entries.error} compact /></div>
              ) : (
                <DataTable
                  data={entries.data}
                  columns={columns}
                  loading={entries.loading}
                  getRowId={(e) => e.id}
                  itemLabel="mouvements"
                  searchPlaceholder="Rechercher un libellé, une commande…"
                  className="border-0 shadow-none"
                  emptyState={<EmptyState compact title="Aucun mouvement rattaché" description="Les reversements de démonstration anciens ne détaillent pas toujours leurs mouvements." />}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Bénéficiaire" icon={payout.beneficiaryType === 'restaurant' ? <Building2 /> : <UserRound />} divided />
            <CardContent className="space-y-4">
              <div>
                <p className="font-medium text-fg">{payout.beneficiaryName}</p>
                <Link className="text-sm text-primary-soft-fg hover:underline" to={payout.beneficiaryType === 'restaurant' ? `/restaurants/${payout.beneficiaryId}` : `/livreurs/${payout.beneficiaryId}`}>
                  Ouvrir la fiche
                </Link>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Landmark className="size-4 text-fg-subtle" />
                {commercial.loading || driverPrivate.loading ? (
                  <Skeleton className="h-5 w-40" />
                ) : stripe ? (
                  <Badge tone={STRIPE_STATUS[stripe]?.tone ?? 'neutral'} icon={stripe === 'enabled' ? <BadgeCheck /> : undefined}>{STRIPE_STATUS[stripe]?.label ?? stripe}</Badge>
                ) : (
                  <Badge tone="danger">Aucun compte de paiement</Badge>
                )}
              </div>
              {stripeId && <p className="break-all font-mono text-xs text-fg-subtle">{stripeId}</p>}
              <div className="flex flex-wrap gap-2">
                {can('finance.hold') && !hold && (
                  <Button size="sm" variant="secondary" leftIcon={<ShieldBan />} onClick={() => setDialog('hold')}>
                    Bloquer
                  </Button>
                )}
                {can('finance.hold') && hold && (
                  <Button size="sm" variant="secondary" onClick={() => setDialog('release')}>
                    Lever le blocage
                  </Button>
                )}
                {can('finance.payouts') && ['scheduled', 'failed', 'on_hold'].includes(payout.status) && (
                  <Button size="sm" variant="danger-soft" leftIcon={<XCircle />} onClick={() => setDialog('cancel')}>
                    Annuler
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Suivi" divided />
            <CardContent>
              <Timeline items={timeline} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Contrôle" divided />
            <CardContent className="divide-y divide-border py-1">
              <DetailRow label="Total des mouvements" value={entries.loading ? '…' : eur(entries.data.filter((e) => e.type !== 'payout').reduce((s, e) => s + e.amountCents, 0))} />
              <DetailRow label="Net du reversement" value={eur(payout.netCents)} />
              <DetailRow label="Référence" value={<span className="break-all text-xs">{payoutId}</span>} />
            </CardContent>
          </Card>
        </div>
      </div>

      <HoldDialog open={dialog === 'hold'} onOpenChange={(o) => setDialog(o ? 'hold' : null)} beneficiary={beneficiary} />
      <AdjustmentDialog open={dialog === 'adjust'} onOpenChange={(o) => setDialog(o ? 'adjust' : null)} beneficiary={beneficiary} />
      <ActionDialog open={dialog === 'pay'} onOpenChange={(o) => setDialog(o ? 'pay' : null)} icon={<Send />} title={payout.status === 'failed' ? 'Relancer le virement' : 'Verser maintenant'} description={`${eur(payout.netCents)} vers le compte Stripe de ${payout.beneficiaryName}.`} confirmLabel="Émettre le virement" requireReason={false} onSubmit={async () => Boolean(await pay.mutate({ payoutId }))} />
      <ActionDialog open={dialog === 'manual'} onOpenChange={(o) => setDialog(o ? 'manual' : null)} icon={<Send />} title="Marquer comme viré" description={`${eur(payout.netCents)} virés à ${payout.beneficiaryName}. La référence du virement apparaît sur le relevé.`} confirmLabel="Enregistrer le virement" disabled={reference.trim().length < 4} onSubmit={async (reason) => Boolean(await manual.mutate({ payoutId, reference: reference.trim(), reason }))}>
        <FormField label="Référence du virement" hint="Numéro de l’opération sur le relevé bancaire.">
          <Input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
        </FormField>
      </ActionDialog>
      <ActionDialog open={dialog === 'verify'} onOpenChange={(o) => setDialog(o ? 'verify' : null)} icon={<ShieldCheck />} title="Vérifier le compte de paiement" description={localAccount ? `${localAccount.accountMasked} · ${localAccount.holderName}` : undefined} confirmLabel="Compte vérifié" onSubmit={async (reason) => Boolean(await verify.mutate({ beneficiaryType: payout.beneficiaryType, beneficiaryId: payout.beneficiaryId, verified: true, reason }))} />
      <ActionDialog open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)} destructive title="Annuler ce reversement" description="Aucun virement ne sera émis ; les mouvements seront repris au prochain calcul." confirmLabel="Annuler le reversement" onSubmit={async (reason) => Boolean(await cancel.mutate({ payoutId, reason }))} />
      <ActionDialog open={dialog === 'release'} onOpenChange={(o) => setDialog(o ? 'release' : null)} title="Lever le blocage" description="Les reversements bloqués redeviennent programmés et seront versés au prochain passage." confirmLabel="Lever le blocage" onSubmit={async (reason) => Boolean(hold && (await release.mutate({ holdId: hold.id, reason })))} />
    </PageContainer>
  );
}
