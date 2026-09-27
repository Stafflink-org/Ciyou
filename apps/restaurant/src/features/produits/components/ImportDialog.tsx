// Import de la carte depuis un CSV : lecture, contrôle ligne par ligne, simulation
// côté serveur (créations, mises à jour, sections créées), puis import réel.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, FileWarning, Upload } from 'lucide-react';
import { MENU_LIMITS, type MenuImportReport } from '@golink/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FileUpload,
  formatEUR,
  Spinner,
  toast,
} from '@golink/ui';
import { errorMessage } from '@/lib/firestore';
import { downloadMenuTemplate, parseMenuCsv, type ParsedLine } from '../menu/csv';
import { menuFunctions } from '../menu/data';

type Step = 'pick' | 'review' | 'done';

export function ImportDialog({ open, onOpenChange, restaurantId }: { open: boolean; onOpenChange: (open: boolean) => void; restaurantId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [report, setReport] = useState<MenuImportReport | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setLines([]);
      setFileError(null);
      setReport(null);
      setStep('pick');
    }
  }, [open]);

  const valid = useMemo(() => lines.filter((l) => l.row), [lines]);
  const invalid = useMemo(() => lines.filter((l) => !l.row), [lines]);

  /** Numéros de ligne du fichier, dans l'ordre des lignes envoyées au serveur. */
  const serverLine = (row: number) => valid[row - 2]?.line ?? row;

  async function read(next: File[]) {
    setFiles(next);
    setFileError(null);
    setReport(null);
    const file = next[0];
    if (!file) {
      setLines([]);
      return;
    }
    const text = await file.text();
    const parsed = parseMenuCsv(text);
    if (parsed.missingColumns.length) {
      setLines([]);
      setFileError(`Colonnes obligatoires absentes : ${parsed.missingColumns.join(', ')}. Partez du modèle pour retrouver le bon format.`);
      return;
    }
    if (parsed.lines.length === 0) {
      setFileError('Le fichier ne contient aucune ligne de produit.');
      return;
    }
    setLines(parsed.lines);
    setBusy(true);
    try {
      const rows = parsed.lines.filter((l) => l.row).map((l) => l.row!);
      if (rows.length) setReport(await menuFunctions.importMenu({ restaurantId, rows, dryRun: true }));
      setStep('review');
    } catch (caught) {
      setFileError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    try {
      const result = await menuFunctions.importMenu({ restaurantId, rows: valid.map((l) => l.row!), dryRun: false });
      setReport(result);
      setStep('done');
      toast.success(`Carte importée : ${result.created} produit(s) créé(s), ${result.updated} mis à jour`);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const serverErrors = report?.errors ?? [];
  const importable = report ? report.created + report.updated : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<FileSpreadsheet />}
          title="Importer une carte"
          description={`Fichier CSV (séparateur « ; » ou « , »), ${MENU_LIMITS.importRows} lignes au maximum. Les produits existants sont mis à jour, les nouveaux créés.`}
        />
        <DialogBody className="space-y-4">
          {step !== 'done' && (
            <>
              <FileUpload
                value={files}
                onChange={(next) => void read(next)}
                accept=".csv,text/csv"
                maxSize={2 * 1024 * 1024}
                label="Glissez-déposez votre fichier CSV ou"
                hint="CSV exporté depuis GoLink, Excel ou votre logiciel de caisse · 2 Mo max."
                onReject={setFileError}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                <span>Colonnes : section, nom, prix (obligatoires), puis description, tva, disponible, stock, allergenes…</span>
                <Button variant="link" size="sm" leftIcon={<Download />} onClick={downloadMenuTemplate}>
                  Télécharger le modèle
                </Button>
              </div>
            </>
          )}

          {fileError && (
            <p role="alert" className="tone-danger flex items-start gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {fileError}
            </p>
          )}

          {busy && step === 'pick' && (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner /> Analyse du fichier…
            </p>
          )}

          {step !== 'pick' && report && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: step === 'done' ? 'Créés' : 'À créer', value: report.created, tone: 'success' as const },
                { label: step === 'done' ? 'Mis à jour' : 'À mettre à jour', value: report.updated, tone: 'info' as const },
                { label: 'Inchangés', value: report.unchanged, tone: 'neutral' as const },
                { label: 'Lignes ignorées', value: invalid.length + serverErrors.length, tone: 'danger' as const },
              ].map((stat) => (
                <div key={stat.label} className={`tone-${stat.tone} rounded-xl border border-border bg-surface-2 px-3 py-2.5`}>
                  <p className="num font-display text-xl font-semibold text-fg">{stat.value}</p>
                  <p className="text-xs text-fg-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {step !== 'pick' && report && report.sectionsCreated.length > 0 && (
            <p className="text-sm text-fg-muted">
              {step === 'done' ? 'Sections créées' : 'Nouvelles sections'} :{' '}
              {report.sectionsCreated.map((name) => (
                <Badge key={name} tone="brand" size="sm" className="mr-1">
                  {name}
                </Badge>
              ))}
            </p>
          )}

          {step === 'review' && (invalid.length > 0 || serverErrors.length > 0) && (
            <div className="rounded-xl border border-border">
              <p className="border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium text-fg-muted">Lignes ignorées (corrigez le fichier puis rechargez-le)</p>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto text-sm">
                {invalid.map((l) => (
                  <li key={`c${l.line}`} className="flex gap-3 px-3 py-1.5">
                    <span className="num w-16 shrink-0 font-mono text-xs text-fg-subtle">Ligne {l.line}</span>
                    <span className="text-fg">{l.errors.join(' · ')}</span>
                  </li>
                ))}
                {serverErrors.map((e) => (
                  <li key={`s${e.row}`} className="flex gap-3 px-3 py-1.5">
                    <span className="num w-16 shrink-0 font-mono text-xs text-fg-subtle">Ligne {serverLine(e.row)}</span>
                    <span className="text-fg">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step !== 'pick' && (report?.warnings?.length ?? 0) > 0 && (
            <div className="tone-amber rounded-xl border border-(--tone-border) bg-(--tone-bg)">
              <p className="flex items-center gap-2 border-b border-(--tone-border) px-3 py-2 text-xs font-medium text-(--tone-fg)">
                <FileWarning className="size-3.5" aria-hidden="true" />
                Importées hors vente : la vente d’alcool est interdite sur GoLink
              </p>
              <ul className="max-h-32 divide-y divide-(--tone-border) overflow-y-auto text-sm">
                {report!.warnings!.map((w) => (
                  <li key={`w${w.row}`} className="flex gap-3 px-3 py-1.5">
                    <span className="num w-16 shrink-0 font-mono text-xs text-fg-subtle">Ligne {serverLine(w.row)}</span>
                    <span className="text-fg">{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 'review' && valid.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <p className="border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium text-fg-muted">Aperçu des premières lignes</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <tbody className="divide-y divide-border">
                    {valid.slice(0, 6).map((l) => (
                      <tr key={l.line}>
                        <td className="px-3 py-1.5 text-fg-muted">{l.row!.section}</td>
                        <td className="px-3 py-1.5 font-medium text-fg">{l.row!.name}</td>
                        <td className="num px-3 py-1.5 text-right font-mono">{formatEUR(l.row!.priceCents, { cents: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'done' && (
            <p className="tone-success flex items-center gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              <CheckCircle2 className="size-4" aria-hidden="true" /> Import terminé. Le contrôle qualité analyse les nouveaux produits dans quelques secondes.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {step === 'done' ? 'Fermer' : 'Annuler'}
          </Button>
          {step === 'review' && (
            <Button variant="primary" leftIcon={<Upload />} loading={busy} disabled={importable === 0} onClick={() => void runImport()}>
              {importable === 0 ? 'Rien à importer' : `Importer ${importable} produit${importable > 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
