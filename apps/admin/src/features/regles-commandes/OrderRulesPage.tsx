// Règles automatiques des commandes (cahier §9) : ce que la plateforme applique seule.
// Réglables pour toute la plateforme, par pays ou par ville ; chaque modification est
// historisée (auteur, motif, avant / après). Vente d'alcool interdite et verrouillée.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlarmClock,
  Ban,
  CalendarClock,
  ChefHat,
  Gift,
  Hourglass,
  Lock,
  MessageSquareWarning,
  PackageX,
  Plus,
  Save,
  Scale,
  Store,
  Trash2,
  Undo2,
  UserX,
  Workflow,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  PageContainer,
  PageHeader,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_ORDER_RULES,
  REFUND_CAUSES,
  REFUND_CAUSE_LABELS,
  SETTINGS_DOCS,
  type CancellableStage,
  type OrderRules,
  type OrderRulesSettings,
  type RefundCause,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, useDoc, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useSettingsHistory } from '../_operations/hooks';
import { EuroInput, PercentInput, UnitInput } from '../_operations/inputs';
import { ListSkeleton, LoadError, OverrideBadge, SettingsHistoryCard } from '../_operations/ui';

type Rules = OrderRules;
type Key = keyof Rules;

const STAGE_LABELS: Record<CancellableStage, string> = {
  pending: 'Avant acceptation',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  ready: 'Prête',
  picked_up: 'En livraison',
};

const FIELD_LABELS: Record<string, string> = {
  acceptanceTimeoutSeconds: 'Délai d’acceptation (s)',
  autoPause: 'Pause automatique',
  merchantInactivity: 'Inactivité des commerces',
  defaultPrepMinutes: 'Préparation par défaut',
  merchantDefaults: 'Valeurs initiales d’un nouveau commerce',
  maxPrepExtensionMinutes: 'Allongement maximal',
  customerCancellation: 'Annulation par le client',
  refundLiability: 'Imputation des remboursements',
  customerAbsent: 'Client absent',
  itemUnavailable: 'Produit indisponible',
  lateCredit: 'Avoirs de retard',
  scheduledOrders: 'Commandes programmées',
  claimWindowHours: 'Délai de réclamation',
  claims: 'Photo des réclamations',
  lateToleranceMinutes: 'Retard toléré',
  alcohol: 'Vente d’alcool',
  orderRules: 'Surcharge',
};

const EDITABLE: Key[] = [
  'acceptanceTimeoutSeconds',
  'autoPause',
  'merchantInactivity',
  'defaultPrepMinutes',
  'merchantDefaults',
  'maxPrepExtensionMinutes',
  'customerCancellation',
  'refundLiability',
  'customerAbsent',
  'itemUnavailable',
  'lateCredit',
  'scheduledOrders',
  'claimWindowHours',
  'claims',
  'lateToleranceMinutes',
];

function pick(rules: Rules): Partial<Rules> {
  return Object.fromEntries(EDITABLE.map((k) => [k, rules[k]])) as Partial<Rules>;
}

export function OrderRulesPage() {
  useDocumentTitle('Règles automatiques · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const platformDoc = useDoc<OrderRulesSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`));

  const scopes = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    if (geo.global && !geo.countryId && !geo.cityId) out.push({ value: 'platform', label: 'Plateforme (toutes les villes)' });
    if (!geo.cityId && (geo.global || geo.countries.length)) {
      for (const c of geo.countries.filter((c) => !geo.countryId || c.id === geo.countryId)) if (geo.global || !geo.cityIds) out.push({ value: `country:${c.id}`, label: `Pays · ${c.name}` });
    }
    for (const c of geo.cities.filter((c) => (!geo.countryId || c.countryId === geo.countryId) && (!geo.cityId || c.id === geo.cityId)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'fr'))) out.push({ value: `city:${c.id}`, label: `Ville · ${c.name}` });
    return out;
  }, [geo]);
  const [scope, setScope] = useState('');
  useEffect(() => {
    if (!scopes.some((s) => s.value === scope)) setScope(scopes[0]?.value ?? '');
  }, [scopes, scope]);
  const [kind, id] = scope === 'platform' ? (['platform', null] as const) : (scope.split(':') as ['country' | 'city', string]);
  const city = kind === 'city' ? geo.cities.find((c) => c.id === id) : undefined;
  const country = geo.countries.find((c) => c.id === (kind === 'country' ? id : city?.countryId));

  const platform = useMemo(() => ({ ...DEFAULT_ORDER_RULES, ...(platformDoc.data ?? {}) }) as Rules, [platformDoc.data]);
  const parent = useMemo(() => (kind === 'city' ? ({ ...platform, ...(country?.orderRules ?? {}) } as Rules) : platform), [kind, platform, country?.orderRules]);
  const override = kind === 'platform' ? null : kind === 'country' ? (country?.orderRules ?? null) : (city?.orderRules ?? null);
  const effective = useMemo(() => (kind === 'platform' ? platform : ({ ...parent, ...(override ?? {}) } as Rules)), [kind, platform, parent, override]);

  const [draft, setDraft] = useState<Rules>(effective);
  useEffect(() => setDraft(effective), [effective]);
  const dirtyKeys = EDITABLE.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(effective[k]));
  const liabilityInvalid = REFUND_CAUSES.some((c) => {
    const split = draft.refundLiability[c] ?? {};
    return (split.restaurant ?? 0) + (split.courier ?? 0) + (split.platform ?? 0) !== 10_000;
  });
  const editable = can('order_rules.edit') && (kind !== 'country' || geo.global);
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const save = useMutation(fn.updateOrderRules, { success: 'Règles enregistrées : elles s’appliquent immédiatement' });
  const set = <K extends Key>(key: K, value: Rules[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const claims = { ...DEFAULT_ORDER_RULES.claims!, ...(draft.claims ?? {}) };
  const setClaims = (patch: Partial<NonNullable<Rules['claims']>>) => set('claims', { ...claims, ...patch });
  const inherited = kind === 'city' ? (country?.orderRules && Object.keys(country.orderRules).length ? 'pays' : 'plateforme') : 'plateforme';
  const badge = (keys: Key[]) => (kind === 'platform' ? null : <OverrideBadge overridden={keys.some((k) => override && k in override)} inheritedFrom={inherited} />);

  const historyPaths = useMemo(() => {
    const list = [`${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`];
    if (country) list.push(`${COLLECTIONS.countries}/${country.id}#orderRules`);
    if (city) list.push(`${COLLECTIONS.cities}/${city.id}#orderRules`);
    return list;
  }, [country, city]);
  const history = useSettingsHistory(historyPaths, 25);

  async function submit(reason: string) {
    if (confirm === 'reset') return save.mutate({ scope: kind, scopeId: id, rules: null, reason });
    if (kind === 'platform') return save.mutate({ scope: 'platform', rules: pick(draft), reason });
    const merged = { ...(override ?? {}) } as Partial<Rules>;
    for (const k of EDITABLE) {
      if (JSON.stringify(draft[k]) === JSON.stringify(parent[k])) delete merged[k];
      else (merged as Record<string, unknown>)[k] = draft[k];
    }
    return save.mutate({ scope: kind, scopeId: id, rules: Object.keys(merged).length ? merged : null, reason });
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Opérations · ${geo.label}`}
        title="Règles automatiques des commandes"
        description="La plateforme applique ces règles seule : délais, annulations, remboursements, gestes commerciaux. Réglables pour toute la plateforme ou ville par ville."
        actions={<Select aria-label="Niveau des règles" value={scope} onValueChange={setScope} options={scopes} className="w-full min-w-64 sm:w-auto" />}
      />
      {platformDoc.loading ? (
        <ListSkeleton rows={5} />
      ) : platformDoc.error ? (
        <LoadError error={platformDoc.error} />
      ) : !scope ? (
        <Card>
          <EmptyState icon={<Workflow />} title="Aucun marché dans votre périmètre" />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            {!editable && (
              <p className="tone-info rounded-lg bg-(--tone-bg) px-3.5 py-2.5 text-sm text-(--tone-fg)">Consultation seule : la modification des règles relève de l’équipe centrale.</p>
            )}
            <Section icon={<AlarmClock />} title="Acceptation par le commerce" description="Sans réponse dans le délai, la commande est annulée et le client remboursé." badge={badge(['acceptanceTimeoutSeconds', 'autoPause'])}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Délai d’acceptation" hint="Décision client : 5 minutes.">
                  <UnitInput value={Math.round(draft.acceptanceTimeoutSeconds / 60)} onChange={(v) => v !== null && set('acceptanceTimeoutSeconds', v * 60)} unit="min" min={1} max={30} disabled={!editable} />
                </FormField>
                <FormField label="Au-delà du délai">
                  <p className="flex h-9 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg-muted">Annulation et remboursement automatiques</p>
                </FormField>
              </div>
              <ToggleRow
                checked={draft.autoPause?.enabled ?? false}
                onChange={(v) => set('autoPause', { enabled: v, missedOrdersInARow: draft.autoPause?.missedOrdersInARow ?? 3 })}
                disabled={!editable}
                label="Pause automatique du commerce"
                description="Après plusieurs commandes manquées d’affilée, le commerce est mis en pause."
              >
                <UnitInput value={draft.autoPause?.missedOrdersInARow ?? 3} onChange={(v) => v !== null && set('autoPause', { enabled: true, missedOrdersInARow: v })} unit="d’affilée" min={1} max={20} disabled={!editable} aria-label="Commandes manquées d’affilée" />
              </ToggleRow>
            </Section>

            <Section icon={<ChefHat />} title="Temps de préparation" description="Temps par défaut, que le commerce peut allonger en période de rush." badge={badge(['defaultPrepMinutes', 'maxPrepExtensionMinutes'])}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Temps par défaut">
                  <UnitInput value={draft.defaultPrepMinutes} onChange={(v) => v !== null && set('defaultPrepMinutes', v)} unit="min" min={5} max={120} disabled={!editable} />
                </FormField>
                <FormField label="Allongement maximal">
                  <UnitInput value={draft.maxPrepExtensionMinutes} onChange={(v) => v !== null && set('maxPrepExtensionMinutes', v)} unit="min" min={0} max={120} disabled={!editable} />
                </FormField>
              </div>
            </Section>

            <Section
              icon={<Store />}
              title="Valeurs initiales d’un nouveau commerce"
              description="Reprises à l’inscription d’un commerce et par le bouton « Réinitialiser » de son back-office ; il peut ensuite les ajuster lui-même."
              badge={badge(['merchantDefaults'])}
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <FormField label="Préparation">
                  <UnitInput value={draft.merchantDefaults?.prepMinutes ?? DEFAULT_ORDER_RULES.merchantDefaults!.prepMinutes} onChange={(v) => v !== null && set('merchantDefaults', { ...(draft.merchantDefaults ?? DEFAULT_ORDER_RULES.merchantDefaults!), prepMinutes: v })} unit="min" min={5} max={120} disabled={!editable} />
                </FormField>
                <FormField label="Capacité simultanée">
                  <UnitInput value={draft.merchantDefaults?.maxConcurrentOrders ?? DEFAULT_ORDER_RULES.merchantDefaults!.maxConcurrentOrders} onChange={(v) => v !== null && set('merchantDefaults', { ...(draft.merchantDefaults ?? DEFAULT_ORDER_RULES.merchantDefaults!), maxConcurrentOrders: v })} unit="cmd" min={1} max={999} disabled={!editable} />
                </FormField>
                <FormField label="Minimum de commande">
                  <EuroInput value={draft.merchantDefaults?.minOrderCents ?? DEFAULT_ORDER_RULES.merchantDefaults!.minOrderCents} onChange={(v) => v !== null && set('merchantDefaults', { ...(draft.merchantDefaults ?? DEFAULT_ORDER_RULES.merchantDefaults!), minOrderCents: v })} disabled={!editable} />
                </FormField>
                <FormField label="Préavis programmé minimum">
                  <UnitInput value={draft.merchantDefaults?.scheduledLeadMinutes ?? DEFAULT_ORDER_RULES.merchantDefaults!.scheduledLeadMinutes} onChange={(v) => v !== null && set('merchantDefaults', { ...(draft.merchantDefaults ?? DEFAULT_ORDER_RULES.merchantDefaults!), scheduledLeadMinutes: v })} unit="min" min={10} max={1440} disabled={!editable} />
                </FormField>
                <FormField label="Horizon programmé maximum">
                  <UnitInput value={draft.merchantDefaults?.scheduledMaxDays ?? DEFAULT_ORDER_RULES.merchantDefaults!.scheduledMaxDays} onChange={(v) => v !== null && set('merchantDefaults', { ...(draft.merchantDefaults ?? DEFAULT_ORDER_RULES.merchantDefaults!), scheduledMaxDays: v })} unit="jours" min={1} max={60} disabled={!editable} />
                </FormField>
              </div>
            </Section>

            <Section icon={<Ban />} title="Annulation par le client" description="Jusqu’à quelle étape le client peut annuler, et quelle part lui est remboursée (pourboire toujours rendu)." badge={badge(['customerCancellation'])}>
              <div className="divide-y divide-border rounded-xl border border-border">
                {(Object.keys(STAGE_LABELS) as CancellableStage[]).map((stage) => {
                  const value = draft.customerCancellation[stage];
                  const mode = value === null ? 'forbidden' : value === 10_000 ? 'full' : value === 0 ? 'none' : 'partial';
                  const update = (next: number | null) => set('customerCancellation', { ...draft.customerCancellation, [stage]: next });
                  return (
                    <div key={stage} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium text-fg">{STAGE_LABELS[stage]}</span>
                      <div className="flex gap-2">
                        <Select
                          aria-label={`Annulation : ${STAGE_LABELS[stage]}`}
                          value={mode}
                          disabled={!editable}
                          onValueChange={(m) => update(m === 'forbidden' ? null : m === 'full' ? 10_000 : m === 'none' ? 0 : 5_000)}
                          options={[
                            { value: 'full', label: 'Remboursement total' },
                            { value: 'partial', label: 'Remboursement partiel' },
                            { value: 'none', label: 'Sans remboursement' },
                            { value: 'forbidden', label: 'Annulation impossible' },
                          ]}
                          className="w-full sm:w-56"
                        />
                        {mode === 'partial' && (
                          <div className="w-28">
                            <PercentInput value={value} onChange={(v) => v !== null && update(v)} disabled={!editable} aria-label="Part remboursée" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section icon={<Scale />} title="Qui paie le remboursement" description="Imputation automatique sur le prochain reversement de chacun. Décision client : le commerce paie dans tous les cas." badge={badge(['refundLiability'])}>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="secondary" leftIcon={<Store />} onClick={() => set('refundLiability', Object.fromEntries(REFUND_CAUSES.map((c) => [c, { restaurant: 10_000 }])) as Rules['refundLiability'])}>
                    Tout au commerce
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Cause</TableHead>
                    <TableHead className="w-28 text-right">Commerce</TableHead>
                    <TableHead className="w-28 text-right">Livreur</TableHead>
                    <TableHead className="w-28 text-right">Ciyou Eats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {REFUND_CAUSES.map((cause: RefundCause) => {
                    const split = draft.refundLiability[cause] ?? {};
                    const total = (split.restaurant ?? 0) + (split.courier ?? 0) + (split.platform ?? 0);
                    const setPart = (payer: 'restaurant' | 'courier' | 'platform', v: number | null) =>
                      set('refundLiability', { ...draft.refundLiability, [cause]: { ...split, [payer]: v ?? 0 } });
                    return (
                      <TableRow key={cause} className={cn(total !== 10_000 && 'bg-danger-soft/40')}>
                        <TableCell className="text-sm">
                          {REFUND_CAUSE_LABELS[cause]}
                          {total !== 10_000 && <span className="block text-2xs text-danger">Total {total / 100} % : doit faire 100 %</span>}
                        </TableCell>
                        {(['restaurant', 'courier', 'platform'] as const).map((payer) => (
                          <TableCell key={payer} className="py-1.5">
                            <PercentInput value={split[payer] ?? 0} onChange={(v) => setPart(payer, v)} disabled={!editable} aria-label={`${REFUND_CAUSE_LABELS[cause]} : part ${payer}`} />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Section>

            <Section icon={<UserX />} title="Client absent" description="Le livreur attend puis appelle via l’application ; sans réponse, la commande est clôturée." badge={badge(['customerAbsent'])}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Temps d’attente du livreur" hint="Décision client : 10 minutes.">
                  <UnitInput value={draft.customerAbsent.driverWaitMinutes} onChange={(v) => v !== null && set('customerAbsent', { ...draft.customerAbsent, driverWaitMinutes: v })} unit="min" min={1} max={60} disabled={!editable} />
                </FormField>
                <FormField label="Clôture automatique" hint="Si le livreur ne clôture pas, la plateforme le fait après ce délai supplémentaire (0 = jamais).">
                  <UnitInput value={draft.customerAbsent.autoCloseGraceMinutes ?? 10} onChange={(v) => v !== null && set('customerAbsent', { ...draft.customerAbsent, autoCloseGraceMinutes: v })} unit="min" min={0} max={120} disabled={!editable} />
                </FormField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow checked={draft.customerAbsent.callViaApp ?? true} onChange={(v) => set('customerAbsent', { ...draft.customerAbsent, callViaApp: v })} disabled={!editable} label="Appel du client via l’application" />
                <ToggleRow checked={draft.customerAbsent.payDriver} onChange={(v) => set('customerAbsent', { ...draft.customerAbsent, payDriver: v })} disabled={!editable} label="Livreur payé normalement" />
                <ToggleRow checked={draft.customerAbsent.payRestaurant ?? true} onChange={(v) => set('customerAbsent', { ...draft.customerAbsent, payRestaurant: v })} disabled={!editable} label="Commerce payé normalement" />
                <ToggleRow checked={draft.customerAbsent.refundCustomer} onChange={(v) => set('customerAbsent', { ...draft.customerAbsent, refundCustomer: v })} disabled={!editable} label="Client remboursé" />
              </div>
            </Section>

            <Section icon={<PackageX />} title="Produit indisponible" description="Remplacement proposé au client, ou retrait avec remboursement partiel." badge={badge(['itemUnavailable'])}>
              <ToggleRow
                checked={draft.itemUnavailable.allowReplacement}
                onChange={(v) => set('itemUnavailable', { ...draft.itemUnavailable, allowReplacement: v })}
                disabled={!editable}
                label="Proposer un remplacement"
                description="Sans réponse du client dans le délai, l’article est retiré et remboursé."
              >
                <UnitInput value={Math.round(draft.itemUnavailable.replacementTimeoutSeconds / 60)} onChange={(v) => v !== null && set('itemUnavailable', { ...draft.itemUnavailable, replacementTimeoutSeconds: v * 60 })} unit="min" min={1} max={30} disabled={!editable} aria-label="Délai de réponse du client" />
              </ToggleRow>
            </Section>

            <Section icon={<Gift />} title="Gestes automatiques" description="Retard au-delà d’un seuil : avoir crédité automatiquement au client." badge={badge(['lateCredit'])}>
              <ToggleRow checked={draft.lateCredit.enabled} onChange={(v) => set('lateCredit', { ...draft.lateCredit, enabled: v })} disabled={!editable} label="Avoirs de retard" description="Crédités sur le porte-monnaie Ciyou Eats du client.">
                <UnitInput value={draft.lateCredit.creditValidityDays} onChange={(v) => v !== null && set('lateCredit', { ...draft.lateCredit, creditValidityDays: v })} unit="j de validité" min={1} max={730} disabled={!editable} aria-label="Validité de l’avoir" />
              </ToggleRow>
              <div className="max-w-xs">
                <FormField label="Retard toléré" hint="Au-delà, la commande compte comme « en retard » dans les indicateurs.">
                  <UnitInput value={draft.lateToleranceMinutes ?? 5} onChange={(v) => v !== null && set('lateToleranceMinutes', v)} unit="min" min={0} max={60} disabled={!editable} />
                </FormField>
              </div>
              {draft.lateCredit.enabled && (
                <div className="space-y-2">
                  {draft.lateCredit.tiers.map((tier, i) => {
                    const update = (patch: Partial<typeof tier>) => set('lateCredit', { ...draft.lateCredit, tiers: draft.lateCredit.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
                    return (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-xl border border-border p-3">
                        <FormField label="Retard dès">
                          <UnitInput value={tier.fromMinutes} onChange={(v) => v !== null && update({ fromMinutes: v })} unit="min" min={1} max={240} disabled={!editable} />
                        </FormField>
                        <FormField label="Avoir">
                          <PercentInput value={tier.rateBps} onChange={(v) => v !== null && update({ rateBps: v })} disabled={!editable} />
                        </FormField>
                        <FormField label="Plafond">
                          <EuroInput value={tier.maxCents} onChange={(v) => v !== null && update({ maxCents: v })} disabled={!editable} />
                        </FormField>
                        <IconButton label="Supprimer ce palier" variant="ghost" disabled={!editable} onClick={() => set('lateCredit', { ...draft.lateCredit, tiers: draft.lateCredit.tiers.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </IconButton>
                      </div>
                    );
                  })}
                  {editable && draft.lateCredit.tiers.length < 6 && (
                    <Button size="sm" variant="ghost" leftIcon={<Plus />} onClick={() => set('lateCredit', { ...draft.lateCredit, tiers: [...draft.lateCredit.tiers, { fromMinutes: (draft.lateCredit.tiers.at(-1)?.fromMinutes ?? 10) + 20, rateBps: 2000, maxCents: 1000 }] })}>
                      Ajouter un palier
                    </Button>
                  )}
                </div>
              )}
            </Section>

            <Card className="border-dashed">
              <CardHeader
                title="Vente d’alcool"
                description="Interdite sur toute la plateforme par décision du client : produits alcoolisés bloqués à la création et signalés en contrôle qualité."
                icon={<Lock />}
                actions={<Badge tone="danger" icon={<Lock />}>Verrouillé</Badge>}
              />
              <CardContent>
                <p className="text-xs text-fg-subtle">Ce réglage ne peut pas être modifié depuis le super admin.</p>
              </CardContent>
            </Card>

            <Section icon={<CalendarClock />} title="Commandes programmées" description="Commander plus tard dans la journée ou un autre jour." badge={badge(['scheduledOrders'])}>
              <ToggleRow checked={draft.scheduledOrders.enabled} onChange={(v) => set('scheduledOrders', { ...draft.scheduledOrders, enabled: v })} disabled={!editable} label="Autoriser les commandes à l’avance" />
              {draft.scheduledOrders.enabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Délai minimum">
                    <UnitInput value={draft.scheduledOrders.minLeadMinutes} onChange={(v) => v !== null && set('scheduledOrders', { ...draft.scheduledOrders, minLeadMinutes: v })} unit="min" min={10} max={1440} disabled={!editable} />
                  </FormField>
                  <FormField label="Délai maximum">
                    <UnitInput value={draft.scheduledOrders.maxDaysAhead} onChange={(v) => v !== null && set('scheduledOrders', { ...draft.scheduledOrders, maxDaysAhead: v })} unit="jours" min={1} max={60} disabled={!editable} />
                  </FormField>
                </div>
              )}
            </Section>

            <Section icon={<MessageSquareWarning />} title="Réclamations" description="Délai après livraison pendant lequel une réclamation est recevable ; photo obligatoire, contrôlée automatiquement (doublon, date, cohérence)." badge={badge(['claimWindowHours', 'claims'])}>
              <div className="max-w-xs">
                <UnitInput value={draft.claimWindowHours} onChange={(v) => v !== null && set('claimWindowHours', v)} unit="heures" min={1} max={720} disabled={!editable} aria-label="Délai de réclamation" />
              </div>
              <ToggleRow checked={claims.photoRequired} onChange={(v) => setClaims({ photoRequired: v })} disabled={!editable} label="Photo obligatoire" description="Décision client : sans photo, la réclamation n’est pas enregistrée." />
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow checked={claims.checkDuplicates} onChange={(v) => setClaims({ checkDuplicates: v })} disabled={!editable} label="Détecter les photos déjà utilisées" />
                <ToggleRow checked={claims.checkPhotoDate} onChange={(v) => setClaims({ checkPhotoDate: v })} disabled={!editable} label="Contrôler la date de la photo" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <FormField label="Photos minimum">
                  <UnitInput value={claims.minPhotos} onChange={(v) => v !== null && setClaims({ minPhotos: v })} unit="photo(s)" min={0} max={4} disabled={!editable} />
                </FormField>
                <FormField label="Photos maximum">
                  <UnitInput value={claims.maxPhotos} onChange={(v) => v !== null && setClaims({ maxPhotos: v })} unit="photo(s)" min={1} max={8} disabled={!editable} />
                </FormField>
                <FormField label="Dossier à examiner dès" hint="Réclamations sur 30 jours.">
                  <UnitInput value={claims.repeatThreshold30d} onChange={(v) => v !== null && setClaims({ repeatThreshold30d: v })} unit="réclam." min={1} max={20} disabled={!editable} />
                </FormField>
                <FormField label="Acceptation automatique" hint="Contrôles propres et montant sous ce plafond (0 = jamais).">
                  <EuroInput value={claims.autoAcceptMaxCents} onChange={(v) => v !== null && setClaims({ autoAcceptMaxCents: v })} disabled={!editable} />
                </FormField>
              </div>
            </Section>

            <Section icon={<Hourglass />} title="Inactivité des commerces" description="Sans commande : e-mail d’alerte, puis retrait de la plateforme." badge={badge(['merchantInactivity'])}>
              <ToggleRow
                checked={draft.merchantInactivity?.enabled ?? false}
                onChange={(v) => set('merchantInactivity', { alertAfterDays: 15, removeAfterAlertDays: 30, ...(draft.merchantInactivity ?? {}), enabled: v })}
                disabled={!editable}
                label="Surveillance de l’inactivité"
              />
              {draft.merchantInactivity?.enabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Alerte après">
                    <UnitInput value={draft.merchantInactivity.alertAfterDays} onChange={(v) => v !== null && set('merchantInactivity', { ...draft.merchantInactivity!, alertAfterDays: v })} unit="jours" min={1} max={120} disabled={!editable} />
                  </FormField>
                  <FormField label="Retrait après l’alerte">
                    <UnitInput value={draft.merchantInactivity.removeAfterAlertDays} onChange={(v) => v !== null && set('merchantInactivity', { ...draft.merchantInactivity!, removeAfterAlertDays: v })} unit="jours" min={1} max={365} disabled={!editable} />
                  </FormField>
                </div>
              )}
            </Section>
          </div>
          <div className="min-w-0 space-y-6">
            <div className="space-y-6 xl:sticky xl:top-20">
              <Card>
                <CardHeader
                  title={kind === 'platform' ? 'Plateforme' : kind === 'country' ? `Pays · ${country?.name ?? ''}` : `Ville · ${city?.name ?? ''}`}
                  description={kind === 'platform' ? 'Valeurs de référence de toutes les villes.' : `Les règles non surchargées suivent le niveau ${inherited === 'pays' ? 'du pays' : 'de la plateforme'}.`}
                  icon={<Workflow />}
                  divided
                />
                <CardContent className="space-y-3">
                  <p className="text-sm text-fg-muted">{dirtyKeys.length ? `${dirtyKeys.length} règle${dirtyKeys.length > 1 ? 's' : ''} modifiée${dirtyKeys.length > 1 ? 's' : ''} : ${dirtyKeys.map((k) => FIELD_LABELS[k]).join(', ')}.` : 'Aucune modification en cours.'}</p>
                  {editable && (
                    <div className="flex flex-col gap-2">
                      <Button variant="primary" leftIcon={<Save />} disabled={!dirtyKeys.length || liabilityInvalid} onClick={() => setConfirm('save')}>
                        Enregistrer
                      </Button>
                      <Button variant="secondary" leftIcon={<Undo2 />} disabled={!dirtyKeys.length} onClick={() => setDraft(effective)}>
                        Annuler les changements
                      </Button>
                      {kind !== 'platform' && override && Object.keys(override).length > 0 && (
                        <Button variant="ghost" onClick={() => setConfirm('reset')}>
                          Supprimer toutes les surcharges
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              <SettingsHistoryCard entries={history.data} loading={history.loading} error={history.error} labels={FIELD_LABELS} />
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'reset' ? 'Supprimer les surcharges' : 'Enregistrer les règles'}
        description={confirm === 'reset' ? 'Les règles du niveau supérieur s’appliqueront de nouveau.' : 'Les nouvelles règles s’appliquent immédiatement aux commandes concernées.'}
        requireReason
        confirmLabel={confirm === 'reset' ? 'Supprimer les surcharges' : 'Enregistrer'}
        onConfirm={async (reason) => {
          await submit(reason ?? '');
        }}
      />
    </PageContainer>
  );
}

function Section({ icon, title, description, badge, children }: { icon: ReactNode; title: string; description: string; badge: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} icon={icon} actions={badge} divided />
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ToggleRow({ checked, onChange, disabled, label, description, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} label={label} description={description} />
      {checked && children && <div className="w-full sm:w-44">{children}</div>}
    </div>
  );
}
