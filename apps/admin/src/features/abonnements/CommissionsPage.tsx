import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { ArrowDownWideNarrow, Building2, Globe2, History, Layers, MapPin, Percent, Plus, Store, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, Combobox, DataTable, EmptyState, FormField, Input, PageContainer, PageHeader, RadioGroup, Skeleton, StatusPill, createColumnHelper, formatDate, Table } from '@golink/ui';
import { COLLECTIONS, COMMISSION_SCOPE_LABELS, type CommissionRule, type CommissionScope, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { updateCommissionRule } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel } from '../argent-commun/components';
import { addDays, bps, isoDay, parsePercent, toPercentInput } from '../argent-commun/format';
import { inGeo, useDirectory } from '../argent-commun/hooks';
import { usePlans } from './hooks';
import { AbonnementsNav } from './nav';

type Rule = WithId<CommissionRule & { scopeLabel?: string; cityId?: string | null; endReason?: string }>;
const col = createColumnHelper<Rule>();

const SCOPE_ICONS: Record<CommissionScope, ReactNode> = {
  country: <Globe2 />,
  city: <MapPin />,
  plan: <Layers />,
  group: <Building2 />,
  restaurant: <Store />,
};

const isActive = (r: CommissionRule) => !r.validTo || (toDate(r.validTo)?.getTime() ?? 0) > Date.now();

/** Commissions (cahier §17) : par défaut, par formule, par ville, négociées, avec historique. */
export function CommissionsPage() {
  useDocumentTitle('Commissions · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const plans = usePlans();
  const canRead = can('commissions.edit') || can('finance.view') || can('restaurants.commercial');
  const q = useMemo(() => (canRead ? query(collection(db, COLLECTIONS.commissionRules), orderBy('validFrom', 'desc'), limit(500)) : null), [canRead]);
  const rules = useCollection<Rule>(q);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<Rule | null>(null);
  const end = useMutation(updateCommissionRule, { success: 'Barème clos : le taux par défaut s’applique de nouveau' });

  const label = (r: Rule) => {
    if (r.scopeLabel) return r.scopeLabel;
    if (r.scope === 'country') return geo.countries.find((c) => c.id === r.scopeId)?.name ?? r.scopeId;
    if (r.scope === 'city') return geo.cities.find((c) => c.id === r.scopeId)?.name ?? r.scopeId;
    if (r.scope === 'plan') return plans.data.find((p) => p.code === r.scopeId)?.name ?? r.scopeId;
    if (r.scope === 'restaurant') return directory.name('restaurant', r.scopeId);
    return r.scopeId;
  };
  const visible = useMemo(
    () =>
      rules.data.filter((r) => {
        if (r.scope === 'city') return inGeo(geo, { cityId: r.scopeId, countryId: r.countryId });
        if (r.scope === 'restaurant') {
          const entry = directory.get('restaurant', r.scopeId);
          return entry ? inGeo(geo, entry) : !geo.cityIds;
        }
        return !geo.countryId || r.countryId === geo.countryId || r.scope === 'plan';
      }),
    [rules.data, geo, directory],
  );
  const active = visible.filter(isActive);
  const planRates = plans.data.map((p) => ({ id: `plan-${p.code}`, label: p.name, ...p.commission }));

  const columns = useMemo(
    () => [
      col.accessor('scope', {
        header: 'Portée',
        cell: (info) => (
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{SCOPE_ICONS[info.getValue()]}</span>
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{label(info.row.original)}</p>
              <p className="text-xs text-fg-subtle">{COMMISSION_SCOPE_LABELS[info.getValue()]}</p>
            </div>
          </div>
        ),
      }),
      col.accessor('platformDeliveryBps', { header: 'Livraison GoLink', meta: { align: 'right' }, cell: (info) => <span className="font-mono num">{bps(info.getValue())}</span> }),
      col.accessor('restaurantDeliveryBps', { header: 'Livreurs du commerce', meta: { align: 'right' }, cell: (info) => <span className="font-mono num">{bps(info.getValue())}</span> }),
      col.accessor('pickupBps', { header: 'Retrait', meta: { align: 'right' }, cell: (info) => <span className="font-mono num">{bps(info.getValue())}</span> }),
      col.accessor((r) => toDate(r.validFrom)?.getTime() ?? 0, {
        id: 'validity',
        header: 'Validité',
        cell: (info) => {
          const r = info.row.original;
          const to = toDate(r.validTo);
          return (
            <div>
              <p className="whitespace-nowrap text-fg-muted">depuis le {info.getValue() ? formatDate(info.getValue()) : '—'}</p>
              {to && <p className="text-xs text-fg-subtle">{isActive(r) ? `jusqu’au ${formatDate(to)}` : `clos le ${formatDate(to)}`}</p>}
            </div>
          );
        },
      }),
      col.accessor('reason', { header: 'Motif', cell: (info) => <p className="line-clamp-2 max-w-xs text-fg-muted" title={String(info.getValue() ?? '')}>{info.getValue()}</p> }),
      col.display({
        id: 'state',
        header: 'État',
        cell: (info) => (isActive(info.row.original) ? <StatusPill tone="success">En vigueur</StatusPill> : <StatusPill tone="neutral">Historique</StatusPill>),
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: (info) => {
          const r = info.row.original;
          if (!can('commissions.edit') || !isActive(r) || r.scope === 'country' || r.scope === 'plan') return null;
          return (
            <Button size="xs" variant="ghost" leftIcon={<XCircle />} onClick={(e) => { e.stopPropagation(); setEnding(r); }}>
              Clore
            </Button>
          );
        },
      }),
    ],
    [can, geo.countries, geo.cities, plans.data, directory],
  );

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Argent · ${geo.label}`}
        title="Commissions"
        description="Barème par défaut de chaque pays, taux par formule, par ville ou négocié pour un commerce. Chaque changement crée une nouvelle version : l’historique est conservé."
        actions={can('commissions.edit') ? <Button variant="primary" size="sm" leftIcon={<Plus />} onClick={() => setCreating(true)}>Nouveau barème</Button> : undefined}
      >
        <AbonnementsNav />
      </PageHeader>

      <div className="space-y-6">
        <Callout tone="info" icon={<ArrowDownWideNarrow />} title="Ordre d’application">
          Taux négocié du commerce, puis négocié pour son groupe, puis taux de la ville, puis taux de la formule (sauf formule qui hérite du pays), puis barème du pays. En mode « abonnement », aucune commission n’est prélevée sur les ventes. Une offre spéciale retire ensuite ses points. Assiette : articles TTC payés par le client, hors livraison et pourboires.
        </Callout>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Barèmes par défaut" description="Pays et formules" icon={<Percent />} divided />
            <CardContent className="p-0">
              {rules.loading || plans.loading ? (
                <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left">
                        <th className="eyebrow px-5 py-2.5 font-normal">Barème</th>
                        <th className="eyebrow px-3 py-2.5 text-right font-normal">Livraison GoLink</th>
                        <th className="eyebrow px-3 py-2.5 text-right font-normal">Livreurs du commerce</th>
                        <th className="eyebrow px-5 py-2.5 text-right font-normal">Retrait</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...active.filter((r) => r.scope === 'country').map((r) => ({ id: r.id, label: `${label(r)} (pays)`, platformDeliveryBps: r.platformDeliveryBps, restaurantDeliveryBps: r.restaurantDeliveryBps, pickupBps: r.pickupBps })),
                        ...planRates.map((p) => ({ ...p, label: `Formule ${p.label}` })),
                      ].map((row) => (
                        <tr key={row.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3 font-medium text-fg">{row.label}</td>
                          <td className="px-3 py-3 text-right font-mono num">{bps(row.platformDeliveryBps)}</td>
                          <td className="px-3 py-3 text-right font-mono num">{bps(row.restaurantDeliveryBps)}</td>
                          <td className="px-5 py-3 text-right font-mono num">{bps(row.pickupBps)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Exceptions en vigueur" description="Villes, groupes et commerces" divided />
            <CardContent className="space-y-3">
              {rules.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : active.filter((r) => ['city', 'group', 'restaurant'].includes(r.scope)).length === 0 ? (
                <p className="text-sm text-fg-muted">Aucun taux particulier : le barème par défaut s’applique partout.</p>
              ) : (
                active
                  .filter((r) => ['city', 'group', 'restaurant'].includes(r.scope))
                  .map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{label(r)}</p>
                        <p className="text-xs text-fg-subtle">{COMMISSION_SCOPE_LABELS[r.scope]}{toDate(r.validTo) ? ` · jusqu’au ${formatDate(toDate(r.validTo) as Date)}` : ''}</p>
                      </div>
                      <Badge tone="brand" className="shrink-0 font-mono">{bps(r.platformDeliveryBps)}</Badge>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-fg"><History className="size-4 text-fg-subtle" />Historique des barèmes</h2>
          {!canRead ? (
            <EmptyState title="Accès réservé" description="La consultation des barèmes demande un droit finance, commissions ou conditions commerciales." />
          ) : rules.error ? (
            <ErrorPanel error={rules.error} />
          ) : (
            <DataTable
              data={visible}
              columns={columns}
              loading={rules.loading}
              getRowId={(r) => r.id}
              itemLabel="barèmes"
              searchPlaceholder="Rechercher un commerce, une ville, un motif…"
              filters={[
                { id: 'scope', label: 'Portée', options: (Object.keys(COMMISSION_SCOPE_LABELS) as CommissionScope[]).map((s) => ({ value: s, label: COMMISSION_SCOPE_LABELS[s] })), getValue: (r) => r.scope },
                { id: 'state', label: 'État', options: [{ value: 'active', label: 'En vigueur' }, { value: 'closed', label: 'Historique' }], getValue: (r) => (isActive(r) ? 'active' : 'closed') },
              ]}
              emptyState={<EmptyState icon={<Percent />} title="Aucun barème" />}
            />
          )}
        </section>
      </div>

      {creating && <RuleDialog onClose={() => setCreating(false)} />}
      <ActionDialog
        open={Boolean(ending)}
        onOpenChange={(o) => !o && setEnding(null)}
        destructive
        title={ending ? `Clore le barème de ${label(ending)}` : 'Clore le barème'}
        description="Le taux particulier cesse immédiatement : le taux de la formule ou du pays s’applique aux prochaines commandes."
        confirmLabel="Clore le barème"
        onSubmit={async (reason) => Boolean(ending && (await end.mutate({ action: 'end', ruleId: ending.id, reason })))}
      />
    </PageContainer>
  );
}

function RuleDialog({ onClose }: { onClose: () => void }) {
  const geo = useGeoScope();
  const directory = useDirectory();
  const plans = usePlans();
  const [scope, setScope] = useState<CommissionScope>('restaurant');
  const [scopeId, setScopeId] = useState<string | undefined>();
  const [rates, setRates] = useState({ platform: '', restaurant: '', pickup: '' });
  const [validTo, setValidTo] = useState('');
  const create = useMutation(updateCommissionRule, { success: 'Nouveau barème en vigueur' });
  const parsed = { platform: parsePercent(rates.platform), restaurant: parsePercent(rates.restaurant), pickup: parsePercent(rates.pickup) };
  const valid = Boolean(scopeId) && parsed.platform !== null && parsed.restaurant !== null && parsed.pickup !== null;

  const options = useMemo(() => {
    switch (scope) {
      case 'country':
        return geo.countries.map((c) => ({ value: c.id, label: c.name }));
      case 'city':
        return geo.cities.filter((c) => inGeo(geo, { cityId: c.id, countryId: c.countryId })).map((c) => ({ value: c.id, label: c.name, description: c.countryId }));
      case 'plan':
        return plans.data.map((p) => ({ value: p.code, label: p.name }));
      case 'restaurant':
        return directory.restaurants.filter((r) => inGeo(geo, r)).map((r) => ({ value: r.id, label: r.name, description: r.address?.city }));
      case 'group':
        return [...new Set(directory.restaurants.map((r) => r.groupId).filter((g): g is string => Boolean(g)))].map((g) => ({ value: g, label: g }));
    }
  }, [scope, geo, plans.data, directory.restaurants]);

  const prefill = (id: string | undefined) => {
    setScopeId(id);
    if (!id) return;
    const plan = scope === 'plan' ? plans.data.find((p) => p.code === id) : null;
    const country = scope === 'country' ? geo.countries.find((c) => c.id === id) : null;
    const source = plan?.commission ?? country?.pricing?.commission;
    if (source) setRates({ platform: toPercentInput(source.platformDeliveryBps), restaurant: toPercentInput(source.restaurantDeliveryBps), pickup: toPercentInput(source.pickupBps) });
  };

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<Percent />}
      title="Nouveau barème de commission"
      description="Le barème en vigueur sur la même portée est clos automatiquement et conservé dans l’historique."
      confirmLabel="Mettre en vigueur"
      disabled={!valid}
      onSubmit={async (reason) =>
        Boolean(
          valid &&
            scopeId &&
            (await create.mutate({
              action: 'create',
              scope,
              scopeId,
              platformDeliveryBps: parsed.platform as number,
              restaurantDeliveryBps: parsed.restaurant as number,
              pickupBps: parsed.pickup as number,
              validTo: validTo || null,
              reason,
            })),
        )
      }
    >
      <FormField label="Portée">
        <RadioGroup
          value={scope}
          onValueChange={(v) => {
            setScope(v as CommissionScope);
            setScopeId(undefined);
          }}
          options={(['restaurant', 'group', 'city', 'plan', 'country'] as CommissionScope[]).map((s) => ({ value: s, label: COMMISSION_SCOPE_LABELS[s] }))}
        />
      </FormField>
      <FormField label="Cible">
        <Combobox options={options} value={scopeId} onChange={prefill} placeholder="Choisir…" searchPlaceholder="Rechercher…" emptyText="Aucun résultat" className="w-full" aria-label="Cible du barème" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Livraison GoLink"><Input inputMode="decimal" value={rates.platform} trailing="%" invalid={rates.platform !== '' && parsed.platform === null} onChange={(e) => setRates({ ...rates, platform: e.target.value })} /></FormField>
        <FormField label="Livreurs du commerce"><Input inputMode="decimal" value={rates.restaurant} trailing="%" invalid={rates.restaurant !== '' && parsed.restaurant === null} onChange={(e) => setRates({ ...rates, restaurant: e.target.value })} /></FormField>
        <FormField label="Retrait"><Input inputMode="decimal" value={rates.pickup} trailing="%" invalid={rates.pickup !== '' && parsed.pickup === null} onChange={(e) => setRates({ ...rates, pickup: e.target.value })} /></FormField>
      </div>
      {(scope === 'restaurant' || scope === 'group' || scope === 'city') && (
        <FormField label="Fin de validité" hint="Facultatif : sans date, le taux reste en vigueur jusqu’à sa clôture.">
          <Input type="date" value={validTo} min={addDays(isoDay(new Date()), 1)} onChange={(e) => setValidTo(e.target.value)} />
        </FormField>
      )}
    </ActionDialog>
  );
}
