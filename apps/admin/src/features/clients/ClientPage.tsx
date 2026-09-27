// Super admin §7 : fiche client (coordonnées, adresses, commandes, dépenses,
// favoris, fidélité, promotions, tickets, moyens de paiement masqués, avoirs et
// remboursements, indicateurs de risque), blocage et suppression RGPD.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Ban,
  CreditCard,
  Gift,
  Heart,
  LayoutGrid,
  LifeBuoy,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageContainer,
  Skeleton,
  StatCard,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  createColumnHelper,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import {
  COLLECTIONS,
  LOCALE_LABELS,
  REFUND_CAUSE_LABELS,
  REFUND_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  formatCardLabel,
  paths,
  type Favorite,
  type LoyaltyAccount,
  type Order,
  type PromotionRedemption,
  type Refund,
  type Restaurant,
  type Review,
  type SavedPaymentMethod,
  type SupportTicket,
  type UserAddress,
  type UserPrivate,
  type UserProfile,
  type WalletTransaction,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useDoc, useDocs } from '@/lib/firestore';
import { HistoryPanel } from '../acteurs-commun/HistoryPanel';
import { NotesPanel } from '../acteurs-commun/NotesPanel';
import { ErrorPanel, Facts, Panel, eur, plural } from '../acteurs-commun/ui';
import { BlockCustomerDialog, CreditDialog, DeleteCustomerDialog } from './components/CustomerDialogs';
import { CUSTOMER_STATUS_META, RISK_FLAG_LABELS, RISK_META, displayEmail, displayPhone, riskOf } from './lib';

const TABS = ['apercu', 'commandes', 'argent', 'support', 'risque', 'notes'] as const;
type Tab = (typeof TABS)[number];
const orderColumn = createColumnHelper<WithId<Order>>();

const WALLET_REASON: Record<WalletTransaction['reason'], string> = {
  refund: 'Remboursement',
  late_delivery: 'Retard de livraison',
  commercial_gesture: 'Geste commercial',
  referral: 'Parrainage',
  loyalty_reward: 'Fidélité',
  order_payment: 'Paiement de commande',
  expiry: 'Expiration',
  adjustment: 'Régularisation',
};

function Section({ loading, error, empty, children }: { loading: boolean; error: unknown; empty: { icon: ReactNode; title: string; description?: string } | null; children: ReactNode }) {
  if (error) return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (empty) return <EmptyState compact icon={empty.icon} title={empty.title} description={empty.description} />;
  return <>{children}</>;
}

export function ClientPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { admin, can } = useAdminAccess();
  const full = can('personal_data.view');
  const user = useDoc<UserProfile>(userId ? docAt(paths.user(userId)) : null);
  const profile = user.data;
  useDocumentTitle(`${profile?.displayName ?? 'Client'} · GoLink Admin`);
  const [dialog, setDialog] = useState<'credit' | 'block' | 'unblock' | 'delete' | null>(null);

  const priv = useDoc<UserPrivate>(userId ? docAt(`${COLLECTIONS.userPrivate}/${userId}`) : null);
  const addresses = useCollection<UserAddress>(useMemo(() => (userId ? query(collectionAt(paths.userSub(userId, 'addresses')), limit(20)) : null), [userId]));
  const methods = useCollection<SavedPaymentMethod>(useMemo(() => (userId ? query(collectionAt(paths.userSub(userId, 'paymentMethods')), limit(10)) : null), [userId]));
  const favorites = useCollection<Favorite>(useMemo(() => (userId ? query(collectionAt(paths.userSub(userId, 'favorites')), limit(50)) : null), [userId]));
  const loyalty = useCollection<LoyaltyAccount>(useMemo(() => (userId ? query(collectionAt(COLLECTIONS.loyaltyAccounts), where('userId', '==', userId), limit(20)) : null), [userId]));
  const loyaltyRefs = useMemo(
    () => loyalty.data.filter((a) => a.restaurantId).map((a) => docAt(paths.restaurant(a.restaurantId!))),
    [loyalty.data],
  );
  const loyaltyRestaurants = useDocs<Restaurant>(loyaltyRefs);
  const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  const orders = useCollection<Order>(
    useMemo(() => {
      if (!userId || !can('orders.view')) return null;
      const base = collectionAt(COLLECTIONS.orders);
      return cityScoped
        ? query(base, where('customerId', '==', userId), where('cityId', 'in', admin.cityIds.slice(0, 30)), orderBy('createdAt', 'desc'), limit(100))
        : query(base, where('customerId', '==', userId), orderBy('createdAt', 'desc'), limit(100));
    }, [userId, can, cityScoped, admin.cityIds]),
  );
  const refunds = useCollection<Refund>(
    useMemo(
      () => (userId && (can('refunds.create') || can('finance.view')) ? query(collectionAt(COLLECTIONS.refunds), where('customerId', '==', userId), orderBy('requestedAt', 'desc'), limit(50)) : null),
      [userId, can],
    ),
  );
  const wallet = useCollection<WalletTransaction>(
    useMemo(() => (userId ? query(collectionAt(COLLECTIONS.walletTransactions), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50)) : null), [userId]),
  );
  const tickets = useCollection<SupportTicket>(
    useMemo(() => (userId && can('support.view') ? query(collectionAt(COLLECTIONS.supportTickets), where('requesterId', '==', userId), orderBy('lastMessageAt', 'desc'), limit(30)) : null), [userId, can]),
  );
  const promos = useCollection<PromotionRedemption>(
    useMemo(() => (userId && can('promotions.view') ? query(collectionAt(COLLECTIONS.promotionRedemptions), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(30)) : null), [userId, can]),
  );
  const reviews = useCollection<Review>(
    useMemo(() => (userId && can('reviews.view') ? query(collectionAt(COLLECTIONS.reviews), where('customerId', '==', userId), orderBy('createdAt', 'desc'), limit(30)) : null), [userId, can]),
  );

  const requested = params.get('onglet') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'apercu';
  const notCollected = orders.data.filter((o) => o.closedAs === 'customer_absent').length;
  const claims = orders.data.filter((o) => o.flags?.disputed).length;
  const risk = profile ? riskOf(profile, priv.data, { notCollectedCount: notCollected, claimsCount: claims }) : null;
  const refundedTotal = refunds.data.filter((r) => r.status === 'processed' || r.status === 'approved').reduce((s, r) => s + r.amountCents, 0);
  const favoriteRestaurants = favorites.data.filter((f) => f.type === 'restaurant').length;
  const loyaltyPoints = loyalty.data.reduce((s, a) => s + (a.points ?? 0), 0);

  const orderColumns = useMemo(
    () => [
      orderColumn.accessor('number', { header: 'Commande', cell: (info) => <span className="font-mono text-sm text-fg">{info.getValue()}</span> }),
      orderColumn.accessor('restaurantName', { header: 'Commerce', cell: (info) => <span className="text-sm text-fg">{info.getValue()}</span> }),
      orderColumn.accessor((o) => toDate(o.createdAt)?.getTime() ?? 0, { id: 'date', header: 'Date', meta: { className: 'hidden sm:table-cell' }, cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span> }),
      orderColumn.accessor((o) => o.amounts?.totalCents ?? 0, { id: 'total', header: 'Total', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{eur(info.getValue())}</span> }),
      orderColumn.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge status={info.getValue()} />
            {info.row.original.closedAs === 'customer_absent' && <Badge size="sm" tone="amber">Client absent</Badge>}
            {info.row.original.flags?.refunded && <Badge size="sm">Remboursée</Badge>}
          </div>
        ),
      }),
    ],
    [],
  );

  if (user.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-6 h-5 w-32" />
        <div className="mb-8 flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-8 w-60" />
        </div>
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }
  if (user.error) {
    return (
      <PageContainer>
        <ErrorPanel error={user.error} />
      </PageContainer>
    );
  }
  if (!profile || profile.role !== 'client') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<UserRound />}
            title="Client introuvable"
            description="Ce compte n’existe pas ou n’est pas un compte client."
            action={
              <Button asChild variant="secondary" leftIcon={<ArrowLeft />}>
                <Link to="/clients">Retour aux clients</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const deleted = profile.status === 'deleted';
  const blocked = profile.status === 'blocked';
  const stats = profile.stats ?? { ordersCount: 0, totalSpentCents: 0, cancelledCount: 0, refundsCount: 0 };
  const basket = stats.ordersCount ? Math.round(stats.totalSpentCents / stats.ordersCount) : 0;

  return (
    <PageContainer wide>
      <Link to="/clients" className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-4" /> Clients
      </Link>
      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={profile.displayName} src={profile.avatar?.url} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-display text-fg sm:text-[1.75rem] sm:leading-9">{profile.displayName}</h1>
              <StatusBadge status={profile.status} map={CUSTOMER_STATUS_META} />
              {risk && risk.level !== 'low' && <StatusBadge status={risk.level} map={RISK_META} />}
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              Client depuis {toDate(profile.createdAt) ? formatDate(toDate(profile.createdAt)!) : '—'}
              {toDate(profile.lastSeenAt) ? ` · vu ${formatRelative(toDate(profile.lastSeenAt)!)}` : ''}
            </p>
          </div>
        </div>
        {!deleted && (
          <div className="flex flex-wrap items-center gap-2">
            {can('customers.credit') && (
              <Button variant="primary" leftIcon={<Gift />} onClick={() => setDialog('credit')}>
                Créditer un avoir
              </Button>
            )}
            {can('customers.block') &&
              (blocked ? (
                <Button variant="secondary" leftIcon={<ShieldCheck />} onClick={() => setDialog('unblock')}>
                  Débloquer
                </Button>
              ) : (
                <Button variant="danger-soft" leftIcon={<Ban />} onClick={() => setDialog('block')}>
                  Bloquer
                </Button>
              ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Plus d’actions" variant="secondary">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<NotebookPen />} onSelect={() => setParams({ onglet: 'notes' })}>
                  Ajouter une note interne
                </DropdownMenuItem>
                {can('customers.delete') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDialog('delete')}>
                      Supprimer le compte (RGPD)
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      {blocked && (
        <div role="status" className="tone-danger mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
          <strong className="font-semibold">Compte bloqué</strong>
          {profile.blockedReason ? ` · ${profile.blockedReason}` : ''}
          {toDate(profile.blockedAt) ? ` · depuis le ${formatDateTime(toDate(profile.blockedAt)!)}` : ''}
        </div>
      )}
      {deleted && (
        <div role="status" className="tone-neutral mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
          Compte supprimé et anonymisé{toDate(profile.deletedAt) ? ` le ${formatDateTime(toDate(profile.deletedAt)!)}` : ''}. Seules les données à conservation légale subsistent.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Commandes" value={formatNumber(stats.ordersCount)} icon={<ShoppingBag />} footer={`${formatNumber(stats.cancelledCount)} annulée(s)`} />
        <StatCard label="Dépenses" value={eur(stats.totalSpentCents)} icon={<Receipt />} tone="success" footer={`Panier moyen ${eur(basket)}`} />
        <StatCard label="Avoir disponible" value={eur(profile.walletBalanceCents ?? 0)} icon={<Wallet />} tone="brand" footer={`${plural(stats.refundsCount, 'remboursement', 'remboursements')}`} />
        <StatCard label="Fidélité" value={`${formatNumber(loyaltyPoints)} pts`} icon={<Star />} tone="plum" footer={`${plural(favoriteRestaurants, 'commerce favori', 'commerces favoris')}`} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ onglet: v }, { replace: true })}>
        <TabsList className="mb-6">
          <TabsTrigger value="apercu" icon={<LayoutGrid />}>
            Aperçu
          </TabsTrigger>
          <TabsTrigger value="commandes" icon={<ShoppingBag />} count={orders.data.length || undefined}>
            Commandes
          </TabsTrigger>
          <TabsTrigger value="argent" icon={<Wallet />}>
            Remboursements & avoirs
          </TabsTrigger>
          <TabsTrigger value="support" icon={<LifeBuoy />}>
            Support & promotions
          </TabsTrigger>
          <TabsTrigger value="risque" icon={<ShieldAlert />}>
            Risque
          </TabsTrigger>
          <TabsTrigger value="notes" icon={<NotebookPen />}>
            Notes & historique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="apercu">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <Panel title="Coordonnées" icon={<UserRound />} description={full ? undefined : 'Coordonnées masquées pour votre rôle.'}>
              <Facts
                items={[
                  { label: 'E-mail', value: displayEmail(profile.email, full), hint: profile.emailVerified ? 'Vérifié' : 'Non vérifié' },
                  { label: 'Téléphone', value: displayPhone(profile.phone, full), hint: profile.phone ? (profile.phoneVerified ? 'Vérifié' : 'Non vérifié') : undefined },
                  { label: 'Langue', value: LOCALE_LABELS[profile.locale] ?? profile.locale },
                  { label: 'Code de parrainage', value: <span className="font-mono">{profile.referralCode || '—'}</span> },
                  { label: 'Dernière connexion', value: toDate(profile.lastLoginAt) ? formatDateTime(toDate(profile.lastLoginAt)!) : '—' },
                  { label: 'Communications', value: profile.notificationPrefs?.promotions ? 'Offres acceptées' : 'Offres refusées' },
                ]}
              />
            </Panel>
            <div className="space-y-6">
              <Panel title="Adresses" icon={<MapPin />}>
                <Section loading={addresses.loading} error={addresses.error} empty={addresses.data.length ? null : { icon: <MapPin />, title: 'Aucune adresse enregistrée' }}>
                  <ul className="divide-y divide-border">
                    {addresses.data.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">
                            {a.label} {a.isDefault && <Badge size="sm">Par défaut</Badge>}
                          </p>
                          <p className="truncate text-sm text-fg-muted">{full ? `${a.line1}, ${a.postalCode} ${a.city}` : `${a.postalCode} ${a.city}`}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              </Panel>
              <Panel title="Moyens de paiement" icon={<CreditCard />} description="Toujours masqués : GoLink ne stocke jamais le numéro complet.">
                <Section loading={methods.loading} error={methods.error} empty={methods.data.length ? null : { icon: <CreditCard />, title: 'Aucune carte enregistrée' }}>
                  <ul className="divide-y divide-border">
                    {methods.data.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="font-mono text-sm text-fg">{formatCardLabel(m.brand, m.last4)}</span>
                        <span className="text-xs text-fg-subtle">
                          {m.wallet ? (m.wallet === 'apple_pay' ? 'Apple Pay · ' : 'Google Pay · ') : ''}expire {String(m.expMonth).padStart(2, '0')}/{String(m.expYear).slice(-2)}
                          {m.isDefault ? ' · par défaut' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </Panel>
              <Panel title="Favoris et fidélité" icon={<Heart />}>
                <Facts
                  items={[
                    { label: 'Commerces favoris', value: formatNumber(favoriteRestaurants) },
                    { label: 'Produits favoris', value: formatNumber(favorites.data.length - favoriteRestaurants) },
                    ...loyalty.data.map((acc) => ({ label: acc.scope === 'platform' ? 'Points GoLink' : `Points · ${loyaltyRestaurants.data.find((r) => r.id === acc.restaurantId)?.name ?? 'commerce'}`, value: `${formatNumber(acc.points)} pts`, hint: `${formatNumber(acc.lifetimePoints)} cumulés` })),
                  ]}
                />
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="commandes">
          {!can('orders.view') ? (
            <EmptyState icon={<ShoppingBag />} title="Commandes réservées" description="La consultation des commandes demande le droit « Commandes »." />
          ) : orders.error ? (
            <ErrorPanel error={orders.error} />
          ) : (
            <DataTable
              data={orders.data}
              columns={orderColumns}
              getRowId={(o) => o.id}
              loading={orders.loading}
              itemLabel="commandes"
              searchPlaceholder="Rechercher un numéro, un commerce…"
              initialSorting={[{ id: 'date', desc: true }]}
              onRowClick={(o) => navigate(`/commandes/${o.id}`)}
              emptyState={<EmptyState compact icon={<ShoppingBag />} title="Aucune commande" description="Ce client n’a encore rien commandé." />}
            />
          )}
        </TabsContent>

        <TabsContent value="argent">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <Panel title="Remboursements" icon={<RefreshCw />} description={refunds.data.length ? `${eur(refundedTotal)} remboursés au total` : undefined}>
              {!(can('refunds.create') || can('finance.view')) ? (
                <p className="text-sm text-fg-muted">Réservé au support et à la finance.</p>
              ) : (
                <Section loading={refunds.loading} error={refunds.error} empty={refunds.data.length ? null : { icon: <RefreshCw />, title: 'Aucun remboursement' }}>
                  <ul className="divide-y divide-border">
                    {refunds.data.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">
                            {r.orderNumber} · {REFUND_CAUSE_LABELS[r.cause]}
                          </p>
                          <p className="text-xs text-fg-subtle">
                            {REFUND_STATUS_LABELS[r.status]} · {toDate(r.requestedAt) ? formatDate(toDate(r.requestedAt)!) : ''} · {r.method === 'wallet_credit' ? 'en avoir' : 'sur le moyen de paiement'}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-medium num">{eur(r.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </Panel>
            <Panel
              title="Avoirs"
              icon={<Wallet />}
              description={`Solde : ${eur(profile.walletBalanceCents ?? 0)}`}
              actions={
                can('customers.credit') && !deleted ? (
                  <Button size="sm" variant="secondary" leftIcon={<Gift />} onClick={() => setDialog('credit')}>
                    Créditer
                  </Button>
                ) : undefined
              }
            >
              <Section loading={wallet.loading} error={wallet.error} empty={wallet.data.length ? null : { icon: <Wallet />, title: 'Aucun mouvement d’avoir' }}>
                <ul className="divide-y divide-border">
                  {wallet.data.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">{WALLET_REASON[t.reason] ?? t.reason}</p>
                        <p className="truncate text-xs text-fg-subtle">
                          {toDate(t.createdAt) ? formatDateTime(toDate(t.createdAt)!) : ''}
                          {t.note ? ` · ${t.note}` : ''}
                          {toDate(t.expiresAt) ? ` · expire le ${formatDate(toDate(t.expiresAt)!)}` : ''}
                        </p>
                      </div>
                      <span className={`font-mono text-sm font-medium num ${t.amountCents >= 0 ? 'text-success' : 'text-fg-muted'}`}>
                        {t.amountCents >= 0 ? '+' : ''}
                        {eur(t.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="support">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            <Panel title="Tickets" icon={<LifeBuoy />}>
              {!can('support.view') ? (
                <p className="text-sm text-fg-muted">Réservé au support.</p>
              ) : (
                <Section loading={tickets.loading} error={tickets.error} empty={tickets.data.length ? null : { icon: <LifeBuoy />, title: 'Aucun ticket' }}>
                  <ul className="divide-y divide-border">
                    {tickets.data.map((t) => (
                      <li key={t.id} className="py-2.5">
                        <Link to={`/support/${t.id}`} className="text-sm font-medium text-fg hover:underline">
                          {t.number} · {t.subject}
                        </Link>
                        <p className="text-xs text-fg-subtle">{TICKET_STATUS_LABELS[t.status]}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </Panel>
            <Panel title="Promotions utilisées" icon={<Tag />}>
              {!can('promotions.view') ? (
                <p className="text-sm text-fg-muted">Réservé au marketing.</p>
              ) : (
                <Section loading={promos.loading} error={promos.error} empty={promos.data.length ? null : { icon: <Tag />, title: 'Aucune promotion utilisée' }}>
                  <ul className="divide-y divide-border">
                    {promos.data.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-mono text-sm text-fg">{p.code ?? 'Offre automatique'}</p>
                          <p className="text-xs text-fg-subtle">{toDate(p.createdAt) ? formatDate(toDate(p.createdAt)!) : ''}{p.status === 'reversed' ? ' · annulée' : ''}</p>
                        </div>
                        <span className="font-mono text-sm num">−{eur(p.discountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </Panel>
            <Panel title="Avis laissés" icon={<Star />}>
              {!can('reviews.view') ? (
                <p className="text-sm text-fg-muted">Réservé à la modération.</p>
              ) : (
                <Section loading={reviews.loading} error={reviews.error} empty={reviews.data.length ? null : { icon: <Star />, title: 'Aucun avis' }}>
                  <ul className="divide-y divide-border">
                    {reviews.data.map((r) => (
                      <li key={r.id} className="py-2.5">
                        <p className="text-sm text-fg">
                          {'★'.repeat(r.restaurantRating)}
                          <span className="text-fg-subtle">{'★'.repeat(5 - r.restaurantRating)}</span>
                        </p>
                        {r.comment && <p className="line-clamp-2 text-xs text-fg-muted" title={String(r.comment ?? '')}>{r.comment}</p>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="risque">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <Panel title="Indicateurs de risque" icon={<ShieldAlert />} description="Signaux d’abus : réclamations et remboursements répétés, commandes non récupérées.">
              {risk && (
                <div className="mb-4 flex items-center gap-3">
                  <StatusBadge status={risk.level} map={RISK_META} />
                  <span className="text-sm text-fg-muted">{risk.reasons.length ? risk.reasons.join(' · ') : 'Aucun signal particulier.'}</span>
                </div>
              )}
              <Facts
                items={[
                  { label: 'Taux d’annulation', value: stats.ordersCount ? `${Math.round((stats.cancelledCount / stats.ordersCount) * 100)} %` : '—', hint: `${stats.cancelledCount} sur ${stats.ordersCount}` },
                  { label: 'Remboursements', value: formatNumber(stats.refundsCount), hint: stats.ordersCount ? `${Math.round((stats.refundsCount / stats.ordersCount) * 100)} % des commandes` : undefined },
                  { label: 'Commandes non récupérées', value: formatNumber(notCollected), hint: 'Client absent à la livraison' },
                  { label: 'Commandes contestées', value: formatNumber(claims) },
                  { label: 'Score de risque', value: priv.data ? `${priv.data.riskScore}/100` : '—' },
                  { label: 'Appareils connus', value: priv.data ? formatNumber(priv.data.deviceHashes?.length ?? 0) : '—', hint: 'Détection de comptes liés' },
                ]}
              />
            </Panel>
            <Panel title="Signaux de fraude" icon={<ShieldCheck />}>
              {priv.loading ? (
                <Skeleton className="h-20 w-full" />
              ) : priv.data?.riskFlags?.length ? (
                <ul className="flex flex-wrap gap-2">
                  {priv.data.riskFlags.map((flag) => (
                    <Badge key={flag} tone="danger">
                      {RISK_FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={<ShieldCheck />} title="Aucun signal" description="Aucun dossier de fraude ouvert pour ce compte." />
              )}
              {priv.data?.fraudCaseIds?.length ? <p className="mt-3 text-sm text-fg-muted">{plural(priv.data.fraudCaseIds.length, 'dossier de fraude lié', 'dossiers de fraude liés')}.</p> : null}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Notes internes" icon={<NotebookPen />} description="Visibles uniquement par l’équipe GoLink.">
              <NotesPanel target={{ type: 'client', id: userId, label: profile.displayName }} />
            </Panel>
            <Panel title="Historique des actions" icon={<RefreshCw />}>
              <HistoryPanel target={{ type: 'client', id: userId, label: profile.displayName }} />
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

      {!deleted && (
        <>
          <CreditDialog user={{ ...profile, id: userId }} orders={orders.data} open={dialog === 'credit'} onOpenChange={(o) => !o && setDialog(null)} />
          <BlockCustomerDialog users={[{ ...profile, id: userId }]} blocked={dialog === 'block'} open={dialog === 'block' || dialog === 'unblock'} onOpenChange={(o) => !o && setDialog(null)} />
          <DeleteCustomerDialog user={{ ...profile, id: userId }} open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} onDeleted={() => setParams({ onglet: 'notes' })} />
        </>
      )}
    </PageContainer>
  );
}
