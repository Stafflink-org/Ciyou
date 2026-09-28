import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { CalendarClock, Mail, Plus, Send, Smartphone, Store } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  SegmentedControl,
  StatCard,
  StatusPill,
  createColumnHelper,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { CAMPAIGN_STATUS_LABELS, COLLECTIONS, type Campaign, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';
import { useGeoNames, useNow, useRestaurantOptions } from '../_croissance/hooks';
import { CAMPAIGN_STATUS_TONES, CHANNEL_SHORT, USER_TYPE_LABELS } from '../_croissance/labels';
import { LoadError } from '../_croissance/ui';
import { CommunicationLayout } from './layout';
import { CHANNEL_ICONS, audienceSummary } from './shared';

type Row = WithId<Campaign>;
const col = createColumnHelper<Row>();

export function CampaignsPage() {
  useDocumentTitle('Notifications et envois · GoLink Admin');
  const navigate = useNavigate();
  const geo = useGeoScope();
  const names = useGeoNames();
  const now = useNow();
  const restaurants = useRestaurantOptions();
  const [scope, setScope] = useState<'platform' | 'restaurant'>('platform');
  const q = useMemo(() => query(collection(db, COLLECTIONS.campaigns), where('scope', '==', scope), orderBy('createdAt', 'desc'), limit(300)), [scope]);
  const { data, loading, error } = useCollection<Campaign>(q);

  const rows = useMemo(
    () =>
      data.filter((c) => {
        if (scope === 'restaurant') {
          const r = c.restaurantId ? restaurants.byId.get(c.restaurantId) : null;
          if (geo.cityIds) return Boolean(r && geo.cityIds.includes(r.cityId));
          if (geo.countryId) return Boolean(r && r.countryId === geo.countryId);
          return true;
        }
        const a = c.audience;
        if (geo.cityIds) return !a.cityIds?.length ? !a.countryIds?.length || a.countryIds.some((id) => geo.cities.some((city) => geo.cityIds?.includes(city.id) && city.countryId === id)) : a.cityIds.some((id) => geo.cityIds?.includes(id));
        if (geo.countryId) return !a.countryIds?.length || a.countryIds.includes(geo.countryId);
        return true;
      }),
    [data, scope, geo.cityIds, geo.countryId, geo.cities, restaurants.byId],
  );

  const kpis = useMemo(() => {
    const since = now - 30 * 86_400_000;
    let sent = 0;
    let delivered = 0;
    let recipients = 0;
    let scheduled = 0;
    for (const c of rows) {
      if (c.status === 'scheduled') scheduled += 1;
      const at = toMillis(c.sentAt);
      if (c.status === 'sent' && at && at >= since) {
        sent += 1;
        recipients += c.stats?.sent ?? 0;
        delivered += c.stats?.delivered ?? 0;
      }
    }
    return { sent, delivered, recipients, scheduled };
  }, [rows, now]);

  const restaurantName = (id: string) => restaurants.byId.get(id)?.name ?? 'Restaurant';

  const columns = useMemo(
    () => [
      col.accessor((c) => `${c.name} ${c.title}`, {
        id: 'envoi',
        header: 'Envoi',
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex min-w-[15rem] max-w-[24rem] items-start gap-3">
              <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-4">{CHANNEL_ICONS[c.channel]}</div>
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{c.name}</p>
                <p className="truncate text-xs text-fg-muted">{c.title}</p>
              </div>
            </div>
          );
        },
      }),
      col.accessor((c) => CHANNEL_SHORT[c.channel], { id: 'canal', header: 'Canal', cell: ({ getValue }) => <Badge>{getValue()}</Badge> }),
      col.accessor((c) => (scope === 'restaurant' ? restaurantName(c.restaurantId ?? '') : audienceSummary(c, names, restaurantName)), {
        id: 'cible',
        header: scope === 'restaurant' ? 'Restaurant' : 'Cible',
        cell: ({ row, getValue }) => (
          <div className="min-w-[12rem] max-w-[20rem]">
            <p className="truncate text-sm text-fg">{getValue()}</p>
            <p className="text-xs text-fg-muted">{row.original.audience.marketing ? 'Promotionnel · consentement exigé' : 'Information de service'}</p>
          </div>
        ),
      }),
      col.accessor((c) => c.stats?.targeted ?? 0, {
        id: 'destinataires',
        header: 'Destinataires',
        meta: { align: 'right' },
        cell: ({ row, getValue }) => (
          <div className="whitespace-nowrap text-right">
            <p className="num font-mono text-sm">{formatNumber(getValue())}</p>
            {row.original.status === 'sent' && <p className="num text-2xs text-fg-muted">{formatNumber(row.original.stats?.delivered ?? 0)} délivrés</p>}
          </div>
        ),
      }),
      col.accessor((c) => toMillis(c.sentAt ?? c.scheduledAt ?? c.createdAt) ?? 0, {
        id: 'date',
        header: 'Date',
        cell: ({ row, getValue }) => (
          <div className="whitespace-nowrap text-sm">
            <p className="text-fg">{getValue() ? formatDateTime(getValue()) : '—'}</p>
            <p className="text-xs text-fg-muted">
              {row.original.status === 'scheduled' ? `Départ ${formatRelative(getValue(), now)}` : row.original.status === 'sent' ? 'Envoyé' : row.original.status === 'draft' ? 'Brouillon créé' : ''}
            </p>
          </div>
        ),
      }),
      col.accessor((c) => CAMPAIGN_STATUS_LABELS[c.status], {
        id: 'statut',
        header: 'Statut',
        cell: ({ row, getValue }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={CAMPAIGN_STATUS_TONES[row.original.status]} pulse={row.original.status === 'sending'}>
              {getValue()}
            </StatusPill>
            {row.original.testMode && row.original.status === 'sent' && (
              <Badge tone="neutral" size="sm">
                Mode test
              </Badge>
            )}
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, names, restaurants.byId, now],
  );

  return (
    <CommunicationLayout
      actions={
        <Button asChild variant="primary" leftIcon={<Plus />}>
          <Link to="/communication/nouveau">Nouvel envoi</Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Envois sur 30 jours" value={formatNumber(kpis.sent)} icon={<Send />} tone="brand" loading={loading} />
        <StatCard label="Messages envoyés" value={formatNumber(kpis.recipients)} icon={<Mail />} tone="info" loading={loading} footer="Sur 30 jours" />
        <StatCard
          label="Taux de remise"
          value={kpis.recipients ? `${Math.round((kpis.delivered / kpis.recipients) * 100)} %` : '—'}
          icon={<Smartphone />}
          tone="success"
          loading={loading}
          footer="Messages délivrés / envoyés"
        />
        <StatCard label="Envois programmés" value={formatNumber(kpis.scheduled)} icon={<CalendarClock />} tone="amber" loading={loading} />
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            aria-label="Origine des envois"
            size="sm"
            value={scope}
            onValueChange={(v) => setScope(v as typeof scope)}
            options={[
              { value: 'platform', label: 'Envois GoLink', icon: <Send /> },
              { value: 'restaurant', label: 'Campagnes des restaurants', icon: <Store /> },
            ]}
          />
          {scope === 'restaurant' && <p className="text-sm text-fg-muted">Lecture seule : campagnes créées par les restaurants pour leurs clients.</p>}
        </div>
        {error ? (
          <Card>
            <LoadError error={error} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(c) => c.id}
            loading={loading}
            searchable
            searchPlaceholder="Rechercher un envoi…"
            itemLabel="envois"
            onRowClick={(c) => void navigate(`/communication/${c.id}`)}
            filters={[
              { id: 'status', label: 'Statut', options: Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (c) => c.status },
              { id: 'channel', label: 'Canal', options: Object.entries(CHANNEL_SHORT).map(([value, label]) => ({ value, label })), getValue: (c) => c.channel },
              ...(scope === 'platform'
                ? [{ id: 'userType', label: 'Destinataires', options: Object.entries(USER_TYPE_LABELS).map(([value, label]) => ({ value, label })), getValue: (c: Row) => c.audience.userType }]
                : []),
            ]}
            emptyState={
              <EmptyState
                compact
                icon={<Send />}
                title={scope === 'platform' ? 'Aucun envoi' : 'Aucune campagne de restaurant'}
                description={scope === 'platform' ? 'Informez vos clients, restaurants ou livreurs par push, e-mail ou SMS.' : 'Les campagnes envoyées par les restaurants apparaîtront ici.'}
                action={
                  scope === 'platform' ? (
                    <Button asChild size="sm" variant="primary" leftIcon={<Plus />}>
                      <Link to="/communication/nouveau">Nouvel envoi</Link>
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </div>
    </CommunicationLayout>
  );
}
