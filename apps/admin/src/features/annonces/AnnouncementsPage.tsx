import { useMemo, useState, type ReactElement } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Archive, Bike, CalendarClock, CheckCheck, Info, Megaphone, Pencil, Plus, Store, TriangleAlert, Wrench } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  RadioGroup,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Textarea,
  cn,
  formatDateTime,
} from '@golink/ui';
import { COLLECTIONS, type Announcement, type PlanCode, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toMillis, useCollection, useMutation } from '@/lib/firestore';
import { publishAnnouncement } from '../_croissance/api';
import { useGeoNames, useNow } from '../_croissance/hooks';
import { PLAN_LABELS, SEVERITY_LABELS, SEVERITY_TONES } from '../_croissance/labels';
import { ChipGroup, DateTimeField, LoadError } from '../_croissance/ui';

type Row = WithId<Announcement>;
type Severity = Announcement['severity'];

const SEVERITY_ICONS: Record<Severity, ReactElement> = { info: <Info />, important: <TriangleAlert />, maintenance: <Wrench /> };

/** Bandeau tel qu'il apparaît dans le back-office du restaurant. */
function Banner({ title, body, severity, link, ack }: { title: string; body: string; severity: Severity; link?: string | null; ack?: boolean }) {
  return (
    <div className={cn(`tone-${SEVERITY_TONES[severity]}`, 'flex items-start gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-3.5')}>
      <div className="mt-0.5 text-(--tone-fg) [&_svg]:size-4">{SEVERITY_ICONS[severity]}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title || 'Titre de l’annonce'}</p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{body || 'Le message de l’annonce apparaîtra ici.'}</p>
        {(link || ack) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {link && <span className="text-sm font-medium text-(--tone-fg) underline underline-offset-4">En savoir plus</span>}
            {ack && <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-fg shadow-xs">J’ai pris connaissance</span>}
          </div>
        )}
      </div>
    </div>
  );
}

interface Draft {
  audience: 'restaurants' | 'drivers';
  severity: Severity;
  title: string;
  body: string;
  link: string;
  countryIds: string[];
  cityIds: string[];
  planCodes: PlanCode[];
  publishAt: number | null;
  expiresAt: number | null;
  requiresAcknowledgement: boolean;
}

function Composer({ announcement, onDone }: { announcement: Row | null; onDone: () => void }) {
  const geo = useGeoScope();
  const { admin } = useAdminAccess();
  const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  const [d, setD] = useState<Draft>(() =>
    announcement
      ? {
          audience: announcement.audience,
          severity: announcement.severity,
          title: announcement.title,
          body: announcement.body,
          link: announcement.link ?? '',
          countryIds: announcement.countryIds ?? [],
          cityIds: announcement.cityIds ?? [],
          planCodes: announcement.planCodes ?? [],
          publishAt: toMillis(announcement.publishedAt),
          expiresAt: toMillis(announcement.expiresAt),
          requiresAcknowledgement: announcement.requiresAcknowledgement,
        }
      : {
          audience: 'restaurants',
          severity: 'info',
          title: '',
          body: '',
          link: '',
          countryIds: [],
          cityIds: cityScoped ? admin.cityIds : [],
          planCodes: [],
          publishAt: null,
          expiresAt: Date.now() + 14 * 86_400_000,
          requiresAcknowledgement: false,
        },
  );
  const [touched, setTouched] = useState(false);
  const { mutate, loading } = useMutation(publishAnnouncement, { success: announcement ? 'Annonce mise à jour' : 'Annonce publiée' });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const errors = {
    title: d.title.trim().length < 3 ? 'Au moins 3 caractères.' : undefined,
    body: d.body.trim().length < 10 ? 'Au moins 10 caractères.' : undefined,
    link: d.link && !(d.link.startsWith('/') || d.link.startsWith('https://')) ? 'Lien interne (/…) ou adresse https://' : undefined,
    expiresAt: d.expiresAt !== null && d.expiresAt <= (d.publishAt ?? Date.now()) ? 'Après la publication.' : undefined,
    cityIds: cityScoped && d.cityIds.length === 0 ? 'Choisissez au moins une de vos villes.' : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  async function submit() {
    setTouched(true);
    if (!valid) return;
    const ok = await mutate({
      action: 'save',
      announcementId: announcement?.id ?? null,
      audience: d.audience,
      countryIds: d.countryIds.length ? d.countryIds : null,
      cityIds: d.cityIds.length ? d.cityIds : null,
      planCodes: d.audience === 'restaurants' && d.planCodes.length ? d.planCodes : null,
      title: d.title.trim(),
      body: d.body.trim(),
      severity: d.severity,
      link: d.link.trim() || null,
      publishAt: d.publishAt,
      expiresAt: d.expiresAt,
      requiresAcknowledgement: d.requiresAcknowledgement,
    });
    if (ok) onDone();
  }

  return (
    <SheetContent className="sm:max-w-xl" aria-describedby={undefined}>
      <SheetHeader title={announcement ? 'Modifier l’annonce' : 'Nouvelle annonce'} description="Affichée en haut du back-office des restaurants ou de l’app livreur." icon={<Megaphone />} />
      <SheetBody className="space-y-5">
        <div>
          <p className="eyebrow mb-2">Aperçu</p>
          <Banner title={d.title} body={d.body} severity={d.severity} link={d.link} ack={d.requiresAcknowledgement} />
        </div>
        <RadioGroup
          variant="cards"
          aria-label="Destinataires"
          className="grid gap-2 sm:grid-cols-2"
          value={d.audience}
          onValueChange={(v) => set('audience', v as Draft['audience'])}
          options={[
            { value: 'restaurants', label: 'Restaurants', description: 'Back-office des commerces' },
            { value: 'drivers', label: 'Livreurs', description: 'App livreur' },
          ]}
        />
        <FormField label="Type">
          <SegmentedControl
            aria-label="Type d’annonce"
            size="sm"
            value={d.severity}
            onValueChange={(v) => set('severity', v as Severity)}
            options={(['info', 'important', 'maintenance'] as const).map((s) => ({ value: s, label: SEVERITY_LABELS[s], icon: SEVERITY_ICONS[s] }))}
          />
        </FormField>
        <FormField label="Titre" required error={e('title')}>
          <Input value={d.title} maxLength={90} onChange={(x) => set('title', x.target.value)} placeholder="Ex. Nouvelle version du back-office" />
        </FormField>
        <FormField label="Message" required error={e('body')} aside={<span className="num font-mono text-2xs text-fg-subtle">{d.body.length} / 600</span>}>
          <Textarea rows={4} maxLength={600} value={d.body} onChange={(x) => set('body', x.target.value)} />
        </FormField>
        <FormField label="Lien « En savoir plus »" hint="Page du back-office (/abonnement…) ou adresse https://" error={e('link')}>
          <Input value={d.link} onChange={(x) => set('link', x.target.value)} placeholder="Facultatif" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Pays" hint="Vide = tous.">
            <Combobox multiple value={d.countryIds} onChange={(v: string[]) => set('countryIds', v)} options={geo.countries.map((c) => ({ value: c.id, label: c.name }))} placeholder="Tous les pays" />
          </FormField>
          <FormField label="Villes" hint={cityScoped ? 'Limitées à votre périmètre.' : 'Vide = toutes.'} error={e('cityIds')}>
            <Combobox
              multiple
              value={d.cityIds}
              onChange={(v: string[]) => set('cityIds', v)}
              options={geo.cities.filter((c) => d.countryIds.length === 0 || d.countryIds.includes(c.countryId)).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Toutes les villes"
            />
          </FormField>
        </div>
        {d.audience === 'restaurants' && (
          <FormField label="Formules" hint="Vide = toutes les formules.">
            <div>
              <ChipGroup<PlanCode> label="Formules" value={d.planCodes} onChange={(v) => set('planCodes', v)} options={(['basic', 'pro', 'premium'] as const).map((p) => ({ value: p, label: PLAN_LABELS[p] }))} />
            </div>
          </FormField>
        )}
        <div className="grid gap-4">
          <FormField label="Publication" hint="Vide = immédiatement.">
            <DateTimeField value={d.publishAt} onChange={(v) => set('publishAt', v)} placeholder="Maintenant" minDate={new Date()} />
          </FormField>
          <FormField label="Fin d’affichage" hint="Vide = jusqu’au retrait manuel." error={e('expiresAt')}>
            <DateTimeField value={d.expiresAt} onChange={(v) => set('expiresAt', v)} placeholder="Sans fin" minDate={new Date()} />
          </FormField>
        </div>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-fg">Demander une prise de connaissance</span>
            <span className="block text-sm text-fg-muted">L’annonce reste affichée jusqu’à ce que le restaurant confirme l’avoir lue.</span>
          </span>
          <Switch checked={d.requiresAcknowledgement} onCheckedChange={(v) => set('requiresAcknowledgement', v)} aria-label="Prise de connaissance obligatoire" />
        </label>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button variant="primary" loading={loading} onClick={() => void submit()}>
          {announcement ? 'Enregistrer' : d.publishAt && d.publishAt > Date.now() ? 'Programmer' : 'Publier'}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

type Tab = 'live' | 'scheduled' | 'past';

export function AnnouncementsPage() {
  useDocumentTitle('Annonces · Ciyou Eats Admin');
  const geo = useGeoScope();
  const names = useGeoNames();
  const now = useNow();
  const q = useMemo(() => query(collection(db, COLLECTIONS.announcements), orderBy('publishedAt', 'desc'), limit(200)), []);
  const { data, loading, error } = useCollection<Announcement>(q);
  const [tab, setTab] = useState<Tab>('live');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Row | null>(null);
  const archive = useMutation(publishAnnouncement, { success: 'Annonce retirée' });

  const scoped = useMemo(
    () =>
      data.filter((a) => {
        if (geo.cityIds && a.cityIds?.length) return a.cityIds.some((c) => geo.cityIds?.includes(c));
        if (geo.countryId && a.countryIds?.length) return a.countryIds.includes(geo.countryId);
        return true;
      }),
    [data, geo.cityIds, geo.countryId],
  );
  const state = (a: Row): Tab => {
    const start = toMillis(a.publishedAt) ?? 0;
    const end = toMillis(a.expiresAt);
    if (!a.active || (end !== null && end <= now)) return 'past';
    return start > now ? 'scheduled' : 'live';
  };
  const groups = { live: scoped.filter((a) => state(a) === 'live'), scheduled: scoped.filter((a) => state(a) === 'scheduled'), past: scoped.filter((a) => state(a) === 'past') };
  const rows = groups[tab];

  const target = (a: Row) => {
    const parts: string[] = [];
    parts.push(a.cityIds?.length ? a.cityIds.map((c) => names.city(c)).join(', ') : a.countryIds?.length ? a.countryIds.map((c) => names.country(c)).join(', ') : 'Tous les marchés');
    if (a.planCodes?.length) parts.push(a.planCodes.map((p) => PLAN_LABELS[p]).join(', '));
    return parts.join(' · ');
  };

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Croissance · ${geo.label}`}
        title="Annonces"
        description="Messages affichés dans le back-office des restaurants ou l’app livreur : nouveauté, maintenance, changement de conditions."
        actions={
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
            Nouvelle annonce
          </Button>
        }
      />
      <div data-scroll-ok className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <SegmentedControl
          aria-label="Annonces"
          size="sm"
          className="min-w-max"
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'live', label: 'En ligne', count: groups.live.length },
            { value: 'scheduled', label: 'Programmées', count: groups.scheduled.length },
            { value: 'past', label: 'Terminées' },
          ]}
        />
      </div>
      {error ? (
        <Card>
          <LoadError error={error} />
        </Card>
      ) : loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone />}
            title={tab === 'live' ? 'Aucune annonce en ligne' : tab === 'scheduled' ? 'Aucune annonce programmée' : 'Aucune annonce terminée'}
            description="Prévenez les restaurants d’une maintenance, d’une nouveauté ou d’un changement de conditions."
            action={
              tab !== 'past' ? (
                <Button size="sm" variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
                  Nouvelle annonce
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => (
            <Card key={a.id} className="flex min-w-0 flex-col">
              <div className="p-4">
                <Banner title={a.title} body={a.body} severity={a.severity} link={a.link} ack={a.requiresAcknowledgement} />
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div className="min-w-0 space-y-1 text-xs text-fg-muted">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <Badge size="sm" tone={a.audience === 'restaurants' ? 'teal' : 'plum'} icon={a.audience === 'restaurants' ? <Store /> : <Bike />}>
                      {a.audience === 'restaurants' ? 'Restaurants' : 'Livreurs'}
                    </Badge>
                    <span className="truncate">{target(a)}</span>
                    {a.requiresAcknowledgement && (
                      <Badge size="sm" icon={<CheckCheck />}>
                        Lecture confirmée
                      </Badge>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" />
                    {formatDateTime(toMillis(a.publishedAt) ?? 0)}
                    {toMillis(a.expiresAt) ? ` → ${formatDateTime(toMillis(a.expiresAt) ?? 0)}` : ' · sans fin'}
                  </p>
                </div>
                {tab !== 'past' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(a)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" leftIcon={<Archive />} onClick={() => setArchiving(a)}>
                      Retirer
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <Composer key={editing === 'new' ? 'new' : editing.id} announcement={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      {archiving && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setArchiving(null)}
          title="Retirer l’annonce ?"
          description={`« ${archiving.title} » ne sera plus affichée.`}
          confirmLabel="Retirer"
          destructive
          requireReason
          onConfirm={async (reason) => {
            await archive.mutate({ action: 'archive', announcementId: archiving.id, reason: reason ?? '' });
            setArchiving(null);
          }}
        />
      )}
    </PageContainer>
  );
}
