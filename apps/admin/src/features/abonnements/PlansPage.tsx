import { useEffect, useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Check, History, Layers, Pencil } from 'lucide-react';
import {
  Badge,
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
  RadioGroup,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Textarea,
  formatDateTime,
} from '@golink/ui';
import {
  BILLING_MODE_LABELS,
  COLLECTIONS,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  type BillingMode,
  type Plan,
  type PlanFeatureKey,
  type SettingsHistoryEntry,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { updatePlan, type PlanInput } from '../argent-commun/api';
import { ActionDialog, Callout, DetailRow, ErrorPanel } from '../argent-commun/components';
import { bps, eur, parseEuros, parsePercent, toEurosInput, toPercentInput } from '../argent-commun/format';
import { usePlans, useSubscriptions } from './hooks';
import { AbonnementsNav } from './nav';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nom',
  description: 'Description',
  active: 'Proposée',
  countryIds: 'Pays',
  monthlyPriceHtCents: 'Prix mensuel',
  yearlyPriceHtCents: 'Prix annuel',
  trialDays: 'Essai',
  billingMode: 'Mode de facturation',
  commitmentMonths: 'Engagement',
  cardRequired: 'Carte exigée',
  gracePeriodDays: 'Délai de grâce',
  commission: 'Commissions',
  rankingBoost: 'Bonus de classement',
  maxDeliveryRadiusMeters: 'Rayon de livraison',
  includedOutlets: 'Établissements inclus',
  features: 'Fonctionnalités',
  limits: 'Limites',
  order: 'Ordre',
};

/** Formules Basic / Pro / Premium (cahier §17) : prix, fonctionnalités, limites, commission associée. */
export function PlansPage() {
  useDocumentTitle('Formules · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const plans = usePlans();
  const subs = useSubscriptions();
  const [editing, setEditing] = useState<WithId<Plan> | null>(null);

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Formules" description="Tout est paramétrable : prix mensuel et annuel, mode de facturation, fonctionnalités, limites, engagement, essai, carte exigée, délai avant suspension et commissions associées.">
        <AbonnementsNav />
      </PageHeader>

      {plans.error ? (
        <ErrorPanel error={plans.error} />
      ) : plans.loading ? (
        <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[520px]" />)}</div>
      ) : plans.data.length === 0 ? (
        <EmptyState icon={<Layers />} title="Aucune formule" description="Les formules sont créées au lancement de la plateforme." />
      ) : (
        <div className="space-y-6">
          {plans.data.every((p) => p.monthlyPriceHtCents === 0) && (
            <Callout tone="info" title="Formules gratuites pour l’instant">
              Décision du client : les trois formules sont à 0 €, sans contenu ni engagement, en attendant le choix entre commission et abonnement. Modifiez-les ici le moment venu.
            </Callout>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.data.map((plan) => {
              const count = subs.data.filter((s) => s.planCode === plan.code && s.status !== 'cancelled').length;
              return (
                <Card key={plan.id} className="flex flex-col">
                  <CardHeader
                    title={<span className="flex items-center gap-2">{plan.name}{!plan.active && <Badge tone="neutral" size="sm">Non proposée</Badge>}</span>}
                    description={plan.description || 'Aucune description.'}
                    actions={can('plans.edit') ? <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(plan)}>Modifier</Button> : undefined}
                    divided
                  />
                  <CardContent className="flex-1 space-y-5">
                    <div>
                      <p className="font-display text-3xl font-semibold tracking-display text-fg num">{plan.monthlyPriceHtCents ? eur(plan.monthlyPriceHtCents) : 'Gratuit'}</p>
                      <p className="text-sm text-fg-muted">{plan.monthlyPriceHtCents ? 'HT par mois' : 'Aucun abonnement facturé'}{plan.yearlyPriceHtCents ? ` · ${eur(plan.yearlyPriceHtCents)} HT par an` : ''}</p>
                    </div>
                    <div className="divide-y divide-border">
                      <DetailRow label="Mode de facturation" value={<span className="font-sans">{BILLING_MODE_LABELS[plan.billingMode ?? 'commission']}</span>} />
                      {plan.commissionInherit ? (
                        <DetailRow label="Commissions" value={<span className="font-sans">Barème du pays</span>} />
                      ) : (
                        <>
                          <DetailRow label="Commission livraison GoLink" value={bps(plan.commission.platformDeliveryBps)} />
                          <DetailRow label="Commission livreurs du commerce" value={bps(plan.commission.restaurantDeliveryBps)} />
                          <DetailRow label="Commission retrait" value={bps(plan.commission.pickupBps)} />
                        </>
                      )}
                      <DetailRow label="Essai gratuit" value={plan.trialDays ? `${plan.trialDays} j` : 'Aucun'} />
                      <DetailRow label="Engagement" value={plan.commitmentMonths ? `${plan.commitmentMonths} mois` : 'Sans engagement'} />
                      <DetailRow label="Délai avant suspension" value={plan.gracePeriodDays ? `${plan.gracePeriodDays} j` : 'Immédiat'} />
                      <DetailRow label="Rayon maximal" value={`${(plan.maxDeliveryRadiusMeters / 1000).toLocaleString('fr-FR')} km`} />
                    </div>
                    <div>
                      <p className="eyebrow mb-2">Fonctionnalités</p>
                      {plan.features.length ? (
                        <ul className="space-y-1.5 text-sm">
                          {plan.features.map((f) => <li key={f} className="flex items-start gap-2 text-fg"><Check className="mt-0.5 size-4 shrink-0 text-success" />{PLAN_FEATURE_LABELS[f as PlanFeatureKey] ?? f}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-fg-subtle">Aucune fonctionnalité réservée.</p>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="justify-between text-sm text-fg-muted">
                    <span>{count} abonnement{count > 1 ? 's' : ''} en cours</span>
                    <span>{plan.countryIds.length ? plan.countryIds.join(' · ') : 'Tous les pays'}</span>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>
      )}
      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-xl">{editing && <PlanEditor plan={editing} onDone={() => setEditing(null)} />}</SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function PlanEditor({ plan, onDone }: { plan: WithId<Plan>; onDone: () => void }) {
  const geo = useGeoScope();
  const [form, setForm] = useState({
    name: plan.name,
    description: plan.description ?? '',
    active: plan.active,
    countryIds: plan.countryIds ?? [],
    monthly: toEurosInput(plan.monthlyPriceHtCents),
    yearly: plan.yearlyPriceHtCents ? toEurosInput(plan.yearlyPriceHtCents) : '',
    trialDays: String(plan.trialDays ?? 0),
    billingMode: (plan.billingMode ?? 'commission') as BillingMode,
    commitmentMonths: String(plan.commitmentMonths ?? 0),
    cardRequired: plan.cardRequired ?? false,
    gracePeriodDays: String(plan.gracePeriodDays ?? 0),
    platform: toPercentInput(plan.commission.platformDeliveryBps),
    restaurant: toPercentInput(plan.commission.restaurantDeliveryBps),
    pickup: toPercentInput(plan.commission.pickupBps),
    commissionInherit: plan.commissionInherit === true,
    rankingBoost: String(plan.rankingBoost ?? 0),
    radiusKm: String((plan.maxDeliveryRadiusMeters ?? 9000) / 1000),
    includedOutlets: String(plan.includedOutlets ?? 1),
    features: [...plan.features] as PlanFeatureKey[],
    maxProducts: plan.limits?.maxProducts ? String(plan.limits.maxProducts) : '',
    maxStaff: plan.limits?.maxStaff ? String(plan.limits.maxStaff) : '',
    maxPromotions: plan.limits?.maxPromotions ? String(plan.limits.maxPromotions) : '',
  });
  const [confirm, setConfirm] = useState(false);
  const save = useMutation(updatePlan, { success: `Formule ${plan.name} enregistrée` });
  const historyQuery = useMemo(() => query(collection(db, COLLECTIONS.settingsHistory), where('docPath', '==', `plans/${plan.code}`), orderBy('changedAt', 'desc'), limit(10)), [plan.code]);
  const history = useCollection<SettingsHistoryEntry>(historyQuery);
  useEffect(() => setConfirm(false), [plan.id]);

  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : null);
  const optInt = (v: string) => (v.trim() === '' ? null : int(v));
  const monthly = parseEuros(form.monthly || '0');
  const yearly = form.yearly.trim() ? parseEuros(form.yearly) : null;
  const rates = { platformDeliveryBps: parsePercent(form.platform), restaurantDeliveryBps: parsePercent(form.restaurant), pickupBps: parsePercent(form.pickup) };
  const radius = Number(form.radiusKm.replace(',', '.'));
  const input: Omit<PlanInput, 'reason'> | null =
    monthly !== null && monthly >= 0 && (form.yearly.trim() === '' || (yearly !== null && yearly >= 0)) && rates.platformDeliveryBps !== null && rates.restaurantDeliveryBps !== null && rates.pickupBps !== null && int(form.trialDays) !== null && int(form.commitmentMonths) !== null && int(form.gracePeriodDays) !== null && int(form.includedOutlets) && radius >= 0.5 && radius <= 50 && form.name.trim().length >= 2
      ? {
          code: plan.code,
          name: form.name.trim(),
          description: form.description.trim(),
          active: form.active,
          countryIds: form.countryIds,
          monthlyPriceHtCents: monthly,
          yearlyPriceHtCents: yearly,
          trialDays: int(form.trialDays) as number,
          billingMode: form.billingMode,
          commitmentMonths: int(form.commitmentMonths) as number,
          cardRequired: form.cardRequired,
          gracePeriodDays: int(form.gracePeriodDays) as number,
          commission: rates as PlanInput['commission'],
          commissionInherit: form.commissionInherit,
          rankingBoost: Math.max(0, Math.min(10, Number(form.rankingBoost.replace(',', '.')) || 0)),
          maxDeliveryRadiusMeters: Math.round(radius * 1000),
          includedOutlets: int(form.includedOutlets) as number,
          features: form.features,
          limits: { maxProducts: optInt(form.maxProducts), maxStaff: optInt(form.maxStaff), maxPromotions: optInt(form.maxPromotions) },
          order: plan.order ?? 0,
        }
      : null;
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <SheetHeader title={`Formule ${plan.name}`} description="Les changements s’appliquent aux prochaines commandes et factures ; les abonnements en cours gardent leur prix jusqu’au renouvellement." icon={<Layers />} />
      <SheetBody className="space-y-6">
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom" required><Input value={form.name} maxLength={40} onChange={(e) => set('name', e.target.value)} /></FormField>
            <FormField label="Proposée aux commerces"><Switch checked={form.active} onCheckedChange={(v) => set('active', v)} label={form.active ? 'Oui' : 'Non'} /></FormField>
          </div>
          <FormField label="Description"><Textarea rows={2} maxLength={400} value={form.description} onChange={(e) => set('description', e.target.value)} /></FormField>
          <FormField label="Pays" hint="Aucun coché : tous les pays.">
            <div className="flex flex-wrap gap-3">
              {geo.countries.map((c) => (
                <Checkbox key={c.id} label={c.name} checked={form.countryIds.includes(c.id)} onCheckedChange={(v) => set('countryIds', v ? [...form.countryIds, c.id] : form.countryIds.filter((x) => x !== c.id))} />
              ))}
            </div>
          </FormField>
        </section>
        <section className="space-y-4">
          <h3 className="eyebrow">Prix et facturation</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prix mensuel HT"><Input inputMode="decimal" value={form.monthly} trailing="€" invalid={monthly === null} onChange={(e) => set('monthly', e.target.value)} /></FormField>
            <FormField label="Prix annuel HT" hint="Vide : pas d’offre annuelle."><Input inputMode="decimal" value={form.yearly} trailing="€" invalid={form.yearly !== '' && yearly === null} onChange={(e) => set('yearly', e.target.value)} /></FormField>
          </div>
          <FormField label="Mode de facturation">
            <RadioGroup variant="cards" value={form.billingMode} onValueChange={(v) => set('billingMode', v as BillingMode)} options={(Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map((m) => ({ value: m, label: BILLING_MODE_LABELS[m] }))} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Essai gratuit"><Input type="number" min={0} value={form.trialDays} trailing="j" onChange={(e) => set('trialDays', e.target.value)} /></FormField>
            <FormField label="Engagement"><Input type="number" min={0} value={form.commitmentMonths} trailing="mois" onChange={(e) => set('commitmentMonths', e.target.value)} /></FormField>
            <FormField label="Délai avant suspension" hint="Après un impayé."><Input type="number" min={0} value={form.gracePeriodDays} trailing="j" onChange={(e) => set('gracePeriodDays', e.target.value)} /></FormField>
          </div>
          <Switch checked={form.cardRequired} onCheckedChange={(v) => set('cardRequired', v)} label="Carte bancaire exigée à la souscription" />
        </section>
        <section className="space-y-4">
          <h3 className="eyebrow">Commissions associées</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Livraison GoLink"><Input inputMode="decimal" value={form.platform} trailing="%" invalid={rates.platformDeliveryBps === null} onChange={(e) => set('platform', e.target.value)} /></FormField>
            <FormField label="Livreurs du commerce"><Input inputMode="decimal" value={form.restaurant} trailing="%" invalid={rates.restaurantDeliveryBps === null} onChange={(e) => set('restaurant', e.target.value)} /></FormField>
            <FormField label="Retrait"><Input inputMode="decimal" value={form.pickup} trailing="%" invalid={rates.pickupBps === null} onChange={(e) => set('pickup', e.target.value)} /></FormField>
          </div>
          <Switch checked={form.commissionInherit} onCheckedChange={(v) => set('commissionInherit', v)} label="Cette formule laisse le barème du pays s’appliquer (taux ci-dessus ignorés)" />
          <p className="text-xs text-fg-subtle">Priorité appliquée à chaque commande : taux négocié pour le commerce, puis pour son groupe, puis taux de la ville, puis taux de la formule, puis barème du pays ; une offre spéciale retire ensuite ses points. Le mode « abonnement » supprime la commission sur les ventes.</p>
        </section>
        <section className="space-y-4">
          <h3 className="eyebrow">Fonctionnalités et limites</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLAN_FEATURE_KEYS.map((key) => (
              <Checkbox key={key} label={PLAN_FEATURE_LABELS[key]} checked={form.features.includes(key)} onCheckedChange={(v) => set('features', v ? [...form.features, key] : form.features.filter((f) => f !== key))} />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Produits max." hint="Vide : illimité."><Input type="number" min={1} value={form.maxProducts} onChange={(e) => set('maxProducts', e.target.value)} /></FormField>
            <FormField label="Membres d’équipe max."><Input type="number" min={1} value={form.maxStaff} onChange={(e) => set('maxStaff', e.target.value)} /></FormField>
            <FormField label="Promotions max."><Input type="number" min={1} value={form.maxPromotions} onChange={(e) => set('maxPromotions', e.target.value)} /></FormField>
            <FormField label="Rayon de livraison max."><Input inputMode="decimal" value={form.radiusKm} trailing="km" onChange={(e) => set('radiusKm', e.target.value)} /></FormField>
            <FormField label="Établissements inclus"><Input type="number" min={1} value={form.includedOutlets} onChange={(e) => set('includedOutlets', e.target.value)} /></FormField>
            <FormField label="Bonus de classement" hint="0 à 10."><Input inputMode="decimal" value={form.rankingBoost} onChange={(e) => set('rankingBoost', e.target.value)} /></FormField>
          </div>
        </section>
        <section>
          <h3 className="eyebrow mb-2 flex items-center gap-1.5"><History className="size-3.5" />Dernières modifications</h3>
          {history.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : history.error ? (
            <p className="text-sm text-fg-subtle">Historique indisponible pour votre rôle.</p>
          ) : !history.data.length ? (
            <p className="text-sm text-fg-subtle">Aucune modification enregistrée.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-fg">{h.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(', ') || 'Aucun champ modifié'}</p>
                  <p className="text-xs text-fg-subtle">{toDate(h.changedAt) ? formatDateTime(toDate(h.changedAt) as Date) : ''}{h.reason ? ` · ${h.reason}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
        <Button variant="primary" disabled={!input} onClick={() => setConfirm(true)}>Enregistrer</Button>
      </SheetFooter>
      <ActionDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Enregistrer la formule ${form.name}`}
        description="Le changement est historisé avec son motif."
        confirmLabel="Enregistrer"
        onSubmit={async (reason) => {
          if (!input) return false;
          const ok = Boolean(await save.mutate({ ...input, reason }));
          if (ok) onDone();
          return ok;
        }}
      />
    </>
  );
}
