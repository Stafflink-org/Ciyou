import { useMemo, useState } from 'react';
import { CalendarClock, Copy, Eye, FlaskConical, MailOpen, Megaphone, MousePointerClick, PencilLine, Plus, Send, ShieldCheck, Users, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  ProgressBar,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@golink/ui';
// Dates des campagnes affichées à l'heure de Paris, comme leur programmation.
import { RESTAURANT_CAMPAIGN_SEGMENT_LABELS, formatDateTime, type RestaurantCampaignSegment } from '@golink/shared';
import { errorMessage, toDate, toMillis, useMutation } from '@/lib/firestore';
import { CampaignComposer, ChannelTag } from './CampaignComposer';
import { CAMPAIGN_STATUS, campaignDate, cancelCampaign, rate, useRestaurantCampaigns, type CampaignRow } from './lib';

const column = createColumnHelper<CampaignRow>();
const DAY = 86_400_000;

function segmentLabel(c: CampaignRow): string {
  const segment = (c.audience.segment ?? 'all') as RestaurantCampaignSegment;
  const label = RESTAURANT_CAMPAIGN_SEGMENT_LABELS[segment] ?? 'Tous mes clients';
  return segment === 'inactive' && c.audience.inactiveDays ? `${label} (${c.audience.inactiveDays} j)` : label;
}

export function CampaignsPage() {
  const { data, loading, error } = useRestaurantCampaigns();
  const [composer, setComposer] = useState<{ campaign: CampaignRow | null; duplicate: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.find((c) => c.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const since = Date.now() - 30 * DAY;
    const sent = data.filter((c) => c.status === 'sent' && (toMillis(c.sentAt) ?? 0) >= since);
    const delivered = sent.reduce((s, c) => s + c.stats.delivered, 0);
    const opened = sent.reduce((s, c) => s + c.stats.opened, 0);
    const clicked = sent.reduce((s, c) => s + c.stats.clicked, 0);
    const next = data
      .filter((c) => c.status === 'scheduled')
      .sort((a, b) => (toMillis(a.scheduledAt) ?? 0) - (toMillis(b.scheduledAt) ?? 0))[0];
    return { sentCount: sent.length, reached: sent.reduce((s, c) => s + c.stats.sent, 0), openRate: rate(opened, delivered), clickRate: rate(clicked, delivered), next };
  }, [data]);

  const columns = useMemo(
    () => [
      column.accessor((c) => `${c.name} ${c.title}`, {
        id: 'campagne',
        header: 'Campagne',
        cell: ({ row: { original: c } }) => (
          <div className="min-w-52 max-w-sm">
            <p className="truncate font-medium text-fg">{c.name}</p>
            <p className="truncate text-xs text-fg-muted">{c.title}</p>
          </div>
        ),
      }),
      column.accessor('channel', { header: 'Canal', cell: ({ getValue }) => <ChannelTag channel={getValue()} /> }),
      column.accessor((c) => segmentLabel(c), { id: 'audience', header: 'Audience', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue()}</span> }),
      column.accessor((c) => toMillis(campaignDate(c).value) ?? 0, {
        id: 'date',
        header: 'Date',
        cell: ({ row: { original: c } }) => {
          const { value, label } = campaignDate(c);
          const d = toDate(value);
          return (
            <div className="whitespace-nowrap">
              <p className="text-2xs text-fg-subtle">{label}</p>
              <p className="text-sm text-fg">{d ? formatDateTime(d) : '—'}</p>
            </div>
          );
        },
      }),
      column.accessor((c) => c.stats.sent, {
        id: 'resultats',
        header: 'Résultats',
        meta: { align: 'right' },
        cell: ({ row: { original: c } }) =>
          c.status === 'sent' ? (
            <div className="text-right font-mono text-xs num">
              <p className="text-sm text-fg">{formatNumber(c.stats.sent)} envoyés</p>
              <p className="text-fg-subtle">{c.stats.delivered > 0 ? `${formatPercent(c.stats.opened / c.stats.delivered)} d’ouverture` : '—'}</p>
            </div>
          ) : (
            <p className="text-right font-mono text-xs text-fg-subtle num">{formatNumber(c.stats.targeted)} ciblés</p>
          ),
      }),
      column.accessor('status', { header: 'Statut', cell: ({ getValue }) => <StatusBadge status={getValue()} map={CAMPAIGN_STATUS} /> }),
    ],
    [],
  );

  const createButton = (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setComposer({ campaign: null, duplicate: false })}>
      Nouvelle campagne
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Campagnes"
        description="Parlez à vos clients au bon moment : une notification ou un e-mail, envoyé tout de suite ou programmé."
        breadcrumbs={[{ label: 'Marketing', href: '/marketing' }, { label: 'Campagnes' }]}
        actions={createButton}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Campagnes envoyées" value={formatNumber(stats.sentCount)} icon={<Send />} loading={loading} footer="Sur les 30 derniers jours." />
        <StatCard label="Clients touchés" value={formatNumber(stats.reached)} icon={<Users />} tone="info" loading={loading} footer="Messages envoyés sur 30 jours." />
        <StatCard
          label="Taux d’ouverture"
          value={stats.openRate === null ? '—' : formatPercent(stats.openRate)}
          icon={<MailOpen />}
          tone="success"
          loading={loading}
          footer={stats.clickRate === null ? 'Calculé après les premiers envois.' : `${formatPercent(stats.clickRate)} de clics vers votre fiche.`}
        />
        <StatCard
          label="Prochain envoi"
          value={stats.next ? formatRelative(toDate(stats.next.scheduledAt) ?? new Date()) : 'Aucun'}
          icon={<CalendarClock />}
          tone="teal"
          loading={loading}
          footer={stats.next ? stats.next.name : 'Programmez une campagne à l’avance.'}
        />
      </div>

      <Card className="mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="tone-teal grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg)">
          <ShieldCheck className="size-4" />
        </span>
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">Consentement respecté :</span> vos campagnes ne partent qu’aux clients ayant accepté les offres par notification ou
          par e-mail. Chaque envoi est tracé, et vos clients peuvent se désabonner à tout moment depuis leur compte Ciyou Eats.
        </p>
      </Card>

      <div className="mt-6">
        {error ? (
          <Card>
            <EmptyState icon={<Megaphone />} title="Impossible de charger vos campagnes" description={errorMessage(error)} />
          </Card>
        ) : (
          <DataTable
            data={data}
            columns={columns}
            loading={loading}
            getRowId={(c) => c.id}
            onRowClick={(c) => setSelectedId(c.id)}
            searchPlaceholder="Rechercher une campagne…"
            itemLabel="campagnes"
            filters={[
              {
                id: 'statut',
                label: 'Statut',
                options: Object.entries(CAMPAIGN_STATUS).map(([value, meta]) => ({ value, label: meta.label })),
                getValue: (c) => c.status,
              },
              { id: 'canal', label: 'Canal', options: [{ value: 'push', label: 'Notification' }, { value: 'email', label: 'E-mail' }], getValue: (c) => c.channel },
            ]}
            emptyState={
              <EmptyState
                icon={<Megaphone />}
                title="Aucune campagne pour le moment"
                description="Annoncez un nouveau plat, relancez vos clients inactifs ou mettez en avant votre offre du moment."
                action={createButton}
              />
            }
          />
        )}
      </div>

      <CampaignSheet
        campaign={selected}
        onClose={() => setSelectedId(null)}
        onEdit={(c) => {
          setSelectedId(null);
          setComposer({ campaign: c, duplicate: false });
        }}
        onDuplicate={(c) => {
          setSelectedId(null);
          setComposer({ campaign: c, duplicate: true });
        }}
      />
      <CampaignComposer
        open={composer !== null}
        onOpenChange={(open) => !open && setComposer(null)}
        campaign={composer?.campaign ?? null}
        duplicate={composer?.duplicate}
      />
    </PageContainer>
  );
}

function Metric({ icon, label, value, ratio, tone }: { icon: React.ReactNode; label: string; value: number; ratio: number | null; tone: 'brand' | 'info' | 'success' | 'teal' }) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-fg-muted [&_svg]:size-4">
          {icon}
          {label}
        </span>
        <span className="font-mono font-medium text-fg num">
          {formatNumber(value)}
          {ratio !== null && <span className="ml-1.5 text-xs text-fg-subtle">{formatPercent(ratio)}</span>}
        </span>
      </div>
      {ratio !== null && <ProgressBar value={ratio * 100} tone={tone} size="sm" />}
    </div>
  );
}

function CampaignSheet({
  campaign: c,
  onClose,
  onEdit,
  onDuplicate,
}: {
  campaign: CampaignRow | null;
  onClose: () => void;
  onEdit: (c: CampaignRow) => void;
  onDuplicate: (c: CampaignRow) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const cancel = useMutation(cancelCampaign, { success: 'Campagne annulée.' });
  const editable = c && (c.status === 'draft' || c.status === 'scheduled');
  return (
    <Sheet open={c !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg">
        {c && (
          <>
            <SheetHeader icon={<Megaphone />} title={c.name} description={`${c.channel === 'email' ? 'E-mail' : 'Notification'} · ${segmentLabel(c)}`} />
            <SheetBody className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={c.status} map={CAMPAIGN_STATUS} />
                {c.testMode && (
                  <Badge tone="amber" icon={<FlaskConical />}>
                    Mode test : e-mails non transmis
                  </Badge>
                )}
                <span className="text-sm text-fg-muted">
                  {campaignDate(c).label} {toDate(campaignDate(c).value) ? formatDateTime(toDate(campaignDate(c).value)!) : ''}
                </span>
              </div>

              <div className="rounded-2xl border border-border bg-surface-2 p-4">
                <p className="eyebrow mb-2">Message</p>
                {c.emailSubject && <p className="mb-1 text-xs text-fg-muted">Objet : {c.emailSubject}</p>}
                <p className="font-display text-md font-semibold tracking-tight text-fg">{c.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{c.body}</p>
              </div>

              <div className="space-y-2.5">
                <p className="eyebrow">Résultats</p>
                {c.status === 'sent' ? (
                  <>
                    <Metric icon={<Users />} label="Clients ciblés" value={c.stats.targeted} ratio={null} tone="brand" />
                    <Metric icon={<Send />} label="Envoyés" value={c.stats.sent} ratio={rate(c.stats.sent, c.stats.targeted)} tone="brand" />
                    <Metric icon={<Eye />} label="Reçus" value={c.stats.delivered} ratio={rate(c.stats.delivered, c.stats.sent)} tone="teal" />
                    <Metric icon={<MailOpen />} label="Ouverts" value={c.stats.opened} ratio={rate(c.stats.opened, c.stats.delivered)} tone="info" />
                    <Metric icon={<MousePointerClick />} label="Clics" value={c.stats.clicked} ratio={rate(c.stats.clicked, c.stats.delivered)} tone="success" />
                    {c.stats.failed > 0 && <p className="text-xs text-danger-soft-fg">{formatNumber(c.stats.failed)} envoi(s) en échec.</p>}
                  </>
                ) : c.status === 'failed' ? (
                  <p className="text-sm text-danger-soft-fg">{c.failureReason ?? 'L’envoi a échoué.'}</p>
                ) : (
                  <p className="text-sm text-fg-muted">
                    {formatNumber(c.stats.targeted)} client{c.stats.targeted > 1 ? 's' : ''} joignable{c.stats.targeted > 1 ? 's' : ''} lors du dernier enregistrement. Les
                    statistiques s’afficheront après l’envoi.
                  </p>
                )}
              </div>
            </SheetBody>
            <SheetFooter>
              {editable && (
                <Button variant="danger-soft" leftIcon={<XCircle />} onClick={() => setConfirm(true)}>
                  {c.status === 'scheduled' ? 'Annuler l’envoi' : 'Abandonner'}
                </Button>
              )}
              <Button variant="secondary" leftIcon={<Copy />} onClick={() => onDuplicate(c)}>
                Dupliquer
              </Button>
              {editable && (
                <Button variant="primary" leftIcon={<PencilLine />} onClick={() => onEdit(c)}>
                  Modifier
                </Button>
              )}
            </SheetFooter>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              destructive
              title={c.status === 'scheduled' ? 'Annuler l’envoi programmé ?' : 'Abandonner ce brouillon ?'}
              description="La campagne restera visible dans l’historique avec le statut « Annulée »."
              confirmLabel="Confirmer"
              cancelLabel="Retour"
              onConfirm={async () => {
                const done = await cancel.mutate({ campaignId: c.id });
                if (done) onClose();
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
