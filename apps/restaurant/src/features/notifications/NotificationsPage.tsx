import { useEffect, useMemo, useState } from 'react';
import { BellRing, Mail, MessageSquareText, MonitorSmartphone, Play, Volume2 } from 'lucide-react';
import {
  Badge,
  Button,
  FormField,
  PageContainer,
  PageHeader,
  Slider,
  Switch,
  cn,
  toast,
} from '@golink/ui';
import type { RestaurantAlertKey, RestaurantNotificationSettings, RestaurantNotificationSound } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings, type NotificationsInput } from '../parametres/kit/api';
import { useDraft, useRestaurantSettings, useUnsavedGuard } from '../parametres/kit/hooks';
import { ChipsInput } from '../parametres/kit/inputs';
import { LoadError, Notice, RowList, SaveBar, SettingRow, SettingsCard, SettingsSkeleton } from '../parametres/kit/ui';
import { SOUND_OPTIONS, playSound } from './sounds';

type Draft = Omit<NotificationsInput, 'section'>;

const ALERTS: Array<{ key: RestaurantAlertKey; label: string; description: string; defaults: { inApp: boolean; email: boolean } }> = [
  { key: 'order_cancelled', label: 'Commande annulée', description: 'Par le client, le livreur ou le support.', defaults: { inApp: true, email: false } },
  { key: 'order_late', label: 'Commande en retard', description: 'Préparation qui dépasse le délai annoncé.', defaults: { inApp: true, email: false } },
  { key: 'low_stock', label: 'Stock bas', description: 'Un produit suivi passe sous son seuil d’alerte.', defaults: { inApp: true, email: true } },
  { key: 'new_review', label: 'Nouvel avis client', description: 'Pour répondre rapidement, surtout aux avis négatifs.', defaults: { inApp: true, email: false } },
  { key: 'new_message', label: 'Nouveau message', description: 'Message d’un client, d’un livreur ou du support Ciyou Eats.', defaults: { inApp: true, email: false } },
  { key: 'document_expiry', label: 'Document bientôt expiré', description: 'Pièce d’identité ou attestation à renouveler (J-30 et J-7).', defaults: { inApp: true, email: true } },
  { key: 'payout_paid', label: 'Virement effectué', description: 'Vos ventes ont été reversées sur votre compte.', defaults: { inApp: true, email: true } },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 .()-]{6,20}$/;

function permissionState(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Sons, alertes, e-mails et SMS de l'établissement. */
export function NotificationsPage() {
  const { restaurantId } = useRestaurantAccess();
  const settings = useRestaurantSettings<RestaurantNotificationSettings>('notifications');
  const [browserPermission, setBrowserPermission] = useState(permissionState);

  const source = useMemo<Draft | null>(() => {
    if (settings.loading) return null;
    const s = settings.data;
    return {
      newOrderSound: s?.newOrderSound ?? true,
      sound: s?.sound ?? 'chime',
      volume: s?.volume ?? 80,
      repeatUntilAccepted: s?.repeatUntilAccepted ?? true,
      emailDailySummary: s?.emailDailySummary ?? false,
      emailWeeklyReport: s?.emailWeeklyReport ?? true,
      emailInvoices: s?.emailInvoices ?? true,
      emailRecipients: s?.emailRecipients ?? [],
      smsOnNewOrder: s?.smsOnNewOrder ?? false,
      smsNumbers: s?.smsNumbers ?? [],
      alerts: Object.fromEntries(ALERTS.map((a) => [a.key, s?.alerts?.[a.key] ?? a.defaults])) as Draft['alerts'],
    };
  }, [settings.data, settings.loading]);

  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Préférences de notification enregistrées.' });

  useEffect(() => {
    const refresh = () => setBrowserPermission(permissionState());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const header = (
    <PageHeader eyebrow="Configuration" title="Notifications" description="Soyez averti au bon moment, par le bon canal, sans être submergé." />
  );
  if (settings.error)
    return (
      <PageContainer>
        {header}
        <LoadError message={errorMessage(settings.error)} />
      </PageContainer>
    );
  if (!draft)
    return (
      <PageContainer>
        {header}
        <SettingsSkeleton cards={3} />
      </PageContainer>
    );

  const wantsEmail = draft.emailDailySummary || draft.emailWeeklyReport || draft.emailInvoices || Object.values(draft.alerts).some((a) => a.email);
  const missingRecipients = wantsEmail && draft.emailRecipients.length === 0;
  const missingNumbers = draft.smsOnNewOrder && draft.smsNumbers.length === 0;
  const invalid = missingRecipients || missingNumbers;

  const setAlert = (key: RestaurantAlertKey, channel: 'inApp' | 'email', on: boolean) =>
    setDraft((d) => ({ ...d, alerts: { ...d.alerts, [key]: { ...d.alerts[key], [channel]: on } } }));

  const preview = async (sound: RestaurantNotificationSound) => {
    const ok = await playSound(sound, draft.volume);
    if (!ok) toast.error('Votre navigateur ne permet pas de jouer ce son.');
  };

  const askBrowser = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setBrowserPermission(result);
    if (result === 'granted') {
      new Notification('Ciyou Eats Restaurant', { body: 'Les notifications sont activées sur cet appareil.', icon: '/favicon.svg' });
    }
  };

  const onSave = async () => {
    const result = await save.mutate({ restaurantId, section: 'notifications', ...draft });
    if (result) markSaved();
  };

  return (
    <PageContainer>
      {header}
      <div className="grid gap-6">
        <SettingsCard icon={<BellRing />} title="Nouvelle commande" description="Le signal le plus important de votre service.">
          <RowList>
            <SettingRow icon={<Volume2 />} label="Son à chaque nouvelle commande" description="Joué sur tous les appareils connectés au back-office.">
              <Switch checked={draft.newOrderSound} aria-label="Son de nouvelle commande" onCheckedChange={(v) => setDraft({ newOrderSound: v })} />
            </SettingRow>
          </RowList>
          <div className={cn('mt-4 grid gap-5 border-t border-border pt-5 transition-opacity', !draft.newOrderSound && 'pointer-events-none opacity-50')}>
            <div role="radiogroup" aria-label="Son" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {SOUND_OPTIONS.map((option) => {
                const selected = draft.sound === option.value;
                return (
                  <div
                    key={option.value}
                    className={cn(
                      'flex items-start justify-between gap-2 rounded-xl border bg-surface p-3.5 transition-colors',
                      selected ? 'border-primary bg-primary-soft/40' : 'border-border hover:border-border-strong',
                    )}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!draft.newOrderSound}
                      className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        setDraft({ sound: option.value });
                        void preview(option.value);
                      }}
                    >
                      <span className="block text-sm font-medium text-fg">{option.label}</span>
                      <span className="block text-xs text-fg-subtle">{option.description}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Écouter : ${option.label}`}
                      disabled={!draft.newOrderSound}
                      onClick={() => void preview(option.value)}
                    >
                      <Play />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Volume">
                <div className="flex items-center gap-3 pt-2">
                  <Slider
                    className="min-w-0 flex-1"
                    min={10}
                    max={100}
                    step={10}
                    value={[draft.volume]}
                    aria-label="Volume"
                    formatValue={(v) => `${v} %`}
                    onValueChange={([v]) => v !== undefined && setDraft({ volume: v })}
                    onValueCommit={() => void preview(draft.sound)}
                  />
                  <span className="w-12 shrink-0 text-right font-mono text-sm text-fg num">{draft.volume} %</span>
                </div>
              </FormField>
              <SettingRow label="Répéter jusqu’à l’acceptation" description="Le son est répété tant que la commande attend d’être acceptée.">
                <Switch checked={draft.repeatUntilAccepted} aria-label="Répéter le son" onCheckedChange={(v) => setDraft({ repeatUntilAccepted: v })} />
              </SettingRow>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <div>
                <p className="text-sm font-medium text-fg">Notifications de cet appareil</p>
                <p className="text-xs text-fg-subtle">Réglage propre à ce navigateur : utile quand l’onglet Ciyou Eats est en arrière-plan.</p>
              </div>
            </div>
            {browserPermission === 'granted' ? (
              <Badge tone="success">Autorisées</Badge>
            ) : browserPermission === 'denied' ? (
              <Badge tone="danger">Bloquées dans le navigateur</Badge>
            ) : browserPermission === 'unsupported' ? (
              <Badge>Non prises en charge</Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void askBrowser()}>
                Autoriser
              </Button>
            )}
          </div>
        </SettingsCard>

        <SettingsCard icon={<BellRing />} title="Alertes" description="Choisissez les événements qui méritent votre attention, et où les recevoir.">
          <div data-scroll-ok className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 pb-2.5 font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle">Événement</th>
                  <th className="w-28 px-3 pb-2.5 text-center font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle">Back-office</th>
                  <th className="w-28 px-5 pb-2.5 text-center font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle">E-mail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ALERTS.map((alert) => (
                  <tr key={alert.key}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-fg">{alert.label}</p>
                      <p className="text-xs text-fg-subtle">{alert.description}</p>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Switch
                        size="sm"
                        checked={draft.alerts[alert.key].inApp}
                        aria-label={`${alert.label} : back-office`}
                        onCheckedChange={(v) => setAlert(alert.key, 'inApp', v)}
                      />
                    </td>
                    <td className="px-5 py-3 text-center">
                      <Switch
                        size="sm"
                        checked={draft.alerts[alert.key].email}
                        aria-label={`${alert.label} : e-mail`}
                        onCheckedChange={(v) => setAlert(alert.key, 'email', v)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <SettingsCard icon={<Mail />} title="E-mails" description="Rapports et documents envoyés automatiquement.">
            <RowList>
              <SettingRow label="Récapitulatif quotidien" description="Ventes, commandes et avis de la veille, chaque matin.">
                <Switch checked={draft.emailDailySummary} aria-label="Récapitulatif quotidien" onCheckedChange={(v) => setDraft({ emailDailySummary: v })} />
              </SettingRow>
              <SettingRow label="Rapport hebdomadaire" description="Tendances de la semaine, chaque lundi.">
                <Switch checked={draft.emailWeeklyReport} aria-label="Rapport hebdomadaire" onCheckedChange={(v) => setDraft({ emailWeeklyReport: v })} />
              </SettingRow>
              <SettingRow label="Factures et relevés" description="Factures Ciyou Eats et relevés de versement.">
                <Switch checked={draft.emailInvoices} aria-label="Factures et relevés" onCheckedChange={(v) => setDraft({ emailInvoices: v })} />
              </SettingRow>
            </RowList>
            <FormField
              className="mt-5"
              label="Destinataires"
              hint="Cinq adresses au plus. Entrée pour valider."
              error={missingRecipients ? 'Ajoutez au moins une adresse pour recevoir les e-mails activés.' : undefined}
            >
              <ChipsInput
                values={draft.emailRecipients}
                max={5}
                inputMode="email"
                placeholder="gerant@exemple.fr"
                validate={(v) => (EMAIL.test(v) ? null : 'Adresse e-mail invalide.')}
                onChange={(emailRecipients) => setDraft({ emailRecipients })}
              />
            </FormField>
          </SettingsCard>

          <SettingsCard icon={<MessageSquareText />} title="SMS" description="Pour ne manquer aucune commande, même loin de l’écran.">
            <RowList>
              <SettingRow label="SMS à chaque nouvelle commande" description="Un SMS résume chaque nouvelle commande reçue.">
                <Switch checked={draft.smsOnNewOrder} aria-label="SMS de nouvelle commande" onCheckedChange={(v) => setDraft({ smsOnNewOrder: v })} />
              </SettingRow>
            </RowList>
            <FormField
              className="mt-5"
              label="Numéros"
              hint="Trois numéros au plus, format international conseillé (+33…)."
              error={missingNumbers ? 'Ajoutez un numéro pour recevoir les SMS.' : undefined}
            >
              <ChipsInput
                values={draft.smsNumbers}
                max={3}
                inputMode="tel"
                placeholder="+33 6 12 34 56 78"
                validate={(v) => (PHONE.test(v) ? null : 'Numéro invalide.')}
                onChange={(smsNumbers) => setDraft({ smsNumbers })}
              />
            </FormField>
            <Notice tone="neutral" className="mt-5">
              Les SMS sont envoyés par Ciyou Eats. Ils complètent le son et les notifications, sans les remplacer.
            </Notice>
          </SettingsCard>
        </div>
      </div>
      <SaveBar
        dirty={dirty}
        saving={save.loading}
        disabled={invalid}
        message={invalid ? 'Destinataires manquants' : 'Préférences modifiées'}
        onSave={() => void onSave()}
        onReset={reset}
      />
    </PageContainer>
  );
}
