import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Coins, Globe2, Lock, Minus, Pencil, Save, Store } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, PageContainer, PageHeader, RadioGroup, Select, Skeleton, Switch, Tooltip, createColumnHelper, formatDateTime, toast, Table } from '@golink/ui';
import {
  COLLECTIONS,
  DISABLED_PAYMENT_METHODS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYOUT_FREQUENCY_LABELS,
  SETTINGS_DOCS,
  formatMoney,
  type Country,
  type CurrencyCode,
  type PaymentMethod,
  type PaymentSettings,
  type Restaurant,
  type RestaurantCommercial,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { docAt, toDate, useDoc, useMutation } from '@/lib/firestore';
import { updateCountryPayments, updateFinanceSettings, updateRestaurantPayments } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel } from '../argent-commun/components';
import { bps, parseEuros, parseMinor, parsePercent, toEurosInput, toMinorInput, toPercentInput } from '../argent-commun/format';
import { inGeo, useCommercials, useDirectory } from '../argent-commun/hooks';
import { PaiementsNav } from './nav';

const ONLINE: PaymentMethod[] = ['card', 'apple_pay', 'google_pay'];
const SHOWN: PaymentMethod[] = PAYMENT_METHODS.filter((m) => m !== 'wallet');

const presetsText = (cents: readonly number[], currency: CurrencyCode = 'EUR') => cents.map((c) => toMinorInput(c, currency).replace(/,0+$/, '')).join(' · ');
const parsePresets = (text: string, currency: CurrencyCode = 'EUR') => {
  const parts = text.split(/[·;/\s]+/).filter(Boolean).map((p) => parseMinor(p, currency));
  return parts.length && parts.every((p) => p !== null && p > 0) ? (parts as number[]) : null;
};

/** Moyens de paiement (cahier §14) : plateforme, pays et commerce ; pourboires et espèces. */
export function MethodsPage() {
  useDocumentTitle('Moyens de paiement · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const editable = can('payments.configure');

  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Moyens de paiement et pourboires" description="Activez les moyens de paiement par pays et par commerce, réglez les pourboires et les espèces.">
        <PaiementsNav />
      </PageHeader>
      <div className="space-y-6">
        <Callout tone="info" icon={<Lock />} title="Règles fixées par la direction">
          Titres-restaurant non acceptés. Espèces possibles uniquement si la livraison est faite par un livreur salarié du commerce : avec un livreur indépendant GoLink, le paiement en ligne est obligatoire. Pourboires reversés à 100 % au livreur.
        </Callout>
        <PlatformCard editable={editable} />
        <CountriesCard editable={editable} />
        <RestaurantsCard editable={editable} />
      </div>
    </PageContainer>
  );
}

function PlatformCard({ editable }: { editable: boolean }) {
  const settings = useDoc<PaymentSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.payments}`));
  const [draft, setDraft] = useState<{ methods: Record<PaymentMethod, boolean>; tipsEnabled: boolean; presets: string; tipsMax: string; cashEnabled: boolean; cashLimit: string; retries: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useMutation(updateFinanceSettings, { success: 'Réglages de paiement enregistrés' });
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setDraft({
      methods: { ...s.methods },
      tipsEnabled: s.tips.enabled,
      presets: presetsText(s.tips.presetsCents),
      tipsMax: toEurosInput(s.tips.maxCents),
      cashEnabled: s.cash.enabled,
      cashLimit: toEurosInput(s.cash.driverCashLimitCents),
      retries: String(s.failedPaymentRetry?.maxAttempts ?? 3),
    });
  }, [settings.data]);
  const presets = draft ? parsePresets(draft.presets) : null;
  const tipsMax = draft ? parseEuros(draft.tipsMax) : null;
  const cashLimit = draft ? parseEuros(draft.cashLimit) : null;
  const valid = Boolean(draft && presets && tipsMax !== null && cashLimit !== null && /^\d+$/.test(draft.retries) && ONLINE.some((m) => draft.methods[m]));

  return (
    <Card>
      <CardHeader title="Plateforme" description="Réglages communs à tous les marchés ; chaque pays peut ensuite restreindre." icon={<Coins />} divided />
      {settings.error ? (
        <CardContent><ErrorPanel error={settings.error} compact /></CardContent>
      ) : !draft ? (
        <CardContent><Skeleton className="h-48 w-full" /></CardContent>
      ) : (
        <>
          <CardContent className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <p className="eyebrow">Moyens de paiement</p>
              {SHOWN.map((m) => {
                const locked = DISABLED_PAYMENT_METHODS.includes(m);
                return (
                  <Switch
                    key={m}
                    checked={!locked && draft.methods[m]}
                    disabled={!editable || locked}
                    onCheckedChange={(v) => setDraft({ ...draft, methods: { ...draft.methods, [m]: v } })}
                    label={PAYMENT_METHOD_LABELS[m]}
                    description={locked ? 'Non accepté sur GoLink' : m === 'cash' ? 'Seulement avec un livreur salarié du commerce' : undefined}
                  />
                );
              })}
            </div>
            <div className="space-y-3">
              <p className="eyebrow">Pourboires</p>
              <Switch checked={draft.tipsEnabled} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, tipsEnabled: v })} label="Pourboires proposés au client" description="Reversés intégralement au livreur, hors commission." />
              <FormField label="Montants proposés" hint="Séparés par des points médians : 1 · 2 · 3 · 5">
                <Input value={draft.presets} disabled={!editable || !draft.tipsEnabled} invalid={!presets} trailing="€" onChange={(e) => setDraft({ ...draft, presets: e.target.value })} />
              </FormField>
              <FormField label="Pourboire maximal">
                <Input inputMode="decimal" value={draft.tipsMax} disabled={!editable || !draft.tipsEnabled} invalid={tipsMax === null} trailing="€" onChange={(e) => setDraft({ ...draft, tipsMax: e.target.value })} />
              </FormField>
            </div>
            <div className="space-y-3">
              <p className="eyebrow">Espèces et échecs</p>
              <Switch checked={draft.cashEnabled} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, cashEnabled: v })} label="Espèces autorisées" description="Pour les commerces qui livrent avec leurs salariés." />
              <FormField label="Plafond d’espèces par livreur" hint="Au-delà, plus de course payée en espèces.">
                <Input inputMode="decimal" value={draft.cashLimit} disabled={!editable || !draft.cashEnabled} invalid={cashLimit === null} trailing="€" onChange={(e) => setDraft({ ...draft, cashLimit: e.target.value })} />
              </FormField>
              <FormField label="Nouvelles tentatives d’un paiement refusé">
                <Input type="number" min={0} max={10} value={draft.retries} disabled={!editable} onChange={(e) => setDraft({ ...draft, retries: e.target.value })} />
              </FormField>
            </div>
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-3">
            <p className="text-xs text-fg-subtle">{toDate(settings.data?.updatedAt) ? `Modifié le ${formatDateTime(toDate(settings.data?.updatedAt) as Date)}` : ''}</p>
            {editable && <Button variant="primary" size="sm" leftIcon={<Save />} disabled={!valid} onClick={() => setConfirm(true)}>Enregistrer</Button>}
          </CardFooter>
          <ActionDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Enregistrer les réglages de paiement"
            description="S’applique immédiatement aux nouvelles commandes de toute la plateforme."
            confirmLabel="Enregistrer"
            onSubmit={async (reason) =>
              Boolean(
                draft && presets && tipsMax !== null && cashLimit !== null &&
                  (await save.mutate({
                    doc: 'payments',
                    reason,
                    data: {
                      methods: draft.methods,
                      tips: { enabled: draft.tipsEnabled, presetsCents: presets, maxCents: tipsMax },
                      cash: { enabled: draft.cashEnabled, driverCashLimitCents: cashLimit },
                      failedPaymentRetry: { maxAttempts: Number(draft.retries) },
                    },
                  })),
              )
            }
          />
        </>
      )}
    </Card>
  );
}

function MethodDot({ on, locked }: { on: boolean; locked?: boolean }) {
  if (locked) return <Minus className="mx-auto size-4 text-fg-subtle" aria-label="Non accepté" />;
  return on ? <Check className="mx-auto size-4 text-success" aria-label="Activé" /> : <Minus className="mx-auto size-4 text-fg-subtle" aria-label="Désactivé" />;
}

function CountriesCard({ editable }: { editable: boolean }) {
  const geo = useGeoScope();
  const countries = geo.countries.filter((c) => !geo.countryId || c.id === geo.countryId);
  const [editing, setEditing] = useState<WithId<Country> | null>(null);
  return (
    <Card>
      <CardHeader title="Par pays" description="Moyens activés, frais de paiement et pourboires de chaque marché" icon={<Globe2 />} divided />
      <CardContent className="p-0">
        {countries.length === 0 ? (
          <EmptyState compact title="Aucun pays dans votre périmètre" />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="eyebrow px-5 py-2.5 text-left font-normal">Pays</th>
                  {SHOWN.map((m) => <th key={m} className="eyebrow px-2 py-2.5 text-center font-normal">{PAYMENT_METHOD_LABELS[m]}</th>)}
                  <th className="eyebrow px-3 py-2.5 text-right font-normal">Frais carte</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-normal">Payés par</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {countries.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-fg">{c.name}</p>
                      <p className="text-xs text-fg-subtle">{c.stripeAvailable === false ? 'Prestataire local' : 'Stripe'}{c.active ? '' : ' · en attente'}</p>
                    </td>
                    {SHOWN.map((m) => <td key={m} className="px-2 py-3 text-center"><MethodDot on={Boolean(c.paymentMethods?.[m])} locked={DISABLED_PAYMENT_METHODS.includes(m)} /></td>)}
                    <td className="px-3 py-3 text-right font-mono text-fg-muted num">{c.pricing?.payment ? `${bps(c.pricing.payment.percentBps)} + ${formatMoney(c.pricing.payment.fixedCents, c.currency)}` : '—'}</td>
                    <td className="px-3 py-3"><Badge size="sm" tone={c.pricing?.payment?.payer === 'restaurant' ? 'info' : 'neutral'}>{c.pricing?.payment?.payer === 'restaurant' ? 'Commerce' : 'GoLink'}</Badge></td>
                    <td className="px-5 py-3 text-right">{editable && <Button size="xs" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(c)}>Modifier</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing && <CountryDialog country={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CountryDialog({ country, onClose }: { country: WithId<Country>; onClose: () => void }) {
  const p = country.pricing.payment;
  const [methods, setMethods] = useState<Record<PaymentMethod, boolean>>({ ...country.paymentMethods });
  const cur = country.currency ?? 'EUR';
  const [fees, setFees] = useState({ percent: toPercentInput(p.percentBps), fixed: toMinorInput(p.fixedCents, cur), connect: toPercentInput(p.connectPercentBps) });
  const [payer, setPayer] = useState<'platform' | 'restaurant'>(p.payer);
  const [tips, setTips] = useState({ enabled: country.pricing.tips.enabled, presets: presetsText(country.pricing.tips.presetsCents, cur), max: toMinorInput(country.pricing.tips.maxCents, cur) });
  const save = useMutation(updateCountryPayments, { success: `Paiements de ${country.name} enregistrés` });
  const parsed = { percent: parsePercent(fees.percent), fixed: parseMinor(fees.fixed, cur), connect: parsePercent(fees.connect), presets: parsePresets(tips.presets, cur), max: parseMinor(tips.max, cur) };
  const valid = Object.values(parsed).every((v) => v !== null) && (country.stripeAvailable === false || ONLINE.some((m) => methods[m]));
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      icon={<Globe2 />}
      title={`Paiements · ${country.name}`}
      confirmLabel="Enregistrer"
      disabled={!valid}
      onSubmit={async (reason) =>
        Boolean(
          valid &&
            (await save.mutate({
              countryId: country.id,
              methods,
              payment: { percentBps: parsed.percent as number, fixedCents: parsed.fixed as number, connectPercentBps: parsed.connect as number, payer },
              tips: { enabled: tips.enabled, presetsCents: parsed.presets as number[], maxCents: parsed.max as number },
              reason,
            })),
        )
      }
    >
      <FormField label="Moyens de paiement">
        <div className="grid gap-2 sm:grid-cols-2">
          {SHOWN.map((m) => (
            <Checkbox key={m} label={PAYMENT_METHOD_LABELS[m]} disabled={DISABLED_PAYMENT_METHODS.includes(m)} checked={!DISABLED_PAYMENT_METHODS.includes(m) && Boolean(methods[m])} onCheckedChange={(v) => setMethods({ ...methods, [m]: v === true })} />
          ))}
        </div>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Frais carte (%)"><Input inputMode="decimal" value={fees.percent} trailing="%" invalid={parsed.percent === null} onChange={(e) => setFees({ ...fees, percent: e.target.value })} /></FormField>
        <FormField label="Part fixe"><Input inputMode="decimal" value={fees.fixed} trailing={country.currency === 'EUR' ? '€' : country.currency} invalid={parsed.fixed === null} onChange={(e) => setFees({ ...fees, fixed: e.target.value })} /></FormField>
        <FormField label="Frais Connect"><Input inputMode="decimal" value={fees.connect} trailing="%" invalid={parsed.connect === null} onChange={(e) => setFees({ ...fees, connect: e.target.value })} /></FormField>
      </div>
      <FormField label="Frais de paiement pris en charge par">
        <RadioGroup
          variant="cards"
          value={payer}
          onValueChange={(v) => setPayer(v as 'platform' | 'restaurant')}
          options={[
            { value: 'restaurant', label: 'Le commerce', description: 'Déduits de son reversement (décision de la direction).' },
            { value: 'platform', label: 'GoLink', description: 'Pris sur la marge de la plateforme.' },
          ]}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Montants de pourboire proposés"><Input value={tips.presets} trailing={country.currency === 'EUR' ? '€' : country.currency} invalid={parsed.presets === null} onChange={(e) => setTips({ ...tips, presets: e.target.value })} /></FormField>
        <FormField label="Pourboire maximal"><Input inputMode="decimal" value={tips.max} trailing={country.currency === 'EUR' ? '€' : country.currency} invalid={parsed.max === null} onChange={(e) => setTips({ ...tips, max: e.target.value })} /></FormField>
      </div>
      <Switch checked={tips.enabled} onCheckedChange={(v) => setTips({ ...tips, enabled: v })} label="Pourboires proposés dans ce pays" />
    </ActionDialog>
  );
}

type RestaurantRow = WithId<Restaurant> & { commercial: RestaurantCommercial | null };
const col = createColumnHelper<RestaurantRow>();

function RestaurantsCard({ editable }: { editable: boolean }) {
  const geo = useGeoScope();
  const directory = useDirectory();
  const restaurants = useMemo(() => directory.restaurants.filter((r) => inGeo(geo, r)), [directory.restaurants, geo]);
  const commercials = useCommercials(restaurants.map((r) => r.id));
  const [editing, setEditing] = useState<RestaurantRow | null>(null);
  const rows: RestaurantRow[] = useMemo(() => restaurants.map((r) => ({ ...r, commercial: commercials.byId[r.id] ?? null })), [restaurants, commercials.byId]);

  const issues = (r: RestaurantRow): string[] => {
    const m = r.commercial?.allowedPaymentMethods ?? [];
    const out: string[] = [];
    if (m.includes('meal_voucher')) out.push('Titres-restaurant encore autorisés (ignorés à la commande)');
    if (m.includes('cash') && r.deliveredBy === 'platform') out.push('Espèces autorisées sans livreur salarié (refusées à la commande)');
    return out;
  };

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Commerce',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{info.row.original.deliveredBy === 'platform' ? 'Livré par GoLink' : info.row.original.deliveredBy === 'restaurant' ? 'Livre avec ses salariés' : 'GoLink et ses salariés'}</p>
          </div>
        ),
      }),
      col.accessor((r) => (r.commercial?.allowedPaymentMethods ?? []).join(','), {
        id: 'methods',
        header: 'Moyens autorisés',
        cell: (info) => {
          const methods = info.row.original.commercial?.allowedPaymentMethods ?? [];
          return (
            <div className="flex flex-wrap gap-1">
              {methods.length ? methods.map((m) => <Badge key={m} size="sm" tone={DISABLED_PAYMENT_METHODS.includes(m) || (m === 'cash' && info.row.original.deliveredBy === 'platform') ? 'amber' : 'neutral'}>{PAYMENT_METHOD_LABELS[m]}</Badge>) : <span className="text-fg-subtle">Réglages de la plateforme</span>}
            </div>
          );
        },
      }),
      col.accessor((r) => r.commercial?.payoutFrequency ?? '', { id: 'payout', header: 'Reversements', cell: (info) => <span className="text-fg-muted">{info.getValue() ? PAYOUT_FREQUENCY_LABELS[info.getValue() as 'weekly'] : 'Calendrier par défaut'}</span> }),
      col.accessor((r) => (r.commercial?.stripeAccountId ? (r.commercial.stripeAccountStatus ?? 'pending') : ''), { id: 'stripe', header: 'Compte Stripe', cell: (info) => <Badge size="sm" tone={info.getValue() === 'enabled' ? 'success' : info.getValue() ? 'amber' : 'danger'} variant="outline">{info.getValue() === 'enabled' ? 'Actif' : info.getValue() ? 'Incomplet' : 'Non créé'}</Badge> }),
      col.display({
        id: 'issues',
        header: '',
        cell: (info) => {
          const list = issues(info.row.original);
          return list.length ? (
            <Tooltip content={list.join(' · ')}>
              <span className="tone-amber inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-(--tone-bg) px-1.5 py-0.5 text-2xs font-medium text-(--tone-fg)"><AlertTriangle className="size-3" />À corriger</span>
            </Tooltip>
          ) : null;
        },
      }),
      col.display({ id: 'edit', header: '', meta: { align: 'right' }, cell: (info) => (editable ? <Button size="xs" variant="ghost" leftIcon={<Pencil />} onClick={(e) => { e.stopPropagation(); setEditing(info.row.original); }}>Modifier</Button> : null) }),
    ],
    [editable],
  );

  const flagged = rows.filter((r) => issues(r).length > 0);
  const [fixing, setFixing] = useState(false);
  const fixAll = async (reason: string): Promise<boolean> => {
    let done = 0;
    for (const r of flagged) {
      const methods = (r.commercial?.allowedPaymentMethods ?? []).filter((m) => !DISABLED_PAYMENT_METHODS.includes(m) && !(m === 'cash' && r.deliveredBy === 'platform'));
      const ok = await updateRestaurantPayments({ restaurantId: r.id, allowedPaymentMethods: methods.length ? methods : ONLINE, payoutFrequency: r.commercial?.payoutFrequency ?? null, reason }).then(() => true, () => false);
      if (ok) done += 1;
    }
    if (done === flagged.length) toast.success(`${done} commerce${done > 1 ? 's' : ''} mis en conformité`);
    else toast.warning(`${done} commerce${done > 1 ? 's' : ''} sur ${flagged.length} mis en conformité`);
    return done > 0;
  };

  return (
    <Card>
      <CardHeader title="Par commerce" description="Moyens autorisés et rythme de reversement propres à chaque commerce" icon={<Store />} divided />
      <CardContent className="space-y-4">
        {editable && flagged.length > 0 && (
          <Callout tone="amber" title={`${flagged.length} commerce${flagged.length > 1 ? 's' : ''} avec des moyens non conformes`} action={<Button size="sm" variant="secondary" onClick={() => setFixing(true)}>Tout mettre en conformité</Button>}>
            Titres-restaurant ou espèces sans livreur salarié : ces moyens sont déjà refusés à la commande ; la correction aligne les réglages enregistrés.
          </Callout>
        )}
        {commercials.error ? (
          <ErrorPanel error={commercials.error} compact />
        ) : (
          <DataTable data={rows} columns={columns} loading={directory.loading || commercials.loading} getRowId={(r) => r.id} itemLabel="commerces" searchPlaceholder="Rechercher un commerce…" pageSize={10} className="border-0 shadow-none" filters={[{ id: 'issue', label: 'Conformité', options: [{ value: 'ko', label: 'À corriger' }, { value: 'ok', label: 'Conforme' }], getValue: (r) => (issues(r).length ? 'ko' : 'ok') }]} emptyState={<EmptyState compact title="Aucun commerce dans votre périmètre" />} />
        )}
      </CardContent>
      {editing && <RestaurantDialog row={editing} onClose={() => setEditing(null)} />}
      <ActionDialog
        open={fixing}
        onOpenChange={setFixing}
        title="Mettre en conformité les commerces"
        description={`Retire les titres-restaurant et les espèces non autorisées pour ${flagged.length} commerce${flagged.length > 1 ? 's' : ''}. Chaque modification est historisée.`}
        confirmLabel="Mettre en conformité"
        onSubmit={fixAll}
      />
    </Card>
  );
}

function RestaurantDialog({ row, onClose }: { row: RestaurantRow; onClose: () => void }) {
  const can = useCan();
  const initial = (row.commercial?.allowedPaymentMethods ?? ONLINE).filter((m) => !DISABLED_PAYMENT_METHODS.includes(m) && !(m === 'cash' && row.deliveredBy === 'platform'));
  const [methods, setMethods] = useState<PaymentMethod[]>(initial);
  const [frequency, setFrequency] = useState<string>(row.commercial?.payoutFrequency ?? 'default');
  const save = useMutation(updateRestaurantPayments, { success: `Paiements de ${row.name} enregistrés` });
  const valid = ONLINE.some((m) => methods.includes(m));
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      icon={<Store />}
      title={`Paiements · ${row.name}`}
      description="Les titres-restaurant et les espèces non conformes sont retirés à l’enregistrement."
      confirmLabel="Enregistrer"
      disabled={!valid}
      onSubmit={async (reason) => Boolean(await save.mutate({ restaurantId: row.id, allowedPaymentMethods: methods, payoutFrequency: frequency === 'default' ? null : (frequency as 'weekly'), reason }))}
    >
      <FormField label="Moyens autorisés">
        <div className="grid gap-2 sm:grid-cols-2">
          {SHOWN.map((m) => {
            const locked = DISABLED_PAYMENT_METHODS.includes(m) || (m === 'cash' && row.deliveredBy === 'platform');
            return (
              <Checkbox
                key={m}
                label={PAYMENT_METHOD_LABELS[m]}
                description={m === 'cash' && row.deliveredBy === 'platform' ? 'Le commerce ne livre pas avec ses salariés' : DISABLED_PAYMENT_METHODS.includes(m) ? 'Non accepté' : undefined}
                disabled={locked}
                checked={!locked && methods.includes(m)}
                onCheckedChange={(v) => setMethods(v ? [...methods, m] : methods.filter((x) => x !== m))}
              />
            );
          })}
        </div>
      </FormField>
      <FormField label="Rythme des reversements" hint={can('finance.payouts') ? undefined : 'Modifiable avec le droit de gérer les reversements.'}>
        <Select disabled={!can('finance.payouts')} value={frequency} onValueChange={setFrequency} options={[{ value: 'default', label: 'Calendrier par défaut de la plateforme' }, ...Object.entries(PAYOUT_FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))]} />
      </FormField>
    </ActionDialog>
  );
}
