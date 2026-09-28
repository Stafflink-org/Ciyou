import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Mail, X } from 'lucide-react';
import { Button, Combobox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, RadioGroup, Select, Switch } from '@golink/ui';
import {
  REPORT_FREQUENCY_LABELS,
  REPORT_KIND_DESCRIPTIONS,
  REPORT_KIND_LABELS,
  type ExportFormat,
  type ReportFrequency,
  type ReportKind,
  type SaveScheduledReportInput,
  type ScheduledReport,
  type WithId,
} from '@golink/shared';
import { useAuth } from '@golink/web';
import { useGeoScope } from '@/layout/GeoScope';
import { useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

const saveReport = callFunctionWithReason<SaveScheduledReportInput, { id: string; nextRunAt: string }>('saveScheduledReport', { title: 'Enregistrer ce rapport programmé', description: 'Un rapport programmé envoie des données à des destinataires : indiquez le motif.' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALL = 'all';

interface Draft {
  name: string;
  report: ReportKind;
  frequency: ReportFrequency;
  hour: string;
  format: ExportFormat;
  recipients: string[];
  countryId: string;
  cityIds: string[];
  active: boolean;
}

function draftFrom(report: WithId<ScheduledReport> | null, email: string | null | undefined): Draft {
  const filters = report?.filters ?? {};
  return {
    name: report?.name ?? '',
    report: report?.report ?? 'daily_summary',
    frequency: report?.frequency ?? 'weekly',
    hour: String(report?.hour ?? 7),
    format: report?.format ?? 'pdf',
    recipients: report?.recipients ?? (email ? [email] : []),
    countryId: (typeof filters.countryId === 'string' && filters.countryId) || ALL,
    cityIds: Array.isArray(filters.cityIds) ? filters.cityIds : [],
    active: report?.active ?? true,
  };
}

/** Création ou modification d'un rapport programmé (envoi par e-mail). */
export function ReportFormDialog({ open, report, onClose }: { open: boolean; report: WithId<ScheduledReport> | null; onClose: () => void }) {
  const { user } = useAuth();
  const geo = useGeoScope();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(report, user?.email));
  const [pending, setPending] = useState('');
  const [touched, setTouched] = useState(false);
  const { mutate, loading } = useMutation(saveReport, { success: report ? 'Rapport mis à jour' : 'Rapport programmé' });

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(report, user?.email));
      setPending('');
      setTouched(false);
    }
  }, [open, report, user?.email]);

  const cities = useMemo(() => geo.cities.filter((c) => draft.countryId === ALL || c.countryId === draft.countryId), [geo.cities, draft.countryId]);

  function addRecipients(raw: string) {
    const parts = raw
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    const valid = parts.filter((p) => EMAIL.test(p));
    setDraft((d) => ({ ...d, recipients: [...new Set([...d.recipients, ...valid])].slice(0, 10) }));
    setPending(parts.filter((p) => !EMAIL.test(p)).join(' '));
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (['Enter', ',', ';', ' '].includes(event.key)) {
      event.preventDefault();
      addRecipients(pending);
    } else if (event.key === 'Backspace' && !pending && draft.recipients.length) {
      setDraft((d) => ({ ...d, recipients: d.recipients.slice(0, -1) }));
    }
  }

  const errors = {
    name: draft.name.trim().length < 3 ? 'Au moins 3 caractères.' : null,
    recipients:
      draft.recipients.length === 0 ? 'Ajoutez au moins un destinataire.' : pending.trim() && !EMAIL.test(pending.trim()) ? 'Adresse e-mail invalide.' : null,
  };
  const invalid = Boolean(errors.name || errors.recipients);

  async function submit() {
    setTouched(true);
    if (pending.trim()) addRecipients(pending);
    if (invalid) return;
    const result = await mutate({
      id: report?.id ?? null,
      name: draft.name.trim(),
      report: draft.report,
      frequency: draft.frequency,
      recipients: draft.recipients,
      format: draft.format,
      hour: Number(draft.hour),
      countryId: draft.countryId === ALL ? null : draft.countryId,
      cityIds: draft.cityIds.length ? draft.cityIds : null,
      active: draft.active,
    });
    if (result) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !loading && onClose()}>
      <DialogContent size="lg">
        <DialogHeader
          title={report ? 'Modifier le rapport' : 'Programmer un rapport'}
          description="Récapitulatif envoyé par e-mail avec le fichier en pièce jointe, dans le périmètre choisi."
          icon={<Mail />}
        />
        <DialogBody className="max-h-[70dvh] space-y-5 overflow-y-auto pt-3">
          <FormField label="Nom du rapport" required error={touched ? errors.name : null}>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ex. : Synthèse hebdomadaire des associés"
              maxLength={80}
            />
          </FormField>

          <FormField label="Contenu">
            <RadioGroup
              variant="cards"
              value={draft.report}
              onValueChange={(v) => setDraft({ ...draft, report: v as ReportKind })}
              options={(Object.keys(REPORT_KIND_LABELS) as ReportKind[]).map((k) => ({
                value: k,
                label: REPORT_KIND_LABELS[k],
                description: REPORT_KIND_DESCRIPTIONS[k],
              }))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Fréquence">
              <Select
                value={draft.frequency}
                onValueChange={(v) => setDraft({ ...draft, frequency: v as ReportFrequency })}
                options={(Object.keys(REPORT_FREQUENCY_LABELS) as ReportFrequency[]).map((f) => ({ value: f, label: REPORT_FREQUENCY_LABELS[f] }))}
              />
            </FormField>
            <FormField label="Heure d’envoi" hint="Heure de Paris.">
              <Select
                value={draft.hour}
                onValueChange={(v) => setDraft({ ...draft, hour: v })}
                options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')} h` }))}
              />
            </FormField>
            <FormField label="Pièce jointe">
              <Select
                value={draft.format}
                onValueChange={(v) => setDraft({ ...draft, format: v as ExportFormat })}
                options={[
                  { value: 'pdf', label: 'PDF' },
                  { value: 'xlsx', label: 'Excel' },
                  { value: 'csv', label: 'CSV' },
                ]}
              />
            </FormField>
          </div>

          <FormField
            label="Destinataires"
            required
            hint="Entrée ou virgule pour ajouter une adresse ; 10 au maximum."
            error={touched ? errors.recipients : null}
          >
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1.5 shadow-xs focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20">
              {draft.recipients.map((email) => (
                <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-3 py-0.5 pl-2 pr-1 text-xs text-fg">
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    aria-label={`Retirer ${email}`}
                    onClick={() => setDraft({ ...draft, recipients: draft.recipients.filter((r) => r !== email) })}
                    className="grid size-4 place-items-center rounded text-fg-subtle hover:bg-surface hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={pending}
                onChange={(e) => setPending(e.target.value)}
                onKeyDown={onKey}
                onBlur={() => addRecipients(pending)}
                placeholder={draft.recipients.length ? '' : 'prenom.nom@golink.fr'}
                aria-label="Ajouter un destinataire"
                className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Pays">
              <Select
                value={draft.countryId}
                onValueChange={(v) => setDraft({ ...draft, countryId: v, cityIds: [] })}
                options={[...(geo.global ? [{ value: ALL, label: 'Tous les pays' }] : []), ...geo.countries.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="Mon périmètre"
              />
            </FormField>
            <FormField label="Villes" hint="Aucune sélection : toutes les villes du pays.">
              <Combobox
                multiple
                value={draft.cityIds}
                onChange={(ids: string[]) => setDraft({ ...draft, cityIds: ids.slice(0, 30) })}
                options={cities.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Toutes les villes"
                searchPlaceholder="Rechercher une ville…"
              />
            </FormField>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-fg">Envoi automatique actif</span>
              <span className="block text-xs text-fg-muted">Désactivé, le rapport reste enregistré mais n’est plus envoyé.</span>
            </span>
            <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} aria-label="Envoi automatique actif" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {report ? 'Enregistrer' : 'Programmer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
