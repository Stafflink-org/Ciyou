import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, limit, orderBy, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ArrowDown, ArrowUp, MessageSquareText, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, EmptyState, FormField, IconButton, Input, PageContainer, PageHeader, Select, Skeleton, Switch, cn, toast, Table } from '@golink/ui';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  paths,
  richTextToPlain,
  type CannedResponse,
  type SupportSettings,
  type TicketPriority,
  type TicketReason,
  type TicketRequesterType,
  type UpdateExperienceSettingsInput,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { createdFields, docAt, errorMessage, updatedFields, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';
import { REQUESTER_LABELS } from '../_experience/labels';
import { LoadError, Panel, RichTextEditor } from '../_experience/ui';
import { SupportNav } from './components';

const updateSettings = callFunctionWithReason<UpdateExperienceSettingsInput, { changed: string[] }>('updateExperienceSettings', { title: 'Enregistrer les réglages du support' });
const REQUESTERS: TicketRequesterType[] = ['client', 'restaurant', 'driver'];

export function SettingsPage() {
  useDocumentTitle('Motifs et délais · Support · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const editable = can('support.configure');
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Opérations"
        title="Support et litiges"
        description="Motifs de contact, réponses types et délais cibles de l’équipe support."
      />
      <SupportNav />
      {!editable && (
        <p className="tone-info mb-6 rounded-lg bg-(--tone-bg) px-4 py-2.5 text-sm text-(--tone-fg)">Consultation seule : la configuration du support est réservée aux responsables (droit « Configurer le support »).</p>
      )}
      <div className="space-y-6">
        <SlaPanel editable={editable} />
        <div className="grid gap-6 xl:grid-cols-2">
          <ReasonsPanel editable={editable} />
          <CannedPanel editable={editable} />
        </div>
      </div>
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Délais cibles

function SlaPanel({ editable }: { editable: boolean }) {
  const { can } = useAdminAccess();
  const settings = useDoc<SupportSettings>(can('settings.view') || can('support.view') ? docAt(paths.settings(SETTINGS_DOCS.support)) : null);
  const [draft, setDraft] = useState<Pick<SupportSettings, 'firstResponseTargetMinutes' | 'resolutionTargetHours' | 'autoEscalateAfterMinutes' | 'liveChatEnabled'> & { autoCloseResolvedAfterDays: number } | null>(null);
  const { mutate, loading } = useMutation(updateSettings, { success: (r) => (r.changed.length ? 'Délais enregistrés' : 'Aucun changement') });

  useEffect(() => {
    if (!settings.data) return;
    const s = settings.data;
    setDraft({
      firstResponseTargetMinutes: { ...s.firstResponseTargetMinutes },
      resolutionTargetHours: { ...s.resolutionTargetHours },
      autoEscalateAfterMinutes: s.autoEscalateAfterMinutes,
      liveChatEnabled: s.liveChatEnabled,
      autoCloseResolvedAfterDays: s.autoCloseResolvedAfterDays ?? 7,
    });
  }, [settings.data]);

  const num = (v: string) => Math.max(0, Number(v.replace(/\D/g, '')) || 0);

  return (
    <Panel
      title="Délais cibles"
      description="Appliqués à l’ouverture de chaque ticket selon sa priorité. Au-delà, le ticket est signalé puis escaladé automatiquement."
      actions={editable && draft ? <Button variant="primary" size="sm" loading={loading} onClick={() => void mutate({ doc: 'support', values: draft })}>Enregistrer</Button> : undefined}
    >
      {settings.error ? <LoadError error={settings.error} compact /> : !draft ? <Skeleton className="h-40" /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-eyebrow text-fg-subtle">
                  <th className="pb-2 font-medium">Priorité</th>
                  <th className="pb-2 font-medium">Première réponse</th>
                  <th className="pb-2 font-medium">Résolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {TICKET_PRIORITIES.map((p) => (
                  <tr key={p}>
                    <td className="py-2 pr-3 font-medium">{TICKET_PRIORITY_LABELS[p]}</td>
                    <td className="py-2 pr-3">
                      <Input size="sm" className="w-32" inputMode="numeric" disabled={!editable} value={String(draft.firstResponseTargetMinutes[p])} trailing="min"
                        onChange={(e) => setDraft({ ...draft, firstResponseTargetMinutes: { ...draft.firstResponseTargetMinutes, [p]: num(e.target.value) } })} aria-label={`Première réponse, priorité ${TICKET_PRIORITY_LABELS[p]}`} />
                    </td>
                    <td className="py-2">
                      <Input size="sm" className="w-32" inputMode="numeric" disabled={!editable} value={String(draft.resolutionTargetHours[p])} trailing="h"
                        onChange={(e) => setDraft({ ...draft, resolutionTargetHours: { ...draft.resolutionTargetHours, [p]: num(e.target.value) } })} aria-label={`Résolution, priorité ${TICKET_PRIORITY_LABELS[p]}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="space-y-4">
            <FormField label="Escalade automatique" hint="Sans première réponse, ce délai après l’échéance.">
              <Input inputMode="numeric" disabled={!editable} value={String(draft.autoEscalateAfterMinutes)} trailing="min" onChange={(e) => setDraft({ ...draft, autoEscalateAfterMinutes: num(e.target.value) })} />
            </FormField>
            <FormField label="Fermeture des tickets résolus" hint="Sans nouvelle réponse du demandeur.">
              <Input inputMode="numeric" disabled={!editable} value={String(draft.autoCloseResolvedAfterDays)} trailing="jours" onChange={(e) => setDraft({ ...draft, autoCloseResolvedAfterDays: num(e.target.value) })} />
            </FormField>
            <Switch checked={draft.liveChatEnabled} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, liveChatEnabled: v })} label="Chat en direct" description="Proposé aux clients pendant une commande." />
          </div>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ Motifs

function ReasonsPanel({ editable }: { editable: boolean }) {
  const q = useMemo(() => query(collection(db, COLLECTIONS.ticketReasons), orderBy('order'), limit(100)), []);
  const { data, loading, error } = useCollection<TicketReason>(q);
  const [editing, setEditing] = useState<WithId<TicketReason> | 'new' | null>(null);

  async function move(index: number, delta: number) {
    const target = data[index + delta];
    const current = data[index];
    if (!target || !current) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, COLLECTIONS.ticketReasons, current.id), { order: target.order });
      batch.update(doc(db, COLLECTIONS.ticketReasons, target.id), { order: current.order === target.order ? current.order + delta : current.order });
      await batch.commit();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function toggle(reason: WithId<TicketReason>) {
    try {
      await updateDoc(doc(db, COLLECTIONS.ticketReasons, reason.id), { active: !reason.active });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Panel
      title="Motifs de contact"
      description="Proposés aux demandeurs à l’ouverture d’un ticket, dans cet ordre."
      actions={editable ? <Button size="sm" leftIcon={<Plus />} onClick={() => setEditing('new')}>Ajouter</Button> : undefined}
      bodyClassName="p-0"
    >
      {error ? <LoadError error={error} compact /> : loading ? <div className="p-5"><Skeleton className="h-40" /></div> : data.length === 0 ? (
        <EmptyState compact icon={<Tags />} title="Aucun motif" description="Ajoutez les motifs de contact : retard, article manquant, paiement…" />
      ) : (
        <ul className="divide-y divide-border">
          {data.map((r, i) => (
            <li key={r.id} className={cn('flex items-center gap-3 px-5 py-3', !r.active && 'opacity-60')}>
              {editable && (
                <div className="flex flex-col">
                  <IconButton size="xs" variant="ghost" label="Monter" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp /></IconButton>
                  <IconButton size="xs" variant="ghost" label="Descendre" disabled={i === data.length - 1} onClick={() => void move(i, 1)}><ArrowDown /></IconButton>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{r.label.fr}</span>
                  {r.requiresOrder && <Badge size="sm" tone="info" variant="outline">Commande requise</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-fg-muted">{r.audience.map((a) => REQUESTER_LABELS[a]).join(', ')} · priorité {TICKET_PRIORITY_LABELS[r.defaultPriority].toLowerCase()}</div>
              </div>
              {editable && (
                <>
                  <Switch size="sm" checked={r.active} onCheckedChange={() => void toggle(r)} aria-label={r.active ? 'Désactiver' : 'Activer'} />
                  <IconButton size="sm" variant="ghost" label="Modifier" onClick={() => setEditing(r)}><Pencil /></IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog key={editing === 'new' ? 'new' : (editing?.id ?? '')} reason={editing} onClose={() => setEditing(null)} nextOrder={(data.at(-1)?.order ?? -1) + 1} />
    </Panel>
  );
}

function ReasonDialog({ reason, onClose, nextOrder }: { reason: WithId<TicketReason> | 'new' | null; onClose: () => void; nextOrder: number }) {
  const existing = reason && reason !== 'new' ? reason : null;
  const [label, setLabel] = useState(existing?.label.fr ?? '');
  const [audience, setAudience] = useState<TicketRequesterType[]>(existing?.audience ?? ['client']);
  const [priority, setPriority] = useState<TicketPriority>(existing?.defaultPriority ?? 'normal');
  const [requiresOrder, setRequiresOrder] = useState(existing?.requiresOrder ?? false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const fields = { label: { fr: label.trim() }, audience, defaultPriority: priority, requiresOrder };
      if (existing) await updateDoc(doc(db, COLLECTIONS.ticketReasons, existing.id), fields);
      else await setDoc(doc(collection(db, COLLECTIONS.ticketReasons)), { ...fields, order: nextOrder, active: true });
      toast.success('Motif enregistré');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={reason !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader icon={<Tags />} title={existing ? 'Modifier le motif' : 'Nouveau motif'} />
        <DialogBody className="space-y-4">
          <FormField label="Libellé" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Livraison non reçue" />
          </FormField>
          <FormField label="Proposé aux">
            <div className="flex flex-wrap gap-4">
              {REQUESTERS.map((a) => (
                <Checkbox key={a} label={REQUESTER_LABELS[a]} checked={audience.includes(a)} onCheckedChange={(v) => setAudience((cur) => (v === true ? [...cur, a] : cur.filter((x) => x !== a)))} />
              ))}
            </div>
          </FormField>
          <FormField label="Priorité par défaut">
            <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))} />
          </FormField>
          <Switch checked={requiresOrder} onCheckedChange={setRequiresOrder} label="Commande obligatoire" description="Le demandeur doit choisir la commande concernée." />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={label.trim().length < 3 || audience.length === 0} onClick={() => void save()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Réponses types

function CannedPanel({ editable }: { editable: boolean }) {
  const q = useMemo(() => query(collection(db, COLLECTIONS.cannedResponses), orderBy('title'), limit(200)), []);
  const { data, loading, error } = useCollection<CannedResponse>(q);
  const reasons = useCollection<TicketReason>(useMemo(() => query(collection(db, COLLECTIONS.ticketReasons), orderBy('order')), []));
  const [editing, setEditing] = useState<WithId<CannedResponse> | 'new' | null>(null);
  const [removing, setRemoving] = useState<WithId<CannedResponse> | null>(null);

  return (
    <Panel
      title="Réponses types"
      description="Modèles insérés en un clic dans une réponse. Variables : {prenom}, {commande}, {restaurant}."
      actions={editable ? <Button size="sm" leftIcon={<Plus />} onClick={() => setEditing('new')}>Ajouter</Button> : undefined}
      bodyClassName="p-0"
    >
      {error ? <LoadError error={error} compact /> : loading ? <div className="p-5"><Skeleton className="h-40" /></div> : data.length === 0 ? (
        <EmptyState compact icon={<MessageSquareText />} title="Aucune réponse type" description="Gagnez du temps sur les demandes récurrentes." />
      ) : (
        <ul className="divide-y divide-border">
          {data.map((r) => (
            <li key={r.id} className={cn('flex items-start gap-3 px-5 py-3', !r.active && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{r.title}</span>
                  {r.shortcut && <span className="font-mono text-2xs text-fg-subtle">{r.shortcut}</span>}
                  {r.usageCount ? <Badge size="sm" tone="neutral">{r.usageCount} utilisations</Badge> : null}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted" title={String(richTextToPlain(r.body.fr) ?? '')}>{richTextToPlain(r.body.fr)}</p>
              </div>
              {editable && (
                <div className="flex shrink-0">
                  <IconButton size="sm" variant="ghost" label="Modifier" onClick={() => setEditing(r)}><Pencil /></IconButton>
                  <IconButton size="sm" variant="danger" label="Supprimer" onClick={() => setRemoving(r)}><Trash2 /></IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <CannedDialog key={editing === 'new' ? 'new' : (editing?.id ?? '')} response={editing} reasons={reasons.data} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Supprimer cette réponse type ?"
        description={removing?.title}
        destructive
        confirmLabel="Supprimer"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteDoc(doc(db, COLLECTIONS.cannedResponses, removing.id));
            toast.success('Réponse type supprimée');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Panel>
  );
}

function CannedDialog({ response, reasons, onClose }: { response: WithId<CannedResponse> | 'new' | null; reasons: WithId<TicketReason>[]; onClose: () => void }) {
  const { admin } = useAdminAccess();
  const existing = response && response !== 'new' ? response : null;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body.fr ?? '');
  const [shortcut, setShortcut] = useState(existing?.shortcut ?? '');
  const [reasonIds, setReasonIds] = useState<string[]>(existing?.reasonIds ?? []);
  const [active, setActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const fields = { title: title.trim(), body: { fr: body.trim() }, shortcut: shortcut.trim() || null, reasonIds, active };
      if (existing) await updateDoc(doc(db, COLLECTIONS.cannedResponses, existing.id), { ...fields, ...updatedFields(admin.uid) });
      else await setDoc(doc(collection(db, COLLECTIONS.cannedResponses)), { ...fields, usageCount: 0, ...createdFields(admin.uid) });
      toast.success('Réponse type enregistrée');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={response !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<MessageSquareText />} title={existing ? 'Modifier la réponse type' : 'Nouvelle réponse type'} />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <FormField label="Titre" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Retard : geste commercial" />
            </FormField>
            <FormField label="Raccourci">
              <Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} maxLength={12} placeholder="/retard" />
            </FormField>
          </div>
          <FormField label="Texte" required hint="Bonjour {prenom}, … — les variables sont remplacées à l’insertion.">
            <RichTextEditor value={body} onChange={setBody} minRows={7} aria-label="Texte de la réponse" />
          </FormField>
          <FormField label="Suggérée pour les motifs">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {reasons.map((r) => (
                <Checkbox key={r.id} label={r.label.fr} checked={reasonIds.includes(r.id)} onCheckedChange={(v) => setReasonIds((cur) => (v === true ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} />
              ))}
            </div>
          </FormField>
          <Switch checked={active} onCheckedChange={setActive} label="Active" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={saving} disabled={title.trim().length < 3 || body.trim().length < 5} onClick={() => void save()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

