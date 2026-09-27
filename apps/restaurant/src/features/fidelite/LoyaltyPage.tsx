import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { Award, Coins, Gift, Heart, Lock, Plus, Sparkles, Trash2, TrendingUp, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  Switch,
  cn,
  formatEUR,
  formatNumber,
  formatPercent,
} from '@golink/ui';
import {
  COLLECTIONS,
  RESTAURANT_LOYALTY_RULES,
  RESTAURANT_SETTINGS_DOCS,
  SETTINGS_DOCS,
  parsePriceInput,
  paths,
  type LoyaltyAccount,
  type LoyaltySettings,
  type RestaurantCustomer,
  type RestaurantLoyaltySettings,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, docAt, errorMessage, useCollection, useDoc, useDocs, useMutation } from '@/lib/firestore';

const RULES = RESTAURANT_LOYALTY_RULES;

interface RewardForm {
  points: string;
  reward: string;
  label: string;
}

interface FormState {
  enabled: boolean;
  earnPoints: string;
  every: string;
  welcome: string;
  validity: string;
  rewards: RewardForm[];
}

interface SaveInput {
  restaurantId: string;
  enabled: boolean;
  earnPoints: number;
  everyCents: number;
  welcomePoints: number;
  rewards: Array<{ points: number; rewardCents: number; label: string | null }>;
  pointsValidityDays: number | null;
}

const saveLoyaltyProgram = callFunction<SaveInput, { enabled: boolean }>('saveLoyaltyProgram');
const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

function toForm(settings: RestaurantLoyaltySettings | null): FormState {
  if (!settings) {
    return {
      enabled: false,
      earnPoints: '1',
      every: '1,00',
      welcome: '20',
      validity: '365',
      rewards: [
        { points: '100', reward: '5,00', label: '' },
        { points: '250', reward: '15,00', label: '' },
      ],
    };
  }
  const rewards = settings.rewards?.length ? settings.rewards : [{ points: settings.thresholdPoints, rewardCents: settings.rewardCents, label: null }];
  return {
    enabled: settings.enabled,
    earnPoints: String(settings.earnPoints),
    every: euros(settings.everyCents),
    welcome: String(settings.welcomePoints),
    validity: settings.pointsValidityDays ? String(settings.pointsValidityDays) : 'none',
    rewards: rewards.map((r) => ({ points: String(r.points), reward: euros(r.rewardCents), label: r.label ?? '' })),
  };
}

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

function parse(form: FormState) {
  const errors: Record<string, string> = {};
  const earnPoints = int(form.earnPoints);
  const everyCents = parsePriceInput(form.every) ?? NaN;
  const welcomePoints = int(form.welcome || '0');
  if (!(earnPoints >= 1 && earnPoints <= 100)) errors.earnPoints = 'Entre 1 et 100 points.';
  if (!(everyCents >= RULES.minEveryCents && everyCents <= 10_000)) errors.every = 'Entre 0,50 € et 100 €.';
  if (!(welcomePoints >= 0 && welcomePoints <= RULES.maxWelcomePoints)) errors.welcome = `Entre 0 et ${RULES.maxWelcomePoints} points.`;
  const rewards = form.rewards.map((r, i) => {
    const points = int(r.points);
    const rewardCents = parsePriceInput(r.reward) ?? NaN;
    if (!(points >= 10 && points <= RULES.maxThresholdPoints)) errors[`points${i}`] = 'Entre 10 et 10 000.';
    if (!(rewardCents >= 50 && rewardCents <= 10_000)) errors[`reward${i}`] = 'Entre 0,50 € et 100 €.';
    const spend = earnPoints > 0 && everyCents > 0 ? (points / earnPoints) * everyCents : NaN;
    const returnRate = spend > 0 ? rewardCents / spend : NaN;
    if (returnRate * 10_000 > RULES.maxReturnBps) errors[`reward${i}`] = `Rend ${formatPercent(returnRate)} des dépenses (max ${RULES.maxReturnBps / 100} %).`;
    return { points, rewardCents, label: r.label.trim() || null, spend, returnRate };
  });
  const sorted = [...rewards].sort((a, b) => a.points - b.points);
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    if (prev && (r.points === prev.points || r.rewardCents <= prev.rewardCents)) errors.rewards = 'Chaque palier doit demander plus de points et offrir davantage que le précédent.';
  });
  return { errors, earnPoints, everyCents, welcomePoints, rewards: sorted, validity: form.validity === 'none' ? null : Number(form.validity) };
}

export function LoyaltyPage() {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const state = useDoc<RestaurantLoyaltySettings>(docAt(paths.restaurantSettings(restaurantId, RESTAURANT_SETTINGS_DOCS.loyalty)));
  const platform = useDoc<LoyaltySettings>(docAt(paths.settings(SETTINGS_DOCS.loyalty)));

  if (state.loading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[520px] rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </PageContainer>
    );
  }
  return (
    <LoyaltyEditor
      key={`${restaurantId}-${state.data?.updatedAt?.toMillis?.() ?? 0}`}
      restaurantId={restaurantId}
      restaurantName={restaurant.name}
      saved={state.data}
      platformAllowed={platform.data?.allowRestaurantPrograms ?? true}
      loadError={state.error ? errorMessage(state.error) : null}
    />
  );
}

function LoyaltyEditor({
  restaurantId,
  restaurantName,
  saved,
  platformAllowed,
  loadError,
}: {
  restaurantId: string;
  restaurantName: string;
  saved: RestaurantLoyaltySettings | null;
  platformAllowed: boolean;
  loadError: string | null;
}) {
  const can = useCan();
  const initial = useMemo(() => toForm(saved), [saved]);
  const [form, setForm] = useState<FormState>(initial);
  const [touched, setTouched] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const parsed = useMemo(() => parse(form), [form]);
  const errors = touched ? parsed.errors : {};
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setReward = (index: number, patch: Partial<RewardForm>) =>
    setForm((f) => ({ ...f, rewards: f.rewards.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));

  // Membres du programme (comptes de fidélité de l'établissement) et panier moyen des clients.
  const canSeeCustomers = can('customers.view');
  const members = useCollection<LoyaltyAccount>(
    canSeeCustomers
      ? query(
          collectionAt(COLLECTIONS.loyaltyAccounts),
          where('scope', '==', 'restaurant'),
          where('restaurantId', '==', restaurantId),
          orderBy('lifetimePoints', 'desc'),
          limit(200),
        )
      : null,
  );
  const customers = useCollection<RestaurantCustomer>(
    canSeeCustomers ? query(collectionAt(paths.restaurantSub(restaurantId, 'customers')), orderBy('ordersCount', 'desc'), limit(300)) : null,
  );
  const topRefs = useMemo(() => members.data.slice(0, 6).map((m) => docAt(`${paths.restaurantSub(restaurantId, 'customers')}/${m.userId}`)), [members.data, restaurantId]);
  const topCustomers = useDocs<RestaurantCustomer>(topRefs);
  const averageBasket = useMemo(() => {
    const orders = customers.data.reduce((s, c) => s + c.ordersCount, 0);
    const spent = customers.data.reduce((s, c) => s + c.totalSpentCents, 0);
    return orders > 0 ? Math.round(spent / orders) : 2500;
  }, [customers.data]);

  const firstTier = parsed.rewards[0];
  const memberStats = useMemo(() => {
    const outstanding = members.data.reduce((s, m) => s + m.points, 0);
    const lifetime = members.data.reduce((s, m) => s + m.lifetimePoints, 0);
    const reachable = firstTier && firstTier.points > 0 ? members.data.filter((m) => m.points >= firstTier.points).length : 0;
    return { count: members.data.length, outstanding, lifetime, reachable };
  }, [members.data, firstTier]);

  const save = useMutation(saveLoyaltyProgram, { success: (r) => (r.enabled ? 'Programme de fidélité enregistré.' : 'Programme de fidélité mis en pause.') });

  async function submit() {
    setTouched(true);
    if (Object.keys(parsed.errors).length > 0) return;
    await save.mutate({
      restaurantId,
      enabled: form.enabled,
      earnPoints: parsed.earnPoints,
      everyCents: parsed.everyCents,
      welcomePoints: parsed.welcomePoints,
      rewards: parsed.rewards.map((r) => ({ points: r.points, rewardCents: r.rewardCents, label: r.label })),
      pointsValidityDays: parsed.validity,
    });
  }

  const pointsPerOrder = parsed.everyCents > 0 ? (averageBasket / parsed.everyCents) * parsed.earnPoints : 0;
  const statusBadge = saved?.enabled ? (
    <Badge tone="success" icon={<Heart />}>
      Programme actif
    </Badge>
  ) : (
    <Badge tone="neutral">Programme en pause</Badge>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Programme de fidélité"
        description={`Une raison de revenir chez ${restaurantName} : vos clients cumulent des points à chaque commande et débloquent vos récompenses.`}
        actions={statusBadge}
      />

      {loadError && <p className="mb-4 text-sm text-danger-soft-fg">{loadError}</p>}
      {!platformAllowed && (
        <div className="tone-amber mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 text-sm text-(--tone-fg)">
          Les programmes de fidélité des établissements sont momentanément suspendus par GoLink. Vos réglages sont conservés.
        </div>
      )}

      {canSeeCustomers && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Membres" value={formatNumber(memberStats.count)} icon={<Users />} loading={members.loading} footer="Clients ayant cumulé des points." />
          <StatCard label="Points en circulation" value={formatNumber(memberStats.outstanding)} icon={<Coins />} tone="amber" loading={members.loading} footer="Points non encore utilisés." />
          <StatCard label="Points distribués" value={formatNumber(memberStats.lifetime)} icon={<Sparkles />} tone="teal" loading={members.loading} footer="Depuis le lancement du programme." />
          <StatCard
            label="Récompense à portée"
            value={formatNumber(memberStats.reachable)}
            icon={<Gift />}
            tone="success"
            loading={members.loading}
            footer={firstTier ? `Clients ayant ${formatNumber(firstTier.points || 0)} points ou plus.` : 'Ajoutez un palier.'}
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card padding="md">
            <Switch
              label="Activer la fidélité"
              description="Les clients accumulent des points sur chaque commande livrée ou retirée chez vous."
              checked={form.enabled}
              onCheckedChange={(v) => set('enabled', v)}
              disabled={!platformAllowed && !form.enabled}
            />
          </Card>

          <Card>
            <CardHeader eyebrow="01 · Gagner" title="Accumulation des points" description="Choisissez le rythme qui correspond à votre activité." />
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Points gagnés" required error={errors.earnPoints}>
                <Input inputMode="numeric" value={form.earnPoints} onChange={(e) => set('earnPoints', e.target.value)} trailing="pts" />
              </FormField>
              <FormField label="Pour chaque tranche de" required error={errors.every} hint="Montant des articles, hors frais.">
                <Input inputMode="decimal" value={form.every} onChange={(e) => set('every', e.target.value)} trailing="€" />
              </FormField>
              <FormField label="Bonus de bienvenue" error={errors.welcome} hint="Offert à la première commande.">
                <Input inputMode="numeric" value={form.welcome} onChange={(e) => set('welcome', e.target.value)} trailing="pts" />
              </FormField>
              <FormField label="Validité des points">
                <Select
                  value={form.validity}
                  onValueChange={(v) => set('validity', v)}
                  options={[
                    { value: '90', label: '3 mois' },
                    { value: '180', label: '6 mois' },
                    { value: '365', label: '12 mois' },
                    { value: '730', label: '24 mois' },
                    { value: 'none', label: 'Sans expiration' },
                  ]}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              eyebrow="02 · Utiliser"
              title="Paliers de récompense"
              description={`Jusqu’à ${RULES.maxRewards} paliers : une remise débloquée à chaque seuil atteint.`}
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Plus />}
                  disabled={form.rewards.length >= RULES.maxRewards}
                  onClick={() => {
                    const last = parsed.rewards[parsed.rewards.length - 1];
                    const points = last && Number.isFinite(last.points) ? last.points * 2 : 100;
                    const reward = last && Number.isFinite(last.rewardCents) ? last.rewardCents * 2 : 500;
                    set('rewards', [...form.rewards, { points: String(points), reward: euros(reward), label: '' }]);
                  }}
                >
                  Ajouter un palier
                </Button>
              }
            />
            <CardContent className="space-y-3">
              {form.rewards.map((reward, i) => {
                const info = parse({ ...form, rewards: [reward] }).rewards[0];
                return (
                  <div key={i} className="relative rounded-xl border border-border bg-surface-2 p-3.5">
                    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-[1fr_1fr_1.3fr_auto]">
                      <FormField label={`Palier ${i + 1}`} error={errors[`points${i}`]}>
                        <Input inputMode="numeric" value={reward.points} onChange={(e) => setReward(i, { points: e.target.value })} trailing="pts" />
                      </FormField>
                      <FormField label="Remise offerte" error={errors[`reward${i}`]}>
                        <Input inputMode="decimal" value={reward.reward} onChange={(e) => setReward(i, { reward: e.target.value })} trailing="€" />
                      </FormField>
                      <FormField label="Nom (facultatif)" className="col-span-2 sm:col-span-1">
                        <Input maxLength={40} placeholder="Ex. Le dessert offert" value={reward.label} onChange={(e) => setReward(i, { label: e.target.value })} />
                      </FormField>
                      <IconButton
                        label={`Supprimer le palier ${i + 1}`}
                        variant="danger"
                        className="max-sm:absolute max-sm:right-2 max-sm:top-2 sm:mt-6"
                        disabled={form.rewards.length === 1}
                        onClick={() => set('rewards', form.rewards.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                    {info && Number.isFinite(info.returnRate) && Number.isFinite(info.spend) && (
                      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                        <span>
                          Atteint après <span className="font-medium text-fg">{formatEUR(info.spend, { cents: true })}</span> d’achats
                          {pointsPerOrder > 0 && ` (≈ ${formatNumber(Math.max(1, Math.ceil(info.points / pointsPerOrder)))} commandes)`}
                        </span>
                        <span>
                          Retour client <span className="font-medium text-fg">{formatPercent(info.returnRate)}</span>
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
              {errors.rewards && <p className="text-xs text-danger-soft-fg">{errors.rewards}</p>}
              <p className="text-xs text-fg-subtle">
                Estimation basée sur votre panier moyen de {formatEUR(averageBasket, { cents: true })}. GoLink plafonne le retour client à {RULES.maxReturnBps / 100} % des dépenses.
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
          <LoyaltyPreview restaurantName={restaurantName} form={form} parsed={parsed} />
          {canSeeCustomers && (
            <Card>
              <CardHeader title="Meilleurs membres" icon={<Award />} description="Clients ayant cumulé le plus de points." />
              <CardContent className="space-y-3">
                {members.loading ? (
                  [0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)
                ) : members.data.length === 0 ? (
                  <EmptyState compact icon={<Heart />} title="Aucun membre pour l’instant" description="Les points s’accumulent dès la prochaine commande livrée." />
                ) : (
                  members.data.slice(0, 6).map((m) => {
                    const name = topCustomers.data.find((c) => c.id === m.userId)?.displayName ?? 'Client GoLink';
                    return (
                      <div key={m.userId} className="flex items-center gap-3">
                        <Avatar name={name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{name}</p>
                          <p className="text-xs text-fg-subtle">{formatNumber(m.lifetimePoints)} points cumulés</p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block font-mono text-sm text-fg num">{formatNumber(m.points)} pts</span>
                          <span className="block text-2xs text-fg-subtle">à utiliser</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      {(dirty || save.loading) && (
        <div className="sticky bottom-4 z-10 mt-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-elevated p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:pl-5">
            <p className="text-sm text-fg-muted">Modifications non enregistrées.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => (setForm(initial), setTouched(false))} disabled={save.loading}>
                Annuler
              </Button>
              <Button variant="primary" loading={save.loading} onClick={() => void submit()}>
                Enregistrer
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function LoyaltyPreview({ restaurantName, form, parsed }: { restaurantName: string; form: FormState; parsed: ReturnType<typeof parse> }) {
  const first = parsed.rewards[0];
  const demoPoints = first && Number.isFinite(first.points) ? Math.round(first.points * 0.64) : 0;
  const everyLabel = Number.isFinite(parsed.everyCents) ? formatEUR(parsed.everyCents, { cents: true }) : '—';
  return (
    <div className="overflow-hidden rounded-2xl border border-border shadow-card">
      <div className="relative bg-sidebar p-6 text-sidebar-fg">
        <div className="absolute -right-10 -top-12 size-40 rounded-full border-[26px] border-white/5" aria-hidden="true" />
        <Heart className="size-5 text-primary" />
        <p className="mt-6 text-2xs font-medium uppercase tracking-eyebrow text-sidebar-muted">Aperçu client · {restaurantName}</p>
        <p className="mt-2 font-display text-2xl font-semibold tracking-display">Vos visites comptent.</p>
        <p className="mt-1 text-sm text-sidebar-muted">Chaque commande vous rapproche d’une récompense.</p>
        {first && Number.isFinite(first.points) && (
          <div className="mt-6">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary" style={{ width: '64%' }} />
            </div>
            <p className="mt-2 font-mono text-xs text-sidebar-muted num">
              {formatNumber(demoPoints)} / {formatNumber(first.points)} points
            </p>
          </div>
        )}
      </div>
      <div className="space-y-3 bg-surface p-5 text-sm">
        <p className="text-fg-muted">
          <span className="font-semibold text-fg">
            {Number.isFinite(parsed.earnPoints) ? parsed.earnPoints : '—'} point{parsed.earnPoints > 1 ? 's' : ''}
          </span>{' '}
          tous les {everyLabel} dépensés
          {parsed.welcomePoints > 0 && `, et ${parsed.welcomePoints} points offerts à la première commande`}.
        </p>
        <ul className="space-y-2">
          {parsed.rewards.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className={cn('grid size-7 place-items-center rounded-full', i === 0 ? 'tone-brand bg-(--tone-bg) text-(--tone-fg)' : 'bg-surface-3 text-fg-subtle')}>
                {i === 0 ? <TrendingUp className="size-3.5" /> : <Lock className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{r.label || `${Number.isFinite(r.rewardCents) ? formatEUR(r.rewardCents, { cents: true }) : '—'} offerts`}</span>
                <span className="text-xs text-fg-subtle">dès {Number.isFinite(r.points) ? formatNumber(r.points) : '—'} points</span>
              </span>
            </li>
          ))}
        </ul>
        {!form.enabled && <ProgressBar value={0} label="Programme en pause" tone="neutral" size="sm" />}
      </div>
    </div>
  );
}
