import { useMemo, useRef, useState } from 'react';
import { addDoc, deleteDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Bike, Bot, FileText, MessageSquareText, MoreHorizontal, Pencil, Plus, Star, Trash2, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DataTable,
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
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  createColumnHelper,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import {
  AUTO_MESSAGE_DEFINITIONS,
  AUTO_MESSAGE_KEYS,
  MESSAGE_VARIABLES,
  REPLY_TEMPLATE_KIND_LABELS,
  REPLY_TEMPLATE_KINDS,
  RESTAURANT_MARKETING_DOCS,
  paths,
  renderMessageTemplate,
  unknownMessageVariables,
  type AutoMessageKey,
  type AutoMessageSetting,
  type MessageVariable,
  type ReplyTemplateKind,
  type RestaurantAutoMessages,
} from '@golink/shared';
import { useAuth, usePersistentState } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, docAt, errorMessage, toDate, updatedFields, useDoc, useMutation } from '@/lib/firestore';
import { useReplyTemplates, type TemplateRow } from './lib';

const column = createColumnHelper<TemplateRow>();

const KIND_ICONS: Record<ReplyTemplateKind, React.ReactNode> = {
  review_reply: <Star />,
  customer_message: <UserRound />,
  driver_message: <Bike />,
};

const TEMPLATE_VARIABLES: Record<ReplyTemplateKind, MessageVariable[]> = {
  review_reply: ['prenom', 'restaurant'],
  customer_message: ['prenom', 'restaurant', 'commande'],
  driver_message: ['livreur', 'commande', 'restaurant'],
};

export function TemplatesPage() {
  const [tab, setTab] = usePersistentState<string>('golink:restaurant:modeles:onglet', 'reponses');
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Modèles"
        description="Vos réponses types pour gagner du temps, et les messages envoyés automatiquement à chaque étape d’une commande."
        breadcrumbs={[{ label: 'Marketing', href: '/marketing' }, { label: 'Modèles' }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="reponses" icon={<MessageSquareText />}>
            Réponses types
          </TabsTrigger>
          <TabsTrigger value="automatiques" icon={<Bot />}>
            Messages automatiques
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reponses">
          <ReplyTemplatesTab />
        </TabsContent>
        <TabsContent value="automatiques">
          <AutoMessagesTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

// ------------------------------------------------------------------ Aide à la saisie des variables

function VariableChips({ variables, onInsert }: { variables: readonly MessageVariable[]; onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-fg-subtle">Insérer :</span>
      {variables.map((v) => (
        <button
          key={v}
          type="button"
          title={MESSAGE_VARIABLES[v]}
          onClick={() => onInsert(`{{${v}}}`)}
          className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted transition-colors hover:border-primary/60 hover:text-fg"
        >
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

const SAMPLE: Partial<Record<MessageVariable, string>> = { prenom: 'Camille', commande: 'GL-12884', code: '4821', minutes: '10', livreur: 'Ana' };

/** Insère un texte à la position du curseur d'une zone de saisie. */
function useInsertAt(value: string, onChange: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return { ref, insert };
}

// ------------------------------------------------------------------ Réponses types

function ReplyTemplatesTab() {
  const templates = useReplyTemplates();
  const { restaurantId } = useRestaurantAccess();
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<TemplateRow[] | null>(null);
  const remove = useMutation(
    async (rows: TemplateRow[]) => {
      for (const row of rows) await deleteDoc(docAt(`${paths.restaurantSub(restaurantId, 'replyTemplates')}/${row.id}`));
      return rows.length;
    },
    { success: (n) => (n > 1 ? `${n} réponses supprimées.` : 'Réponse supprimée.') },
  );

  const columns = useMemo(
    () => [
      column.accessor((t) => `${t.title} ${t.body}`, {
        id: 'titre',
        header: 'Réponse',
        cell: ({ row: { original: t } }) => (
          <div className="min-w-60 max-w-lg">
            <p className="flex items-center gap-2 font-medium text-fg">
              {t.title}
              {t.shortcut && <span className="font-mono text-2xs text-fg-subtle">{t.shortcut}</span>}
            </p>
            <p className="line-clamp-1 text-xs text-fg-muted">{t.body}</p>
          </div>
        ),
      }),
      column.accessor('kind', {
        header: 'Usage',
        cell: ({ getValue }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-muted [&_svg]:size-3.5">
            {KIND_ICONS[getValue()]}
            {REPLY_TEMPLATE_KIND_LABELS[getValue()]}
          </span>
        ),
      }),
      column.accessor((t) => t.ratings.join(','), {
        id: 'notes',
        header: 'Avis',
        cell: ({ row: { original: t } }) =>
          t.kind === 'review_reply' && t.ratings.length ? (
            <div className="flex gap-1">
              {[...t.ratings].sort().map((r) => (
                <Badge key={r} size="sm" tone={r >= 4 ? 'success' : r === 3 ? 'amber' : 'danger'}>
                  {r}★
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      }),
      column.accessor('usageCount', {
        header: 'Utilisations',
        meta: { align: 'right' },
        cell: ({ row: { original: t } }) => (
          <div className="text-right">
            <p className="font-mono text-sm num">{formatNumber(t.usageCount)}</p>
            {t.lastUsedAt && <p className="text-2xs text-fg-subtle">{formatRelative(toDate(t.lastUsedAt) ?? new Date())}</p>}
          </div>
        ),
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { align: 'right', className: 'w-12' },
        cell: ({ row: { original: t } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" label={`Actions pour ${t.title}`}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Pencil />} onSelect={() => setEditing(t)}>
                  Modifier
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setToDelete([t])}>
                  Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }),
    ],
    [],
  );

  const create = (
    <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
      Nouvelle réponse
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-fg-muted">
          Utilisables en un clic pour répondre à un avis ou dans la messagerie. Les variables comme {'{{prenom}}'} sont remplacées automatiquement.
        </p>
        {create}
      </div>
      {templates.error ? (
        <Card>
          <EmptyState icon={<FileText />} title="Impossible de charger vos réponses" description={errorMessage(templates.error)} />
        </Card>
      ) : (
        <DataTable
          data={templates.data}
          columns={columns}
          loading={templates.loading}
          getRowId={(t) => t.id}
          onRowClick={(t) => setEditing(t)}
          itemLabel="réponses"
          searchPlaceholder="Rechercher une réponse…"
          filters={[
            {
              id: 'usage',
              label: 'Usage',
              options: REPLY_TEMPLATE_KINDS.map((k) => ({ value: k, label: REPLY_TEMPLATE_KIND_LABELS[k] })),
              getValue: (t) => t.kind,
            },
          ]}
          bulkActions={[{ label: 'Supprimer', destructive: true, onClick: (rows, clear) => (setToDelete(rows), clear()) }]}
          emptyState={
            <EmptyState
              icon={<MessageSquareText />}
              title="Aucune réponse type"
              description="Préparez vos réponses aux avis positifs, aux réclamations ou aux questions fréquentes de vos clients."
              action={create}
            />
          }
        />
      )}
      <TemplateEditor template={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        destructive
        title={toDelete && toDelete.length > 1 ? `Supprimer ${toDelete.length} réponses ?` : 'Supprimer cette réponse ?'}
        description="Elle ne sera plus proposée dans les avis ni dans la messagerie."
        confirmLabel="Supprimer"
        onConfirm={async () => {
          if (toDelete) await remove.mutate(toDelete);
        }}
      />
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: TemplateRow | 'new' | null; onClose: () => void }) {
  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">{template !== null && <TemplateEditorBody key={template === 'new' ? 'new' : template.id} template={template === 'new' ? null : template} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function TemplateEditorBody({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const { user } = useAuth();
  const { restaurantId, restaurant } = useRestaurantAccess();
  const [kind, setKind] = useState<ReplyTemplateKind>(template?.kind ?? 'review_reply');
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [shortcut, setShortcut] = useState(template?.shortcut ?? '');
  const [ratings, setRatings] = useState<number[]>(template?.ratings ?? [4, 5]);
  const [touched, setTouched] = useState(false);
  const { ref, insert } = useInsertAt(body, setBody);
  const allowed = TEMPLATE_VARIABLES[kind];
  const unknown = unknownMessageVariables(body, allowed);
  const errors = {
    title: title.trim().length < 2 ? 'Donnez un titre court.' : undefined,
    body: body.trim().length < 5 ? 'Écrivez le texte de la réponse.' : unknown.length ? `Variable inconnue : ${unknown.map((v) => `{{${v}}}`).join(', ')}.` : undefined,
    shortcut: shortcut && !/^\/[a-z0-9-]{1,20}$/.test(shortcut) ? 'Format : /merci (minuscules, chiffres, tirets).' : undefined,
  };
  const valid = !errors.title && !errors.body && !errors.shortcut;

  const save = useMutation(
    async () => {
      const uid = user?.uid ?? '';
      const data = { kind, title: title.trim(), body: body.trim(), shortcut: shortcut || null, ratings: kind === 'review_reply' ? ratings : [] };
      if (template) await updateDoc(docAt(`${paths.restaurantSub(restaurantId, 'replyTemplates')}/${template.id}`), { ...data, ...updatedFields(uid) });
      else await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'replyTemplates')), { ...data, usageCount: 0, lastUsedAt: null, ...createdFields(uid) });
      return true;
    },
    { success: template ? 'Réponse mise à jour.' : 'Réponse créée.' },
  );

  return (
    <>
      <DialogHeader icon={<MessageSquareText />} title={template ? 'Modifier la réponse' : 'Nouvelle réponse type'} description="Un texte prêt à l’emploi, personnalisé automatiquement." />
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Usage">
            <Select value={kind} onValueChange={(v) => setKind(v as ReplyTemplateKind)} options={REPLY_TEMPLATE_KINDS.map((k) => ({ value: k, label: REPLY_TEMPLATE_KIND_LABELS[k] }))} />
          </FormField>
          <FormField label="Raccourci" hint="Facultatif, ex. /merci." error={touched ? errors.shortcut : undefined}>
            <Input className="font-mono" maxLength={21} placeholder="/merci" value={shortcut} onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/\s+/g, ''))} />
          </FormField>
        </div>
        <FormField label="Titre" required error={touched ? errors.title : undefined}>
          <Input maxLength={60} placeholder="Ex. Merci pour un avis 5 étoiles" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        {kind === 'review_reply' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">Suggérée pour les avis de</legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((r) => {
                const on = ratings.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRatings(on ? ratings.filter((x) => x !== r) : [...ratings, r])}
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-sm transition-colors',
                      on ? 'border-primary bg-primary-soft/60 text-fg' : 'border-border text-fg-muted hover:border-border-strong',
                    )}
                  >
                    {r} <Star className="size-3.5" />
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <FormField label="Texte" required error={touched ? errors.body : undefined} aside={`${body.length}/1000`}>
          <Textarea ref={ref} rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour {{prenom}}, merci pour votre retour…" />
        </FormField>
        <VariableChips variables={allowed} onInsert={insert} />
        {body.trim() && (
          <div className="rounded-xl border border-border bg-surface-2 p-3.5">
            <p className="eyebrow mb-1.5">Aperçu</p>
            <p className="whitespace-pre-line text-sm text-fg">{renderMessageTemplate(body, { ...SAMPLE, restaurant: restaurant.name })}</p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={save.loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={save.loading}
          onClick={async () => {
            setTouched(true);
            if (!valid) return;
            const done = await save.mutate();
            if (done) onClose();
          }}
        >
          Enregistrer
        </Button>
      </DialogFooter>
    </>
  );
}

// ------------------------------------------------------------------ Messages automatiques

function AutoMessagesTab() {
  const { user } = useAuth();
  const { restaurantId, restaurant } = useRestaurantAccess();
  const ref = docAt(`${paths.restaurantSub(restaurantId, 'marketing')}/${RESTAURANT_MARKETING_DOCS.autoMessages}`);
  const state = useDoc<RestaurantAutoMessages>(ref);
  const saved = useMemo(() => {
    const out = {} as Record<AutoMessageKey, AutoMessageSetting>;
    for (const key of AUTO_MESSAGE_KEYS) {
      const s = state.data?.messages?.[key];
      out[key] = { enabled: s?.enabled ?? false, body: s?.body || AUTO_MESSAGE_DEFINITIONS[key].defaultBody };
    }
    return out;
  }, [state.data]);
  const [draft, setDraft] = useState<Record<AutoMessageKey, AutoMessageSetting> | null>(null);
  const current = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const invalid = AUTO_MESSAGE_KEYS.filter(
    (k) => current[k].body.trim().length < 5 || unknownMessageVariables(current[k].body, AUTO_MESSAGE_DEFINITIONS[k].variables).length > 0,
  );

  const save = useMutation(
    async () => {
      await setDoc(ref, { messages: current, updatedAt: serverTimestamp(), updatedBy: user?.uid ?? '' });
      setDraft(null);
    },
    { success: 'Messages automatiques enregistrés.' },
  );
  const update = (key: AutoMessageKey, patch: Partial<AutoMessageSetting>) => setDraft({ ...current, [key]: { ...current[key], ...patch } });

  if (state.loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
    );
  }

  const enabledCount = AUTO_MESSAGE_KEYS.filter((k) => saved[k].enabled).length;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-fg-muted">
        Envoyés dans la messagerie de la commande (ou en réponse publique pour les avis), au nom de {restaurant.name}.{' '}
        <span className="font-medium text-fg">
          {enabledCount} message{enabledCount > 1 ? 's' : ''} actif{enabledCount > 1 ? 's' : ''}
        </span>{' '}
        sur {AUTO_MESSAGE_KEYS.length}.
      </p>
      {state.error && <p className="text-sm text-danger-soft-fg">{errorMessage(state.error)}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {AUTO_MESSAGE_KEYS.map((key) => (
          <AutoMessageCard key={key} messageKey={key} value={current[key]} restaurantName={restaurant.name} onChange={(patch) => update(key, patch)} />
        ))}
      </div>
      {(dirty || save.loading) && (
        <div className="sticky bottom-4 z-10">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-elevated p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:pl-5">
            <p className="text-sm text-fg-muted">{invalid.length ? 'Un message contient une variable inconnue ou est vide.' : 'Modifications non enregistrées.'}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={save.loading}>
                Annuler
              </Button>
              <Button variant="primary" loading={save.loading} disabled={invalid.length > 0} onClick={() => void save.mutate()}>
                Enregistrer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoMessageCard({
  messageKey,
  value,
  restaurantName,
  onChange,
}: {
  messageKey: AutoMessageKey;
  value: AutoMessageSetting;
  restaurantName: string;
  onChange: (patch: Partial<AutoMessageSetting>) => void;
}) {
  const def = AUTO_MESSAGE_DEFINITIONS[messageKey];
  const { ref, insert } = useInsertAt(value.body, (body) => onChange({ body }));
  const unknown = unknownMessageVariables(value.body, def.variables);
  return (
    <Card className={cn('flex flex-col transition-opacity', !value.enabled && 'opacity-90')}>
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-md font-semibold tracking-tight text-fg">{def.label}</h3>
            <Badge size="sm" tone={def.audience === 'driver' ? 'plum' : 'info'} icon={def.audience === 'driver' ? <Bike /> : <UserRound />}>
              {def.audience === 'driver' ? 'Livreur' : 'Client'}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{def.description}</p>
          <p className="mt-1 text-xs text-fg-subtle">Déclencheur : {def.trigger}</p>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={`Activer « ${def.label} »`} />
      </div>
      <CardContent className="mt-auto space-y-2.5">
        <Textarea ref={ref} rows={3} maxLength={600} value={value.body} onChange={(e) => onChange({ body: e.target.value })} aria-label={`Texte de « ${def.label} »`} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <VariableChips variables={def.variables} onInsert={insert} />
          {value.body !== def.defaultBody && (
            <Button size="xs" variant="ghost" onClick={() => onChange({ body: def.defaultBody })}>
              Texte par défaut
            </Button>
          )}
        </div>
        {unknown.length > 0 ? (
          <p className="text-xs text-danger-soft-fg">Variable inconnue : {unknown.map((v) => `{{${v}}}`).join(', ')}.</p>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-muted">{renderMessageTemplate(value.body, { ...SAMPLE, restaurant: restaurantName })}</p>
        )}
      </CardContent>
    </Card>
  );
}
