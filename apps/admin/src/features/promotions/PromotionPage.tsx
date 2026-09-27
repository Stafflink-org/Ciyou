import { useMemo, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, BadgeEuro, Ban, CheckCircle2, Pause, Pencil, Play, ShoppingBag, Store, TicketPercent, UserPlus, XCircle } from 'lucide-react';
import {
  AreaChart,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageContainer,
  PageHeader,
  ProgressBar,
  Sheet,
  Skeleton,
  StatCard,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatDateTime,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import {
  COLLECTIONS,
  FULFILLMENT_LABELS,
  PROMOTION_FUNDING_LABELS,
  PROMOTION_KIND_LABELS,
  PROMOTION_STATUS_LABELS,
  formatPrice,
  type Promotion,
  type PromotionRedemption,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { setPromotionStatus, type PromotionAction } from '../_croissance/api';
import { useGeoNames, useNow, useRestaurantOptions } from '../_croissance/hooks';
import { PROMOTION_STATUS_TONES, SCOPE_LABELS, TARGET_LABELS, bpsLabel, platformShare, promotionValueLabel } from '../_croissance/labels';
import { InfoRow, LoadError } from '../_croissance/ui';
import { PromotionFormSheet } from './PromotionForm';
import { periodLabel, promotionCost, timingHint } from './lib';

const ACTIONS: Record<PromotionAction, { label: string; title: string; description: string; confirm: string; destructive?: boolean; reason: boolean }> = {
  approve: { label: 'Valider', title: 'Valider l’offre ?', description: 'Elle devient visible des clients selon ses dates. Le restaurant est prévenu.', confirm: 'Valider et publier', reason: false },
  reject: { label: 'Refuser', title: 'Refuser l’offre ?', description: 'Le restaurant reçoit votre motif et peut soumettre une nouvelle offre.', confirm: 'Refuser', destructive: true, reason: true },
  pause: { label: 'Mettre en pause', title: 'Mettre l’offre en pause ?', description: 'Elle n’est plus proposée aux clients jusqu’à sa reprise.', confirm: 'Mettre en pause', reason: true },
  resume: { label: 'Mettre en ligne', title: 'Mettre l’offre en ligne ?', description: 'Elle sera proposée aux clients selon ses dates et conditions.', confirm: 'Mettre en ligne', reason: false },
  end: { label: 'Arrêter', title: 'Arrêter définitivement l’offre ?', description: 'L’offre est close et ne pourra plus être relancée (dupliquez-la si besoin).', confirm: 'Arrêter l’offre', destructive: true, reason: true },
};

export function PromotionPage() {
  const { promotionId = '' } = useParams();
  const { can } = useAdminAccess();
  const canEdit = can('promotions.edit');
  const now = useNow();
  const names = useGeoNames();
  const restaurants = useRestaurantOptions();
  const promo = useDoc<Promotion>(docAt(`${COLLECTIONS.promotions}/${promotionId}`));
  const redemptionsQuery = useMemo(
    () => query(collection(db, COLLECTIONS.promotionRedemptions), where('promotionId', '==', promotionId), orderBy('createdAt', 'desc'), limit(500)),
    [promotionId],
  );
  const redemptions = useCollection<PromotionRedemption>(redemptionsQuery);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<PromotionAction | null>(null);
  const { mutate } = useMutation(setPromotionStatus, {
    success: (out) => ({ active: 'Offre en ligne', rejected: 'Offre refusée', paused: 'Offre mise en pause', ended: 'Offre arrêtée' })[out.status as 'active'] ?? 'Offre mise à jour',
  });
  const p = promo.data;
  useDocumentTitle(`${p?.title.fr ?? 'Offre'} · Promotions · Ciyou Eats Admin`);

  const chart = useMemo(() => {
    // Période affichée : depuis le début de l'offre (au plus 26 semaines), par jour ou par semaine.
    const startMs = Math.max(toMillis(p?.startsAt) ?? now - 30 * 86_400_000, now - 182 * 86_400_000);
    const weekly = now - startMs > 45 * 86_400_000;
    const step = (weekly ? 7 : 1) * 86_400_000;
    const buckets: Array<{ from: number; label: string; utilisations: number }> = [];
    for (let t = now - Math.ceil((now - startMs) / step) * step; t <= now; t += step) {
      buckets.push({ from: t, label: new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), utilisations: 0 });
    }
    for (const r of redemptions.data) {
      const ms = toMillis(r.createdAt);
      if (!ms || r.status !== 'applied' || ms < (buckets[0]?.from ?? 0)) continue;
      const i = Math.min(buckets.length - 1, Math.floor((ms - (buckets[0]?.from ?? 0)) / step));
      const b = buckets[i];
      if (b) b.utilisations += 1;
    }
    return { weekly, data: buckets.map((b) => ({ jour: b.label, utilisations: b.utilisations })) };
  }, [redemptions.data, now, p?.startsAt]);

  if (promo.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="mt-6 h-72" />
      </PageContainer>
    );
  }
  if (promo.error || promo.missing || !p) {
    return (
      <PageContainer>
        <Card>
          {promo.error ? (
            <LoadError error={promo.error} />
          ) : (
            <EmptyState
              icon={<TicketPercent />}
              title="Offre introuvable"
              description="Elle a peut-être été supprimée, ou le lien est incorrect."
              action={
                <Button asChild size="sm">
                  <Link to="/promotions">Retour aux promotions</Link>
                </Button>
              }
            />
          )}
        </Card>
      </PageContainer>
    );
  }

  const row = { ...p, id: promotionId };
  const cost = promotionCost(p);
  const share = platformShare(p);
  const hint = timingHint(p, now);
  const restaurant = p.restaurantId ? restaurants.byId.get(p.restaurantId) : null;
  const participants = (p.restaurantIds ?? []).map((id) => restaurants.byId.get(id)?.name ?? id);
  const usage = p.totalUsageLimit ? Math.min(100, ((p.stats?.redemptions ?? 0) / p.totalUsageLimit) * 100) : null;
  const available: PromotionAction[] = !canEdit
    ? []
    : p.status === 'pending_review'
      ? ['approve', 'reject']
      : p.status === 'active'
        ? ['pause', 'end']
        : p.status === 'paused'
          ? ['resume', 'end']
          : p.status === 'draft'
            ? ['resume', 'end']
            : [];
  const icons: Record<PromotionAction, ReactElement> = { approve: <CheckCircle2 />, reject: <XCircle />, pause: <Pause />, resume: <Play />, end: <Ban /> };

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: 'Promotions', href: '/promotions' }, { label: p.title.fr }]}
        eyebrow={p.scope === 'restaurant' ? `Offre du restaurant · ${restaurant?.name ?? ''}` : `Offre Ciyou Eats · ${SCOPE_LABELS[p.scope]}`}
        title={p.title.fr}
        description={p.description?.fr ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />}>
              <Link to="/promotions">Toutes les offres</Link>
            </Button>
            {canEdit && p.status !== 'ended' && p.status !== 'rejected' && (
              <Button size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                Modifier
              </Button>
            )}
            {available.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'approve' || a === 'resume' ? 'primary' : ACTIONS[a].destructive ? 'danger-soft' : 'secondary'}
                leftIcon={icons[a]}
                onClick={() => setAction(a)}
              >
                {a === 'resume' && p.status === 'paused' ? 'Reprendre' : ACTIONS[a].label}
              </Button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={PROMOTION_STATUS_TONES[p.status]}>{PROMOTION_STATUS_LABELS[p.status]}</StatusPill>
          {hint && <Badge tone="amber">{hint}</Badge>}
          {p.code ? <Badge tone="neutral" className="font-mono">{p.code}</Badge> : <Badge tone="neutral">Appliquée automatiquement</Badge>}
          {p.showcase && <Badge tone="brand">Vitrine de l’app</Badge>}
        </div>
      </PageHeader>

      {p.status === 'pending_review' && (
        <Card className="tone-amber mb-6 border-(--tone-border) bg-(--tone-bg) p-4 text-sm text-fg">
          Offre soumise par le restaurant {p.submittedAt ? `le ${formatDateTime(toMillis(p.submittedAt) ?? 0)}` : ''} : vérifiez la remise, le financement et les dates avant de la valider.
        </Card>
      )}
      {p.reviewNote && p.status !== 'pending_review' && (
        <Card className="mb-6 p-4 text-sm">
          <span className="text-fg-muted">Note de validation : </span>
          <span className="text-fg">{p.reviewNote}</span>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Utilisations" value={formatNumber(p.stats?.redemptions ?? 0)} icon={<ShoppingBag />} tone="info" footer={p.totalUsageLimit ? `sur ${formatNumber(p.totalUsageLimit)} autorisées` : 'Sans limite totale'} />
        <StatCard label="Coût total des remises" value={formatEUR(cost.total, { cents: true })} icon={<BadgeEuro />} tone="amber" footer={`Ciyou Eats ${formatEUR(cost.platform, { cents: true })} · restaurants ${formatEUR(cost.restaurant, { cents: true })}`} />
        <StatCard label="Ventes générées" value={formatEUR(p.stats?.ordersSubtotalCents ?? 0, { cents: true })} icon={<Store />} tone="success" footer={p.stats?.redemptions ? `Panier moyen ${formatPrice(Math.round((p.stats.ordersSubtotalCents ?? 0) / p.stats.redemptions))}` : 'Aucune commande'} />
        <StatCard label="Nouveaux clients" value={formatNumber(p.stats?.newCustomers ?? 0)} icon={<UserPlus />} tone="plum" footer={p.stats?.redemptions ? `${Math.round(((p.stats.newCustomers ?? 0) / p.stats.redemptions) * 100)} % des utilisations` : '—'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Utilisations" description={chart.weekly ? "Commandes ayant bénéficié de l’offre, par semaine." : "Commandes ayant bénéficié de l’offre, par jour."} divided />
            <div className="px-3 pb-4 pt-4 sm:px-5">
              {redemptions.loading ? (
                <Skeleton className="h-60" />
              ) : redemptions.error ? (
                <LoadError error={redemptions.error} compact />
              ) : (
                <AreaChart data={chart.data} xKey="jour" series={[{ key: 'utilisations', label: 'Utilisations' }]} height={240} valueFormatter={(v) => formatNumber(v)} />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Dernières utilisations" description="Répartition du coût de chaque remise." divided />
            {redemptions.data.length === 0 && !redemptions.loading ? (
              <EmptyState compact icon={<ShoppingBag />} title="Aucune utilisation pour l’instant" description="Les commandes utilisant l’offre apparaîtront ici en temps réel." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Commande</TableHead>
                      <TableHead>Restaurant</TableHead>
                      <TableHead className="text-right">Remise</TableHead>
                      <TableHead className="text-right">Part Ciyou Eats</TableHead>
                      <TableHead className="text-right">Part restaurant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {redemptions.data.slice(0, 12).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-fg-muted">{formatDateTime(toMillis(r.createdAt) ?? 0)}</TableCell>
                        <TableCell>
                          <Link className="font-mono text-xs text-primary-soft-fg hover:underline" to={`/commandes/${r.orderId}`}>
                            {r.orderId.slice(0, 10)}
                          </Link>
                          {r.status === 'reversed' && <Badge tone="neutral" size="sm" className="ml-2">Annulée</Badge>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{restaurants.byId.get(r.restaurantId)?.name ?? r.restaurantId}</TableCell>
                        <TableCell className="num text-right font-mono">{formatPrice(r.discountCents)}</TableCell>
                        <TableCell className="num text-right font-mono text-fg-muted">{formatPrice(r.platformFundedCents)}</TableCell>
                        <TableCell className="num text-right font-mono text-fg-muted">{formatPrice(r.restaurantFundedCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Remise et conditions" divided />
            <dl className="divide-y divide-border px-5 py-1">
              <InfoRow label="Type">{PROMOTION_KIND_LABELS[p.kind]}</InfoRow>
              <InfoRow label="Remise">{promotionValueLabel(p)}</InfoRow>
              <InfoRow label="Panier minimum">{p.minSubtotalCents ? formatPrice(p.minSubtotalCents) : 'Aucun'}</InfoRow>
              <InfoRow label="Par client">{p.perCustomerLimit} fois</InfoRow>
              <InfoRow label="Au total">{p.totalUsageLimit ? formatNumber(p.totalUsageLimit) : 'Illimité'}</InfoRow>
              <InfoRow label="Modes">{p.modes.map((m) => FULFILLMENT_LABELS[m]).join(', ')}</InfoRow>
              <InfoRow label="Période">{periodLabel(p)}</InfoRow>
            </dl>
            {usage !== null && (
              <div className="border-t border-border px-5 py-4">
                <ProgressBar value={usage} tone={usage > 90 ? 'danger' : 'brand'} label="Utilisations consommées" valueLabel={`${Math.round(usage)} %`} />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Portée et ciblage" divided />
            <dl className="divide-y divide-border px-5 py-1">
              <InfoRow label="Portée">{SCOPE_LABELS[p.scope]}</InfoRow>
              {p.scope === 'country' && <InfoRow label="Pays">{names.country(p.countryId)}</InfoRow>}
              {(p.scope === 'city' || p.scope === 'restaurant') && <InfoRow label="Ville">{(p.cityIds ?? []).map((c) => names.city(c)).join(', ')}</InfoRow>}
              {restaurant && (
                <InfoRow label="Restaurant">
                  <Link className="text-primary-soft-fg hover:underline" to={`/restaurants/${restaurant.id}`}>
                    {restaurant.name}
                  </Link>
                </InfoRow>
              )}
              {participants.length > 0 && <InfoRow label="Participants">{participants.join(', ')}</InfoRow>}
              <InfoRow label="Clients ciblés">
                {TARGET_LABELS[p.target]}
                {p.target === 'inactive_customers' && p.inactiveDays ? ` (${p.inactiveDays} j)` : ''}
              </InfoRow>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Financement" divided />
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-muted">Financée par</span>
                <span className="font-medium text-fg">{PROMOTION_FUNDING_LABELS[p.funding]}</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <div className="bg-primary" style={{ width: `${share * 100}%` }} />
                <div className="tone-teal bg-(--tone-solid)" style={{ width: `${(1 - share) * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-fg-muted">
                <span>Ciyou Eats {Math.round(share * 100)} %</span>
                <span>Restaurants {p.restaurantShareBps && p.funding === 'shared' ? bpsLabel(p.restaurantShareBps) : `${Math.round((1 - share) * 100)} %`}</span>
              </div>
              <p className="text-xs text-fg-subtle">La part des restaurants est déduite de leur prochain reversement.</p>
            </div>
          </Card>
        </div>
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        {editing && <PromotionFormSheet promotion={row} onDone={() => setEditing(false)} />}
      </Sheet>
      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={ACTIONS[action].title}
          description={ACTIONS[action].description}
          confirmLabel={ACTIONS[action].confirm}
          destructive={ACTIONS[action].destructive}
          requireReason={ACTIONS[action].reason}
          reasonLabel={action === 'reject' ? 'Motif du refus (transmis au restaurant)' : undefined}
          onConfirm={async (reason) => {
            const result = await mutate({ promotionId, action, reason: reason ?? null });
            if (result) setAction(null);
          }}
        />
      )}
    </PageContainer>
  );
}
