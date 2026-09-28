import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { BellRing, CircleSlash, CreditCard, Mail, Save, ShieldBan } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Skeleton,
  StatusBadge,
  Switch,
  formatDate,
  formatDateTime,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_DUNNING_SETTINGS,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  SETTINGS_DOCS,
  type DunningSettings,
  type Invoice,
  type Payment,
  type PlanFeatureKey,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { updateFinanceSettings } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel, Money } from '../argent-commun/components';
import { eur, plural } from '../argent-commun/format';
import { inGeo, useDirectory } from '../argent-commun/hooks';
import { SUBSCRIPTION_STATUS } from '../argent-commun/status';
import { UNPAID_STATUSES, usePlans, useSubscriptions } from './hooks';
import { AbonnementsNav } from './nav';

type Draft = Omit<DunningSettings, 'updatedAt' | 'updatedBy'>;

/** Impayés d'abonnement (cahier §17) : relances automatiques, puis restriction, puis suspension. */
export function DunningPage() {
  useDocumentTitle('Impayés et relances · Ciyou Eats Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const subs = useSubscriptions();
  const plans = usePlans();
  const settings = useDoc<DunningSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.dunning}`));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useMutation(updateFinanceSettings, { success: 'Règles de relance enregistrées' });
  const canPayments = can('payments.view');
  const failedQuery = useMemo(() => (canPayments ? query(collection(db, COLLECTIONS.payments), where('status', '==', 'failed'), orderBy('createdAt', 'desc'), limit(100)) : null), [canPayments]);
  const failed = useCollection<Payment>(failedQuery);
  const failedSubs = failed.data.filter((p) => p.purpose === 'subscription' && inGeo(geo, p));
  // Factures d'abonnement retenues sur les reversements et pas encore compensées (solde à reverser insuffisant).
  const canInvoices = can('invoices.view');
  const pendingQuery = useMemo(() => (canInvoices ? query(collection(db, COLLECTIONS.invoices), where('compensation.status', '==', 'pending'), limit(100)) : null), [canInvoices]);
  const pendingInvoices = useCollection<Invoice>(pendingQuery);
  const pendingList = pendingInvoices.data.filter((i) => inGeo(geo, i));

  useEffect(() => {
    if (!settings.loading) {
      const { updatedAt: _u, updatedBy: _b, ...rest } = (settings.data ?? {}) as Partial<DunningSettings>;
      setDraft({ ...DEFAULT_DUNNING_SETTINGS, ...rest });
    }
  }, [settings.loading, settings.data]);

  const unpaid = subs.data.filter((s) => UNPAID_STATUSES.includes(s.status)).sort((a, b) => (b.dunning?.attempts ?? 0) - (a.dunning?.attempts ?? 0));
  const editable = can('subscriptions.manage');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Impayés et relances" description="Relances automatiques des abonnements impayés, puis restriction des fonctionnalités et suspension après le délai de grâce de la formule.">
        <AbonnementsNav />
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Abonnements en impayé" description={`${plural(unpaid.length, 'abonnement')} à régulariser`} icon={<CreditCard />} divided />
            <CardContent className="p-0">
              {subs.loading ? (
                <div className="space-y-2 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : subs.error ? (
                <div className="p-5"><ErrorPanel error={subs.error} compact /></div>
              ) : unpaid.length === 0 ? (
                <EmptyState compact icon={<BellRing />} title="Aucun impayé" description="Tous les abonnements sont à jour." />
              ) : (
                <ul className="divide-y divide-border">
                  {unpaid.map((s) => {
                    const plan = plans.data.find((p) => p.code === s.planCode);
                    const next = toDate(s.dunning?.nextRetryAt);
                    return (
                      <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium text-fg">{directory.name('restaurant', s.subscriberId)}</p>
                            <StatusBadge status={s.status} map={SUBSCRIPTION_STATUS} />
                          </div>
                          <p className="mt-0.5 text-xs text-fg-subtle">
                            {plan?.name ?? s.planCode} · {eur(s.priceHtCents)} HT / mois · {plural(s.dunning?.attempts ?? 0, 'relance')} sans compensation
                            {next ? ` · prochaine tentative le ${formatDate(next)}` : ''}
                            {toDate(s.dunning?.restrictedAt) ? ` · restreint depuis le ${formatDate(toDate(s.dunning?.restrictedAt) as Date)}` : ''}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="secondary">
                          <Link to={`/abonnements?abonnement=${s.id}`}>Gérer</Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Factures à compenser" description="Abonnement et mises en avant retenus sur les reversements, mais non couverts par le solde à reverser" icon={<CreditCard />} divided />
            <CardContent className="p-0">
              {!canInvoices ? (
                <p className="p-5 text-sm text-fg-muted">La liste des factures demande le droit « factures ».</p>
              ) : pendingInvoices.loading ? (
                <div className="space-y-2 p-5">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : pendingInvoices.error ? (
                <div className="p-5"><ErrorPanel error={pendingInvoices.error} compact /></div>
              ) : pendingList.length === 0 ? (
                <EmptyState compact title="Aucune facture en attente" description="Toutes les retenues d’abonnement ont été compensées." />
              ) : (
                <ul className="divide-y divide-border">
                  {pendingList.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fg">{directory.name('restaurant', i.recipient.id)}</p>
                        <p className="truncate text-xs text-fg-subtle">Facture {i.number} · émise le {toDate(i.issuedAt) ? formatDate(toDate(i.issuedAt) as Date) : ''}</p>
                      </div>
                      <Money cents={i.compensation?.debitCents ?? 0} className="shrink-0 text-sm text-fg" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Paiements d’abonnement en échec" description="Derniers paiements en échec" icon={<CircleSlash />} divided />
            <CardContent className="p-0">
              {!canPayments ? (
                <p className="p-5 text-sm text-fg-muted">La liste des paiements demande le droit « paiements ».</p>
              ) : failed.loading ? (
                <div className="space-y-2 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : failed.error ? (
                <div className="p-5"><ErrorPanel error={failed.error} compact /></div>
              ) : failedSubs.length === 0 ? (
                <EmptyState compact title="Aucun paiement en échec" />
              ) : (
                <ul className="divide-y divide-border">
                  {failedSubs.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fg">{directory.name('restaurant', p.payerId)}</p>
                        <p className="truncate text-xs text-fg-subtle">{p.failureMessage ?? p.failureCode ?? 'Refus sans motif'} · {plural(p.attempts, 'tentative')} · {toDate(p.createdAt) ? formatDateTime(toDate(p.createdAt) as Date) : ''}</p>
                      </div>
                      <Money cents={p.amountCents} className="shrink-0 text-sm text-fg" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Règles de relance" description="Appliquées chaque matin à 8 h" icon={<BellRing />} divided />
          {!draft ? (
            <CardContent><Skeleton className="h-72 w-full" /></CardContent>
          ) : (
            <>
              <CardContent className="space-y-5">
                <Switch checked={draft.enabled} disabled={!editable} onCheckedChange={(v) => set('enabled', v)} label="Relances automatiques" description="Nouvelle tentative de compensation sur les reversements et relance du commerce." />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Intervalle"><Input type="number" min={1} max={30} disabled={!editable} value={draft.retryIntervalDays} trailing="j" onChange={(e) => set('retryIntervalDays', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></FormField>
                  <FormField label="Tentatives" hint="Avant restriction."><Input type="number" min={1} max={10} disabled={!editable} value={draft.maxAttempts} onChange={(e) => set('maxAttempts', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></FormField>
                </div>
                <Switch checked={draft.emailReminders} disabled={!editable} onCheckedChange={(v) => set('emailReminders', v)} label={<span className="flex items-center gap-1.5"><Mail className="size-4" />Relance par e-mail</span>} />
                <Switch checked={draft.holdPayouts} disabled={!editable} onCheckedChange={(v) => set('holdPayouts', v)} label={<span className="flex items-center gap-1.5"><ShieldBan className="size-4" />Bloquer les reversements</span>} description="Pendant la restriction pour impayé." />
                <FormField label="Fonctionnalités coupées en restriction">
                  <div className="grid gap-2">
                    {PLAN_FEATURE_KEYS.filter((k) => !['orders', 'menu', 'finance'].includes(k)).map((key) => (
                      <Checkbox key={key} disabled={!editable} label={PLAN_FEATURE_LABELS[key]} checked={draft.restrictedFeatures.includes(key)} onCheckedChange={(v) => set('restrictedFeatures', v ? [...draft.restrictedFeatures, key] : draft.restrictedFeatures.filter((f) => f !== (key as PlanFeatureKey)))} />
                    ))}
                  </div>
                </FormField>
                <Callout tone="info" title="Suspension">
                  Après la restriction, l’abonnement est suspendu une fois écoulé le délai de grâce de sa formule ({plans.data.map((p) => `${p.name} : ${p.gracePeriodDays ?? 0} j`).join(', ') || '—'}).
                </Callout>
                {toDate(settings.data?.updatedAt) && <p className="text-xs text-fg-subtle">Modifié le {formatDateTime(toDate(settings.data?.updatedAt) as Date)}</p>}
              </CardContent>
              {editable && (
                <CardFooter className="justify-end">
                  <Button variant="primary" size="sm" leftIcon={<Save />} onClick={() => setConfirm(true)}>Enregistrer</Button>
                </CardFooter>
              )}
            </>
          )}
        </Card>
      </div>
      <ActionDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer les règles de relance"
        confirmLabel="Enregistrer"
        onSubmit={async (reason) => Boolean(draft && (await save.mutate({ doc: 'dunning', reason, data: { enabled: draft.enabled, retryIntervalDays: draft.retryIntervalDays, maxAttempts: draft.maxAttempts, emailReminders: draft.emailReminders, restrictedFeatures: draft.restrictedFeatures as PlanFeatureKey[], holdPayouts: draft.holdPayouts } })))}
      />
    </PageContainer>
  );
}
