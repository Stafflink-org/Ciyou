import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { AlertTriangle, Banknote, HandCoins, Users, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  ProgressBar,
  StatCard,
  createColumnHelper,
  formatDateTime,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, type CashMovement, type DriverPrivate, type PaymentSettings, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { recordCashRemittance } from '../argent-commun/api';
import { ActionDialog, Callout, ErrorPanel, Money } from '../argent-commun/components';
import { eur, parseEuros, plural } from '../argent-commun/format';
import { inGeo, useDirectory } from '../argent-commun/hooks';
import { PaiementsNav } from './nav';

type Row = WithId<DriverPrivate> & { name: string; cityId: string | null; countryId: string | null; detail: string | null };
const col = createColumnHelper<Row>();

/** Espèces (cahier §14) : caisse des livreurs salariés des commerces (l'argent reste chez le commerce), plafond et remises. */
export function CashPage() {
  useDocumentTitle('Espèces · GoLink Admin');
  const can = useCan();
  const geo = useGeoScope();
  const directory = useDirectory();
  const allowed = can('drivers.view') || can('finance.view');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.driverPrivate), where('cashBalanceCents', '>', 0), orderBy('cashBalanceCents', 'desc'), limit(500)) : null), [allowed]);
  const { data, loading, error } = useCollection<DriverPrivate>(q);
  const settings = useDoc<PaymentSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.payments}`));
  const movementsQuery = useMemo(() => (can('finance.view') ? query(collection(db, COLLECTIONS.cashMovements), orderBy('createdAt', 'desc'), limit(60)) : null), [can]);
  const movements = useCollection<CashMovement>(movementsQuery);
  const [target, setTarget] = useState<Row | null>(null);
  const [amount, setAmount] = useState('');
  const remit = useMutation(recordCashRemittance, { success: (r) => `Remise enregistrée : il reste ${eur(r.cashBalanceCents)} en espèces` });

  const rows: Row[] = useMemo(
    () =>
      data
        .map((d) => {
          const entry = directory.get('driver', d.id);
          return { ...d, name: entry?.name ?? d.id, cityId: entry?.cityId ?? null, countryId: entry?.countryId ?? null, detail: entry?.detail ?? null };
        })
        .filter((d) => inGeo(geo, d)),
    [data, directory, geo],
  );
  const total = rows.reduce((s, r) => s + r.cashBalanceCents, 0);
  const over = rows.filter((r) => r.cashBalanceCents >= r.cashLimitCents);

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Livreur',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{info.getValue()}</p>
            <p className="text-xs text-fg-subtle">{[geo.cities.find((c) => c.id === info.row.original.cityId)?.name, info.row.original.detail].filter(Boolean).join(' · ')}</p>
          </div>
        ),
      }),
      col.accessor('cashBalanceCents', { header: 'Espèces détenues', meta: { align: 'right' }, cell: (info) => <Money cents={info.getValue()} className="font-semibold text-fg" /> }),
      col.accessor((r) => (r.cashLimitCents ? r.cashBalanceCents / r.cashLimitCents : 0), {
        id: 'usage',
        header: 'Plafond',
        cell: (info) => {
          const r = info.row.original;
          const pct = Math.min(100, Math.round(info.getValue() * 100));
          return (
            <div className="w-44">
              <ProgressBar value={pct} tone={pct >= 100 ? 'danger' : pct >= 75 ? 'amber' : 'brand'} size="sm" />
              <p className="mt-1 text-2xs text-fg-subtle">{pct} % de {eur(r.cashLimitCents)}</p>
            </div>
          );
        },
      }),
      col.display({
        id: 'state',
        header: 'État',
        cell: (info) => (info.row.original.cashBalanceCents >= info.row.original.cashLimitCents ? <Badge tone="danger" icon={<AlertTriangle />}>Plafond atteint</Badge> : <Badge tone="neutral">Sous le plafond</Badge>),
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: (info) =>
          can('finance.adjust') ? (
            <Button size="sm" variant="secondary" leftIcon={<HandCoins />} onClick={(e) => { e.stopPropagation(); setAmount((info.row.original.cashBalanceCents / 100).toFixed(2).replace('.', ',')); setTarget(info.row.original); }}>
              Remise de caisse
            </Button>
          ) : null,
      }),
    ],
    [can, geo.cities],
  );

  const cents = parseEuros(amount);
  return (
    <PageContainer wide>
      <PageHeader eyebrow={`Argent · ${geo.label}`} title="Espèces" description="Espèces encaissées par les livreurs salariés des commerces : caisse détenue, plafond et remises au commerce.">
        <PaiementsNav />
      </PageHeader>
      <div className="space-y-6">
        <Callout tone="info" icon={<Banknote />} title="Espèces seulement avec les livreurs salariés des commerces">
          Avec un livreur indépendant GoLink, le paiement en ligne est obligatoire. Les espèces encaissées par un livreur salarié restent au commerce : elles sont déduites du reversement du commerce (déjà encaissées), la caisse du livreur augmente à chaque livraison payée en espèces, et le commerce (ou l’équipe GoLink) enregistre la remise de caisse. Au plafond, le livreur ne reçoit plus de commande en espèces.
        </Callout>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Espèces détenues" icon={<Wallet />} tone="brand" loading={loading} value={eur(total)} footer={plural(rows.length, 'livreur')} />
          <StatCard label="Plafond atteint" icon={<AlertTriangle />} tone="danger" loading={loading} value={String(over.length)} footer="Plus de course en espèces tant que le solde n’est pas remis" />
          <StatCard label="Plafond par livreur" icon={<Users />} tone="neutral" loading={settings.loading} value={settings.data ? eur(settings.data.cash.driverCashLimitCents) : '—'} footer={settings.data?.cash.enabled ? 'Espèces autorisées' : 'Espèces désactivées'} />
        </div>
        {!allowed ? (
          <EmptyState title="Accès réservé" description="La consultation des soldes d’espèces demande le droit de voir les livreurs ou la finance." />
        ) : error ? (
          <ErrorPanel error={error} />
        ) : (
          <DataTable data={rows} columns={columns} loading={loading || directory.loading} getRowId={(r) => r.id} itemLabel="livreurs" searchPlaceholder="Rechercher un livreur…" emptyState={<EmptyState icon={<Banknote />} title="Aucune espèce détenue" description="Aucun livreur salarié de votre périmètre ne détient d’espèces." />} />
        )}
        {can('finance.view') && (
          <section className="space-y-2">
            <h2 className="eyebrow">Derniers mouvements de caisse</h2>
            {movements.error ? (
              <ErrorPanel error={movements.error} compact />
            ) : movements.loading ? (
              <p className="text-sm text-fg-subtle">Chargement…</p>
            ) : movements.data.length === 0 ? (
              <p className="text-sm text-fg-subtle">Aucun mouvement enregistré.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {movements.data.filter((m) => inGeo(geo, m)).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-fg">{m.driverName ?? m.driverId} · {m.type === 'collected' ? 'Espèces encaissées' : m.type === 'remitted' ? 'Remise de caisse' : 'Correction'}{m.orderNumber ? ` · ${m.orderNumber}` : ''}</p>
                      <p className="truncate text-xs text-fg-subtle">{toDate(m.createdAt) ? formatDateTime(toDate(m.createdAt) as Date) : ''} · caisse après : {eur(m.balanceAfterCents)}{m.note ? ` · ${m.note}` : ''}</p>
                    </div>
                    <Money cents={m.amountCents} className="shrink-0 text-sm text-fg" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <ActionDialog
        open={Boolean(target)}
        onOpenChange={(o) => !o && setTarget(null)}
        icon={<HandCoins />}
        title={target ? `Remise de caisse de ${target.name}` : 'Remise de caisse'}
        description={target ? `Solde actuel : ${eur(target.cashBalanceCents)}.` : undefined}
        confirmLabel={cents ? `Enregistrer ${eur(cents)}` : 'Enregistrer'}
        disabled={!target || !cents || cents <= 0 || cents > target.cashBalanceCents}
        reasonPlaceholder="Ex. : caisse remise au gérant, reçu n° 124."
        onSubmit={async (reason) => Boolean(target && cents && (await remit.mutate({ driverId: target.id, amountCents: cents, reason })))}
      >
        <FormField label="Montant remis" hint={target ? `Au plus ${eur(target.cashBalanceCents)}.` : undefined}>
          <Input inputMode="decimal" value={amount} trailing="€" invalid={amount !== '' && (!cents || (target ? cents > target.cashBalanceCents : false))} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
      </ActionDialog>
    </PageContainer>
  );
}
