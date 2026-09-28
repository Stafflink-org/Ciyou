// Fiche livreur (cahier §6) : identité, contact, véhicule, zones, statut, performance,
// courses, gains et pourboires, documents, contrôles d'identité, sanctions,
// historique des actions et notes internes. Actions selon les droits.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { addDoc, collection, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Ban,
  Banknote,
  Bike,
  Camera,
  Clock,
  Gavel,
  History,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Pin,
  RotateCcw,
  ShieldAlert,
  Star,
  ThumbsUp,
  Timer,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  PageContainer,
  Skeleton,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  formatDate,
  formatDateTime,
  formatEUR,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import {
  COLLECTIONS,
  DRIVER_BLOCK_LABELS,
  DRIVER_TYPE_LABELS,
  SANCTION_TYPE_LABELS,
  VEHICLE_LABELS,
  type AuditLog,
  type Driver,
  type DriverEarning,
  type DriverLocation,
  type DriverSanction,
  type IdentityCheck,
  type InternalNote,
  type Order,
  type Restaurant,
  type WithId,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, toDate, useCollection, useDoc, useDocs, useMutation } from '@/lib/firestore';
import { bulkSummary, fn } from '../_operations/functions';
import { useNames, useScopedZones } from '../_operations/hooks';
import { DriverDot, OpsMap } from '../_operations/map';
import { AVAILABILITY_TONES, AvailabilityPill, DriverStatusPill, InfoRow, ListSkeleton, LoadError, OnboardingPill, OrderStatusPill, formatMeters, pct } from '../_operations/ui';
import { ApplicationDecision, DocumentsChecklist, LegalIdentity, useDriverDocuments } from './components';
import { MessageDialog, SanctionDialog } from './dialogs';
import { useContactMask } from './lib';
import { ContestDialog, SANCTION_STATUS_META } from './SanctionsPage';

const euros = (cents: number) => formatEUR(cents, { cents: true });

export function DriverPage() {
  const { driverId = '' } = useParams();
  const driverState = useDoc<Driver>(docAt(`${COLLECTIONS.drivers}/${driverId}`));
  const driver = driverState.data;
  useDocumentTitle(`${driver ? `${driver.firstName} ${driver.lastName}` : 'Livreur'} · Ciyou Eats Admin`);

  if (driverState.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-6 h-24 w-full rounded-xl" />
        <ListSkeleton rows={4} />
      </PageContainer>
    );
  }
  if (driverState.error || !driver) {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<Bike />}
            title={driverState.error ? 'Fiche inaccessible' : 'Livreur introuvable'}
            description={driverState.error ? 'Ce livreur est hors de votre périmètre ou n’existe plus.' : 'Le lien est peut-être erroné.'}
            action={
              <Button asChild size="sm">
                <Link to="/livreurs">Retour aux livreurs</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }
  return <DriverSheet driver={driver} />;
}

function DriverSheet({ driver }: { driver: WithId<Driver> }) {
  const { can } = useAdminAccess();
  const names = useNames();
  const contact = useContactMask();
  const docs = useDriverDocuments(driver.id);
  const [dialog, setDialog] = useState<'message' | 'sanction' | 'selfie' | 'activate' | 'deactivate' | 'cash' | 'zones' | null>(null);
  const name = `${driver.firstName} ${driver.lastName}`;
  const created = toDate(driver.createdAt);
  const lastSeen = toDate(driver.lastSeenAt ?? null);
  const bulk = useMutation(fn.bulkUpdateDrivers, { success: (r) => bulkSummary(r, 'Modification enregistrée') });
  const selfie = useMutation(fn.requestIdentityChecks, { success: (r) => bulkSummary(r, 'Selfie demandé') });

  return (
    <PageContainer wide>
      <Link to="/livreurs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Livreurs
      </Link>
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={name} size="xl" status={driver.availability === 'online' ? 'online' : driver.availability === 'on_delivery' ? 'busy' : 'offline'} />
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-semibold tracking-display text-fg">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {driver.status === 'onboarding' ? <OnboardingPill status={driver.onboardingStatus} /> : <DriverStatusPill status={driver.status} />}
                <AvailabilityPill availability={driver.availability} />
                <Badge tone={driver.type === 'platform' ? 'brand' : 'plum'} size="sm">{DRIVER_TYPE_LABELS[driver.type]}</Badge>
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted"><MapPin className="size-3" />{names.city(driver.cityId)}</span>
                {lastSeen && <span className="text-xs text-fg-subtle">· vu {formatRelative(lastSeen)}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<MessageSquare />} onClick={() => setDialog('message')}>
              Message
            </Button>
            {can('drivers.sanction') && driver.status !== 'onboarding' && (
              <Button variant="secondary" leftIcon={<Gavel />} onClick={() => setDialog('sanction')}>
                Sanctionner
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" aria-label="Autres actions" leftIcon={<MoreHorizontal />}>
                  Plus
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can('drivers.validate') && driver.status === 'active' && (
                  <DropdownMenuItem icon={<Camera />} onSelect={() => setDialog('selfie')}>
                    Demander un selfie
                  </DropdownMenuItem>
                )}
                {can('drivers.edit') && (
                  <DropdownMenuItem icon={<MapPin />} onSelect={() => setDialog('zones')}>
                    Zones de livraison
                  </DropdownMenuItem>
                )}
                {can('drivers.edit') && driver.type === 'restaurant' && (
                  <DropdownMenuItem icon={<Banknote />} onSelect={() => setDialog('cash')}>
                    {driver.acceptsCash ? 'Refuser les espèces' : 'Autoriser les espèces'}
                  </DropdownMenuItem>
                )}
                {can('drivers.sanction') && driver.onboardingStatus === 'approved' && driver.status !== 'active' && (
                  <DropdownMenuItem icon={<RotateCcw />} onSelect={() => setDialog('activate')}>
                    Réactiver le compte
                  </DropdownMenuItem>
                )}
                {can('drivers.sanction') && driver.status !== 'deactivated' && driver.status !== 'onboarding' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Ban />} destructive onSelect={() => setDialog('deactivate')}>
                      Désactiver le compte
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {driver.blocked && (
          <div className="tone-danger mt-4 flex items-start gap-2.5 rounded-lg bg-(--tone-bg) px-3.5 py-2.5 text-sm text-(--tone-fg)">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{DRIVER_BLOCK_LABELS[driver.blocked.reason]}</p>
              <p className="text-xs opacity-90">
                {driver.blocked.details ?? ''}
                {toDate(driver.blocked.since) ? ` · depuis le ${formatDate(toDate(driver.blocked.since)!)}` : ''}
              </p>
            </div>
          </div>
        )}
        {driver.status === 'onboarding' && can('drivers.validate') && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-fg-muted">Inscription en attente de décision : vérifiez les documents avant de valider.</p>
            <ApplicationDecision driver={driver} documents={docs.data} />
          </div>
        )}
      </Card>

      <Tabs defaultValue="overview">
        <div data-scroll-ok className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="overview">Vue d’ensemble</TabsTrigger>
            <TabsTrigger value="orders">Courses</TabsTrigger>
            <TabsTrigger value="earnings">Gains</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="sanctions">Sanctions</TabsTrigger>
            <TabsTrigger value="history">Historique</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <Overview driver={driver} contact={contact} created={created} />
        </TabsContent>
        <TabsContent value="orders">
          <DriverOrders driverId={driver.id} />
        </TabsContent>
        <TabsContent value="earnings">
          <DriverEarnings driverId={driver.id} />
        </TabsContent>
        <TabsContent value="documents">
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <DocumentsChecklist driver={driver} documents={docs.data} loading={docs.loading} error={docs.error} />
            </div>
            <IdentityChecks driverId={driver.id} />
          </div>
        </TabsContent>
        <TabsContent value="sanctions">
          <DriverSanctions driver={driver} />
        </TabsContent>
        <TabsContent value="history">
          <DriverHistory driver={driver} />
        </TabsContent>
      </Tabs>

      <MessageDialog open={dialog === 'message'} onOpenChange={(o) => !o && setDialog(null)} driverIds={[driver.id]} label={name} />
      <SanctionDialog open={dialog === 'sanction'} onOpenChange={(o) => !o && setDialog(null)} driverIds={[driver.id]} label={name} />
      <ZonesDialog open={dialog === 'zones'} onOpenChange={(o) => !o && setDialog(null)} driver={driver} />
      <ConfirmDialog
        open={dialog === 'selfie' || dialog === 'activate' || dialog === 'deactivate' || dialog === 'cash'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog === 'selfie' ? 'Demander un selfie de vérification' : dialog === 'activate' ? 'Réactiver le compte' : dialog === 'deactivate' ? 'Désactiver le compte' : driver.acceptsCash ? 'Refuser les espèces' : 'Autoriser les espèces'
        }
        description={
          dialog === 'selfie'
            ? 'Le livreur devra envoyer un selfie avant sa prochaine course.'
            : dialog === 'activate'
              ? 'La sanction en cours est levée si le dossier est conforme.'
              : dialog === 'deactivate'
                ? 'Plus aucune course ne sera proposée à ce livreur.'
                : 'Espèces possibles uniquement pour un livreur salarié du commerce.'
        }
        destructive={dialog === 'deactivate'}
        requireReason
        confirmLabel="Confirmer"
        onConfirm={async (reason) => {
          if (dialog === 'selfie') await selfie.mutate({ driverIds: [driver.id], reason: reason ?? '' });
          else if (dialog === 'activate' || dialog === 'deactivate') await bulk.mutate({ driverIds: [driver.id], action: dialog, reason: reason ?? '' });
          else if (dialog === 'cash') await bulk.mutate({ driverIds: [driver.id], action: 'set_cash', acceptsCash: !driver.acceptsCash, reason: reason ?? '' });
        }}
      />
    </PageContainer>
  );
}

function Overview({ driver, contact, created }: { driver: WithId<Driver>; contact: ReturnType<typeof useContactMask>; created: Date | null }) {
  const names = useNames();
  const location = useDoc<DriverLocation>(docAt(`${COLLECTIONS.driverLocations}/${driver.id}`));
  const employers = useDocs<Restaurant>(useMemo(() => driver.restaurantIds.slice(0, 10).map((id) => docAt(`${COLLECTIONS.restaurants}/${id}`)), [driver.restaurantIds.join(',')])); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = location.data?.position ? { lat: location.data.position.latitude, lng: location.data.position.longitude } : null;
  const s = driver.stats;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard label="Livraisons" value={formatNumber(s.deliveries)} icon={<Bike />} tone="brand" />
        <StatCard label="Taux d’acceptation" value={pct(s.acceptanceRate)} icon={<ThumbsUp />} tone={s.acceptanceRate < 0.7 ? 'danger' : 'success'} />
        <StatCard label="Annulations" value={pct(s.cancellationRate, 1)} icon={<XCircle />} tone={s.cancellationRate > 0.05 ? 'danger' : 'neutral'} />
        <StatCard label="Ponctualité" value={pct(s.onTimeRate)} icon={<Timer />} tone="info" footer={<span>Durée moyenne {s.averageDeliveryMinutes} min</span>} />
        <StatCard
          label="Note clients"
          value={driver.rating.count ? driver.rating.average.toFixed(2).replace('.', ',') : '—'}
          icon={<Star />}
          tone="amber"
          footer={<span>{formatNumber(driver.rating.count)} avis</span>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Identité et contact" divided />
          <CardContent>
            <dl className="divide-y divide-border">
              <InfoRow label="Téléphone"><span className="font-mono">{contact.phone(driver.phone)}</span></InfoRow>
              <InfoRow label="E-mail">{contact.email(driver.email)}</InfoRow>
              <InfoRow label="Inscrit le">{created ? formatDate(created) : '—'}</InfoRow>
              <InfoRow label="Documents valides jusqu’au">{driver.documentsValidUntil ? driver.documentsValidUntil.split('-').reverse().join('/') : '—'}</InfoRow>
              <InfoRow label="Dernier contrôle d’identité">{toDate(driver.lastIdentityCheckAt ?? null) ? formatDate(toDate(driver.lastIdentityCheckAt ?? null)!) : 'Jamais'}</InfoRow>
            </dl>
            <h3 className="eyebrow mb-1 mt-5">Identité légale</h3>
            <LegalIdentity driverId={driver.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Activité" divided />
          <CardContent>
            <dl className="divide-y divide-border">
              <InfoRow label="Type">{DRIVER_TYPE_LABELS[driver.type]}</InfoRow>
              {driver.type === 'restaurant' && (
                <InfoRow label="Employeur">{employers.data.length ? employers.data.map((r) => r.name).join(', ') : '—'}</InfoRow>
              )}
              <InfoRow label="Véhicule">
                {VEHICLE_LABELS[driver.vehicle.type]}
                {driver.vehicle.plate && <span className="ml-1.5 font-mono text-xs text-fg-subtle">{driver.vehicle.plate}</span>}
              </InfoRow>
              <InfoRow label="Ville">{names.city(driver.cityId)}</InfoRow>
              <InfoRow label="Zones">{driver.zoneIds.length ? driver.zoneIds.map(names.zone).join(', ') : 'Toutes les zones de la ville'}</InfoRow>
              <InfoRow label="Distance maximale choisie">{driver.maxDistanceMeters ? formatMeters(driver.maxDistanceMeters) : 'Sans limite'}</InfoRow>
              <InfoRow label="Courses en cours">{driver.activeOrderIds.length}</InfoRow>
              <InfoRow label="Espèces">{driver.type === 'restaurant' ? (driver.acceptsCash ? 'Acceptées' : 'Non') : 'Non (paiement en ligne obligatoire)'}</InfoRow>
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Position" description={pos && toDate(location.data?.updatedAt) ? `Mise à jour ${formatRelative(toDate(location.data!.updatedAt)!)}` : 'Hors ligne'} divided />
            {pos ? (
              <OpsMap center={pos} zoom={14} height={220} className="rounded-none border-0">
                <DriverDot position={pos} tone={AVAILABILITY_TONES[driver.availability]} label={driver.displayName} active />
              </OpsMap>
            ) : (
              <EmptyState compact icon={<MapPin />} title="Aucune position" description="Le livreur n’est pas connecté." />
            )}
          </Card>
          <InternalNotes driver={driver} />
        </div>
      </div>
    </div>
  );
}

function DriverOrders({ driverId }: { driverId: string }) {
  const q = useMemo(() => query(collection(db, COLLECTIONS.orders), where('driverId', '==', driverId), orderBy('createdAt', 'desc'), limit(40)), [driverId]);
  const orders = useCollection<Order>(q);
  if (orders.loading) return <ListSkeleton rows={4} />;
  if (orders.error) return <LoadError error={orders.error} />;
  if (orders.data.length === 0) return <Card><EmptyState icon={<Bike />} title="Aucune course" description="Les courses du livreur apparaîtront ici." /></Card>;
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {orders.data.map((o) => {
        const at = toDate(o.createdAt);
        return (
          <Link key={o.id} to={`/commandes/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-2">
            <span className="w-24 font-mono text-sm font-medium text-fg">{o.number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{o.restaurantName} → {o.customerName}</span>
            <span className="font-mono text-xs text-fg-subtle">{formatMeters(o.delivery?.distanceMeters)}</span>
            <OrderStatusPill status={o.status} />
            <span className="w-28 text-right font-mono text-2xs text-fg-subtle">{at ? formatDateTime(at) : ''}</span>
          </Link>
        );
      })}
    </Card>
  );
}

function DriverEarnings({ driverId }: { driverId: string }) {
  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000), []);
  const q = useMemo(() => query(collection(db, COLLECTIONS.driverEarnings), where('driverId', '==', driverId), orderBy('earnedAt', 'desc'), limit(400)), [driverId]);
  const earnings = useCollection<DriverEarning>(q);
  const recent = earnings.data.filter((e) => (toDate(e.earnedAt)?.getTime() ?? 0) >= since.getTime());
  const total = recent.reduce((s, e) => s + e.amountCents, 0);
  const tips = recent.reduce((s, e) => s + (e.tipCents ?? 0), 0);
  const peak = recent.reduce((s, e) => s + (e.breakdown?.surgeBonusCents ?? 0), 0);
  const byDay = useMemo(() => {
    const map = new Map<string, { day: string; gains: number; pourboires: number }>();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { day: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), gains: 0, pourboires: 0 });
    }
    for (const e of recent) {
      const key = toDate(e.earnedAt)?.toISOString().slice(0, 10);
      const entry = key ? map.get(key) : undefined;
      if (entry) {
        entry.gains += e.amountCents / 100;
        entry.pourboires += (e.tipCents ?? 0) / 100;
      }
    }
    return [...map.values()];
  }, [recent]);
  if (earnings.error) return <LoadError error={earnings.error} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Gains sur 30 jours" value={euros(total)} icon={<Wallet />} tone="success" loading={earnings.loading} />
        <StatCard label="Pourboires" value={euros(tips)} icon={<TrendingUp />} tone="plum" loading={earnings.loading} footer={<span>Reversés à 100 %</span>} />
        <StatCard label="Courses payées" value={formatNumber(recent.filter((e) => e.kind === 'delivery').length)} icon={<Bike />} tone="info" loading={earnings.loading} />
        <StatCard label="Bonus de pointe" value={euros(peak)} icon={<Clock />} tone="amber" loading={earnings.loading} />
      </div>
      <Card>
        <CardHeader title="Gains par jour" description="Rémunération des courses et pourboires, 30 derniers jours." divided />
        <CardContent>
          {earnings.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : recent.length === 0 ? (
            <EmptyState compact icon={<Wallet />} title="Aucun gain sur la période" />
          ) : (
            <BarChart data={byDay} xKey="day" stacked height={260} series={[{ key: 'gains', label: 'Courses' }, { key: 'pourboires', label: 'Pourboires' }]} valueFormatter={(v) => formatEUR(v)} axisFormatter={(v) => `${v} €`} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IdentityChecks({ driverId }: { driverId: string }) {
  const { can } = useAdminAccess();
  const q = useMemo(() => (can('drivers.validate') ? query(collection(db, COLLECTIONS.identityChecks), where('driverId', '==', driverId), orderBy('requestedAt', 'desc'), limit(20)) : null), [driverId, can]);
  const checks = useCollection<IdentityCheck>(q);
  const labels = { requested: 'Demandé', submitted: 'À examiner', passed: 'Conforme', failed: 'Non conforme', expired: 'Non réalisé' } as const;
  const tones = { requested: 'info', submitted: 'brand', passed: 'success', failed: 'danger', expired: 'neutral' } as const;
  return (
    <Card>
      <CardHeader title="Contrôles d’identité" icon={<Camera />} divided />
      {!can('drivers.validate') ? (
        <EmptyState compact icon={<Camera />} title="Accès réservé" />
      ) : checks.loading ? (
        <ListSkeleton rows={2} className="p-4" />
      ) : checks.data.length === 0 ? (
        <EmptyState compact icon={<Camera />} title="Aucun contrôle" description="Aucun selfie demandé à ce livreur." />
      ) : (
        <ul className="divide-y divide-border">
          {checks.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="text-fg-muted">{toDate(c.requestedAt) ? formatDate(toDate(c.requestedAt)!) : ''}</span>
              <Badge size="sm" tone={tones[c.status]}>{labels[c.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DriverSanctions({ driver }: { driver: WithId<Driver> }) {
  const { can } = useAdminAccess();
  const q = useMemo(() => query(collection(db, COLLECTIONS.driverSanctions), where('driverId', '==', driver.id), orderBy('createdAt', 'desc'), limit(50)), [driver.id]);
  const sanctions = useCollection<DriverSanction & { createdByName?: string }>(q);
  const [deciding, setDeciding] = useState<WithId<DriverSanction> | null>(null);
  if (sanctions.loading) return <ListSkeleton rows={2} />;
  if (sanctions.error) return <LoadError error={sanctions.error} />;
  if (sanctions.data.length === 0) return <Card><EmptyState icon={<Gavel />} title="Aucune sanction" description="Ce livreur n’a jamais été sanctionné." /></Card>;
  return (
    <>
      <Card>
        <CardContent>
          <Timeline
            items={sanctions.data.map((s) => ({
              id: s.id,
              title: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {SANCTION_TYPE_LABELS[s.type]}
                  <Badge size="sm" tone={SANCTION_STATUS_META[s.status].tone} variant="outline">{SANCTION_STATUS_META[s.status].label}</Badge>
                  {s.status === 'contested' && can('drivers.sanction') && (
                    <Button size="xs" variant="primary" onClick={() => setDeciding(s)}>Trancher</Button>
                  )}
                </span>
              ),
              description: `${s.reason}${s.contest ? ` — contestation : « ${s.contest.message} »` : ''}`,
              time: toDate(s.createdAt) ? formatDate(toDate(s.createdAt)!) : '',
              tone: s.type === 'warning' ? 'amber' : 'danger',
              icon: <Gavel />,
            }))}
          />
        </CardContent>
      </Card>
      <ContestDialog sanction={deciding} driverName={`${driver.firstName} ${driver.lastName}`} onOpenChange={(o) => !o && setDeciding(null)} />
    </>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  'driver.application_approved': 'Inscription validée',
  'driver.application_rejected': 'Inscription refusée',
  'driver.application_documents_requested': 'Pièces demandées',
  'driver.document_approved': 'Document validé',
  'driver.document_rejected': 'Document refusé',
  'driver.identity_check_requested': 'Selfie demandé',
  'driver.identity_check_passed': 'Identité confirmée',
  'driver.identity_check_failed': 'Contrôle d’identité échoué',
  'driver.sanction_warning': 'Avertissement',
  'driver.sanction_temporary_suspension': 'Suspension temporaire',
  'driver.sanction_deactivation': 'Désactivation',
  'driver.sanction_contest_upheld': 'Contestation rejetée',
  'driver.sanction_contest_overturned': 'Contestation acceptée',
  'driver.bulk_activate': 'Compte réactivé',
  'driver.bulk_deactivate': 'Compte désactivé',
  'driver.bulk_message': 'Message envoyé',
  'driver.bulk_set_cash': 'Espèces modifiées',
  'driver.bulk_set_zones': 'Zones modifiées',
  'driver.blocked_documents_expired': 'Blocage automatique : document expiré',
};

function DriverHistory({ driver }: { driver: WithId<Driver> }) {
  const { admin } = useAdminAccess();
  const geo = useGeoScope();
  const scoped = !geo.global && admin.role !== 'super_admin';
  const q = useMemo(
    () =>
      query(
        collection(db, COLLECTIONS.auditLogs),
        where('target.type', '==', 'driver'),
        where('target.id', '==', driver.id),
        ...(scoped ? [where('cityId', '==', driver.cityId)] : []),
        orderBy('at', 'desc'),
        limit(60),
      ),
    [driver.id, driver.cityId, scoped],
  );
  const logs = useCollection<AuditLog>(q);
  if (logs.loading) return <ListSkeleton rows={3} />;
  if (logs.error) return <LoadError error={logs.error} />;
  if (logs.data.length === 0) return <Card><EmptyState icon={<History />} title="Aucune action enregistrée" description="Les décisions de l’équipe sur ce livreur apparaîtront ici." /></Card>;
  return (
    <Card>
      <CardContent>
        <Timeline
          items={logs.data.map((l) => ({
            id: l.id,
            title: AUDIT_LABELS[l.action] ?? l.action,
            description: [l.actor.name, l.reason ? `« ${l.reason} »` : null].filter(Boolean).join(' · '),
            time: toDate(l.at) ? formatDateTime(toDate(l.at)!) : '',
            tone: l.action.includes('rejected') || l.action.includes('deactiv') || l.action.includes('failed') || l.action.includes('suspension') ? 'danger' : l.action.includes('approved') || l.action.includes('passed') || l.action.includes('activate') ? 'success' : 'neutral',
          }))}
        />
      </CardContent>
    </Card>
  );
}

function InternalNotes({ driver }: { driver: WithId<Driver> }) {
  const { admin } = useAdminAccess();
  const { user } = useAuth();
  const q = useMemo(() => query(collection(db, COLLECTIONS.internalNotes), where('target.type', '==', 'driver'), where('target.id', '==', driver.id), orderBy('createdAt', 'desc'), limit(20)), [driver.id]);
  const notes = useCollection<InternalNote>(q);
  const [body, setBody] = useState('');
  const add = useMutation(
    async () =>
      addDoc(collection(db, COLLECTIONS.internalNotes), {
        target: { type: 'driver', id: driver.id, label: driver.displayName },
        body: body.trim(),
        pinned: false,
        authorId: user?.uid ?? admin.id,
        authorName: admin.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    { success: 'Note ajoutée' },
  );
  return (
    <Card>
      <CardHeader title="Notes internes" description="Visibles uniquement par l’équipe Ciyou Eats." icon={<NotebookPen />} divided />
      <CardContent className="space-y-3">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder="Ajouter une note…" aria-label="Nouvelle note" />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            loading={add.loading}
            disabled={body.trim().length < 2}
            onClick={async () => {
              if (await add.mutate()) setBody('');
            }}
          >
            Ajouter
          </Button>
        </div>
        {notes.error ? (
          <LoadError error={notes.error} compact />
        ) : (
          <ul className="space-y-2">
            {notes.data.map((n) => (
              <li key={n.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="whitespace-pre-line text-sm text-fg">{n.body}</p>
                <p className="mt-1 flex items-center gap-1 text-2xs text-fg-subtle">
                  {n.pinned && <Pin className="size-3" />}
                  {n.authorName} · {toDate(n.createdAt) ? formatRelative(toDate(n.createdAt)!) : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ZonesDialog({ open, onOpenChange, driver }: { open: boolean; onOpenChange: (open: boolean) => void; driver: WithId<Driver> }) {
  const zones = useScopedZones();
  const [selected, setSelected] = useState<string[]>(driver.zoneIds);
  const [reason, setReason] = useState('');
  const action = useMutation(fn.bulkUpdateDrivers, { success: 'Zones mises à jour' });
  return (
    <Dialog open={open} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<MapPin />} title="Zones de livraison" description="Aucune zone : le livreur peut recevoir des courses dans toute la ville." />
        <DialogBody className="space-y-4">
          <FormField label="Zones">
            <Combobox multiple options={zones.data.filter((z) => z.cityId === driver.cityId).map((z) => ({ value: z.id, label: z.name }))} value={selected} onChange={setSelected} placeholder="Toute la ville" />
          </FormField>
          <FormField label="Motif (journal d’audit)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={action.loading}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              if (await action.mutate({ driverIds: [driver.id], action: 'set_zones', zoneIds: selected, reason: reason.trim() })) onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
