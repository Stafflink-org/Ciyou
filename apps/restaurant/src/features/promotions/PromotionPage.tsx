import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { format, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Copy,
  Euro,
  Flag,
  MoreHorizontal,
  Pause,
  PencilLine,
  Play,
  Send,
  ShoppingBag,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react';
import {
  AreaChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timeline,
  formatDate,
  formatDateTime,
  formatEUR,
  formatNumber,
  toast,
  type TimelineItem,
} from '@golink/ui';
import { COLLECTIONS, type Promotion } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { docAt, errorMessage, toDate, toMillis, useDoc } from '@/lib/firestore';
import { PromotionMenuItems, usePromotionActions } from './actions';
import {
  DISPLAY_STATUS,
  TARGET_LABELS,
  conditionsLabel,
  discountLabel,
  displayStatus,
  modesLabel,
  promotionName,
  usePromotionSettings,
  useRedemptions,
  type PromotionRow,
} from './lib';
import { PromotionForm } from './PromotionForm';

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}

export function PromotionPage() {
  const { promotionId = '' } = useParams();
  const can = useCan();
  const state = useDoc<Promotion>(can('marketing.manage') ? docAt(`${COLLECTIONS.promotions}/${promotionId}`) : null);
  const promotion = state.data as PromotionRow | null;
  const redemptions = useRedemptions(promotion ? promotionId : null);
  const limits = usePromotionSettings();
  const actions = usePromotionActions();
  const [editor, setEditor] = useState<'edit' | 'duplicate' | null>(null);
  const submitLabel = limits.restaurantRequiresReview ? 'Soumettre à Ciyou Eats' : 'Mettre en ligne';

  const series = useMemo(() => {
    const days = 30;
    const buckets = new Map<string, { uses: number; discount: number }>();
    for (let i = days - 1; i >= 0; i -= 1) buckets.set(format(subDays(new Date(), i), 'yyyy-MM-dd'), { uses: 0, discount: 0 });
    for (const r of redemptions.data) {
      if (r.status !== 'applied') continue;
      const d = toDate(r.createdAt);
      if (!d) continue;
      const bucket = buckets.get(format(d, 'yyyy-MM-dd'));
      if (bucket) {
        bucket.uses += 1;
        bucket.discount += r.discountCents;
      }
    }
    return [...buckets.entries()].map(([day, v]) => ({ jour: format(new Date(day), 'd MMM', { locale: fr }), utilisations: v.uses }));
  }, [redemptions.data]);

  if (state.loading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-80 rounded-xl" />
      </PageContainer>
    );
  }

  if (!promotion || promotion.scope !== 'restaurant') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<Tag />}
            title="Offre introuvable"
            description={state.error ? errorMessage(state.error) : 'Cette offre n’existe pas ou n’appartient pas à cet établissement.'}
            action={
              <Button asChild variant="secondary" leftIcon={<ArrowLeft />}>
                <Link to="/promotions">Retour aux offres</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const p = promotion;
  const status = displayStatus(p);
  const averageBasket = p.stats.redemptions > 0 ? Math.round(p.stats.ordersSubtotalCents / p.stats.redemptions) : 0;
  const usage = p.totalUsageLimit ? `${formatNumber(p.stats.redemptions)} / ${formatNumber(p.totalUsageLimit)}` : formatNumber(p.stats.redemptions);

  const timeline: TimelineItem[] = [
    { id: 'created', title: 'Offre créée', time: formatDateTime(toDate(p.createdAt) ?? new Date()), icon: <Sparkles />, tone: 'neutral' },
    ...(p.submittedAt ? [{ id: 'submitted', title: 'Envoyée pour validation', time: formatDateTime(toDate(p.submittedAt)!), icon: <Send />, tone: 'info' as const }] : []),
    ...(p.approvedAt ? [{ id: 'approved', title: 'Validée et mise en ligne', time: formatDateTime(toDate(p.approvedAt)!), icon: <CheckCircle2 />, tone: 'success' as const }] : []),
    ...(p.status === 'rejected'
      ? [{ id: 'rejected', title: 'Refusée par Ciyou Eats', description: p.reviewNote ?? undefined, time: formatDateTime(toDate(p.updatedAt)!), icon: <Flag />, tone: 'danger' as const }]
      : []),
    ...(p.pausedAt && p.status === 'paused' ? [{ id: 'paused', title: 'Mise en pause', time: formatDateTime(toDate(p.pausedAt)!), icon: <Pause />, tone: 'amber' as const }] : []),
    ...(p.endedAt ? [{ id: 'ended', title: 'Terminée', time: formatDateTime(toDate(p.endedAt)!), icon: <CalendarCheck />, tone: 'neutral' as const }] : []),
  ];

  const primary =
    p.status === 'draft' || p.status === 'rejected' ? (
      <Button variant="primary" leftIcon={<Send />} onClick={() => actions.trigger('submit', [p])} loading={actions.loading}>
        {submitLabel}
      </Button>
    ) : p.status === 'active' ? (
      <Button variant="secondary" leftIcon={<Pause />} onClick={() => actions.trigger('pause', [p])} loading={actions.loading}>
        Mettre en pause
      </Button>
    ) : p.status === 'paused' ? (
      <Button variant="primary" leftIcon={<Play />} onClick={() => actions.trigger('resume', [p])} loading={actions.loading}>
        Relancer
      </Button>
    ) : null;

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: 'Codes promo et offres', href: '/promotions' }, { label: promotionName(p) }]}
        eyebrow={p.code ? 'Code promo' : 'Offre automatique'}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className={p.code ? 'font-mono tracking-wide' : undefined}>{promotionName(p)}</span>
            <StatusBadge status={status} map={DISPLAY_STATUS} />
          </span>
        }
        description={p.code ? p.title.fr : (p.description?.fr ?? undefined)}
        actions={
          <>
            {p.code && (
              <Button
                variant="ghost"
                leftIcon={<Copy />}
                onClick={() =>
                  void navigator.clipboard.writeText(p.code!).then(
                    () => toast.success(`Code ${p.code} copié.`),
                    () => toast.error('Impossible de copier le code.'),
                  )
                }
              >
                Copier
              </Button>
            )}
            {p.status !== 'ended' && (
              <Button variant="secondary" leftIcon={<PencilLine />} onClick={() => setEditor('edit')}>
                Modifier
              </Button>
            )}
            {primary}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" aria-label="Plus d’actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <PromotionMenuItems
                  promotion={p}
                  submitLabel={submitLabel}
                  onEdit={() => setEditor('edit')}
                  onDuplicate={() => setEditor('duplicate')}
                  onAction={(action) => actions.trigger(action, [p])}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {p.status === 'rejected' && p.reviewNote && (
        <div className="tone-danger mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 text-sm text-(--tone-fg)">
          <p className="font-medium">Motif du refus</p>
          <p className="mt-1">{p.reviewNote}</p>
          <p className="mt-2 text-xs opacity-80">Modifiez l’offre puis soumettez-la à nouveau.</p>
        </div>
      )}
      {p.status === 'pending_review' && (
        <div className="tone-info mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 text-sm text-(--tone-fg)">
          Notre équipe vérifie cette offre avant publication, en général sous 24 heures ouvrées. Vous serez notifié dès sa mise en ligne.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Utilisations" value={usage} icon={<ShoppingBag />} footer={p.totalUsageLimit ? 'Sur le total autorisé.' : 'Sans limite totale.'} />
        <StatCard label="Remises accordées" value={formatEUR(p.stats.discountCents, { cents: true })} icon={<Euro />} tone="amber" footer="À la charge de l’établissement." />
        <StatCard
          label="Ventes générées"
          value={formatEUR(p.stats.ordersSubtotalCents, { cents: true })}
          icon={<ShoppingBag />}
          tone="success"
          footer={averageBasket > 0 ? `Panier moyen ${formatEUR(averageBasket, { cents: true })}` : 'Aucune commande pour le moment.'}
        />
        <StatCard label="Nouveaux clients" value={formatNumber(p.stats.newCustomers)} icon={<Users />} tone="info" footer="Première commande chez vous." />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Utilisations sur 30 jours" description="Commandes passées avec cette offre, jour par jour." />
            <CardContent>
              {redemptions.loading ? (
                <Skeleton className="h-60 rounded-lg" />
              ) : (
                <AreaChart data={series} xKey="jour" height={240} series={[{ key: 'utilisations', label: 'Utilisations' }]} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Dernières utilisations" description="Les commandes les plus récentes ayant bénéficié de l’offre." divided />
            {redemptions.error ? (
              <EmptyState compact title="Historique indisponible" description={errorMessage(redemptions.error)} />
            ) : redemptions.loading ? (
              <div className="space-y-2 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : redemptions.data.length === 0 ? (
              <EmptyState compact icon={<ShoppingBag />} title="Pas encore d’utilisation" description="Les commandes avec cette offre apparaîtront ici en temps réel." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Commande</TableHead>
                    <TableHead className="text-right">Remise</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redemptions.data.slice(0, 12).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-fg-muted">{formatDateTime(toDate(r.createdAt) ?? new Date())}</TableCell>
                      <TableCell>
                        <Link to={`/commandes/${r.orderId}`} className="font-mono text-sm text-primary-soft-fg hover:underline">
                          {r.orderId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono num">−{formatEUR(r.discountCents, { cents: true })}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={r.status}
                          map={{ applied: { label: 'Appliquée', tone: 'success' }, reversed: { label: 'Annulée', tone: 'neutral' } }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Conditions" />
            <CardContent>
              <dl>
                <Detail label="Remise" value={discountLabel(p)} />
                <Detail label="Conditions" value={conditionsLabel(p)} />
                <Detail label="Pour qui" value={p.target === 'inactive_customers' ? `${TARGET_LABELS[p.target]} (${p.inactiveDays} j)` : TARGET_LABELS[p.target]} />
                <Detail label="Modes" value={modesLabel(p.modes)} />
                <Detail label="Par client" value={`${p.perCustomerLimit} fois`} />
                <Detail label="Au total" value={p.totalUsageLimit ? formatNumber(p.totalUsageLimit) : 'Illimité'} />
                <Detail label="Début" value={formatDate(toDate(p.startsAt) ?? new Date())} />
                <Detail label="Fin" value={toMillis(p.endsAt) ? formatDate(toDate(p.endsAt)!) : 'Sans date de fin'} />
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Historique" icon={<CalendarClock />} />
            <CardContent>
              <Timeline items={timeline} />
            </CardContent>
          </Card>
        </div>
      </div>

      <PromotionForm
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
        promotion={editor === 'edit' ? p : null}
        template={editor === 'duplicate' ? p : null}
      />
      {actions.dialog}
    </PageContainer>
  );
}
