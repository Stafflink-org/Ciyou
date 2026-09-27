import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Globe2, ShieldAlert } from 'lucide-react';
import {
  Button,
  DateRangePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  RadioGroup,
  Select,
  Switch,
  Textarea,
  formatNumber,
  toast,
  type DateRange,
} from '@golink/ui';
import {
  EXPORT_ENTITY_DESCRIPTIONS,
  EXPORT_ENTITY_LABELS,
  PILOTAGE_PLAN_CODES,
  type ExportDataInput,
  type ExportDataResult,
  type ExportEntity,
  type ExportFormat,
  type PlanCode,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { callFunction, useMutation } from '@/lib/firestore';
import { downloadBase64, PILOTAGE_PLAN_NAMES } from '../pilotage-commun/components';
import { isoDay, parseDay, PERIOD_PRESETS, presetRange } from '../pilotage-commun/period';
import { ENTITY_CONFIG } from './config';

const exportData = callFunction<ExportDataInput, ExportDataResult>('exportData');
const ALL = 'all';

export interface ExportPreset {
  entity: ExportEntity;
  format?: ExportFormat;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  planCode?: PlanCode | null;
}

/** Préparation d'un export filtré (format, période, statut, formule, périmètre), puis téléchargement. */
export function ExportDialog({ preset, onClose }: { preset: ExportPreset | null; onClose: () => void }) {
  const geo = useGeoScope();
  const entity = preset?.entity ?? 'orders';
  const config = ENTITY_CONFIG[entity];
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [allTime, setAllTime] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [status, setStatus] = useState<string>(ALL);
  const [plan, setPlan] = useState<string>(ALL);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!preset) return;
    const def = presetRange('30d');
    setFormat(preset.format ?? 'xlsx');
    setAllTime(Boolean(preset.entity && !ENTITY_CONFIG[preset.entity].dateField) || (preset.from === null && preset.to === null));
    setRange({ from: parseDay(preset.from ?? def.from), to: parseDay(preset.to ?? def.to) });
    setStatus(preset.status ?? ALL);
    setPlan(preset.planCode ?? ALL);
    setReason('');
  }, [preset]);

  const { mutate, loading } = useMutation(exportData);

  async function submit() {
    const withDates = config.dateField && !allTime && range?.from;
    const result = await mutate({
      entity,
      format,
      filters: {
        from: withDates ? isoDay(range.from!) : null,
        to: withDates ? isoDay(range.to ?? range.from!) : null,
        countryId: geo.countryId,
        cityIds: geo.cityIds,
        status: status === ALL ? null : status,
        planCode: plan === ALL ? null : (plan as PlanCode),
      },
      reason: reason.trim() || null,
    });
    if (!result) return;
    downloadBase64(result.fileName, result.mimeType, result.contentBase64);
    if (result.rowCount === 0) toast.info('Export généré, mais aucune ligne ne correspond aux filtres.');
    else
      toast.success(`${formatNumber(result.rowCount)} ligne${result.rowCount > 1 ? 's' : ''} exportée${result.rowCount > 1 ? 's' : ''}`, {
        description: result.truncated ? 'Limite atteinte : affinez la période pour obtenir toutes les lignes.' : result.fileName,
      });
    onClose();
  }

  // Tout export est tracé avec son motif (qui, quoi, quand, pourquoi).
  const reasonRequired = true;
  const blocked = (reasonRequired && reason.trim().length < 3) || (Boolean(config.dateField) && !allTime && !range?.from);
  const presets = PERIOD_PRESETS.map((p) => ({
    label: p.label,
    range: () => {
      const r = presetRange(p.value);
      return { from: parseDay(r.from), to: parseDay(r.to) };
    },
  }));

  return (
    <Dialog open={Boolean(preset)} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent size="lg">
        <DialogHeader title={`Exporter : ${EXPORT_ENTITY_LABELS[entity]}`} description={EXPORT_ENTITY_DESCRIPTIONS[entity]} icon={config.icon} />
        <DialogBody className="space-y-5 pt-3">
          <FormField label="Format">
            <RadioGroup
              variant="cards"
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              className="sm:grid-cols-3"
              options={[
                { value: 'xlsx', label: 'Excel', description: 'Tableur, colonnes typées.' },
                { value: 'csv', label: 'CSV', description: 'Séparateur « ; », UTF-8.' },
                { value: 'pdf', label: 'PDF', description: 'Mise en page, 3 000 lignes max.' },
              ]}
            />
          </FormField>

          {config.dateField && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg">Période</span>
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <Switch checked={allTime} onCheckedChange={setAllTime} aria-label="Tout l’historique" />
                  Tout l’historique
                </label>
              </div>
              {!allTime && <DateRangePicker value={range} onChange={setRange} presets={presets} className="w-full" />}
              <p className="text-xs text-fg-subtle">Filtre appliqué sur la {config.dateField}.</p>
            </div>
          )}

          {(config.statuses || config.plan) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {config.statuses && (
                <FormField label="Statut">
                  <Select
                    value={status}
                    onValueChange={setStatus}
                    options={[{ value: ALL, label: 'Tous les statuts' }, ...Object.entries(config.statuses).map(([value, label]) => ({ value, label }))]}
                  />
                </FormField>
              )}
              {config.plan && (
                <FormField label="Formule">
                  <Select
                    value={plan}
                    onValueChange={setPlan}
                    options={[
                      { value: ALL, label: 'Toutes les formules' },
                      ...PILOTAGE_PLAN_CODES.map((code) => ({ value: code, label: PILOTAGE_PLAN_NAMES[code] })),
                    ]}
                  />
                </FormField>
              )}
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
            <Globe2 className="size-4 shrink-0 text-fg-subtle" />
            <span>
              Périmètre : <strong className="font-medium text-fg">{geo.label}</strong> (sélecteur en haut de page).
            </span>
          </div>

          <FormField
            label={reasonRequired ? 'Motif de l’export' : 'Motif (facultatif)'}
            required={reasonRequired}
            hint="Le motif est conservé dans le journal d’audit."
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : clôture comptable de septembre" />
          </FormField>

          {reasonRequired && (
            <p className="tone-amber flex items-start gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-xs text-(--tone-fg)">
              <ShieldAlert className="mt-px size-3.5 shrink-0" />
              Les coordonnées sont masquées si votre rôle n’a pas accès aux données personnelles. Un export massif déclenche une alerte de sécurité.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            leftIcon={format === 'pdf' ? <Download /> : <FileSpreadsheet />}
            loading={loading}
            disabled={blocked}
            onClick={() => void submit()}
          >
            Générer et télécharger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
