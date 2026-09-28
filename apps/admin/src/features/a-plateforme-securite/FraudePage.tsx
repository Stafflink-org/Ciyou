// Fraude (cahier §28) : dossiers ouverts à partir de signaux automatiques (clients,
// livreurs, commerces) et liste de blocage (téléphone, e-mail, appareil, carte).
import { useEffect, useMemo, useState } from 'react';
import { Ban, Plus, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  createColumnHelper,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  formatDateTime,
} from '@golink/ui';
import {
  BLOCKLIST_TYPE_LABELS,
  COLLECTIONS,
  DEFAULT_FRAUD_SETTINGS,
  FRAUD_DECISION_LABELS,
  FRAUD_SIGNAL_LABELS,
  FRAUD_STATUS_LABELS,
  FRAUD_SUBJECT_LABELS,
  SETTINGS_DOCS,
  type BlocklistEntry,
  type BlocklistType,
  type FraudCase,
  type FraudSettings,
} from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess, useCan } from '@/auth/AdminAccess';
import { docAt, toDate, toMillis, useDoc, useMutation } from '@/lib/firestore';
import { addBlocklistEntry, decideFraudCase, removeBlocklistEntry, updateFraudSettings } from './api';
import { ActionDialog, ErrorPanel, RequirePermission } from './components';
import { useBlocklist, useFraudCases } from './hooks';
import { PlateformeNav } from './nav';

const STATUS_TONE: Record<FraudCase['status'], 'info' | 'amber' | 'danger' | 'neutral'> = { open: 'info', investigating: 'amber', confirmed: 'danger', dismissed: 'neutral' };

function CaseDialog({ fraudCase, onOpenChange }: { fraudCase: (FraudCase & { id: string }) | null; onOpenChange: (v: boolean) => void }) {
  const [status, setStatus] = useState<FraudCase['status']>('investigating');
  const [action, setAction] = useState<string>('none');
  const [note, setNote] = useState('');
  useMemo(() => {
    if (fraudCase) {
      setStatus(fraudCase.status === 'open' ? 'investigating' : fraudCase.status);
      setAction(fraudCase.decision?.action ?? 'none');
      setNote('');
    }
  }, [fraudCase?.id]);
  const decide = useMutation(() => decideFraudCase({ caseId: fraudCase!.id, status, action, note }), { success: 'Dossier mis à jour.' });
  if (!fraudCase) return null;
  return (
    <Dialog open={Boolean(fraudCase)} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={fraudCase.subjectName} description={`${FRAUD_SUBJECT_LABELS[fraudCase.subjectType]} · score de risque ${fraudCase.riskScore}`} />
        <DialogBody className="space-y-4 pt-2">
          <ul className="space-y-1.5">
            {fraudCase.signals.map((s, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                <span>{FRAUD_SIGNAL_LABELS[s.code]}</span>
                <span className="text-fg-subtle">{s.detail}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Statut" required><Select value={status} onValueChange={(v) => setStatus(v as FraudCase['status'])} options={(['investigating', 'confirmed', 'dismissed'] as const).map((s) => ({ value: s, label: FRAUD_STATUS_LABELS[s] }))} /></FormField>
            <FormField label="Décision"><Select value={action} onValueChange={setAction} options={Object.entries(FRAUD_DECISION_LABELS).map(([v, label]) => ({ value: v, label }))} /></FormField>
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Motif de la décision (conservé dans le journal d'audit)" maxLength={500} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button loading={decide.loading} disabled={note.trim().length < 3} onClick={async () => { const res = await decide.mutate(); if (res) onOpenChange(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FraudCasesTab() {
  const can = useCan();
  const [statusFilter, setStatusFilter] = useState<FraudCase['status'] | undefined>('open');
  const cases = useFraudCases(statusFilter);
  const [editing, setEditing] = useState<(FraudCase & { id: string }) | null>(null);

  const columns = useMemo(() => {
    const helper = createColumnHelper<FraudCase & { id: string }>();
    return [
      helper.accessor('subjectName', { header: 'Sujet', cell: (c) => (
        <div><p className="font-medium text-fg">{c.getValue()}</p><p className="text-xs text-fg-subtle">{FRAUD_SUBJECT_LABELS[c.row.original.subjectType]}</p></div>
      ) }),
      helper.accessor('riskScore', { header: 'Score', cell: (c) => <span className="font-mono num">{c.getValue()}</span> }),
      helper.accessor('signals', { header: 'Signaux', cell: (c) => <span className="text-sm">{c.getValue().map((s) => FRAUD_SIGNAL_LABELS[s.code]).join(', ')}</span> }),
      helper.accessor('status', { header: 'Statut', cell: (c) => <Badge tone={STATUS_TONE[c.getValue()]}>{FRAUD_STATUS_LABELS[c.getValue()]}</Badge> }),
    ];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={statusFilter ?? 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? undefined : (v as FraudCase['status']))} options={[{ value: 'all', label: 'Tous les statuts' }, ...(['open', 'investigating', 'confirmed', 'dismissed'] as const).map((s) => ({ value: s, label: FRAUD_STATUS_LABELS[s] }))]} />
      </div>
      {cases.error ? (
        <ErrorPanel error={cases.error} />
      ) : (
        <DataTable data={cases.data} columns={columns} loading={cases.loading} onRowClick={can('fraud.manage') ? (row) => setEditing(row) : undefined} itemLabel="dossiers" emptyState={<EmptyState icon={<ShieldAlert />} title="Aucun dossier" description="Les signaux automatiques sont recalculés chaque nuit." />} />
      )}
      <CaseDialog fraudCase={editing} onOpenChange={(v) => !v && setEditing(null)} />
    </div>
  );
}

function AddBlocklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [type, setType] = useState<BlocklistType>('email');
  const [value, setValue] = useState('');
  const add = useMutation((reason: string) => addBlocklistEntry({ type, value, reason, fraudCaseId: null, expiresAt: null }), { success: 'Ajouté à la liste de blocage.' });
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader icon={<Ban />} title="Ajouter à la liste de blocage" />
        <DialogBody className="space-y-4 pt-2">
          <FormField label="Type" required><Select value={type} onValueChange={(v) => setType(v as BlocklistType)} options={Object.entries(BLOCKLIST_TYPE_LABELS).map(([v, label]) => ({ value: v, label }))} /></FormField>
          <FormField label="Valeur" required><Input value={value} onChange={(e) => setValue(e.target.value)} /></FormField>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motif (conservé dans le journal d'audit)" maxLength={500} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button leftIcon={<Plus />} loading={add.loading} disabled={value.trim().length < 3 || reason.trim().length < 3} onClick={async () => { const res = await add.mutate(reason); if (res) { onOpenChange(false); setValue(''); setReason(''); } }}>Bloquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlocklistTab() {
  const can = useCan();
  const blocklist = useBlocklist();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<(BlocklistEntry & { id: string }) | null>(null);
  const remove = useMutation((reason: string) => removeBlocklistEntry({ entryId: removing!.id, reason }), { success: 'Retiré de la liste de blocage.' });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{can('fraud.manage') && <Button leftIcon={<Plus />} onClick={() => setAddOpen(true)}>Ajouter</Button>}</div>
      {blocklist.error ? (
        <ErrorPanel error={blocklist.error} />
      ) : blocklist.loading ? (
        <Skeleton className="h-64" />
      ) : blocklist.data.length === 0 ? (
        <EmptyState icon={<Ban />} title="Liste de blocage vide" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {blocklist.data.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{BLOCKLIST_TYPE_LABELS[entry.type]}</Badge>
                      <span className="font-mono text-sm">{entry.valuePreview}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-fg-subtle">{entry.reason} · {formatDateTime(toDate(entry.createdAt) ?? new Date())}</p>
                  </div>
                  {can('fraud.manage') && <Button size="sm" variant="ghost" leftIcon={<Trash2 />} onClick={() => setRemoving(entry)}>Retirer</Button>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <AddBlocklistDialog open={addOpen} onOpenChange={setAddOpen} />
      <ActionDialog
        open={Boolean(removing)}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Retirer de la liste de blocage"
        destructive
        onSubmit={async (r) => Boolean(await remove.mutate(r))}
      />
    </div>
  );
}

type FraudValues = Omit<FraudSettings, 'updatedAt' | 'updatedBy'>;
/** Champ simple, ou score imbriqué (`scores.xxx`), aplatis pour le formulaire. */
type FlatKey =
  | Exclude<keyof FraudValues, 'scores'>
  | `scores.${keyof FraudValues['scores']}`;

interface FraudField {
  key: FlatKey;
  label: string;
  hint?: string;
  unit: string;
  percent?: boolean;
  min: number;
  max: number;
}

const FRAUD_GROUPS: Array<{ title: string; description: string; fields: FraudField[] }> = [
  {
    title: 'Fenêtre et clients',
    description: 'Observation glissante et signaux client.',
    fields: [
      { key: 'lookbackDays', label: 'Fenêtre d’observation', unit: 'jours', min: 1, max: 90 },
      { key: 'clientMinOrders', label: 'Commandes minimales pour évaluer un client', unit: 'cmd', min: 1, max: 1000 },
      { key: 'clientCancellationRate', label: 'Taux d’annulation client', unit: '%', percent: true, min: 5, max: 100 },
      { key: 'clientNotReceivedThreshold', label: '« Commande non reçue » déclenchant le signal', unit: 'récl.', min: 1, max: 100 },
      { key: 'clientRepeatedClaimsThreshold', label: 'Réclamations répétées déclenchant le signal', unit: 'récl.', min: 1, max: 100 },
      { key: 'promoAbuseCodesThreshold', label: 'Codes promo différents (abus)', unit: 'codes', min: 2, max: 100 },
    ],
  },
  {
    title: 'Commerces',
    description: 'Taux de remboursement réel et commandes fictives.',
    fields: [
      { key: 'restaurantMinOrders', label: 'Commandes minimales pour évaluer un commerce', unit: 'cmd', min: 1, max: 10_000 },
      { key: 'restaurantRefundRate', label: 'Taux de remboursement anormal', unit: '%', percent: true, min: 5, max: 100 },
      { key: 'fakeOrderCancelWithinSeconds', label: 'Annulation « rapide » du commerce sous', unit: 's', min: 10, max: 3600 },
      { key: 'fakeOrderThreshold', label: 'Annulations rapides déclenchant « commandes fictives »', unit: 'cmd', min: 2, max: 100 },
    ],
  },
  {
    title: 'Livreurs',
    description: 'Livraison hors adresse et annulations imputables.',
    fields: [
      { key: 'driverOffAddressMeters', label: 'Distance « hors adresse »', unit: 'm', min: 50, max: 5000 },
      { key: 'driverOffAddressThreshold', label: 'Livraisons hors adresse déclenchant le signal', unit: 'liv.', min: 1, max: 50 },
      { key: 'driverCancellationsThreshold', label: 'Annulations imputables au livreur', unit: 'cmd', min: 1, max: 50 },
    ],
  },
  {
    title: 'Points par signal',
    description: 'Score cumulé par dossier, plafonné à 100.',
    fields: [
      { key: 'scores.frequentNotReceived', label: '« Non reçu » fréquent', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.repeatedClaims', label: 'Réclamations répétées', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.abnormalCancellations', label: 'Annulations anormales', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.promoAbuse', label: 'Abus de promotions', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.refundRate', label: 'Taux de remboursement', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.fakeOrders', label: 'Commandes fictives', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.offAddressDelivery', label: 'Livraison hors adresse', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.driverCancellations', label: 'Annulations livreur', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.sharedAccount', label: 'Compte partagé', unit: 'pts', min: 1, max: 100 },
      { key: 'scores.linkedAccounts', label: 'Comptes liés', unit: 'pts', min: 1, max: 100 },
    ],
  },
];
const FRAUD_FIELDS = FRAUD_GROUPS.flatMap((g) => g.fields);

function readFlat(values: FraudValues, key: FlatKey): number {
  return key.startsWith('scores.') ? values.scores[key.slice(7) as keyof FraudValues['scores']] : (values[key as Exclude<keyof FraudValues, 'scores'>] as number);
}

function toDisplay(field: FraudField, value: number): string {
  return String(field.percent ? Math.round(value * 1000) / 10 : value).replace('.', ',');
}

function fromDisplay(field: FraudField, raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  if (!raw.trim() || Number.isNaN(n)) return null;
  if (n < field.min || n > field.max) return null;
  return field.percent ? Math.round(n * 10) / 1000 : Math.round(n);
}

function buildPayload(values: Record<FlatKey, number>): FraudValues {
  const scores = {} as FraudValues['scores'];
  const flat = {} as Record<string, number>;
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('scores.')) scores[key.slice(7) as keyof FraudValues['scores']] = value;
    else flat[key] = value;
  }
  return { ...(flat as unknown as Omit<FraudValues, 'scores'>), scores };
}

/** Seuils réglables de la détection automatique (settings/fraud) : rien n'est figé dans le code. */
function FraudThresholdsTab() {
  const { can } = useAdminAccess();
  const canView = can('settings.view');
  const canEdit = can('settings.edit');
  const { data, loading, error, missing } = useDoc<FraudSettings>(canView ? docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.fraud}`) : null);
  const current = useMemo<FraudValues>(() => ({ ...DEFAULT_FRAUD_SETTINGS, ...(data ?? {}), scores: { ...DEFAULT_FRAUD_SETTINGS.scores, ...(data?.scores ?? {}) } }), [data]);
  const [draft, setDraft] = useState<Record<FlatKey, string> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutate, loading: saving } = useMutation(updateFraudSettings, { success: 'Seuils enregistrés' });

  useEffect(() => {
    if (!loading) setDraft(Object.fromEntries(FRAUD_FIELDS.map((f) => [f.key, toDisplay(f, readFlat(current, f.key))])) as Record<FlatKey, string>);
  }, [loading, current]);

  const parsed = useMemo(() => {
    if (!draft) return null;
    const out: Partial<Record<FlatKey, number>> = {};
    const errors: Partial<Record<FlatKey, string>> = {};
    for (const f of FRAUD_FIELDS) {
      const value = fromDisplay(f, draft[f.key]);
      if (value === null) errors[f.key] = `Entre ${String(f.min).replace('.', ',')} et ${String(f.max).replace('.', ',')}.`;
      else out[f.key] = value;
    }
    return { values: out as Record<FlatKey, number>, errors };
  }, [draft]);

  const changed = parsed ? FRAUD_FIELDS.filter((f) => parsed.values[f.key] !== readFlat(current, f.key)) : [];
  const invalid = parsed ? Object.keys(parsed.errors).length > 0 : true;

  if (!canView) return <EmptyState icon={<ShieldAlert />} title="Accès réservé" description="La consultation des seuils n’est pas incluse dans votre rôle." />;

  const updatedAt = toMillis(data?.updatedAt);

  return error ? (
    <ErrorPanel error={error} />
  ) : !draft || !parsed ? (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
    </div>
  ) : (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {FRAUD_GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} description={group.description} divided />
            <div className="space-y-4 p-5">
              {group.fields.map((f) => (
                <FormField key={f.key} label={f.label} hint={f.hint} error={parsed.errors[f.key]}>
                  <Input inputMode="decimal" value={draft[f.key]} disabled={!canEdit} trailing={<span className="font-mono">{f.unit}</span>} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                </FormField>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-fg-muted">
            {!canEdit ? 'Lecture seule.' : changed.length ? `${changed.length} seuil(s) modifié(s), appliqué(s) au prochain calcul (nuit suivante).` : missing ? 'Valeurs par défaut de la plateforme.' : updatedAt ? `Dernière modification le ${formatDateTime(updatedAt)}.` : 'Aucune modification en attente.'}
          </p>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="ghost" leftIcon={<RotateCcw />} disabled={!changed.length || saving} onClick={() => setDraft(Object.fromEntries(FRAUD_FIELDS.map((f) => [f.key, toDisplay(f, readFlat(current, f.key))])) as Record<FlatKey, string>)}>
                Annuler
              </Button>
              <Button variant="primary" leftIcon={<Save />} disabled={!changed.length || invalid} loading={saving} onClick={() => setConfirmOpen(true)}>
                Enregistrer
              </Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Enregistrer les nouveaux seuils ?"
        description="Les prochains calculs de détection utiliseront ces valeurs."
        confirmLabel="Enregistrer"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ ...buildPayload(parsed!.values), reason: reason ?? '' });
        }}
      >
        <ul className="space-y-1 rounded-lg border border-border bg-surface-2 p-3 text-xs">
          {changed.map((f) => (
            <li key={f.key} className="flex justify-between gap-3">
              <span className="text-fg-muted">{f.label}</span>
              <span className="num shrink-0 font-mono text-fg">
                {toDisplay(f, readFlat(current, f.key))} → {toDisplay(f, parsed.values[f.key])} {f.unit}
              </span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

export function FraudePage() {
  useDocumentTitle('Fraude · Ciyou Eats Admin');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Plateforme & sécurité" title="Fraude" description="Dossiers ouverts à partir de signaux automatiques (recalculés chaque nuit) et liste de blocage.">
        <PlateformeNav />
      </PageHeader>
      <RequirePermission permission="fraud.view" title="Fraude">
        <Tabs defaultValue="cases">
          <TabsList>
            <TabsTrigger value="cases">Dossiers</TabsTrigger>
            <TabsTrigger value="blocklist">Liste de blocage</TabsTrigger>
            <TabsTrigger value="thresholds">Seuils</TabsTrigger>
          </TabsList>
          <TabsContent value="cases" className="pt-4"><FraudCasesTab /></TabsContent>
          <TabsContent value="blocklist" className="pt-4"><BlocklistTab /></TabsContent>
          <TabsContent value="thresholds" className="pt-4"><FraudThresholdsTab /></TabsContent>
        </Tabs>
      </RequirePermission>
    </PageContainer>
  );
}
