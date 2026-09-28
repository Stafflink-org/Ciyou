import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowRight, CalendarClock, Check, Crown, FileText, Gem, History, Rocket, Sparkles, Undo2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  StatusPill,
  Timeline,
  cn,
  formatDate,
  formatEUR,
  type Tone,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_PLANS,
  BILLING_MODE_LABELS,
  INVOICE_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatBps,
  formatDistance,
  type Invoice,
  type PlanCode,
  type Subscription,
  type SubscriptionStatus,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';
import { changePlan } from '../parametres/kit/api';
import { planOf, useCommercial, usePlans } from '../parametres/kit/hooks';
import { LoadError, Notice } from '../parametres/kit/ui';

const FEATURE_LABELS: Record<string, string> = {
  orders: 'Commandes en temps réel',
  menu: 'Carte, options et stocks',
  finance: 'Finances et relevés',
  messaging: 'Messagerie clients et livreurs',
  promo_codes: 'Codes promo',
  loyalty: 'Programme de fidélité',
  push_campaigns: 'Campagnes de notifications',
  team: 'Gestion d’équipe',
  planning: 'Planning',
  timeclock: 'Pointage',
  absences: 'Congés et absences',
  tasks: 'Tâches',
  documents: 'Documents d’équipe',
  payroll: 'Préparation de la paie',
  haccp: 'Registre HACCP',
  multi_outlet: 'Multi-établissements',
  pos_integration: 'Caisse connectée',
  priority_support: 'Support prioritaire',
};

const PLAN_ICONS: Record<PlanCode, ReactNode> = { basic: <Sparkles />, pro: <Rocket />, premium: <Crown /> };
const RANK: Record<PlanCode, number> = { basic: 0, pro: 1, premium: 2 };

const STATUS_TONES: Record<SubscriptionStatus, Tone> = {
  trialing: 'plum',
  active: 'success',
  past_due: 'danger',
  restricted: 'danger',
  suspended: 'danger',
  cancelled: 'neutral',
};

const HISTORY_LABELS: Record<Subscription['history'][number]['event'], string> = {
  created: 'Abonnement créé',
  upgraded: 'Passage à une formule supérieure',
  downgraded: 'Passage à une formule inférieure',
  renewed: 'Renouvellement',
  past_due: 'Facture non compensée : règlement en attente',
  trial_converted: 'Fin de l’essai : abonnement payant',
  cancelled: 'Résiliation',
  reactivated: 'Réactivation',
  suspended: 'Suspension',
  restricted: 'Accès restreint',
  restored: 'Accès rétabli',
  trial_extended: 'Période d’essai prolongée',
  offer_applied: 'Offre commerciale appliquée',
  offer_removed: 'Offre commerciale retirée',
  cancel_scheduled: 'Résiliation programmée',
};

/** Seuil de ventes livrées mensuelles à partir duquel une formule payante est rentable (centimes). */
function breakEvenCents(priceHtCents: number, commissionGainBps: number): number | null {
  if (priceHtCents <= 0 || commissionGainBps <= 0) return null;
  return Math.ceil((priceHtCents * 10_000) / commissionGainBps / 100) * 100;
}

/** Formule d'abonnement, comparaison, changement de formule, historique et factures. */
export function AbonnementPage() {
  const { restaurant, restaurantId, member } = useRestaurantAccess();
  const can = useCan();
  const isOwner = member.role === 'owner';
  const commercial = useCommercial();
  const plans = usePlans();
  const subscriptions = useCollection<Subscription>(
    query(collection(db, COLLECTIONS.subscriptions), where('subscriberType', '==', 'restaurant'), where('subscriberId', '==', restaurantId), limit(3)),
  );
  const invoices = useCollection<Invoice>(
    can('invoices.view')
      ? query(
          collection(db, COLLECTIONS.invoices),
          where('recipient.type', '==', 'restaurant'),
          where('recipient.id', '==', restaurantId),
          where('kind', '==', 'subscription_invoice'),
          orderBy('issuedAt', 'desc'),
          limit(12),
        )
      : null,
  );
  const [target, setTarget] = useState<PlanCode | null>(null);
  const change = useMutation(changePlan, {
    success: (r) =>
      r.status === 'cancelled'
        ? 'Changement de formule annulé.'
        : r.status === 'scheduled'
          ? `Changement programmé au ${r.effectiveAt ? formatDate(r.effectiveAt) : 'prochain renouvellement'}.`
          : r.trial
            ? 'Nouvelle formule active, avec sa période d’essai.'
            : 'Nouvelle formule active dès maintenant.',
  });

  const subscription = useMemo(() => {
    const list = subscriptions.data.filter((s) => s.status !== 'cancelled');
    return list.find((s) => s.id === commercial.data?.subscriptionId) ?? list[0] ?? null;
  }, [subscriptions.data, commercial.data?.subscriptionId]);

  const currentCode = (commercial.data?.planCode ?? restaurant.planCode) as PlanCode;
  const current = planOf(plans.data, currentCode);
  const negotiated = commercial.data?.negotiatedCommission;
  const rates = {
    platformDeliveryBps: negotiated?.platformDeliveryBps ?? current.commission.platformDeliveryBps,
    restaurantDeliveryBps: negotiated?.restaurantDeliveryBps ?? current.commission.restaurantDeliveryBps,
    pickupBps: negotiated?.pickupBps ?? current.commission.pickupBps,
  };
  const pending = subscription?.pendingChange ?? null;
  const pendingAt = toDate(pending?.effectiveAt);
  const trialEnd = toDate(subscription?.trialEndsAt);
  const periodEnd = toDate(subscription?.currentPeriodEnd);
  const status: SubscriptionStatus = subscription?.status ?? commercial.data?.subscriptionStatus ?? 'active';
  const blocked = ['past_due', 'restricted', 'suspended'].includes(status);

  const header = (
    <PageHeader
      eyebrow="Configuration"
      title="Abonnement"
      description="Votre formule Ciyou Eats, les commissions qui s’appliquent à vos ventes, et vos factures d’abonnement."
    />
  );

  if (commercial.error || plans.error || subscriptions.error)
    return (
      <PageContainer>
        {header}
        <LoadError message={errorMessage(commercial.error ?? plans.error ?? subscriptions.error)} />
      </PageContainer>
    );
  if (commercial.loading || plans.loading || subscriptions.loading)
    return (
      <PageContainer>
        {header}
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-96 rounded-xl" />
          ))}
        </div>
      </PageContainer>
    );

  const targetPlan = target ? planOf(plans.data, target) : null;
  const isUpgrade = target ? RANK[target] > RANK[currentCode] : false;
  const trialEligible = Boolean(targetPlan && isUpgrade && targetPlan.trialDays > 0 && !subscription?.trialEndsAt);

  return (
    <PageContainer>
      {header}
      <div className="space-y-8">
        {blocked && (
          <Notice tone="danger" title="Abonnement impayé">
            Réglez la facture en attente pour retrouver toutes vos fonctionnalités. Le changement de formule est bloqué en attendant.
          </Notice>
        )}

        <Card className="overflow-hidden">
          <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
            <div className="flex min-w-0 items-start gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary-soft-fg [&_svg]:size-7">{PLAN_ICONS[currentCode]}</div>
              <div className="min-w-0">
                <p className="eyebrow">Votre formule</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-2xl font-semibold tracking-display text-fg">{current.name}</h2>
                  <StatusPill tone={STATUS_TONES[status]}>{SUBSCRIPTION_STATUS_LABELS[status]}</StatusPill>
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  {status === 'trialing' && trialEnd
                    ? `Essai gratuit jusqu’au ${formatDate(trialEnd)}, puis ${formatEUR(current.monthlyPriceHtCents, { cents: true })} HT par mois.`
                    : current.monthlyPriceHtCents > 0
                      ? `${formatEUR(current.monthlyPriceHtCents, { cents: true })} HT par mois${periodEnd ? ` · prochain renouvellement le ${formatDate(periodEnd)}` : ''}.`
                      : 'Sans abonnement mensuel : vous ne payez que la commission sur vos ventes.'}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-2 p-3 text-center sm:gap-4 sm:p-4">
              {[
                { label: 'Livraison Ciyou Eats', value: rates.platformDeliveryBps },
                { label: 'Vos livreurs', value: rates.restaurantDeliveryBps },
                { label: 'Retrait', value: rates.pickupBps },
              ].map((r) => (
                <div key={r.label} className="min-w-0">
                  <dt className="truncate text-2xs text-fg-subtle">{r.label}</dt>
                  <dd className="mt-0.5 font-display text-xl font-semibold text-fg num">{formatBps(r.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-5 py-3 text-xs text-fg-muted">
            <span>Commission calculée sur le montant TTC des articles, hors frais de livraison et pourboires{negotiated ? ', conditions négociées avec Ciyou Eats' : ''}. Facturée HT, TVA en sus.</span>
            {negotiated?.validUntil && toDate(negotiated.validUntil) && <Badge size="sm">Jusqu’au {formatDate(toDate(negotiated.validUntil)!)}</Badge>}
          </div>
        </Card>

        {pending && (
          <Notice
            tone="amber"
            icon={<CalendarClock />}
            title={`Passage à ${planOf(plans.data, pending.planCode).name} programmé`}
            action={
              isOwner && (
                <Button size="sm" variant="secondary" leftIcon={<Undo2 />} loading={change.loading} onClick={() => void change.mutate({ restaurantId, planCode: currentCode, reason: null })}>
                  Annuler ce changement
                </Button>
              )
            }
          >
            Vous gardez {current.name} et ses avantages jusqu’au {pendingAt ? formatDate(pendingAt) : 'prochain renouvellement'}.
          </Notice>
        )}

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight text-fg">Comparer les formules</h2>
              <p className="text-sm text-fg-muted">Prix HT par établissement, conditions en vigueur fixées par Ciyou Eats.</p>
            </div>
            {!isOwner && <p className="text-xs text-fg-subtle">Seul le propriétaire peut changer de formule.</p>}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {DEFAULT_PLANS.map((base) => {
              const plan = planOf(plans.data, base.code);
              const isCurrent = base.code === currentCode;
              const isPending = pending?.planCode === base.code;
              const up = RANK[base.code] > RANK[currentCode];
              const gain = current.commission.platformDeliveryBps - plan.commission.platformDeliveryBps;
              const threshold = up ? breakEvenCents(plan.monthlyPriceHtCents - current.monthlyPriceHtCents, gain) : null;
              const features = plan.features;
              return (
                <Card key={base.code} className={cn('relative flex flex-col p-5', isCurrent && 'border-primary ring-1 ring-primary')}>
                  {isCurrent && (
                    <Badge tone="brand" className="absolute right-4 top-4">
                      Votre formule
                    </Badge>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{PLAN_ICONS[base.code]}</span>
                    <p className="font-display text-lg font-semibold tracking-tight text-fg">{plan.name}</p>
                  </div>
                  <p className="mt-4 flex items-baseline gap-1">
                    <span className="font-display text-3xl font-semibold tracking-display text-fg num">{formatEUR(plan.monthlyPriceHtCents, { cents: true })}</span>
                    <span className="text-sm text-fg-subtle">HT / mois</span>
                  </p>
                  <p className="mt-1 min-h-5 text-xs text-fg-subtle">
                    {[
                      BILLING_MODE_LABELS[plan.billingMode],
                      plan.commitmentMonths > 0 ? `engagement ${plan.commitmentMonths} mois` : 'sans engagement',
                      plan.trialDays > 0 ? `${plan.trialDays} jours d’essai` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {plan.description && <p className="mt-3 text-sm text-fg-muted">{plan.description}</p>}
                  <dl className="mt-4 space-y-1.5 rounded-lg bg-surface-2 p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-fg-muted">Commission livraison Ciyou Eats</dt>
                      <dd className="font-mono text-fg num">{formatBps(plan.commission.platformDeliveryBps)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-fg-muted">Vos livreurs</dt>
                      <dd className="font-mono text-fg num">{formatBps(plan.commission.restaurantDeliveryBps)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-fg-muted">Retrait</dt>
                      <dd className="font-mono text-fg num">{formatBps(plan.commission.pickupBps)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-fg-muted">Rayon de livraison</dt>
                      <dd className="font-mono text-fg num">{formatDistance(plan.maxDeliveryRadiusMeters)}</dd>
                    </div>
                  </dl>
                  {features.length === 0 && plan.includedOutlets <= 1 && (
                    <p className="mt-4 flex-1 text-sm text-fg-subtle">Le détail des avantages de cette formule sera communiqué par Ciyou Eats.</p>
                  )}
                  <ul className={cn('mt-4 space-y-2 text-sm', (features.length > 0 || plan.includedOutlets > 1) && 'flex-1')}>
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-fg">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        {FEATURE_LABELS[f] ?? f}
                      </li>
                    ))}
                    {plan.includedOutlets > 1 && (
                      <li className="flex items-start gap-2 text-fg">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        {plan.includedOutlets} établissements inclus
                      </li>
                    )}
                  </ul>
                  {threshold && (
                    <p className="mt-4 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-fg-muted">
                      Rentable dès <span className="font-medium text-fg num">{formatEUR(threshold, { cents: true })}</span> de ventes livrées par mois.
                    </p>
                  )}
                  <div className="mt-5">
                    {isCurrent ? (
                      <Button block variant="secondary" disabled leftIcon={<Check />}>
                        Formule actuelle
                      </Button>
                    ) : isPending ? (
                      <Button block variant="secondary" disabled leftIcon={<CalendarClock />}>
                        Programmée
                      </Button>
                    ) : (
                      <Button
                        block
                        variant={up ? 'primary' : 'secondary'}
                        rightIcon={<ArrowRight />}
                        disabled={!isOwner || blocked}
                        onClick={() => setTarget(base.code)}
                      >
                        {up ? `Passer à ${plan.name}` : `Revenir à ${plan.name}`}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 font-display text-md font-semibold tracking-tight text-fg">
                <FileText className="size-4 text-fg-muted" />
                Factures d’abonnement
              </h2>
              {can('invoices.view') && (
                <Button asChild variant="ghost" size="sm">
                  <Link to="/factures">Toutes les factures</Link>
                </Button>
              )}
            </div>
            {!can('invoices.view') ? (
              <p className="px-5 py-6 text-sm text-fg-muted">L’accès aux factures n’est pas inclus dans vos droits.</p>
            ) : invoices.error ? (
              <div className="p-5">
                <LoadError message={errorMessage(invoices.error)} />
              </div>
            ) : invoices.loading ? (
              <div className="space-y-2 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : invoices.data.length === 0 ? (
              <EmptyState compact icon={<FileText />} title="Aucune facture d’abonnement" description="Les factures apparaîtront ici à chaque échéance." />
            ) : (
              <>
              {/* Mobile : liste empilée, sans défilement horizontal. */}
              <ul className="divide-y divide-border sm:hidden">
                {invoices.data.map((inv) => {
                  const issued = toDate(inv.issuedAt);
                  return (
                    <li key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-fg num">{inv.number}</p>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {inv.periodStart ? new Date(inv.periodStart).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : issued ? formatDate(issued) : '—'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-mono text-sm text-fg num">{formatEUR(inv.totalTtcCents, { cents: true })}</span>
                        <StatusPill tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'info'}>{INVOICE_STATUS_LABELS[inv.status]}</StatusPill>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-surface-2">
                    <tr className="text-left">
                      {['Numéro', 'Période', 'Montant TTC', 'Statut'].map((h, i) => (
                        <th key={h} className={cn('px-5 py-2 font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle', i === 2 && 'text-right')}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoices.data.map((inv) => {
                      const issued = toDate(inv.issuedAt);
                      return (
                        <tr key={inv.id}>
                          <td className="px-5 py-2.5 font-mono text-xs text-fg num">{inv.number}</td>
                          <td className="px-5 py-2.5 text-fg-muted">{inv.periodStart ? new Date(inv.periodStart).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : issued ? formatDate(issued) : '—'}</td>
                          <td className="px-5 py-2.5 text-right font-mono text-fg num">{formatEUR(inv.totalTtcCents, { cents: true })}</td>
                          <td className="px-5 py-2.5">
                            <StatusPill tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'info'}>{INVOICE_STATUS_LABELS[inv.status]}</StatusPill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 font-display text-md font-semibold tracking-tight text-fg">
                <History className="size-4 text-fg-muted" />
                Historique
              </h2>
            </div>
            <div className="p-5">
              {subscription && subscription.history.length > 0 ? (
                <Timeline
                  items={[...subscription.history]
                    .sort((a, b) => b.at.toMillis() - a.at.toMillis())
                    .slice(0, 8)
                    .map((h, i) => ({
                      id: String(i),
                      title: `${HISTORY_LABELS[h.event]} · ${planOf(plans.data, h.planCode).name}`,
                      description: h.reason ?? undefined,
                      time: formatDate(h.at.toDate()),
                      tone: h.event === 'upgraded' ? 'success' : h.event === 'downgraded' ? 'amber' : 'neutral',
                    }))}
                />
              ) : (
                <EmptyState compact icon={<Gem />} title="Aucun changement" description="Vous êtes sur votre formule d’origine." />
              )}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={targetPlan ? (isUpgrade ? `Passer à ${targetPlan.name} ?` : `Revenir à ${targetPlan.name} ?`) : ''}
        description={
          targetPlan
            ? isUpgrade
              ? trialEligible
                ? `${targetPlan.trialDays} jours d’essai offerts, puis ${formatEUR(targetPlan.monthlyPriceHtCents, { cents: true })} HT par mois. Les nouvelles commissions s’appliquent dès maintenant.`
                : `${formatEUR(targetPlan.monthlyPriceHtCents, { cents: true })} HT par mois, facturé sur votre prochaine échéance. Les nouvelles commissions s’appliquent dès maintenant.`
              : `Le changement prendra effet le ${periodEnd ? formatDate(periodEnd) : 'jour du prochain renouvellement'} : vous gardez ${current.name} jusque-là.`
            : ''
        }
        confirmLabel={isUpgrade ? 'Confirmer le changement' : 'Programmer le changement'}
        onConfirm={async () => {
          if (!target) return;
          await change.mutate({ restaurantId, planCode: target, reason: null });
        }}
      >
        {targetPlan && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 text-sm">
            <span className="text-fg-muted">Commission livraison</span>
            <span className="text-right font-mono text-fg num">
              {formatBps(current.commission.platformDeliveryBps)} → {formatBps(targetPlan.commission.platformDeliveryBps)}
            </span>
            <span className="text-fg-muted">Rayon de livraison</span>
            <span className="text-right font-mono text-fg num">
              {formatDistance(current.maxDeliveryRadiusMeters)} → {formatDistance(targetPlan.maxDeliveryRadiusMeters)}
            </span>
          </div>
        )}
      </ConfirmDialog>
    </PageContainer>
  );
}
