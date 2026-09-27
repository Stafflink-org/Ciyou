import { useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Bell, CalendarClock, Mail, Megaphone, Send, ShieldCheck, Users } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DatePicker,
  FormField,
  Input,
  LogoMark,
  RadioGroup,
  SegmentedControl,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Slider,
  Textarea,
  TimeInput,
  cn,
  formatNumber,
} from '@golink/ui';
import {
  RESTAURANT_CAMPAIGN_RULES,
  RESTAURANT_CAMPAIGN_SEGMENT_HINTS,
  RESTAURANT_CAMPAIGN_SEGMENT_LABELS,
  RESTAURANT_CAMPAIGN_SEGMENTS,
  restaurantPublicUrl,
  type RestaurantCampaignSegment,
} from '@golink/shared';
import { useActiveRestaurant } from '@/auth/RestaurantAccess';
import { errorMessage, toDate, useMutation } from '@/lib/firestore';
import { discountLabel, promotionName, useRestaurantPromotions } from '../promotions/lib';
import { estimateCampaignAudience, formatParis, parisDateTime, scheduleCampaign, toParisParts, type CampaignRow } from './lib';

const RULES = RESTAURANT_CAMPAIGN_RULES;

interface FormState {
  channel: 'push' | 'email';
  segment: RestaurantCampaignSegment;
  inactiveDays: number;
  name: string;
  title: string;
  body: string;
  emailSubject: string;
  promotionId: string;
  when: 'now' | 'later';
  date: Date | undefined;
  time: string;
}

function initial(campaign: CampaignRow | null): FormState {
  const tomorrow = addDays(new Date(), 1);
  if (!campaign) {
    return {
      channel: 'push',
      segment: 'all',
      inactiveDays: RULES.inactiveDefaultDays,
      name: '',
      title: '',
      body: '',
      emailSubject: '',
      promotionId: '',
      when: 'later',
      date: tomorrow,
      time: '11:30',
    };
  }
  const scheduledMs = campaign.status === 'scheduled' ? toDate(campaign.scheduledAt)?.getTime() : undefined;
  const scheduled = scheduledMs ? toParisParts(scheduledMs) : null;
  return {
    channel: campaign.channel === 'email' ? 'email' : 'push',
    segment: (campaign.audience.segment ?? 'all') as RestaurantCampaignSegment,
    inactiveDays: campaign.audience.inactiveDays ?? RULES.inactiveDefaultDays,
    name: campaign.name,
    title: campaign.title,
    body: campaign.body,
    emailSubject: campaign.emailSubject ?? '',
    promotionId: campaign.promotionId ?? '',
    when: 'later',
    date: scheduled?.day ?? tomorrow,
    time: scheduled?.time ?? '11:30',
  };
}

function scheduledMillis(form: FormState): number | null {
  return form.date ? parisDateTime(form.date, form.time) : null;
}

export interface CampaignComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Campagne à modifier (brouillon ou programmée) ou modèle à dupliquer. */
  campaign: CampaignRow | null;
  duplicate?: boolean;
}

export function CampaignComposer({ open, onOpenChange, campaign, duplicate }: CampaignComposerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-4xl">
        {open && <ComposerBody key={`${campaign?.id ?? 'new'}-${duplicate ? 'd' : 'e'}`} campaign={campaign} duplicate={Boolean(duplicate)} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function ComposerBody({ campaign, duplicate, onClose }: { campaign: CampaignRow | null; duplicate: boolean; onClose: () => void }) {
  const restaurant = useActiveRestaurant();
  const promotions = useRestaurantPromotions();
  const livePromotions = promotions.data.filter((p) => p.status === 'active');
  const [form, setForm] = useState<FormState>(() => {
    const base = initial(campaign);
    return duplicate ? { ...base, name: `${base.name} (copie)`, when: 'later', date: addDays(new Date(), 1) } : base;
  });
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const editingId = campaign && !duplicate ? campaign.id : undefined;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Estimation de l'audience, recalculée (avec un léger délai) à chaque changement de ciblage.
  const [audience, setAudience] = useState<{ key: string; segmentCount: number; reachable: number } | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const audienceKey = `${form.channel}|${form.segment}|${form.inactiveDays}`;
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      estimateCampaignAudience({ restaurantId: restaurant.id, channel: form.channel, segment: form.segment, inactiveDays: form.inactiveDays })
        .then((result) => !cancelled && (setAudience({ key: audienceKey, ...result }), setAudienceError(null)))
        .catch((error: unknown) => !cancelled && setAudienceError(errorMessage(error)));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audienceKey, form.channel, form.segment, form.inactiveDays, restaurant.id]);
  const audienceReady = audience?.key === audienceKey;

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState | 'schedule', string>> = {};
    if (form.name.trim().length < 3) e.name = 'Donnez un nom interne à la campagne.';
    if (form.title.trim().length < 3) e.title = 'Au moins 3 caractères.';
    if (form.body.trim().length < 10) e.body = 'Au moins 10 caractères.';
    if (form.when === 'later') {
      const at = scheduledMillis(form);
      const hour = Number(form.time.slice(0, 2));
      if (!at) e.schedule = 'Choisissez une date et une heure.';
      else if (at < Date.now() + 5 * 60_000) e.schedule = 'Programmez l’envoi au moins 5 minutes à l’avance.';
      else if (hour < RULES.sendWindow.fromHour || hour >= RULES.sendWindow.toHour) e.schedule = `Entre ${RULES.sendWindow.fromHour} h et ${RULES.sendWindow.toHour} h.`;
    }
    return e;
  }, [form]);
  const shown = touched ? errors : {};
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation(
    async (mode: 'draft' | 'schedule' | 'send_now') =>
      scheduleCampaign({
        restaurantId: restaurant.id,
        // Clé absente pour une nouvelle campagne (le SDK transmet `undefined` comme `null`).
        ...(editingId ? { campaignId: editingId } : {}),
        channel: form.channel,
        segment: form.segment,
        inactiveDays: form.inactiveDays,
        name: form.name.trim(),
        title: form.title.trim(),
        body: form.body.trim(),
        emailSubject: form.channel === 'email' ? form.emailSubject.trim() || null : null,
        promotionId: form.promotionId || null,
        mode,
        scheduledAt: mode === 'schedule' ? scheduledMillis(form) : null,
      }),
    {
      success: (r) =>
        r.status === 'draft'
          ? 'Brouillon enregistré.'
          : r.status === 'scheduled'
            ? 'Campagne programmée.'
            : `Campagne envoyée à ${formatNumber(r.stats.sent)} client${r.stats.sent > 1 ? 's' : ''}.`,
    },
  );

  async function submit(mode: 'draft' | 'schedule' | 'send_now') {
    setTouched(true);
    if (mode === 'draft' ? form.name.trim().length < 3 || form.title.trim().length < 3 || form.body.trim().length < 10 : hasErrors) return;
    const result = await save.mutate(mode);
    if (result) onClose();
  }

  const scheduledLabel = (() => {
    const at = scheduledMillis(form);
    return at ? `le ${formatParis(at)} (heure de Paris)` : '';
  })();
  const reachable = audienceReady ? audience.reachable : null;
  const link = restaurantPublicUrl(restaurant.slug);
  const promo = livePromotions.find((p) => p.id === form.promotionId);

  return (
    <>
      <SheetHeader
        icon={<Megaphone />}
        title={editingId ? 'Modifier la campagne' : 'Nouvelle campagne'}
        description="Une notification ou un e-mail à vos clients, uniquement ceux qui ont accepté de recevoir vos offres."
      />
      <SheetBody className="pb-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <section className="space-y-3">
              <h3 className="font-display text-md font-semibold tracking-tight">Canal</h3>
              <SegmentedControl
                aria-label="Canal de diffusion"
                value={form.channel}
                onValueChange={(v) => set('channel', v as FormState['channel'])}
                options={[
                  { value: 'push', label: 'Notification', icon: <Bell /> },
                  { value: 'email', label: 'E-mail', icon: <Mail /> },
                ]}
              />
              <p className="text-xs text-fg-subtle">
                {form.channel === 'push'
                  ? 'Notification sur le téléphone et dans le centre de notifications de l’app GoLink.'
                  : 'E-mail aux couleurs de votre établissement, envoyé par GoLink.'}
              </p>
            </section>

            <section className="space-y-3 border-t border-border pt-6">
              <h3 className="font-display text-md font-semibold tracking-tight">Audience</h3>
              <RadioGroup
                variant="cards"
                value={form.segment}
                onValueChange={(v) => set('segment', v as RestaurantCampaignSegment)}
                options={RESTAURANT_CAMPAIGN_SEGMENTS.map((s) => ({ value: s, label: RESTAURANT_CAMPAIGN_SEGMENT_LABELS[s], description: RESTAURANT_CAMPAIGN_SEGMENT_HINTS[s] }))}
              />
              {form.segment === 'inactive' && (
                <div className="rounded-xl border border-border bg-surface-2 p-4">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-medium text-fg">Sans commande depuis</span>
                    <span className="font-mono text-fg num">{form.inactiveDays} jours</span>
                  </div>
                  <Slider min={14} max={180} step={1} value={[form.inactiveDays]} onValueChange={(v) => set('inactiveDays', v[0] ?? 45)} formatValue={(v) => `${v} jours`} />
                </div>
              )}
              <div className="tone-teal flex items-center gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)" aria-live="polite">
                <Users className="size-4 shrink-0" />
                {audienceError ? (
                  <span>{audienceError}</span>
                ) : !audienceReady ? (
                  <Skeleton className="h-4 w-56" />
                ) : (
                  <span>
                    <span className="font-semibold">{formatNumber(audience.reachable)}</span> client{audience.reachable > 1 ? 's' : ''} joignable
                    {audience.reachable > 1 ? 's' : ''} sur {formatNumber(audience.segmentCount)} dans ce segment
                    <span className="block text-xs opacity-80">Les autres n’ont pas accepté les {form.channel === 'push' ? 'notifications' : 'e-mails'} promotionnels.</span>
                  </span>
                )}
              </div>
            </section>

            <section className="space-y-4 border-t border-border pt-6">
              <h3 className="font-display text-md font-semibold tracking-tight">Message</h3>
              <FormField label="Nom de la campagne" required hint="Visible uniquement par votre équipe." error={shown.name}>
                <Input maxLength={80} placeholder="Ex. Relance du vendredi soir" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </FormField>
              {form.channel === 'email' && (
                <FormField label="Objet de l’e-mail" hint="Laissez vide pour reprendre le titre." aside={`${form.emailSubject.length}/${RULES.subjectMax}`}>
                  <Input maxLength={RULES.subjectMax} placeholder={form.title || 'Objet de l’e-mail'} value={form.emailSubject} onChange={(e) => set('emailSubject', e.target.value)} />
                </FormField>
              )}
              <FormField label="Titre" required error={shown.title} aside={`${form.title.length}/${RULES.titleMax}`}>
                <Input maxLength={RULES.titleMax} placeholder="Ex. Ce soir, on cuisine pour vous" value={form.title} onChange={(e) => set('title', e.target.value)} />
              </FormField>
              <FormField label="Message" required error={shown.body} aside={`${form.body.length}/${RULES.bodyMax}`}>
                <Textarea
                  rows={4}
                  maxLength={RULES.bodyMax}
                  placeholder="Ex. Vos plats préférés vous attendent : commandez avant 21 h et profitez de notre offre du moment."
                  value={form.body}
                  onChange={(e) => set('body', e.target.value)}
                />
              </FormField>
              <FormField label="Offre mise en avant" hint={livePromotions.length ? 'Le message ouvrira l’offre dans l’app.' : 'Aucune offre en ligne pour le moment.'}>
                <Select
                  value={form.promotionId || 'none'}
                  onValueChange={(v) => set('promotionId', v === 'none' ? '' : v)}
                  disabled={livePromotions.length === 0}
                  options={[
                    { value: 'none', label: 'Aucune : ouvrir la fiche de l’établissement' },
                    ...livePromotions.map((p) => ({ value: p.id, label: `${promotionName(p)} · ${discountLabel(p)}` })),
                  ]}
                />
              </FormField>
            </section>

            <section className="space-y-3 border-t border-border pt-6">
              <h3 className="font-display text-md font-semibold tracking-tight">Envoi</h3>
              <SegmentedControl
                aria-label="Moment de l’envoi"
                value={form.when}
                onValueChange={(v) => set('when', v as FormState['when'])}
                options={[
                  { value: 'later', label: 'Programmer', icon: <CalendarClock /> },
                  { value: 'now', label: 'Envoyer maintenant', icon: <Send /> },
                ]}
              />
              {form.when === 'later' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Date">
                    <DatePicker value={form.date} onChange={(d) => set('date', d)} disabledDays={{ before: new Date() }} />
                  </FormField>
                  <FormField label="Heure (Paris)">
                    <TimeInput value={form.time} onChange={(v) => set('time', v)} min="09:00" max="20:45" aria-label="Heure d’envoi" />
                  </FormField>
                </div>
              )}
              {shown.schedule && <p className="text-xs text-danger-soft-fg">{shown.schedule}</p>}
              <p className="flex items-start gap-2 text-xs text-fg-subtle">
                <ShieldCheck className="mt-px size-3.5 shrink-0" />
                Envois entre {RULES.sendWindow.fromHour} h et {RULES.sendWindow.toHour} h, {RULES.maxSendsPer7Days} campagnes au plus par semaine : vos clients restent attentifs à vos messages.
              </p>
            </section>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <p className="eyebrow">Aperçu</p>
            {form.channel === 'push' ? (
              <div className="rounded-[28px] border border-border bg-linear-160 from-petrol-800 to-petrol-950 p-3 pt-10 shadow-card">
                <p className="text-center font-display text-4xl font-medium text-white/90 num">{format(new Date(), 'HH:mm')}</p>
                <p className="mb-6 text-center text-xs capitalize text-white/60">{format(new Date(), 'EEEE d MMMM', { locale: fr })}</p>
                <div className="rounded-2xl bg-white/85 p-3 text-petrol-950 shadow-lg backdrop-blur">
                  <div className="mb-1 flex items-center gap-2 text-2xs text-petrol-700">
                    <LogoMark size={16} />
                    <span className="font-semibold uppercase tracking-wide">GoLink</span>
                    <span className="ml-auto">maintenant</span>
                  </div>
                  <p className="text-sm font-semibold leading-5">{form.title || 'Titre de votre notification'}</p>
                  <p className="line-clamp-4 text-xs leading-4 text-petrol-800">{form.body || 'Votre message apparaîtra ici.'}</p>
                </div>
                <div className="h-28" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                <div className="border-b border-border px-4 py-3 text-xs">
                  <p className="font-semibold text-fg">{restaurant.name} via GoLink</p>
                  <p className="truncate text-fg-muted">{form.emailSubject || form.title || 'Objet de l’e-mail'}</p>
                </div>
                <div className="bg-canvas p-4">
                  <div className="rounded-xl bg-surface p-4">
                    <p className="eyebrow text-primary-soft-fg">{restaurant.name}</p>
                    <p className="mt-2 font-display text-lg font-semibold leading-6 tracking-tight">{form.title || 'Titre de votre e-mail'}</p>
                    <p className="mt-2 whitespace-pre-line text-xs leading-5 text-fg-muted">{form.body || 'Votre message apparaîtra ici.'}</p>
                    <span className="mt-4 inline-flex rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-fg">Commander chez {restaurant.name}</span>
                    <p className="mt-3 truncate text-2xs text-fg-subtle">{link}</p>
                  </div>
                </div>
              </div>
            )}
            {promo && <p className="text-xs text-fg-muted">Ouvre l’offre « {promotionName(promo)} » ({discountLabel(promo)}).</p>}
          </aside>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onClose} disabled={save.loading}>
          Annuler
        </Button>
        <Button variant="secondary" loading={save.loading} onClick={() => void submit('draft')}>
          Enregistrer le brouillon
        </Button>
        <Button
          variant="primary"
          leftIcon={form.when === 'now' ? <Send /> : <CalendarClock />}
          loading={save.loading}
          disabled={reachable === 0}
          onClick={() => {
            setTouched(true);
            if (!hasErrors) setConfirmOpen(true);
          }}
        >
          {form.when === 'now' ? 'Envoyer' : 'Programmer'}
        </Button>
      </SheetFooter>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={form.when === 'now' ? 'Envoyer la campagne maintenant ?' : 'Programmer la campagne ?'}
        description={
          <>
            {reachable !== null ? `${formatNumber(reachable)} client${reachable > 1 ? 's' : ''}` : 'Les clients joignables'} du segment «{' '}
            {RESTAURANT_CAMPAIGN_SEGMENT_LABELS[form.segment]} » recevront {form.channel === 'push' ? 'la notification' : 'l’e-mail'}
            {form.when === 'later' ? ` ${scheduledLabel}.` : ' dans quelques instants.'} {form.when === 'now' ? 'Un envoi ne peut pas être annulé.' : 'Vous pourrez annuler jusqu’à l’heure prévue.'}
          </>
        }
        confirmLabel={form.when === 'now' ? 'Envoyer' : 'Programmer'}
        onConfirm={() => submit(form.when === 'now' ? 'send_now' : 'schedule')}
      />
    </>
  );
}

/** Pastille compacte « Notification / E-mail ». */
export function ChannelTag({ channel }: { channel: string }) {
  const email = channel === 'email';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-fg-muted', '[&_svg]:size-3.5')}>
      {email ? <Mail /> : <Bell />}
      {email ? 'E-mail' : 'Notification'}
    </span>
  );
}
