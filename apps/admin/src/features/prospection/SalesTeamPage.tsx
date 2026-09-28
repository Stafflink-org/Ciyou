import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BadgeEuro, Ban, CheckCircle2, HandCoins, MoreHorizontal, Save, Settings2, Trophy, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  IconButton,
  ProgressBar,
  Skeleton,
  StatCard,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  createColumnHelper,
  formatDate,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, type CrmSettings, type SalesCommission, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { docAt, toMillis, useDoc, useMutation } from '@/lib/firestore';
import { decideSalesCommission, updateGrowthSettings } from '../_croissance/api';
import { useRestaurantOptions, useSalesTeam } from '../_croissance/hooks';
import { COMMISSION_STATUS_LABELS, COMMISSION_STATUS_TONES } from '../_croissance/labels';
import { LoadError, MoneyInput, NumberInput, SettingsBlock } from '../_croissance/ui';
import { CrmLayout, OPEN_STAGES, useCommissions, useProspects } from './lib';

type Values = Omit<CrmSettings, 'updatedAt' | 'updatedBy'>;
const DEFAULTS: Values = { signupBonusCents: 15_000, revenueShareBps: 0, revenueShareMonths: 0, defaultFollowUpDays: 3, followUpReminders: true };

type Commission = WithId<SalesCommission>;
const col = createColumnHelper<Commission>();

function CrmSettingsCard() {
  const settings = useDoc<CrmSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.crm}`));
  const current = useMemo<Values>(() => ({ ...DEFAULTS, ...(settings.data ?? {}) }), [settings.data]);
  const [d, setD] = useState<Values | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { mutate } = useMutation(updateGrowthSettings, { success: 'Rémunération des commerciaux enregistrée' });
  useEffect(() => {
    if (settings.loading) return;
    setD(current);
    setShare(current.revenueShareBps / 100);
  }, [settings.loading, current]);
  if (settings.error) return <LoadError error={settings.error} compact />;
  if (!d) return <Skeleton className="h-64" />;
  const values: Values = { ...d, revenueShareBps: Math.round((share ?? 0) * 100) };
  const dirty = JSON.stringify(values) !== JSON.stringify(current);
  const invalid = share === null || share < 0 || share > 50 || d.defaultFollowUpDays < 1 || d.revenueShareMonths < 0 || d.revenueShareMonths > 36;
  return (
    <SettingsBlock
      icon={<Settings2 />}
      title="Rémunération et relances"
      description="Primes des commerciaux et rappels de relance."
      aside={
        <Button size="sm" variant="primary" leftIcon={<Save />} disabled={!dirty || invalid} onClick={() => setConfirm(true)}>
          Enregistrer
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Prime par restaurant inscrit">
          <MoneyInput value={d.signupBonusCents} onChange={(v) => setD({ ...d, signupBonusCents: v ?? 0 })} />
        </FormField>
        <FormField label="Part des commissions Ciyou Eats" hint="0 = aucune part variable." error={share !== null && (share < 0 || share > 50) ? 'Entre 0 et 50 %.' : undefined}>
          <NumberInput value={share} onChange={setShare} unit="%" decimals={1} />
        </FormField>
        <FormField label="Durée de l’intéressement" hint="Après l’inscription.">
          <NumberInput value={d.revenueShareMonths} onChange={(v) => setD({ ...d, revenueShareMonths: v ?? 0 })} unit="mois" />
        </FormField>
        <FormField label="Délai de relance par défaut">
          <NumberInput value={d.defaultFollowUpDays} onChange={(v) => setD({ ...d, defaultFollowUpDays: v ?? 0 })} unit="jours" />
        </FormField>
      </div>
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-fg">Rappel quotidien des relances</span>
          <span className="block text-sm text-fg-muted">Chaque matin à 8 h, chaque commercial reçoit la liste de ses relances du jour.</span>
        </span>
        <Switch checked={d.followUpReminders} onCheckedChange={(v) => setD({ ...d, followUpReminders: v })} aria-label="Rappel quotidien des relances" />
      </label>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer la rémunération des commerciaux ?"
        description="La nouvelle prime s’applique aux prochaines inscriptions."
        confirmLabel="Enregistrer"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ section: 'crm', values, reason: reason ?? '' });
        }}
      />
    </SettingsBlock>
  );
}

export function SalesTeamPage() {
  useDocumentTitle('Commerciaux · Prospection · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const manage = can('crm.manage_team');
  const team = useSalesTeam();
  const restaurants = useRestaurantOptions();
  const prospects = useProspects();
  const commissions = useCommissions();
  const [decision, setDecision] = useState<{ row: Commission; kind: 'approve' | 'pay' | 'cancel' } | null>(null);
  const decide = useMutation(decideSalesCommission, { success: 'Commission mise à jour' });

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const byRep = new Map<string, { open: number; demos: number; signed: number; signedMonth: number; lost: number; pending: number; paid: number; name: string }>();
    const ensure = (uid: string, name?: string | null) => {
      if (!byRep.has(uid)) byRep.set(uid, { open: 0, demos: 0, signed: 0, signedMonth: 0, lost: 0, pending: 0, paid: 0, name: team.byId.get(uid)?.displayName ?? name ?? 'Commercial' });
      return byRep.get(uid)!;
    };
    team.reps.forEach((r) => ensure(r.uid, r.displayName));
    for (const p of prospects.data) {
      const s = ensure(p.ownerId, p.ownerName);
      if (OPEN_STAGES.includes(p.stage)) s.open += 1;
      if (p.stage === 'demo' || p.stage === 'negotiation') s.demos += 1;
      if (p.stage === 'signed_up') {
        s.signed += 1;
        if ((toMillis(p.signedUpAt) ?? 0) >= monthStart.getTime()) s.signedMonth += 1;
      }
      if (p.stage === 'lost') s.lost += 1;
    }
    for (const c of commissions.data) {
      const s = ensure(c.salesRepId);
      if (c.status === 'pending' || c.status === 'approved') s.pending += c.amountCents;
      if (c.status === 'paid') s.paid += c.amountCents;
    }
    return [...byRep.entries()].map(([uid, s]) => ({ uid, ...s, rate: s.signed + s.lost ? s.signed / (s.signed + s.lost) : null })).sort((a, b) => b.signed - a.signed || b.open - a.open);
  }, [prospects.data, commissions.data, team.reps, team.byId]);

  const totals = useMemo(() => {
    let due = 0;
    let paid = 0;
    for (const c of commissions.data) {
      if (c.status === 'pending' || c.status === 'approved') due += c.amountCents;
      if (c.status === 'paid') paid += c.amountCents;
    }
    const signed = stats.reduce((n, s) => n + s.signed, 0);
    const closed = stats.reduce((n, s) => n + s.signed + s.lost, 0);
    return { due, paid, signed, rate: closed ? signed / closed : null };
  }, [commissions.data, stats]);
  const best = stats[0];

  const columns = useMemo(
    () => [
      col.accessor((c) => team.byId.get(c.salesRepId)?.displayName ?? 'Commercial', { id: 'commercial', header: 'Commercial', cell: ({ getValue }) => <span className="whitespace-nowrap font-medium">{getValue()}</span> }),
      col.accessor((c) => restaurants.byId.get(c.restaurantId)?.name ?? '—', {
        id: 'restaurant',
        header: 'Restaurant',
        cell: ({ row, getValue }) =>
          row.original.prospectId ? (
            <Link to={`/prospection/${row.original.prospectId}`} className="whitespace-nowrap hover:underline" onClick={(e) => e.stopPropagation()}>
              {getValue() === '—' ? 'Voir le prospect' : getValue()}
            </Link>
          ) : (
            <span className="whitespace-nowrap">{getValue()}</span>
          ),
      }),
      col.accessor((c) => (c.basis === 'signup_bonus' ? 'Prime d’inscription' : 'Part des commissions'), { id: 'base', header: 'Nature', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue()}</span> }),
      col.accessor('amountCents', { header: 'Montant', meta: { align: 'right' }, cell: ({ getValue }) => <span className="num font-mono">{formatEUR(getValue(), { cents: true })}</span> }),
      col.accessor((c) => toMillis(c.createdAt) ?? 0, { id: 'date', header: 'Date', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue() ? formatDate(getValue()) : '—'}</span> }),
      col.accessor((c) => COMMISSION_STATUS_LABELS[c.status], { id: 'statut', header: 'Statut', cell: ({ row, getValue }) => <StatusPill tone={COMMISSION_STATUS_TONES[row.original.status]}>{getValue()}</StatusPill> }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const c = row.original;
          if (!manage || c.status === 'paid' || c.status === 'cancelled') return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Actions" variant="ghost" size="sm">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {c.status === 'pending' && (
                  <DropdownMenuItem icon={<CheckCircle2 />} onSelect={() => setDecision({ row: c, kind: 'approve' })}>
                    Valider
                  </DropdownMenuItem>
                )}
                {c.status === 'approved' && (
                  <DropdownMenuItem icon={<HandCoins />} onSelect={() => setDecision({ row: c, kind: 'pay' })}>
                    Marquer comme versée
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem icon={<Ban />} destructive onSelect={() => setDecision({ row: c, kind: 'cancel' })}>
                  Annuler
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [team.byId, restaurants.byId, manage],
  );

  const loading = prospects.loading || team.loading;

  return (
    <CrmLayout>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Commerciaux" value={formatNumber(team.reps.length)} icon={<Users />} tone="brand" loading={team.loading} />
        <StatCard label="Restaurants inscrits" value={formatNumber(totals.signed)} icon={<Trophy />} tone="success" loading={loading} footer={totals.rate === null ? 'Aucun prospect clos' : `${Math.round(totals.rate * 100)} % de conversion`} />
        <StatCard label="Commissions à verser" value={formatEUR(totals.due, { cents: true })} icon={<BadgeEuro />} tone="amber" loading={commissions.loading} />
        <StatCard label="Commissions versées" value={formatEUR(totals.paid, { cents: true })} icon={<HandCoins />} tone="teal" loading={commissions.loading} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="min-w-0">
          <CardHeader title="Résultats par commercial" description={best && best.signed > 0 ? `En tête : ${best.name}, ${best.signed} inscription${best.signed > 1 ? 's' : ''}.` : 'Prospects du périmètre sélectionné.'} divided />
          {prospects.error || team.error ? (
            <LoadError error={prospects.error ?? team.error} compact />
          ) : loading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : stats.length === 0 ? (
            <EmptyState compact icon={<Users />} title="Aucun commercial" description="Donnez l’accès à la prospection à un membre de l’équipe pour suivre ses résultats." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commercial</TableHead>
                    <TableHead className="text-right">En cours</TableHead>
                    <TableHead className="text-right">Démos</TableHead>
                    <TableHead className="text-right">Inscrits</TableHead>
                    <TableHead className="text-right">Perdus</TableHead>
                    <TableHead className="min-w-[9rem]">Conversion</TableHead>
                    <TableHead className="text-right">À verser</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.map((s) => (
                    <TableRow key={s.uid}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={s.name} size="sm" />
                          <div className="min-w-0">
                            <p className="whitespace-nowrap font-medium text-fg">{s.name}</p>
                            {s.signedMonth > 0 && <p className="text-2xs text-fg-muted">{s.signedMonth} ce mois-ci</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="num text-right font-mono">{s.open}</TableCell>
                      <TableCell className="num text-right font-mono">{s.demos}</TableCell>
                      <TableCell className="num text-right font-mono">{s.signed}</TableCell>
                      <TableCell className="num text-right font-mono text-fg-muted">{s.lost}</TableCell>
                      <TableCell>
                        {s.rate === null ? <span className="text-xs text-fg-subtle">—</span> : <ProgressBar size="sm" value={s.rate * 100} valueLabel={`${Math.round(s.rate * 100)} %`} tone="success" />}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-right font-mono">{formatEUR(s.pending, { cents: true })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
        {manage ? (
          <CrmSettingsCard />
        ) : (
          <Card className="p-5 text-sm text-fg-muted">
            <p className="mb-1 font-medium text-fg">Vos commissions</p>
            Une prime est créée à chaque restaurant inscrit que vous avez démarché ; elle est validée puis versée par le responsable commercial.
          </Card>
        )}
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{commissions.all ? 'Commissions des commerciaux' : 'Mes commissions'}</h2>
          <Badge>{commissions.data.length}</Badge>
        </div>
        {commissions.error ? (
          <Card>
            <LoadError error={commissions.error} />
          </Card>
        ) : (
          <DataTable
            data={commissions.data}
            columns={columns}
            getRowId={(c) => c.id}
            loading={commissions.loading}
            itemLabel="commissions"
            filters={[{ id: 'status', label: 'Statut', options: Object.entries(COMMISSION_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (c) => c.status }]}
            emptyState={<EmptyState compact icon={<BadgeEuro />} title="Aucune commission" description="Les primes apparaissent quand un prospect passe à l’étape « Inscrit »." />}
          />
        )}
      </div>

      {decision && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDecision(null)}
          title={decision.kind === 'approve' ? 'Valider la commission ?' : decision.kind === 'pay' ? 'Marquer la commission comme versée ?' : 'Annuler la commission ?'}
          description={`${formatEUR(decision.row.amountCents, { cents: true })} pour ${team.byId.get(decision.row.salesRepId)?.displayName ?? 'le commercial'}.`}
          confirmLabel={decision.kind === 'approve' ? 'Valider' : decision.kind === 'pay' ? 'Confirmer le versement' : 'Annuler la commission'}
          destructive={decision.kind === 'cancel'}
          requireReason={decision.kind === 'cancel'}
          onConfirm={async (reason) => {
            await decide.mutate({ commissionId: decision.row.id, decision: decision.kind, reason: reason ?? null });
            setDecision(null);
          }}
        />
      )}
    </CrmLayout>
  );
}
