import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, ChevronDown, ChevronRight, Clock, Headphones, Inbox, LifeBuoy, Mail, MessageSquareDot, Phone, Plus, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusBadge,
  cn,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import { SETTINGS_DOCS, paths, type GeneralSettings, type SupportSettings } from '@golink/shared';
import { docAt, errorMessage, toDate, toMillis, useDoc } from '@/lib/firestore';
import { NewTicketDialog } from './NewTicketDialog';
import { PRIORITY_TONE, TICKET_PRIORITY_LABELS, TICKET_STATUS, useHelpArticles, useRestaurantTickets, useTicketReasons } from './lib';

type Filter = 'active' | 'all' | 'closed';

export function SupportPage() {
  const navigate = useNavigate();
  const tickets = useRestaurantTickets();
  const reasons = useTicketReasons();
  const general = useDoc<GeneralSettings>(docAt(paths.settings(SETTINGS_DOCS.general)));
  const sla = useDoc<SupportSettings>(docAt(paths.settings(SETTINGS_DOCS.support)));
  const firstResponse = sla.data?.firstResponseTargetMinutes?.normal;
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);

  const stats = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      open: tickets.data.filter((t) => !['resolved', 'closed'].includes(t.status)).length,
      waiting: tickets.data.filter((t) => t.status === 'waiting_customer' || t.unreadByRequester > 0).length,
      resolved: tickets.data.filter((t) => ['resolved', 'closed'].includes(t.status) && (toMillis(t.resolvedAt ?? t.closedAt) ?? 0) >= monthAgo).length,
    };
  }, [tickets.data]);

  const list = useMemo(
    () =>
      tickets.data.filter((t) =>
        filter === 'all' ? true : filter === 'closed' ? ['resolved', 'closed'].includes(t.status) : !['resolved', 'closed'].includes(t.status),
      ),
    [tickets.data, filter],
  );
  const reasonLabel = (id: string) => reasons.data.find((r) => r.id === id)?.label.fr ?? 'Demande';

  const create = (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
      Nouvelle demande
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Messagerie"
        title="Support Ciyou Eats"
        description="Une question sur un reversement, une commande ou votre compte ? Notre équipe vous répond ici, avec un suivi de chaque demande."
        actions={create}
      />

      {sla.data?.merchantNotice?.enabled && (
        <div className="tone-info mb-6 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
          <p className="font-medium">{sla.data.merchantNotice.title.fr}</p>
          <p className="mt-0.5">{sla.data.merchantNotice.body.fr}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Demandes en cours"
          value={formatNumber(stats.open)}
          icon={<Inbox />}
          loading={tickets.loading}
          footer={stats.open > 0 ? 'Suivies par l’équipe Ciyou Eats, 7 j/7.' : 'Aucune demande ouverte.'}
        />
        <StatCard
          label="Réponses à lire"
          value={formatNumber(stats.waiting)}
          icon={<MessageSquareDot />}
          tone={stats.waiting > 0 ? 'amber' : 'teal'}
          loading={tickets.loading}
          footer={stats.waiting > 0 ? 'Nouvelles réponses ou question du support.' : 'Vous êtes à jour.'}
        />
        <StatCard
          label="Résolues sur 30 jours"
          value={formatNumber(stats.resolved)}
          icon={<LifeBuoy />}
          tone="success"
          loading={tickets.loading}
          footer="Demandes résolues ou clôturées."
        />
        <Card className="flex flex-col justify-between gap-3 bg-sidebar p-5 text-sidebar-fg">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Headphones className="size-4 text-primary" /> Contacter Ciyou Eats
          </p>
          {general.loading ? (
            <Skeleton className="h-10 bg-white/10" />
          ) : (
            <div className="space-y-1.5 text-sm">
              {general.data?.supportPhone && (
                <a href={`tel:${general.data.supportPhone.replace(/\s/g, '')}`} className="flex items-center gap-2 text-sidebar-fg hover:underline">
                  <Phone className="size-3.5 text-sidebar-muted" /> {general.data.supportPhone}
                </a>
              )}
              {general.data?.supportEmail && (
                <a href={`mailto:${general.data.supportEmail}`} className="flex items-center gap-2 text-sidebar-fg hover:underline">
                  <Mail className="size-3.5 text-sidebar-muted" /> {general.data.supportEmail}
                </a>
              )}
              {firstResponse ? (
                <p className="flex items-center gap-2 text-xs text-sidebar-muted">
                  <Clock className="size-3.5" /> Première réponse visée : {firstResponse >= 60 ? `${Math.round(firstResponse / 60)} h` : `${firstResponse} min`}
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader
            title="Vos demandes"
            icon={<LifeBuoy />}
            actions={
              <SegmentedControl
                size="sm"
                aria-label="Filtrer les demandes"
                value={filter}
                onValueChange={(v) => setFilter(v as Filter)}
                options={[
                  { value: 'active', label: 'En cours' },
                  { value: 'closed', label: 'Terminées' },
                  { value: 'all', label: 'Toutes' },
                ]}
              />
            }
            divided
          />
          {tickets.error ? (
            <EmptyState compact title="Demandes indisponibles" description={errorMessage(tickets.error)} />
          ) : tickets.loading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title={tickets.data.length === 0 ? 'Aucune demande pour le moment' : 'Aucune demande dans cette vue'}
              description={tickets.data.length === 0 ? 'Consultez le centre d’aide ou écrivez-nous : nous répondons en général en moins d’une heure.' : 'Changez de filtre pour voir les autres demandes.'}
              action={tickets.data.length === 0 ? create : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => navigate(`/support/${t.id}`)} className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-fg-subtle">{t.number}</span>
                        <StatusBadge status={t.status} map={TICKET_STATUS} />
                        {t.priority !== 'normal' && (
                          <Badge size="sm" tone={PRIORITY_TONE[t.priority]}>
                            Priorité {TICKET_PRIORITY_LABELS[t.priority].toLowerCase()}
                          </Badge>
                        )}
                      </div>
                      <p className={cn('mt-1 truncate text-sm', t.unreadByRequester > 0 ? 'font-semibold text-fg' : 'font-medium text-fg')}>{t.subject}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-fg-muted">
                        {reasonLabel(t.reasonId)} · {t.lastMessagePreview}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="whitespace-nowrap text-2xs text-fg-subtle">{formatRelative(toDate(t.lastMessageAt) ?? new Date())}</span>
                      {t.unreadByRequester > 0 ? (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 font-mono text-2xs font-semibold text-primary-fg">{t.unreadByRequester}</span>
                      ) : (
                        <ChevronRight className="size-4 text-fg-subtle" />
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <HelpCenter />
      </div>

      <NewTicketDialog open={creating} onOpenChange={setCreating} onCreated={(id) => navigate(`/support/${id}`)} />
    </PageContainer>
  );
}

function HelpCenter() {
  const articles = useHelpArticles();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(articles.data.map((a) => a.category))], [articles.data]);
  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return articles.data.filter((a) => (!category || a.category === category) && (!needle || `${a.title.fr} ${a.body.fr} ${a.tags.join(' ')}`.toLowerCase().includes(needle)));
  }, [articles.data, search, category]);

  return (
    <Card className="min-w-0 self-start">
      <CardHeader title="Centre d’aide" icon={<BookOpen />} description="Les réponses aux questions les plus fréquentes des restaurants." />
      <CardContent className="space-y-3">
        <Input leading={<Search />} placeholder="Rechercher un article…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans le centre d’aide" />
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
                className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', category === c ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:border-border-strong')}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {articles.loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)
        ) : articles.error ? (
          <p className="text-sm text-danger-soft-fg">{errorMessage(articles.error)}</p>
        ) : list.length === 0 ? (
          <EmptyState compact icon={<BookOpen />} title="Aucun article trouvé" description="Posez votre question au support : nous enrichissons l’aide avec vos demandes." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.map((a) => {
              const open = openId === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : a.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-fg">{a.title.fr}</span>
                      <span className="text-2xs text-fg-subtle">{a.category}</span>
                    </span>
                    <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && <p className="whitespace-pre-line px-3.5 pb-4 text-sm leading-6 text-fg-muted">{a.body.fr}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
