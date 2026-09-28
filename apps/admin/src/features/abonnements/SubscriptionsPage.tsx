import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AlarmClock,
  Ban,
  CalendarPlus,
  CreditCard,
  Gift,
  Layers,
  PauseCircle,
  PlayCircle,
  Repeat,
  RotateCw,
  TrendingUp,
  Undo2,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  RadioGroup,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatCard,
  StatusBadge,
  Timeline,
  createColumnHelper,
  formatDate,
  formatDateTime,
  type TimelineItem,
} from '@golink/ui';
import { type Plan, type PlanCode, type Subscription, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { toDate, useMutation } from '@/lib/firestore';
import { changePlan, manageSubscription, type SubscriptionAction } from '../argent-commun/api';
import { ActionDialog, Callout, DetailRow, ErrorPanel, Fact, Money } from '../argent-commun/components';
import { addDays, bps, eur, isoDay, parsePercent, plural } from '../argent-commun/format';
import { useDirectory } from '../argent-commun/hooks';
import { SUBSCRIPTION_STATUS } from '../argent-commun/status';
import { UNPAID_STATUSES, usePlans, useSubscriptions } from './hooks';
import { AbonnementsNav } from './nav';

type Row = WithId<Subscription>;
const col = createColumnHelper<Row>();
type View = 'all' | 'unpaid' | 'trial' | 'cancelled';

const HISTORY_LABELS: Record<Subscription['history'][number]['event'], string> = {
  created: 'Abonnement créé',
  upgraded: 'Passage à une formule supérieure',
  downgraded: 'Passage à une formule inférieure',
  renewed: 'Renouvellement',
  past_due: 'Facture non compensée : abonnement impayé',
  trial_converted: 'Fin de l’essai : abonnement payant',
  cancelled: 'Résiliation',
  reactivated: 'Réactivation',
  suspended: 'Suspension',
  restricted: 'Restriction pour impayé',
  restored: 'Rétablissement',
  trial_extended: 'Essai prolongé',
  offer_applied: 'Offre spéciale accordée',
  offer_removed: 'Offre spéciale retirée',
  cancel_scheduled: 'Résiliation programmée en fin de période',
};

/** Cycle de vie des abonnements (cahier §17) : essai, renouvellement, changement, résiliation, offres. */
export function SubscriptionsPage() {
  useDocumentTitle('Abonnements · Ciyou Eats Admin');
  const geo = useGeoScope();
  const directory = useDirectory();
  const subs = useSubscriptions();
  const plans = usePlans();
  const [view, setView] = useState<View>('all');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('abonnement');
  const setSelectedId = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('abonnement', id);
    else next.delete('abonnement');
    setParams(next, { replace: true });
  };
  const planName = (code: PlanCode) => plans.data.find((p) => p.code === code)?.name ?? code;

  const rows = useMemo(() => {
    switch (view) {
      case 'unpaid':
        return subs.data.filter((s) => UNPAID_STATUSES.includes(s.status));
      case 'trial':
        return subs.data.filter((s) => s.status === 'trialing');
      case 'cancelled':
        return subs.data.filter((s) => s.status === 'cancelled' || s.cancelAtPeriodEnd);
      default:
        return subs.data;
    }
  }, [subs.data, view]);

  const stats = useMemo(() => {
    const paying = subs.data.filter((s) => ['active', 'past_due', 'restricted'].includes(s.status));
    const mrr = paying.reduce((sum, s) => {
      const monthly = s.billingCycle === 'yearly' ? Math.round(s.priceHtCents / 12) : s.priceHtCents;
      return sum + Math.round(monthly * (1 - (s.specialOffer?.discountBps ?? 0) / 10_000));
    }, 0);
    return {
      mrr,
      active: subs.data.filter((s) => s.status === 'active').length,
      trial: subs.data.filter((s) => s.status === 'trialing').length,
      unpaid: subs.data.filter((s) => UNPAID_STATUSES.includes(s.status)),
      cancelling: subs.data.filter((s) => s.cancelAtPeriodEnd && s.status !== 'cancelled').length,
    };
  }, [subs.data]);

  const columns = useMemo(
    () => [
      col.accessor((r) => directory.name('restaurant', r.subscriberId), {
        id: 'restaurant',
        header: 'Commerce',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{geo.cities.find((c) => c.id === info.row.original.cityId)?.name ?? info.row.original.countryId}{info.row.original.subscriberType === 'group' ? ' · groupe' : ''}</p>
          </div>
        ),
      }),
      col.accessor('planCode', { header: 'Formule', cell: (info) => <Badge tone={info.getValue() === 'premium' ? 'plum' : info.getValue() === 'pro' ? 'brand' : 'neutral'}>{planName(info.getValue())}</Badge> }),
      col.accessor('priceHtCents', {
        header: 'Prix HT',
        meta: { align: 'right' },
        cell: (info) => (
          <div className="text-right">
            <Money cents={info.getValue()} className="text-fg" />
            <p className="text-2xs text-fg-subtle">{info.row.original.billingCycle === 'yearly' ? 'par an' : 'par mois'}</p>
          </div>
        ),
      }),
      col.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={info.getValue()} map={SUBSCRIPTION_STATUS} />
            {info.row.original.cancelAtPeriodEnd && info.getValue() !== 'cancelled' && <Badge size="sm" tone="amber" variant="outline">Fin programmée</Badge>}
            {info.row.original.specialOffer && <Badge size="sm" tone="teal" icon={<Gift />}>Offre</Badge>}
          </div>
        ),
      }),
      col.accessor((r) => toDate(r.currentPeriodEnd)?.getTime() ?? 0, {
        id: 'renewal',
        header: 'Échéance',
        cell: (info) => {
          const r = info.row.original;
          const trial = toDate(r.trialEndsAt);
          return (
            <span className="whitespace-nowrap text-fg-muted">
              {r.status === 'trialing' && trial ? `Fin d’essai ${formatDate(trial)}` : info.getValue() ? `${r.cancelAtPeriodEnd ? 'Se termine' : 'Renouvellement'} ${formatDate(info.getValue())}` : '—'}
            </span>
          );
        },
      }),
      col.accessor((r) => r.dunning?.attempts ?? 0, {
        id: 'dunning',
        header: 'Relances',
        meta: { align: 'right' },
        cell: (info) => (info.getValue() ? <Badge size="sm" tone="danger">{plural(info.getValue(), 'échec')}</Badge> : <span className="text-fg-subtle">—</span>),
      }),
    ],
    [directory, geo.cities, plans.data],
  );

  const selected = selectedId ? subs.data.find((s) => s.id === selectedId) ?? null : null;

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Abonnements et commissions" description="Cycle de vie des abonnements des commerces : essai, renouvellement, changement de formule, résiliation motivée et offres spéciales.">
        <AbonnementsNav />
      </PageHeader>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenu mensuel récurrent (HT)" icon={<TrendingUp />} tone="success" loading={subs.loading} value={eur(stats.mrr)} footer="Abonnements payants, offres déduites" />
          <StatCard label="Abonnements actifs" icon={<Users />} tone="brand" loading={subs.loading} value={String(stats.active)} footer={stats.cancelling ? `${plural(stats.cancelling, 'résiliation programmée', 'résiliations programmées')}` : 'Aucune résiliation programmée'} />
          <StatCard label="En période d’essai" icon={<AlarmClock />} tone="plum" loading={subs.loading} value={String(stats.trial)} footer={stats.trial ? 'Essais gratuits en cours' : 'Aucun essai en cours'} onClick={() => setView('trial')} />
          <StatCard label="Impayés" icon={<CreditCard />} tone="danger" loading={subs.loading} value={String(stats.unpaid.length)} footer={stats.unpaid.length ? `${eur(stats.unpaid.reduce((s, x) => s + x.priceHtCents, 0))} HT par mois en jeu` : 'Aucun impayé'} onClick={() => setView('unpaid')} />
        </div>

        <SegmentedControl
          aria-label="Filtre"
          value={view}
          onValueChange={(v) => setView(v as View)}
          options={[
            { value: 'all', label: 'Tous', count: subs.data.length },
            { value: 'unpaid', label: 'Impayés', count: stats.unpaid.length },
            { value: 'trial', label: 'Essai' },
            { value: 'cancelled', label: 'Résiliés' },
          ]}
        />

        {subs.error ? (
          <ErrorPanel error={subs.error} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={subs.loading || directory.loading}
            getRowId={(r) => r.id}
            onRowClick={(r) => setSelectedId(r.id)}
            itemLabel="abonnements"
            searchPlaceholder="Rechercher un commerce…"
            filters={[{ id: 'plan', label: 'Formule', options: plans.data.map((p) => ({ value: p.code, label: p.name })), getValue: (r) => r.planCode }]}
            emptyState={<EmptyState icon={<Repeat />} title="Aucun abonnement" description={view === 'all' ? 'Les commerces sur une formule gratuite n’ont pas d’abonnement à suivre.' : 'Aucun abonnement dans cette catégorie.'} />}
          />
        )}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          {selected && <SubscriptionSheet sub={selected} restaurantName={directory.name('restaurant', selected.subscriberId)} plans={plans.data} />}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

type DialogKind = SubscriptionAction | 'change_plan' | null;

function SubscriptionSheet({ sub, restaurantName, plans }: { sub: Row; restaurantName: string; plans: WithId<Plan>[] }) {
  const can = useCan();
  const manage = useMutation(manageSubscription, { success: 'Abonnement mis à jour' });
  const change = useMutation(changePlan, { success: (r) => (r.status === 'scheduled' ? 'Changement programmé en fin de période' : r.status === 'cancelled' ? 'Changement programmé annulé' : 'Formule changée') });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [days, setDays] = useState('14');
  const [planCode, setPlanCode] = useState<PlanCode>(sub.planCode);
  const [offer, setOffer] = useState({ discount: '', commission: '', freeUntil: '', endsAt: addDays(isoDay(new Date()), 90) });
  const canManage = can('subscriptions.manage');
  const unpaid = UNPAID_STATUSES.includes(sub.status);
  const trialEnd = toDate(sub.trialEndsAt);

  const timeline: TimelineItem[] = [...(sub.history ?? [])]
    .sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0))
    .map((h, i) => ({
      id: `${i}`,
      title: HISTORY_LABELS[h.event] ?? h.event,
      description: [plans.find((p) => p.code === h.planCode)?.name ?? h.planCode, h.reason].filter(Boolean).join(' · '),
      time: toDate(h.at) ? formatDateTime(toDate(h.at) as Date) : undefined,
      tone: ['cancelled', 'suspended', 'restricted'].includes(h.event) ? 'danger' : h.event === 'offer_applied' ? 'teal' : 'neutral',
    }));

  const run = async (action: SubscriptionAction, reason: string, extra: Record<string, unknown> = {}) => Boolean(await manage.mutate({ subscriptionId: sub.id, action, reason, ...extra }));
  const discountBps = offer.discount ? parsePercent(offer.discount) : 0;
  const commissionBps = offer.commission ? parsePercent(offer.commission) : 0;

  return (
    <>
      <SheetHeader title={restaurantName} description={`Abonnement ${plans.find((p) => p.code === sub.planCode)?.name ?? sub.planCode} · ${sub.billingCycle === 'yearly' ? 'annuel' : 'mensuel'}`} icon={<Repeat />} />
      <SheetBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={sub.status} map={SUBSCRIPTION_STATUS} />
          {sub.cancelAtPeriodEnd && sub.status !== 'cancelled' && <Badge tone="amber">Résiliation au {formatDate(toDate(sub.currentPeriodEnd) as Date)}</Badge>}
          {sub.pendingChange && <Badge tone="info">Passage à {plans.find((p) => p.code === sub.pendingChange?.planCode)?.name ?? sub.pendingChange.planCode} programmé</Badge>}
        </div>
        {unpaid && (
          <Callout tone="danger" title="Impayé en cours">
            {plural(sub.dunning?.attempts ?? 0, 'relance')} sans compensation sur les reversements
            {toDate(sub.dunning?.nextRetryAt) ? ` · prochaine tentative le ${formatDate(toDate(sub.dunning?.nextRetryAt) as Date)}` : ''}.
          </Callout>
        )}
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Prix HT">{eur(sub.priceHtCents)} {sub.billingCycle === 'yearly' ? '/ an' : '/ mois'}</Fact>
          <Fact label="Période en cours">{toDate(sub.currentPeriodStart) ? formatDate(toDate(sub.currentPeriodStart) as Date) : '—'} → {toDate(sub.currentPeriodEnd) ? formatDate(toDate(sub.currentPeriodEnd) as Date) : '—'}</Fact>
          <Fact label="Essai">{trialEnd ? `jusqu’au ${formatDate(trialEnd)}` : 'Aucun'}</Fact>
          <Fact label="Résiliation">{sub.cancelReason ?? '—'}</Fact>
        </dl>
        {sub.specialOffer && (
          <div className="tone-teal rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-fg"><Gift className="size-4 text-(--tone-fg)" />Offre spéciale</p>
            <p className="mt-1 text-sm text-fg-muted">{sub.specialOffer.reason}</p>
            <div className="mt-2 divide-y divide-border">
              {sub.specialOffer.discountBps > 0 && <DetailRow label="Remise sur l’abonnement" value={bps(sub.specialOffer.discountBps)} />}
              {toDate(sub.specialOffer.freeUntil) && <DetailRow label="Gratuit jusqu’au" value={formatDate(toDate(sub.specialOffer.freeUntil) as Date)} />}
            </div>
          </div>
        )}
        <div>
          <p className="eyebrow mb-3">Historique</p>
          {timeline.length ? <Timeline items={timeline} /> : <p className="text-sm text-fg-muted">Aucun évènement.</p>}
        </div>
        {(sub.dunning?.log?.length ?? 0) > 0 && (
          <div>
            <p className="eyebrow mb-2">Journal des relances</p>
            <ul className="space-y-1.5 text-sm">
              {[...(sub.dunning.log ?? [])].reverse().map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-fg-muted">{{ retry_failed: 'Tentative en échec', retry_succeeded: 'Paiement régularisé', reminder_sent: 'Relance envoyée', restricted: 'Restriction', suspended: 'Suspension', restored: 'Rétablissement' }[l.kind]}{l.note ? ` — ${l.note}` : ''}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">{toDate(l.at) ? formatDateTime(toDate(l.at) as Date) : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SheetBody>
      {canManage && (
        <SheetFooter className="flex-wrap justify-start gap-2">
          {sub.status !== 'cancelled' && <Button size="sm" variant="secondary" leftIcon={<Layers />} onClick={() => setDialog('change_plan')}>Changer de formule</Button>}
          {['active', 'trialing'].includes(sub.status) && <Button size="sm" variant="secondary" leftIcon={<CalendarPlus />} onClick={() => setDialog('extend_trial')}>Prolonger l’essai</Button>}
          {sub.status !== 'cancelled' && (sub.specialOffer ? <Button size="sm" variant="secondary" leftIcon={<Gift />} onClick={() => setDialog('clear_offer')}>Retirer l’offre</Button> : <Button size="sm" variant="secondary" leftIcon={<Gift />} onClick={() => setDialog('special_offer')}>Offre spéciale</Button>)}
          {['past_due', 'restricted'].includes(sub.status) && <Button size="sm" variant="secondary" leftIcon={<RotateCw />} onClick={() => setDialog('retry_payment')}>Relancer la compensation</Button>}
          {unpaid && <Button size="sm" variant="secondary" leftIcon={<CreditCard />} onClick={() => setDialog('mark_paid')}>Paiement reçu</Button>}
          {sub.status === 'suspended' && <Button size="sm" variant="secondary" leftIcon={<PlayCircle />} onClick={() => setDialog('restore')}>Rétablir</Button>}
          {!['suspended', 'cancelled'].includes(sub.status) && <Button size="sm" variant="ghost" leftIcon={<PauseCircle />} onClick={() => setDialog('suspend')}>Suspendre</Button>}
          {(sub.status === 'cancelled' || sub.cancelAtPeriodEnd) && <Button size="sm" variant="secondary" leftIcon={<Undo2 />} onClick={() => setDialog('reactivate')}>Réactiver</Button>}
          {sub.status !== 'cancelled' && !sub.cancelAtPeriodEnd && <Button size="sm" variant="danger-soft" leftIcon={<XCircle />} onClick={() => setDialog('cancel')}>Résilier</Button>}
        </SheetFooter>
      )}

      <ActionDialog open={dialog === 'change_plan'} onOpenChange={(o) => setDialog(o ? 'change_plan' : null)} icon={<Layers />} title="Changer de formule" description="Formule supérieure : effet immédiat (essai offert s’il n’a jamais été utilisé). Formule inférieure : effet en fin de période." confirmLabel="Appliquer" disabled={planCode === sub.planCode && !sub.pendingChange} onSubmit={async (reason) => Boolean(await change.mutate({ restaurantId: sub.subscriberId, planCode, reason }))}>
        <RadioGroup variant="cards" value={planCode} onValueChange={(v) => setPlanCode(v as PlanCode)} options={plans.map((p) => ({ value: p.code, label: p.name, description: `${eur(p.monthlyPriceHtCents)} HT / mois${p.code === sub.planCode ? ' · formule actuelle' : ''}` }))} />
      </ActionDialog>
      <ActionDialog open={dialog === 'extend_trial'} onOpenChange={(o) => setDialog(o ? 'extend_trial' : null)} icon={<CalendarPlus />} title="Prolonger l’essai" confirmLabel="Prolonger" disabled={!(Number(days) >= 1 && Number(days) <= 365)} onSubmit={(reason) => run('extend_trial', reason, { days: Number(days) })}>
        <FormField label="Jours supplémentaires"><Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} trailing="jours" /></FormField>
      </ActionDialog>
      <ActionDialog
        open={dialog === 'special_offer'}
        onOpenChange={(o) => setDialog(o ? 'special_offer' : null)}
        icon={<Gift />}
        title="Offre spéciale"
        description="Réduction ou gratuité temporaire de l’abonnement, et réduction temporaire de la commission. Le motif est visible dans l’historique."
        confirmLabel="Accorder l’offre"
        reasonLabel="Motif de l’offre"
        disabled={discountBps === null || commissionBps === null || !offer.endsAt || (!discountBps && !commissionBps && !offer.freeUntil)}
        onSubmit={(reason) => run('special_offer', reason, { discountBps: discountBps || null, commissionReductionBps: commissionBps || null, freeUntil: offer.freeUntil || null, offerEndsAt: offer.endsAt })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Remise sur l’abonnement" hint="En pourcentage."><Input inputMode="decimal" value={offer.discount} placeholder="0" trailing="%" invalid={discountBps === null} onChange={(e) => setOffer({ ...offer, discount: e.target.value })} /></FormField>
          <FormField label="Réduction de commission" hint="Points retirés du taux."><Input inputMode="decimal" value={offer.commission} placeholder="0" trailing="pts" invalid={commissionBps === null} onChange={(e) => setOffer({ ...offer, commission: e.target.value })} /></FormField>
          <FormField label="Abonnement gratuit jusqu’au" hint="Facultatif."><Input type="date" value={offer.freeUntil} min={isoDay(new Date())} onChange={(e) => setOffer({ ...offer, freeUntil: e.target.value })} /></FormField>
          <FormField label="Fin de l’offre" required><Input type="date" value={offer.endsAt} min={addDays(isoDay(new Date()), 1)} onChange={(e) => setOffer({ ...offer, endsAt: e.target.value })} /></FormField>
        </div>
      </ActionDialog>
      <ActionDialog open={dialog === 'clear_offer'} onOpenChange={(o) => setDialog(o ? 'clear_offer' : null)} title="Retirer l’offre spéciale" confirmLabel="Retirer l’offre" onSubmit={(reason) => run('clear_offer', reason)} />
      <ActionDialog open={dialog === 'retry_payment'} onOpenChange={(o) => setDialog(o ? 'retry_payment' : null)} icon={<RotateCw />} title="Relancer la compensation" description="Nouvelle tentative immédiate de retenue sur les reversements du commerce ; il est relancé par message en cas d’échec." confirmLabel="Relancer" onSubmit={(reason) => run('retry_payment', reason)} />
      <ActionDialog open={dialog === 'mark_paid'} onOpenChange={(o) => setDialog(o ? 'mark_paid' : null)} icon={<CreditCard />} title="Paiement reçu" description="L’abonnement redevient actif, les factures en retard sont marquées payées et un éventuel blocage pour impayé est levé." confirmLabel="Confirmer le paiement" onSubmit={(reason) => run('mark_paid', reason)} />
      <ActionDialog open={dialog === 'restore'} onOpenChange={(o) => setDialog(o ? 'restore' : null)} icon={<PlayCircle />} title="Rétablir l’abonnement" confirmLabel="Rétablir" onSubmit={(reason) => run('restore', reason)} />
      <ActionDialog open={dialog === 'suspend'} onOpenChange={(o) => setDialog(o ? 'suspend' : null)} destructive icon={<Ban className="text-danger" />} title="Suspendre l’abonnement" description="Les fonctionnalités de la formule sont coupées jusqu’au rétablissement." confirmLabel="Suspendre" onSubmit={(reason) => run('suspend', reason)} />
      <ActionDialog open={dialog === 'reactivate'} onOpenChange={(o) => setDialog(o ? 'reactivate' : null)} icon={<Undo2 />} title="Réactiver l’abonnement" description={sub.status === 'cancelled' ? 'Une nouvelle période commence aujourd’hui.' : 'La résiliation programmée est annulée.'} confirmLabel="Réactiver" onSubmit={(reason) => run('reactivate', reason)} />
      <CancelDialog open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)} periodEnd={toDate(sub.currentPeriodEnd)} onConfirm={(reason, now) => run(now ? 'cancel_now' : 'cancel', reason)} />
    </>
  );
}

function CancelDialog({ open, onOpenChange, periodEnd, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; periodEnd: Date | null; onConfirm: (reason: string, now: boolean) => Promise<boolean> }) {
  const [when, setWhen] = useState<'end' | 'now'>('end');
  return (
    <ActionDialog open={open} onOpenChange={onOpenChange} destructive icon={<XCircle className="text-danger" />} title="Résilier l’abonnement" confirmLabel="Résilier" reasonLabel="Motif de résiliation (obligatoire)" onSubmit={(reason) => onConfirm(reason, when === 'now')}>
      <RadioGroup
        variant="cards"
        value={when}
        onValueChange={(v) => setWhen(v as 'end' | 'now')}
        options={[
          { value: 'end', label: 'En fin de période', description: periodEnd ? `Le commerce garde sa formule jusqu’au ${formatDate(periodEnd)}.` : 'À la fin de la période en cours.' },
          { value: 'now', label: 'Immédiatement', description: 'Les fonctionnalités de la formule sont coupées dès maintenant.' },
        ]}
      />
    </ActionDialog>
  );
}
