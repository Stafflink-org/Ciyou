import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, BellRing, CalendarClock, CheckCircle2, Copy, FlaskConical, Mail, Megaphone, Send, ShieldCheck, Store, Users, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  StatusPill,
  Textarea,
  cn,
  formatDateTime,
  formatNumber,
  toast,
} from '@golink/ui';
import { CAMPAIGN_STATUS_LABELS, COLLECTIONS, type Campaign, type CampaignChannel, type NotificationLog, type PlanCode } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { docAt, errorMessage, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { estimatePlatformAudience, savePlatformCampaign, type AudienceInput, type CampaignInput } from '../_croissance/api';
import { useGeoNames, useRestaurantOptions } from '../_croissance/hooks';
import { CAMPAIGN_STATUS_TONES, CHANNEL_SHORT, PLAN_LABELS, SEGMENT_LABELS, USER_TYPE_LABELS } from '../_croissance/labels';
import { ChipGroup, DateTimeField, InfoRow, LoadError, NumberInput } from '../_croissance/ui';
import { CHANNEL_ICONS, audienceSummary } from './shared';

const LIMITS: Record<CampaignChannel, number> = { push: 240, sms: 320, email: 1000, in_app: 1000 };

interface Draft {
  name: string;
  channel: CampaignChannel;
  title: string;
  body: string;
  emailSubject: string;
  linkType: 'none' | 'restaurant' | 'promotion' | 'page' | 'url';
  linkTarget: string;
  audience: AudienceInput;
  when: 'now' | 'later';
  scheduledAt: number | null;
}

function emptyDraft(cityIds: string[] | null): Draft {
  const later = new Date(Date.now() + 86_400_000);
  later.setHours(11, 0, 0, 0);
  return {
    name: '',
    channel: 'push',
    title: '',
    body: '',
    emailSubject: '',
    linkType: 'none',
    linkTarget: '',
    audience: { userType: 'client', countryIds: null, cityIds, planCodes: null, restaurantIds: null, segment: 'all', inactiveDays: 30, marketing: true },
    when: 'later',
    scheduledAt: later.getTime(),
  };
}

function fromCampaign(c: Campaign): Draft {
  const a = c.audience;
  return {
    name: c.name,
    channel: c.channel,
    title: c.title,
    body: c.body,
    emailSubject: c.emailSubject ?? '',
    linkType: c.link?.type ?? 'none',
    linkTarget: c.link?.target ?? '',
    audience: {
      userType: a.userType,
      countryIds: a.countryIds ?? null,
      cityIds: a.cityIds ?? null,
      planCodes: a.planCodes ?? null,
      restaurantIds: a.restaurantIds ?? null,
      segment: a.segment === 'custom' || !a.segment ? 'all' : a.segment,
      inactiveDays: a.inactiveDays ?? 30,
      marketing: a.marketing,
    },
    when: c.status === 'scheduled' ? 'later' : 'now',
    scheduledAt: toMillis(c.scheduledAt),
  };
}

function Block({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs font-medium text-fg">{step}</span>
        <div>
          <h3 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </Card>
  );
}

/** Aperçu du message tel qu'il sera reçu. */
function Preview({ draft }: { draft: Draft }) {
  const title = draft.title.trim() || 'Titre du message';
  const body = draft.body.trim() || 'Votre message apparaîtra ici.';
  if (draft.channel === 'email') {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
        <div className="border-b border-border px-4 py-2.5 text-xs text-fg-muted">
          <p>
            <span className="text-fg-subtle">De :</span> GoLink
          </p>
          <p className="truncate">
            <span className="text-fg-subtle">Objet :</span> <span className="font-medium text-fg">{draft.emailSubject.trim() || title}</span>
          </p>
        </div>
        <div className="space-y-2 bg-surface p-4">
          <p className="font-display text-md font-semibold text-fg">
            Go<span className="text-primary">Link</span>
          </p>
          <p className="font-display text-lg font-semibold leading-snug text-fg">{title}</p>
          {body.split(/\n+/).map((p, i) => (
            <p key={i} className="text-sm text-fg-muted">
              {p}
            </p>
          ))}
          {draft.linkType === 'url' && <span className="mt-2 inline-block rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-fg">Découvrir</span>}
          {draft.audience.marketing && <p className="border-t border-border pt-2 text-2xs text-fg-subtle">Vous recevez cet e-mail car vous avez accepté les offres GoLink. Se désinscrire.</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[18rem] rounded-[2rem] border border-border-strong bg-surface-3 p-3 shadow-md">
      <div className="mb-3 flex justify-center">
        <span className="h-1.5 w-16 rounded-full bg-border-strong" />
      </div>
      <div className="rounded-2xl bg-elevated p-3 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-2xs text-fg-muted">
          <span className="grid size-4 place-items-center rounded bg-primary text-[8px] font-bold text-primary-fg">G</span>
          {draft.channel === 'sms' ? 'SMS · GoLink' : 'GoLink'} · maintenant
        </div>
        {draft.channel !== 'sms' && <p className="text-sm font-semibold text-fg">{title}</p>}
        <p className="whitespace-pre-line text-sm text-fg-muted">
          {body}
          {draft.channel === 'sms' && draft.audience.marketing ? ' STOP au 36111' : ''}
        </p>
      </div>
      <div className="h-40" />
    </div>
  );
}

// ------------------------------------------------------------------ Détail d'un envoi parti

function CampaignDetail({ id, campaign }: { id: string; campaign: Campaign }) {
  const navigate = useNavigate();
  const names = useGeoNames();
  const restaurants = useRestaurantOptions();
  const logsQuery = useMemo(() => query(collection(db, COLLECTIONS.notificationLogs), where('campaignId', '==', id), orderBy('createdAt', 'desc'), limit(50)), [id]);
  const logs = useCollection<NotificationLog>(logsQuery);
  const s = campaign.stats ?? { targeted: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };
  const restaurantName = (rid: string) => restaurants.byId.get(rid)?.name ?? 'Restaurant';
  const duplicate = () => {
    try {
      sessionStorage.setItem('golink:admin:envoi-duplique', JSON.stringify({ ...fromCampaign(campaign), name: `${campaign.name} (copie)` }));
    } catch {
      // Stockage indisponible : la copie repart d'un formulaire vide.
    }
    void navigate('/communication/nouveau');
  };
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={campaign.scope === 'restaurant' ? `Campagne de ${restaurantName(campaign.restaurantId ?? '')}` : `Envoi GoLink · ${CHANNEL_SHORT[campaign.channel]}`}
        title={campaign.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />}>
              <Link to="/communication">Tous les envois</Link>
            </Button>
            {campaign.scope === 'platform' && (
              <Button size="sm" leftIcon={<Copy />} onClick={duplicate}>
                Dupliquer
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={CAMPAIGN_STATUS_TONES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</StatusPill>
          {campaign.testMode && <Badge tone="neutral">Mode test : messages préparés sans transmission au prestataire</Badge>}
          {campaign.sentAt && <span className="text-sm text-fg-muted">Parti le {formatDateTime(toMillis(campaign.sentAt) ?? 0)}</span>}
        </div>
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Destinataires" value={formatNumber(s.targeted)} icon={<Users />} tone="brand" />
        <StatCard label="Envoyés" value={formatNumber(s.sent)} icon={<Send />} tone="info" />
        <StatCard label="Délivrés" value={formatNumber(s.delivered)} icon={<CheckCircle2 />} tone="success" footer={s.sent ? `${Math.round((s.delivered / s.sent) * 100)} % des envois` : undefined} />
        <StatCard label="Échecs" value={formatNumber(s.failed)} icon={<XCircle />} tone="danger" footer={campaign.failureReason ?? undefined} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader title="Journal de l’envoi" description="50 derniers messages de cet envoi." divided />
          {logs.error ? (
            <LoadError error={logs.error} compact />
          ) : logs.loading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : logs.data.length === 0 ? (
            <EmptyState compact icon={<Mail />} title="Aucune trace d’envoi" description={campaign.status === 'sent' ? 'Cet envoi n’a produit aucune trace détaillée.' : 'Les traces apparaîtront au départ de l’envoi.'} />
          ) : (
            <ul className="divide-y divide-border">
              {logs.data.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs text-fg">{l.destinationMasked}</span>
                  <span className="flex items-center gap-2">
                    {l.error && <span className="hidden max-w-[16rem] truncate text-xs text-fg-subtle sm:inline">{l.error}</span>}
                    <Badge tone={l.status === 'failed' || l.status === 'bounced' ? 'danger' : l.status === 'queued' ? 'neutral' : 'success'} size="sm">
                      {l.status === 'queued' ? 'Préparé' : l.status === 'failed' ? 'Échec' : l.status === 'bounced' ? 'Rejeté' : l.status === 'opened' ? 'Ouvert' : 'Délivré'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Message" divided />
            <div className="space-y-2 px-5 py-4">
              {campaign.emailSubject && <p className="text-xs text-fg-muted">Objet : {campaign.emailSubject}</p>}
              <p className="font-medium text-fg">{campaign.title}</p>
              <p className="whitespace-pre-line text-sm text-fg-muted">{campaign.body}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Cible" divided />
            <dl className="divide-y divide-border px-5 py-1">
              <InfoRow label="Destinataires">{USER_TYPE_LABELS[campaign.audience.userType]}</InfoRow>
              <InfoRow label="Périmètre">{audienceSummary(campaign, names, restaurantName).split(' · ').slice(1).join(' · ') || 'Tous'}</InfoRow>
              <InfoRow label="Nature">{campaign.audience.marketing ? 'Promotionnel (consentement)' : 'Information de service'}</InfoRow>
            </dl>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Composition

function Composer({ id, campaign }: { id: string | null; campaign: Campaign | null }) {
  const navigate = useNavigate();
  const geo = useGeoScope();
  const { admin } = useAdminAccess();
  const restaurants = useRestaurantOptions();
  const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  const [draft, setDraft] = useState<Draft>(() => {
    if (campaign) return fromCampaign(campaign);
    try {
      const copy = sessionStorage.getItem('golink:admin:envoi-duplique');
      if (copy) {
        sessionStorage.removeItem('golink:admin:envoi-duplique');
        return JSON.parse(copy) as Draft;
      }
    } catch {
      // Stockage indisponible : formulaire vide.
    }
    return emptyDraft(cityScoped ? admin.cityIds : geo.cityId ? [geo.cityId] : null);
  });
  const [estimate, setEstimate] = useState<{ matched: number; reachable: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState<'send_now' | 'schedule' | 'cancel' | null>(null);
  const save = useMutation(savePlatformCampaign);
  const seq = useRef(0);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setAudience = <K extends keyof AudienceInput>(k: K, v: AudienceInput[K]) => setDraft((d) => ({ ...d, audience: { ...d.audience, [k]: v } }));
  const a = draft.audience;
  const isClient = a.userType === 'client';
  const audienceKey = JSON.stringify([draft.channel, a]);

  useEffect(() => {
    const run = ++seq.current;
    setEstimating(true);
    setEstimateError(null);
    const t = window.setTimeout(() => {
      estimatePlatformAudience({ channel: draft.channel, audience: { ...a, marketing: isClient ? a.marketing : false } })
        .then((r) => run === seq.current && setEstimate(r))
        .catch((e: unknown) => run === seq.current && setEstimateError(errorMessage(e)))
        .finally(() => run === seq.current && setEstimating(false));
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  const limitChars = LIMITS[draft.channel];
  const errors = useMemo(() => {
    const e: Partial<Record<'name' | 'title' | 'body' | 'emailSubject' | 'link' | 'scheduledAt' | 'cities', string>> = {};
    if (draft.name.trim().length < 3) e.name = 'Au moins 3 caractères.';
    if (draft.title.trim().length < 3) e.title = 'Au moins 3 caractères.';
    if (draft.body.trim().length < 10) e.body = 'Au moins 10 caractères.';
    if (draft.body.length > limitChars) e.body = `${limitChars} caractères au maximum pour ce canal.`;
    if (draft.linkType !== 'none' && !draft.linkTarget.trim()) e.link = 'Complétez la destination du lien.';
    if (draft.linkType === 'url' && draft.linkTarget && !draft.linkTarget.startsWith('https://')) e.link = 'L’adresse doit commencer par https://';
    if (draft.when === 'later' && (!draft.scheduledAt || draft.scheduledAt < Date.now() + 5 * 60_000)) e.scheduledAt = 'Au moins 5 minutes à l’avance.';
    if (cityScoped && !a.cityIds?.length) e.cities = 'Choisissez au moins une de vos villes.';
    return e;
  }, [draft, limitChars, cityScoped, a.cityIds]);
  const valid = Object.keys(errors).length === 0;
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  function input(mode: CampaignInput['mode']): CampaignInput {
    return {
      campaignId: id,
      mode,
      name: draft.name.trim(),
      channel: draft.channel,
      title: draft.title.trim(),
      body: draft.body.trim(),
      emailSubject: draft.channel === 'email' ? draft.emailSubject.trim() || null : null,
      link: draft.linkType === 'none' ? null : { type: draft.linkType, target: draft.linkTarget.trim() },
      audience: {
        ...a,
        marketing: isClient ? a.marketing : false,
        segment: isClient ? a.segment : 'all',
        planCodes: a.userType === 'restaurant' ? a.planCodes : null,
        inactiveDays: isClient && a.segment === 'inactive' ? a.inactiveDays : null,
      },
      scheduledAt: draft.when === 'later' ? draft.scheduledAt : null,
    };
  }

  async function run(mode: CampaignInput['mode']) {
    if (mode !== 'cancel' && mode !== 'draft') {
      setTouched(true);
      if (!valid) return;
    }
    if (mode === 'draft' && (errors.name || errors.title)) {
      setTouched(true);
      return;
    }
    const result = await save.mutate(input(mode));
    if (!result) return;
    const messages: Record<CampaignInput['mode'], string> = {
      draft: 'Brouillon enregistré',
      schedule: 'Envoi programmé',
      send_now: `Envoi parti vers ${formatNumber(result.stats.sent)} destinataire${result.stats.sent > 1 ? 's' : ''}`,
      test: 'Test envoyé dans votre centre de notifications',
      cancel: 'Envoi annulé',
    };
    toast.success(messages[mode]);
    if (mode === 'test') return;
    if (result.campaignId && (mode === 'draft' || mode === 'schedule') && !id) void navigate(`/communication/${result.campaignId}`, { replace: true });
    if (mode === 'send_now' || mode === 'cancel') void navigate(result.campaignId ? `/communication/${result.campaignId}` : '/communication');
  }

  const cityOptions = geo.cities.filter((c) => !a.countryIds?.length || a.countryIds.includes(c.countryId)).map((c) => ({ value: c.id, label: c.name }));
  const restaurantOptions = restaurants.options
    .filter((r) => (!a.cityIds?.length || a.cityIds.includes(r.cityId)) && (!a.countryIds?.length || a.countryIds.includes(r.countryId)))
    .map((r) => ({ value: r.id, label: r.name }));
  const noConsentWarning = isClient && a.marketing;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Croissance · ${geo.label}`}
        title={id ? (campaign?.status === 'scheduled' ? 'Envoi programmé' : 'Brouillon d’envoi') : 'Nouvel envoi'}
        description="Rédigez, ciblez puis envoyez maintenant ou à une date précise."
        actions={
          <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />}>
            <Link to="/communication">Tous les envois</Link>
          </Button>
        }
      >
        {campaign?.status === 'scheduled' && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="info">Programmé</StatusPill>
            <span className="text-sm text-fg-muted">Départ le {formatDateTime(toMillis(campaign.scheduledAt) ?? 0)}</span>
          </div>
        )}
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Block step={1} title="Destinataires" description="À qui s’adresse le message.">
            <RadioGroup
              variant="cards"
              aria-label="Destinataires"
              className="grid gap-2 sm:grid-cols-3"
              value={a.userType}
              onValueChange={(v) => setDraft((d) => ({ ...d, audience: { ...d.audience, userType: v as AudienceInput['userType'], restaurantIds: null, planCodes: null, segment: 'all' } }))}
              options={[
                { value: 'client', label: 'Clients', description: 'App client GoLink' },
                { value: 'restaurant', label: 'Restaurants', description: 'Propriétaires des commerces' },
                { value: 'driver', label: 'Livreurs', description: 'Livreurs actifs' },
              ]}
            />
            {isClient && (
              <FormField label="Nature du message">
                <Select
                  value={a.marketing ? 'marketing' : 'service'}
                  onValueChange={(v) => setAudience('marketing', v === 'marketing')}
                  options={[
                    { value: 'marketing', label: 'Promotionnel', description: 'Offres, nouveautés : seulement aux clients ayant consenti' },
                    { value: 'service', label: 'Information de service', description: 'Changement de conditions, incident : tous les clients' },
                  ]}
                />
              </FormField>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Pays" hint="Vide = tous les pays.">
                <Combobox
                  multiple
                  value={a.countryIds ?? []}
                  onChange={(v: string[]) => setAudience('countryIds', v.length ? v : null)}
                  options={geo.countries.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Tous les pays"
                />
              </FormField>
              <FormField label="Villes" hint={cityScoped ? 'Limitées à votre périmètre.' : 'Vide = toutes les villes.'} error={err('cities')}>
                <Combobox multiple value={a.cityIds ?? []} onChange={(v: string[]) => setAudience('cityIds', v.length ? v : null)} options={cityOptions} placeholder="Toutes les villes" />
              </FormField>
            </div>
            {a.userType !== 'driver' && (
              <FormField label={isClient ? 'Clients ayant commandé chez' : 'Restaurants'} hint={isClient ? 'Vide = tous les clients.' : 'Vide = tous les restaurants du périmètre.'}>
                <Combobox
                  multiple
                  value={a.restaurantIds ?? []}
                  onChange={(v: string[]) => setAudience('restaurantIds', v.length ? v.slice(0, 30) : null)}
                  options={restaurantOptions}
                  placeholder={isClient ? 'Tous les clients' : 'Tous les restaurants'}
                  searchPlaceholder="Rechercher un restaurant"
                />
              </FormField>
            )}
            {a.userType === 'restaurant' && (
              <FormField label="Formules">
                <div>
                  <ChipGroup<PlanCode>
                    label="Formules"
                    value={a.planCodes ?? []}
                    onChange={(v) => setAudience('planCodes', v.length ? v : null)}
                    options={(['basic', 'pro', 'premium'] as const).map((p) => ({ value: p, label: PLAN_LABELS[p] }))}
                  />
                </div>
              </FormField>
            )}
            {isClient && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Groupe de clients">
                  <Select
                    value={a.segment}
                    onValueChange={(v) => setAudience('segment', v as AudienceInput['segment'])}
                    options={(['all', 'new', 'inactive', 'loyal'] as const).map((s) => ({ value: s, label: SEGMENT_LABELS[s] }))}
                  />
                </FormField>
                {a.segment === 'inactive' && (
                  <FormField label="Sans commande depuis">
                    <NumberInput value={a.inactiveDays} onChange={(v) => setAudience('inactiveDays', v)} unit="jours" />
                  </FormField>
                )}
              </div>
            )}
          </Block>

          <Block step={2} title="Canal">
            <RadioGroup
              variant="cards"
              aria-label="Canal"
              className="grid gap-2 sm:grid-cols-4"
              value={draft.channel}
              onValueChange={(v) => set('channel', v as CampaignChannel)}
              options={[
                { value: 'push', label: 'Push', description: '240 caractères' },
                { value: 'email', label: 'E-mail', description: 'Objet et texte' },
                { value: 'sms', label: 'SMS', description: '320 caractères' },
                { value: 'in_app', label: 'Dans l’app', description: 'Centre de notifications' },
              ]}
            />
          </Block>

          <Block step={3} title="Message">
            <FormField label="Nom interne" required hint="Visible uniquement par l’équipe GoLink." error={err('name')}>
              <Input value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="Ex. Relance inactifs Metz — octobre" />
            </FormField>
            {draft.channel === 'email' && (
              <FormField label="Objet de l’e-mail" hint="Vide = titre du message.">
                <Input value={draft.emailSubject} maxLength={120} onChange={(e) => set('emailSubject', e.target.value)} />
              </FormField>
            )}
            <FormField label="Titre" required error={err('title')}>
              <Input value={draft.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="Ex. Vous nous avez manqué" />
            </FormField>
            <FormField
              label="Texte"
              required
              error={err('body')}
              aside={<span className={cn('num font-mono text-2xs', draft.body.length > limitChars ? 'text-danger' : 'text-fg-subtle')}>{draft.body.length} / {limitChars}</span>}
            >
              <Textarea rows={draft.channel === 'email' ? 7 : 4} value={draft.body} onChange={(e) => set('body', e.target.value)} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <FormField label="Lien au clic">
                <Select
                  value={draft.linkType}
                  onValueChange={(v) => set('linkType', v as Draft['linkType'])}
                  options={[
                    { value: 'none', label: 'Aucun' },
                    { value: 'restaurant', label: 'Un restaurant' },
                    { value: 'promotion', label: 'Une offre' },
                    { value: 'page', label: 'Une page de l’app' },
                    { value: 'url', label: 'Une adresse web' },
                  ]}
                />
              </FormField>
              {draft.linkType !== 'none' && (
                <FormField label="Destination" error={err('link')}>
                  {draft.linkType === 'restaurant' ? (
                    <Combobox value={draft.linkTarget || undefined} onChange={(v: string | undefined) => set('linkTarget', v ?? '')} options={restaurants.options.map((r) => ({ value: r.id, label: r.name }))} placeholder="Choisir un restaurant" />
                  ) : (
                    <Input
                      value={draft.linkTarget}
                      onChange={(e) => set('linkTarget', e.target.value)}
                      placeholder={draft.linkType === 'url' ? 'https://…' : draft.linkType === 'promotion' ? 'Identifiant de l’offre' : 'accueil, offres, parrainage…'}
                    />
                  )}
                </FormField>
              )}
            </div>
          </Block>

          <Block step={4} title="Envoi">
            <RadioGroup
              variant="cards"
              aria-label="Moment de l’envoi"
              className="grid gap-2 sm:grid-cols-2"
              value={draft.when}
              onValueChange={(v) => set('when', v as Draft['when'])}
              options={[
                { value: 'now', label: 'Maintenant', description: 'Dès la confirmation' },
                { value: 'later', label: 'Programmer', description: 'À une date et une heure' },
              ]}
            />
            {draft.when === 'later' && (
              <FormField label="Date et heure d’envoi" error={err('scheduledAt')} hint="Heure de votre appareil.">
                <DateTimeField value={draft.scheduledAt} onChange={(v) => set('scheduledAt', v)} minDate={new Date()} />
              </FormField>
            )}
            {isClient && a.marketing && (draft.channel === 'push' || draft.channel === 'sms') && (
              <p className="text-sm text-fg-muted">Les messages promotionnels push et SMS partent entre 9 h et 21 h (heure de Paris).</p>
            )}
          </Block>
        </div>

        <div className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="eyebrow">Audience estimée</p>
                <p className="mt-1 font-display text-3xl font-semibold tracking-display text-fg">
                  {estimate ? formatNumber(estimate.reachable) : '—'}
                  <span className="ml-1.5 text-sm font-normal tracking-normal text-fg-muted">joignables</span>
                </p>
              </div>
              {estimating ? <Spinner className="size-5" /> : <Users className="size-5 text-fg-subtle" />}
            </div>
            <div className="space-y-2 px-5 py-4 text-sm">
              {estimateError ? (
                <p className="text-danger">{estimateError}</p>
              ) : (
                <p className="text-fg-muted">
                  {estimate ? `${formatNumber(estimate.matched)} ${USER_TYPE_LABELS[a.userType].toLowerCase()} correspondent à la cible.` : 'Calcul en cours…'}
                </p>
              )}
              {noConsentWarning && (
                <p className="flex items-start gap-2 text-fg-muted">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-(--tone-fg) tone-success" />
                  Seuls les clients ayant accepté les offres par {CHANNEL_SHORT[draft.channel].toLowerCase()} les recevront.
                </p>
              )}
              {(draft.channel === 'email' || draft.channel === 'sms') && (
                <p className="flex items-start gap-2 text-fg-muted">
                  <FlaskConical className="mt-0.5 size-4 shrink-0" />
                  Environnement de test : les {draft.channel === 'email' ? 'e-mails' : 'SMS'} sont préparés et tracés sans être transmis.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Aperçu" icon={CHANNEL_ICONS[draft.channel]} divided />
            <div className="p-5">
              <Preview draft={draft} />
            </div>
          </Card>
          <Card className="space-y-2 p-4">
            {draft.when === 'now' ? (
              <Button variant="primary" block leftIcon={<Send />} loading={save.loading} onClick={() => (setTouched(true), valid && setConfirm('send_now'))}>
                Envoyer maintenant
              </Button>
            ) : (
              <Button variant="primary" block leftIcon={<CalendarClock />} loading={save.loading} onClick={() => (setTouched(true), valid && setConfirm('schedule'))}>
                {campaign?.status === 'scheduled' ? 'Mettre à jour la programmation' : 'Programmer l’envoi'}
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={save.loading} onClick={() => void run('draft')}>
                {campaign?.status === 'scheduled' ? 'Repasser en brouillon' : 'Brouillon'}
              </Button>
              <Button variant="secondary" leftIcon={<BellRing />} disabled={save.loading || !valid} onClick={() => void run('test')}>
                M’envoyer un test
              </Button>
            </div>
            {id && (
              <Button variant="ghost" block className="text-danger" disabled={save.loading} onClick={() => setConfirm('cancel')}>
                Annuler cet envoi
              </Button>
            )}
            {touched && !valid && <p className="text-center text-sm text-danger">Corrigez les champs signalés.</p>}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'send_now' ? 'Envoyer maintenant ?' : confirm === 'schedule' ? 'Programmer l’envoi ?' : 'Annuler cet envoi ?'}
        description={
          confirm === 'cancel'
            ? 'L’envoi ne partira pas. Il restera visible dans l’historique.'
            : `${estimate ? formatNumber(estimate.reachable) : 'Les'} destinataire${(estimate?.reachable ?? 2) > 1 ? 's' : ''} recevront « ${draft.title.trim()} » par ${CHANNEL_SHORT[draft.channel].toLowerCase()}${
                confirm === 'schedule' && draft.scheduledAt ? ` le ${formatDateTime(draft.scheduledAt)}` : ''
              }.`
        }
        confirmLabel={confirm === 'send_now' ? 'Envoyer' : confirm === 'schedule' ? 'Programmer' : 'Annuler l’envoi'}
        cancelLabel="Retour"
        destructive={confirm === 'cancel'}
        onConfirm={async () => {
          if (confirm) await run(confirm);
        }}
      >
        {confirm !== 'cancel' && (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Megaphone className="size-4" /> {a.marketing && isClient ? 'Message promotionnel : consentement vérifié à l’envoi.' : 'Information de service.'}
          </p>
        )}
      </ConfirmDialog>
    </PageContainer>
  );
}

export function CampaignPage() {
  const { campaignId } = useParams();
  const state = useDoc<Campaign>(campaignId ? docAt(`${COLLECTIONS.campaigns}/${campaignId}`) : null);
  useDocumentTitle(`${state.data?.name ?? (campaignId ? 'Envoi' : 'Nouvel envoi')} · GoLink Admin`);

  if (!campaignId) return <Composer id={null} campaign={null} />;
  if (state.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="h-8 w-72" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="h-[32rem]" />
          <Skeleton className="h-80" />
        </div>
      </PageContainer>
    );
  }
  if (state.error || state.missing || !state.data) {
    return (
      <PageContainer>
        <Card>
          {state.error ? (
            <LoadError error={state.error} />
          ) : (
            <EmptyState
              icon={<Store />}
              title="Envoi introuvable"
              description="Le lien est peut-être incorrect."
              action={
                <Button asChild size="sm">
                  <Link to="/communication">Retour aux envois</Link>
                </Button>
              }
            />
          )}
        </Card>
      </PageContainer>
    );
  }
  const c = state.data;
  if (c.scope === 'platform' && (c.status === 'draft' || c.status === 'scheduled')) return <Composer key={campaignId} id={campaignId} campaign={c} />;
  return <CampaignDetail id={campaignId} campaign={c} />;
}
