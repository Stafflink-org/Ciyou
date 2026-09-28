import { useEffect, useMemo, useState } from 'react';
import { collection, getAggregateFromServer, limit, orderBy, query, sum, where, count } from 'firebase/firestore';
import { CalendarClock, Coins, Gift, History, Plus, Save, Sparkles, Store, Trash2, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  IconButton,
  Skeleton,
  StatCard,
  Switch,
  formatDateTime,
  formatNumber,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, formatPrice, type LoyaltySettings, type LoyaltyTransaction } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { updateGrowthSettings } from '../_croissance/api';
import { LoadError, MoneyInput, NumberInput, SettingsBlock } from '../_croissance/ui';
import { LoyaltyLayout } from './layout';

type Values = Required<Omit<LoyaltySettings, 'updatedAt' | 'updatedBy'>>;

const DEFAULTS: Values = {
  enabled: false,
  pointsPerEuro: 1,
  welcomePoints: 0,
  rewards: [{ points: 200, valueCents: 300 }],
  pointsValidityDays: 365,
  allowRestaurantPrograms: true,
  minOrderCents: 0,
  maxRedeemBps: 5000,
  maxRestaurantReturnBps: 2000,
};

const TX_LABELS: Record<LoyaltyTransaction['type'], string> = { earn: 'Gain', redeem: 'Échange', welcome: 'Bienvenue', expire: 'Expiration', adjust: 'Ajustement' };

/** Comptes et points en circulation (lecture ponctuelle, droit clients requis). */
function useLoyaltyTotals(enabled: boolean) {
  const [totals, setTotals] = useState<{ platformAccounts: number; restaurantAccounts: number; points: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const base = collection(db, COLLECTIONS.loyaltyAccounts);
    Promise.all([
      getAggregateFromServer(query(base, where('scope', '==', 'platform')), { n: count(), points: sum('points') }),
      getAggregateFromServer(query(base, where('scope', '==', 'restaurant')), { n: count(), points: sum('points') }),
    ])
      .then(([p, r]) => alive && setTotals({ platformAccounts: p.data().n, restaurantAccounts: r.data().n, points: (p.data().points ?? 0) + (r.data().points ?? 0) }))
      .catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { totals, error };
}

export function LoyaltyPage() {
  useDocumentTitle('Programme de fidélité · Ciyou Eats Admin');
  const { can, admin } = useAdminAccess();
  const central = admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0);
  const canEdit = can('loyalty.edit') && central;
  const canSeeCustomers = can('customers.view');
  const settings = useDoc<LoyaltySettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.loyalty}`));
  const current = useMemo<Values>(() => ({ ...DEFAULTS, ...(settings.data ?? {}) }) as Values, [settings.data]);
  const [draft, setDraft] = useState<Values | null>(null);
  const [redeemPct, setRedeemPct] = useState<number | null>(null);
  const [expires, setExpires] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const { mutate } = useMutation(updateGrowthSettings, { success: 'Programme de fidélité enregistré' });
  const { totals, error: totalsError } = useLoyaltyTotals(canSeeCustomers);
  const txQuery = useMemo(() => (canSeeCustomers ? query(collection(db, COLLECTIONS.loyaltyTransactions), orderBy('createdAt', 'desc'), limit(12)) : null), [canSeeCustomers]);
  const transactions = useCollection<LoyaltyTransaction>(txQuery);

  useEffect(() => {
    if (settings.loading) return;
    setDraft(current);
    setRedeemPct(current.maxRedeemBps / 100);
    setExpires(current.pointsValidityDays !== null);
  }, [settings.loading, current]);

  if (settings.error) {
    return (
      <LoyaltyLayout>
        <Card>
          <LoadError error={settings.error} />
        </Card>
      </LoyaltyLayout>
    );
  }
  if (!draft) {
    return (
      <LoyaltyLayout>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[28rem]" />
          <Skeleton className="h-72" />
        </div>
      </LoyaltyLayout>
    );
  }

  const set = <K extends keyof Values>(k: K, v: Values[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const values: Values = {
    ...draft,
    rewards: [...draft.rewards].sort((a, b) => a.points - b.points),
    maxRedeemBps: Math.round((redeemPct ?? 0) * 100),
    pointsValidityDays: expires ? draft.pointsValidityDays : null,
  };
  const rewardErrors = draft.rewards.map((r) => (r.points < 10 ? 'Au moins 10 points.' : r.valueCents < 50 ? 'Au moins 0,50 €.' : null));
  const duplicate = new Set(draft.rewards.map((r) => r.points)).size !== draft.rewards.length;
  const invalid =
    draft.pointsPerEuro < 0.1 ||
    draft.pointsPerEuro > 100 ||
    draft.rewards.length === 0 ||
    rewardErrors.some(Boolean) ||
    duplicate ||
    redeemPct === null ||
    redeemPct < 5 ||
    redeemPct > 100 ||
    draft.maxRestaurantReturnBps < 100 ||
    draft.maxRestaurantReturnBps > 10_000 ||
    (expires && (!draft.pointsValidityDays || draft.pointsValidityDays < 30 || draft.pointsValidityDays > 1825));
  const dirty = JSON.stringify(values) !== JSON.stringify({ ...current, rewards: [...current.rewards].sort((a, b) => a.points - b.points) });

  // Simulation : panier type de 25 € d'articles.
  const basket = 2500;
  const earned = basket >= draft.minOrderCents ? Math.floor((basket / 100) * draft.pointsPerEuro) : 0;
  const first = values.rewards[0];
  const ordersToFirst = first && earned > 0 ? Math.max(1, Math.ceil(Math.max(0, first.points - draft.welcomePoints) / earned)) : null;
  const cashback = first && earned > 0 ? ((first.valueCents / first.points) * earned) / basket : 0;
  const updatedAt = toMillis(settings.data?.updatedAt);

  return (
    <LoyaltyLayout
      actions={
        canEdit ? (
          <Button variant="primary" leftIcon={<Save />} disabled={!dirty || invalid} onClick={() => setConfirm(true)}>
            Enregistrer
          </Button>
        ) : undefined
      }
    >
      {canSeeCustomers && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Comptes fidélité Ciyou Eats" value={totals ? formatNumber(totals.platformAccounts) : '—'} loading={!totals && !totalsError} icon={<Users />} tone="brand" footer={totalsError ? 'Indicateur momentanément indisponible' : undefined} />
          <StatCard label="Comptes des programmes commerces" value={totals ? formatNumber(totals.restaurantAccounts) : '—'} loading={!totals && !totalsError} icon={<Store />} tone="teal" footer={totalsError ? 'Indicateur momentanément indisponible' : undefined} />
          <StatCard label="Points en circulation" value={totals ? formatNumber(totals.points) : '—'} loading={!totals && !totalsError} icon={<Coins />} tone="amber" footer={totalsError ? 'Indicateur momentanément indisponible' : 'Tous programmes confondus'} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <SettingsBlock
            icon={<Sparkles />}
            title="Programme Ciyou Eats"
            description="Points gagnés sur toutes les commandes livrées, échangeables contre des remises."
            aside={
              <div className="flex items-center gap-3">
                <Badge tone={draft.enabled ? 'success' : 'neutral'}>{draft.enabled ? 'Actif' : 'Éteint'}</Badge>
                <Switch checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={!canEdit} aria-label="Activer le programme" />
              </div>
            }
          >
            {!draft.enabled && (
              <p className="tone-info rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2.5 text-sm text-(--tone-fg)">
                Le programme est éteint : aucun point n’est gagné. Préparez les règles puis activez-le au lancement.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Points par euro dépensé" hint="Sur les articles, hors livraison." error={draft.pointsPerEuro < 0.1 || draft.pointsPerEuro > 100 ? 'Entre 0,1 et 100.' : undefined}>
                <NumberInput value={draft.pointsPerEuro} onChange={(v) => set('pointsPerEuro', v ?? 0)} decimals={2} unit="pts/€" disabled={!canEdit} />
              </FormField>
              <FormField label="Points de bienvenue" hint="Offerts à l’inscription.">
                <NumberInput value={draft.welcomePoints} onChange={(v) => set('welcomePoints', v ?? 0)} unit="pts" disabled={!canEdit} />
              </FormField>
              <FormField label="Panier minimum pour gagner" hint="0 = dès le premier euro.">
                <MoneyInput value={draft.minOrderCents} onChange={(v) => set('minOrderCents', v ?? 0)} disabled={!canEdit} />
              </FormField>
            </div>
          </SettingsBlock>

          <SettingsBlock icon={<Gift />} title="Utilisation des points" description="Paliers d’échange proposés au client au moment de payer.">
            <div className="space-y-2">
              {draft.rewards.map((r, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-start gap-2">
                  <FormField label={i === 0 ? 'Points' : undefined} error={rewardErrors[i] && r.points < 10 ? rewardErrors[i] : undefined}>
                    <NumberInput
                      value={r.points}
                      onChange={(v) => set('rewards', draft.rewards.map((x, j) => (j === i ? { ...x, points: v ?? 0 } : x)))}
                      unit="pts"
                      disabled={!canEdit}
                      aria-label={`Points du palier ${i + 1}`}
                    />
                  </FormField>
                  <span className={i === 0 ? 'mt-8 text-fg-subtle' : 'mt-2 text-fg-subtle'}>=</span>
                  <FormField label={i === 0 ? 'Remise' : undefined} error={rewardErrors[i] && r.points >= 10 ? rewardErrors[i] : undefined}>
                    <MoneyInput
                      value={r.valueCents}
                      onChange={(v) => set('rewards', draft.rewards.map((x, j) => (j === i ? { ...x, valueCents: v ?? 0 } : x)))}
                      disabled={!canEdit}
                      aria-label={`Remise du palier ${i + 1}`}
                    />
                  </FormField>
                  <IconButton
                    label="Retirer ce palier"
                    variant="ghost"
                    className={i === 0 ? 'mt-6' : ''}
                    disabled={!canEdit || draft.rewards.length <= 1}
                    onClick={() => set('rewards', draft.rewards.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
              {duplicate && <p className="text-sm text-danger">Deux paliers ne peuvent pas demander le même nombre de points.</p>}
              {canEdit && draft.rewards.length < 8 && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Plus />}
                  onClick={() => {
                    const last = draft.rewards[draft.rewards.length - 1];
                    set('rewards', [...draft.rewards, { points: (last?.points ?? 100) * 2, valueCents: (last?.valueCents ?? 300) * 2 }]);
                  }}
                >
                  Ajouter un palier
                </Button>
              )}
            </div>
            <FormField label="Part maximale d’une commande payable en points" className="sm:max-w-xs" error={redeemPct !== null && (redeemPct < 5 || redeemPct > 100) ? 'Entre 5 et 100 %.' : undefined}>
              <NumberInput value={redeemPct} onChange={setRedeemPct} unit="%" disabled={!canEdit} />
            </FormField>
          </SettingsBlock>

          <SettingsBlock
            icon={<CalendarClock />}
            title="Expiration"
            description="Les points non utilisés expirent après une période sans commande."
            aside={<Switch checked={expires} onCheckedChange={setExpires} disabled={!canEdit} aria-label="Les points expirent" />}
          >
            {expires ? (
              <FormField
                label="Durée de validité"
                className="sm:max-w-xs"
                hint="Comptée depuis le gain des points."
                error={!draft.pointsValidityDays || draft.pointsValidityDays < 30 || draft.pointsValidityDays > 1825 ? 'Entre 30 et 1 825 jours.' : undefined}
              >
                <NumberInput value={draft.pointsValidityDays} onChange={(v) => set('pointsValidityDays', v)} unit="jours" disabled={!canEdit} />
              </FormField>
            ) : (
              <p className="text-sm text-fg-muted">Les points n’expirent jamais.</p>
            )}
          </SettingsBlock>

          <SettingsBlock
            icon={<Store />}
            title="Programmes des commerces"
            description="Chaque commerce peut proposer sa propre carte de fidélité, en plus du programme Ciyou Eats."
            aside={<Switch checked={draft.allowRestaurantPrograms} onCheckedChange={(v) => set('allowRestaurantPrograms', v)} disabled={!canEdit} aria-label="Autoriser les programmes des commerces" />}
          >
            <p className="text-sm text-fg-muted">
              {draft.allowRestaurantPrograms ? 'Autorisés : les commerces configurent leur programme depuis leur back-office.' : 'Désactivés : seuls les points Ciyou Eats sont proposés.'}
            </p>
            {draft.allowRestaurantPrograms && (
              <FormField
                label="Plafond du taux de retour"
                className="mt-4 sm:max-w-xs"
                hint="Un palier d’un commerce ne peut pas rendre plus de ce pourcentage des dépenses."
                error={draft.maxRestaurantReturnBps < 100 || draft.maxRestaurantReturnBps > 10_000 ? 'Entre 1 et 100 %.' : undefined}
              >
                <NumberInput
                  value={Math.round(draft.maxRestaurantReturnBps / 100)}
                  onChange={(v) => set('maxRestaurantReturnBps', Math.round((v ?? 0) * 100))}
                  unit="%"
                  disabled={!canEdit}
                />
              </FormField>
            )}
          </SettingsBlock>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <div className="tone-brand border-b border-border bg-(--tone-bg) px-5 py-4">
              <p className="eyebrow text-(--tone-fg)">Simulation</p>
              <p className="mt-1 font-display text-md font-semibold text-fg">Commande de {formatPrice(basket)}</p>
            </div>
            <dl className="divide-y divide-border px-5 py-1 text-sm">
              <div className="flex justify-between py-2.5">
                <dt className="text-fg-muted">Points gagnés</dt>
                <dd className="num font-medium text-fg">{formatNumber(earned)} pts</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-fg-muted">Premier palier</dt>
                <dd className="font-medium text-fg">{first ? `${formatNumber(first.points)} pts = ${formatPrice(first.valueCents)}` : '—'}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-fg-muted">Commandes pour l’atteindre</dt>
                <dd className="num font-medium text-fg">{ordersToFirst ?? '—'}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-fg-muted">Retour client</dt>
                <dd className="num font-medium text-fg">{(cashback * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</dd>
              </div>
            </dl>
            <p className="border-t border-border px-5 py-3 text-xs text-fg-subtle">Le coût des points échangés est supporté par Ciyou Eats.</p>
          </Card>

          {canSeeCustomers && (
            <Card>
              <CardHeader title="Derniers mouvements de points" divided />
              {transactions.error ? (
                <LoadError error={transactions.error} compact />
              ) : transactions.loading ? (
                <div className="space-y-2 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : transactions.data.length === 0 ? (
                <EmptyState compact icon={<Coins />} title="Aucun mouvement" description="Les gains et échanges de points apparaîtront ici." />
              ) : (
                <ul className="divide-y divide-border">
                  {transactions.data.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="text-fg">{TX_LABELS[t.type]}{t.restaurantId ? ' · commerce' : ''}</p>
                        <p className="text-xs text-fg-muted">{formatDateTime(toMillis(t.createdAt) ?? 0)}</p>
                      </div>
                      <span className={`num font-mono ${t.points >= 0 ? 'text-fg' : 'text-fg-muted'}`}>
                        {t.points > 0 ? '+' : ''}
                        {formatNumber(t.points)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {updatedAt && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-fg-subtle">
              <History className="size-3.5" />
              Règles modifiées le {formatDateTime(updatedAt)}
            </p>
          )}
          {!canEdit && <p className="px-1 text-xs text-fg-subtle">Lecture seule : règles communes à toute la plateforme, modifiées par l’équipe centrale.</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer le programme de fidélité ?"
        description={values.enabled ? 'Les nouvelles règles s’appliquent aux prochaines commandes livrées.' : 'Le programme reste éteint : aucune règle n’est appliquée tant qu’il n’est pas activé.'}
        confirmLabel="Enregistrer"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ section: 'loyalty', values, reason: reason ?? '' });
        }}
      />
    </LoyaltyLayout>
  );
}
