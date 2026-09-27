import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { collection, query } from 'firebase/firestore';
import { Bell, Bike, Braces, Mail, MessageSquareText, PenLine, ShieldCheck, Smartphone, Store, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Textarea,
  formatRelative,
  toast,
} from '@golink/ui';
import { COLLECTIONS, DEFAULT_NOTIFICATION_DELIVERY, NOT_YET_EMITTED_MESSAGE_KEYS, SETTINGS_DOCS, type MessageTemplate, type NotificationDeliverySettings, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, docAt, errorMessage, toMillis, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { updateMessageTemplate } from '../_croissance/api';
import { ChipGroup, LoadError } from '../_croissance/ui';
import { CommunicationLayout } from './layout';

type Row = WithId<MessageTemplate>;
type Channel = MessageTemplate['channels'][number];

const AUDIENCES: Array<{ id: MessageTemplate['audience']; label: string; description: string; icon: ReactElement }> = [
  { id: 'client', label: 'Clients', description: 'Suivi de commande, remboursements, parrainage', icon: <UserRound /> },
  { id: 'restaurant', label: 'Restaurants', description: 'Nouvelles commandes, validation, factures, reversements', icon: <Store /> },
  { id: 'driver', label: 'Livreurs', description: 'Validation du compte, paiements', icon: <Bike /> },
  { id: 'admin', label: 'Équipe GoLink', description: 'Invitations et alertes internes', icon: <ShieldCheck /> },
];

const CHANNEL_OPTIONS: Array<{ value: Channel; label: string; icon: ReactElement }> = [
  { value: 'push', label: 'Push', icon: <Smartphone /> },
  { value: 'email', label: 'E-mail', icon: <Mail /> },
  { value: 'sms', label: 'SMS', icon: <MessageSquareText /> },
  { value: 'in_app', label: 'Dans l’app', icon: <Bell /> },
];

/** Valeurs d'exemple pour l'aperçu des variables. */
const SAMPLES: Record<string, string> = {
  orderNumber: 'GL-48213',
  restaurantName: 'Mina Kitchen',
  driverName: 'Karim',
  eta: '19 h 42',
  reason: 'restaurant fermé',
  amount: '12,50 €',
  itemsCount: '3',
  total: '31,90 €',
  period: '15 au 21 septembre',
  documentType: 'attestation d’assurance',
  date: '30 octobre',
  firstName: 'Camille',
  invoiceNumber: 'F-2026-0912',
  role: 'parrain',
  code: '4821',
};

function fill(text: string): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => SAMPLES[k] ?? `[${k}]`);
}

const updateDelivery = callFunction<Omit<NotificationDeliverySettings, 'updatedAt' | 'updatedBy'> & { reason: string }, { updatedFields: string[] }>('updateNotificationDelivery');

/** Envoi réel ou simulation (dry-run) des messages automatiques : réglable par l'équipe centrale. */
function DeliveryCard({ canEdit }: { canEdit: boolean }) {
  const doc = useDoc<NotificationDeliverySettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.notificationDelivery}`));
  const saved = { ...DEFAULT_NOTIFICATION_DELIVERY, ...(doc.data ?? {}) };
  const [draft, setDraft] = useState(saved);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setDraft({ ...DEFAULT_NOTIFICATION_DELIVERY, ...(doc.data ?? {}) }), [doc.data]);
  const dirty = draft.emailLive !== saved.emailLive || draft.smsLive !== saved.smsLive || draft.pushLive !== saved.pushLive;
  const live = saved.emailLive || saved.smsLive || saved.pushLive;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-md font-semibold tracking-tight text-fg">Envoi des messages</h3>
          <p className="text-sm text-fg-muted">Mode simulation : chaque message est préparé et journalisé, mais l’e-mail ou le SMS n’est pas transmis. Le centre de notifications de l’app reçoit toujours le message.</p>
        </div>
        <Badge tone={live ? 'success' : 'amber'}>{live ? 'Envoi réel actif' : 'Simulation'}</Badge>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <Switch checked={draft.emailLive} onCheckedChange={(v) => setDraft((d) => ({ ...d, emailLive: v }))} disabled={!canEdit} label="E-mails réels (Brevo)" description="Adresses de test et données de démonstration jamais envoyées." />
        <Switch checked={draft.smsLive} onCheckedChange={(v) => setDraft((d) => ({ ...d, smsLive: v }))} disabled={!canEdit} label="SMS réels (Brevo)" />
        <Switch checked={draft.pushLive} onCheckedChange={(v) => setDraft((d) => ({ ...d, pushLive: v }))} disabled={!canEdit} label="Push réels (FCM)" description="Nécessite des appareils enregistrés." />
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          <Button variant="primary" disabled={!dirty || doc.loading} onClick={() => setConfirm(true)}>
            Enregistrer
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(saved)}>
              Annuler
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Modifier l’envoi des messages"
        description="Activer l’envoi réel transmet les e-mails, SMS ou push aux vrais destinataires."
        requireReason
        confirmLabel="Enregistrer"
        onConfirm={async (reason) => {
          try {
            await updateDelivery({ emailLive: draft.emailLive, smsLive: draft.smsLive, pushLive: draft.pushLive, reason: reason ?? '' });
            toast.success('Envoi des messages mis à jour');
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </Card>
  );
}

function Editor({ template, canEdit, onDone }: { template: Row; canEdit: boolean; onDone: () => void }) {
  const [active, setActive] = useState(template.active);
  const [channels, setChannels] = useState<Channel[]>(template.channels);
  const [subject, setSubject] = useState(template.subject?.fr ?? '');
  const [title, setTitle] = useState(template.title?.fr ?? '');
  const [body, setBody] = useState(template.body.fr);
  const [focus, setFocus] = useState<'subject' | 'title' | 'body'>('body');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { mutate, loading } = useMutation(updateMessageTemplate, { success: 'Message automatique enregistré' });

  const used = useMemo(() => [...new Set([...`${subject} ${title} ${body}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1] as string))], [subject, title, body]);
  const unknown = used.filter((v) => !template.variables.includes(v));
  const errors = {
    channels: channels.length === 0 ? 'Au moins un canal.' : undefined,
    subject: channels.includes('email') && !subject.trim() ? 'Objet requis pour l’e-mail.' : undefined,
    title: title.trim().length < 2 ? 'Titre requis.' : undefined,
    body: body.trim().length < 5 ? 'Texte requis.' : channels.includes('sms') && body.length > 320 ? '320 caractères au maximum pour le SMS.' : undefined,
    vars: unknown.length ? `Variable inconnue : {{${unknown[0]}}}` : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  function insert(v: string) {
    const token = `{{${v}}}`;
    if (focus === 'subject') return setSubject((s) => `${s}${token}`);
    if (focus === 'title') return setTitle((s) => `${s}${token}`);
    const el = bodyRef.current;
    if (!el) return setBody((s) => `${s}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
      <SheetHeader title={template.event} description={`Message automatique · ${template.key}`} icon={<PenLine />} />
      <SheetBody className="space-y-5">
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-2 p-4">
          <span>
            <span className="block text-sm font-medium text-fg">Message actif</span>
            <span className="block text-sm text-fg-muted">Désactivé, il n’est plus envoyé (les messages indispensables au service restent conseillés).</span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} disabled={!canEdit} aria-label="Message actif" />
        </label>
        <FormField label="Canaux" error={errors.channels}>
          <div>
            <ChipGroup label="Canaux" value={channels} onChange={setChannels} options={CHANNEL_OPTIONS.map((c) => ({ ...c, disabled: !canEdit }))} />
          </div>
        </FormField>
        {template.variables.length > 0 && (
          <div className="rounded-xl border border-border p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <Braces className="size-3.5" /> Variables disponibles (insérées dans le champ actif)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {template.variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => insert(v)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-2xs text-fg transition-colors hover:border-primary hover:text-primary-soft-fg disabled:opacity-50"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        )}
        {channels.includes('email') && (
          <FormField label="Objet de l’e-mail" error={errors.subject}>
            <Input value={subject} maxLength={120} onFocus={() => setFocus('subject')} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} />
          </FormField>
        )}
        <FormField label="Titre" error={errors.title}>
          <Input value={title} maxLength={80} onFocus={() => setFocus('title')} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField
          label="Texte"
          error={errors.body ?? errors.vars}
          aside={<span className="num font-mono text-2xs text-fg-subtle">{body.length} car.</span>}
        >
          <Textarea ref={bodyRef} rows={5} value={body} onFocus={() => setFocus('body')} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} />
        </FormField>
        <div>
          <p className="eyebrow mb-2">Aperçu avec des valeurs d’exemple</p>
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            {channels.includes('email') && subject && <p className="mb-1 text-xs text-fg-muted">Objet : {fill(subject)}</p>}
            <p className="font-medium text-fg">{fill(title) || 'Titre'}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{fill(body)}</p>
          </div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onDone}>
          {canEdit ? 'Annuler' : 'Fermer'}
        </Button>
        {canEdit && (
          <Button
            variant="primary"
            loading={loading}
            disabled={!valid}
            onClick={async () => {
              const ok = await mutate({ key: template.id, active, channels, subject: channels.includes('email') ? subject.trim() : null, title: title.trim(), body: body.trim() });
              if (ok) onDone();
            }}
          >
            Enregistrer
          </Button>
        )}
      </SheetFooter>
    </SheetContent>
  );
}

export function TemplatesPage() {
  useDocumentTitle('Messages automatiques · GoLink Admin');
  const { can, admin } = useAdminAccess();
  const canEdit = can('templates.edit') && (admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0));
  const q = useMemo(() => query(collection(db, COLLECTIONS.messageTemplates)), []);
  const { data, loading, error } = useCollection<MessageTemplate>(q);
  const [editing, setEditing] = useState<Row | null>(null);

  return (
    <CommunicationLayout>
      <p className="mb-6 max-w-3xl text-sm text-fg-muted">
        Textes envoyés automatiquement à chaque étape (confirmation, livreur en route, validation de compte, facture disponible…). Modifiez-les sans développeur : les
        variables entre accolades sont remplacées à l’envoi.
      </p>
      <DeliveryCard canEdit={canEdit} />
      {error ? (
        <Card>
          <LoadError error={error} />
        </Card>
      ) : loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<Mail />} title="Aucun message automatique" description="Les modèles sont créés à l’installation de la plateforme." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {AUDIENCES.map((aud) => {
            const items = data.filter((t) => t.audience === aud.id).sort((a, b) => a.event.localeCompare(b.event, 'fr'));
            if (items.length === 0) return null;
            return (
              <Card key={aud.id} className="min-w-0">
                <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-[18px]">{aud.icon}</div>
                  <div className="min-w-0">
                    <h3 className="font-display text-md font-semibold tracking-tight text-fg">{aud.label}</h3>
                    <p className="text-sm text-fg-muted">{aud.description}</p>
                  </div>
                  <Badge className="ml-auto">{items.length}</Badge>
                </div>
                <ul className="divide-y divide-border">
                  {items.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => setEditing(t)} className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-fg">{t.event}</p>
                            {!t.active && (
                              <Badge tone="neutral" size="sm">
                                Désactivé
                              </Badge>
                            )}
                            {NOT_YET_EMITTED_MESSAGE_KEYS.includes(t.key) && (
                              <Badge tone="amber" size="sm">
                                Pas encore émis
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted" title={String(t.body.fr ?? '')}>{t.body.fr}</p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs text-fg-subtle">
                            {t.channels.map((c) => (
                              <span key={c} className="rounded bg-surface-3 px-1.5 py-px">
                                {CHANNEL_OPTIONS.find((o) => o.value === c)?.label}
                              </span>
                            ))}
                            {toMillis(t.updatedAt) && <span>· modifié {formatRelative(toMillis(t.updatedAt) ?? 0)}</span>}
                          </p>
                        </div>
                        <PenLine className="mt-1 size-4 shrink-0 text-fg-subtle" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <Editor key={editing.id} template={editing} canEdit={canEdit} onDone={() => setEditing(null)} />}
      </Sheet>
    </CommunicationLayout>
  );
}
