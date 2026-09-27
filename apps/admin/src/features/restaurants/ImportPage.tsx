// Super admin §5 : import en masse de commerces (arrivée d'une chaîne) et d'une
// carte complète, depuis un fichier CSV ou Excel. Simulation obligatoire avant import.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { CheckCircle2, Download, FileSpreadsheet, FileUp, History, ListChecks, Store, TriangleAlert, UtensilsCrossed } from 'lucide-react';
import { Badge, Button, Card, Checkbox, Combobox, EmptyState, FileUpload, FormField, PageContainer, PageHeader, SegmentedControl, Skeleton, formatRelative, toast, Table } from '@golink/ui';
import { ALLERGENS, ALLERGEN_LABELS, COLLECTIONS, normalizeText, type Allergen, type BulkJob, type MenuImportReport, type RestaurantImportReport, type RestaurantImportRow } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { callFunction, collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { downloadCsv, readTabularFile } from '../acteurs-commun/export';
import { Panel, plural } from '../acteurs-commun/ui';
import { RestaurantsNav } from './components/RestaurantsNav';
import { importRestaurants, useScopedRestaurants } from './lib';

const importMenu = callFunction<{ restaurantId: string; rows: Array<Record<string, unknown>>; dryRun: boolean }, MenuImportReport>('importMenu');

// ------------------------------------------------------------------ Modèles de fichiers

const RESTAURANT_COLUMNS = [
  { key: 'nom', field: 'name', example: 'Le Comptoir de Metz' },
  { key: 'type', field: 'merchantType', example: 'restaurant' },
  { key: 'ville', field: 'cityId', example: 'metz' },
  { key: 'adresse', field: 'line1', example: '12 rue des Clercs' },
  { key: 'code_postal', field: 'postalCode', example: '57000' },
  { key: 'commune', field: 'city', example: 'Metz' },
  { key: 'telephone', field: 'phone', example: '+33 3 87 00 00 00' },
  { key: 'email', field: 'email', example: 'contact@comptoir-metz.fr' },
  { key: 'gerant_prenom', field: 'ownerFirstName', example: 'Camille' },
  { key: 'gerant_nom', field: 'ownerLastName', example: 'Durand' },
  { key: 'gerant_email', field: 'ownerEmail', example: 'camille.durand@comptoir-metz.fr' },
  { key: 'raison_sociale', field: 'legalName', example: 'Comptoir de Metz SAS' },
  { key: 'siret', field: 'siret', example: '89451237700012' },
  { key: 'formule', field: 'planCode', example: 'basic' },
  { key: 'latitude', field: 'lat', example: '49.1193' },
  { key: 'longitude', field: 'lng', example: '6.1757' },
] as const;

const MENU_COLUMNS = [
  { key: 'section', example: 'Entrées' },
  { key: 'nom', example: 'Houmous maison' },
  { key: 'description', example: 'Pois chiches, tahini, citron' },
  { key: 'prix', example: '6,50' },
  { key: 'allergenes', example: 'sésame' },
  { key: 'disponible', example: 'oui' },
  { key: 'reference', example: 'ENT-01' },
] as const;

const ALLERGEN_BY_NAME = new Map<string, Allergen>();
ALLERGENS.forEach((a) => {
  ALLERGEN_BY_NAME.set(normalizeText(a), a);
  ALLERGEN_BY_NAME.set(normalizeText(ALLERGEN_LABELS[a]), a);
});

function pick(row: Record<string, string>, key: string): string {
  const found = Object.keys(row).find((k) => normalizeText(k).replace(/\s+/g, '_') === key);
  return found ? (row[found] ?? '').trim() : '';
}
function num(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toRestaurantRow(row: Record<string, string>): Partial<RestaurantImportRow> {
  const out: Record<string, unknown> = {};
  RESTAURANT_COLUMNS.forEach((c) => {
    const value = pick(row, c.key);
    if (!value) return;
    out[c.field] = c.field === 'lat' || c.field === 'lng' ? num(value) : c.field === 'merchantType' || c.field === 'planCode' ? value.toLowerCase() : value;
  });
  return out as Partial<RestaurantImportRow>;
}

function toMenuRow(row: Record<string, string>): Record<string, unknown> {
  const price = num(pick(row, 'prix'));
  const allergensRaw = pick(row, 'allergenes');
  const available = pick(row, 'disponible');
  const out: Record<string, unknown> = {
    section: pick(row, 'section'),
    name: pick(row, 'nom'),
    priceCents: price === null ? Number.NaN : Math.round(price * 100),
  };
  const description = pick(row, 'description');
  if (description) out.description = description;
  if (allergensRaw) out.allergens = allergensRaw.split(/[,;|]/).map((a) => ALLERGEN_BY_NAME.get(normalizeText(a.trim())) ?? a.trim()).filter(Boolean);
  if (available) out.available = !['non', 'no', '0', 'false', 'faux'].includes(normalizeText(available));
  const reference = pick(row, 'reference');
  if (reference) out.externalId = reference;
  return out;
}

// ------------------------------------------------------------------ Rapport

function Report({ report, total }: { report: { dryRun: boolean; errors: Array<{ row: number; message: string }>; warnings?: Array<{ row: number; message: string }> }; total: number; children?: ReactNode }) {
  const warnings = report.warnings ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={report.errors.length ? 'amber' : 'success'} icon={report.errors.length ? <TriangleAlert /> : <CheckCircle2 />}>
          {report.dryRun ? 'Simulation' : 'Import terminé'} · {plural(total - report.errors.length, 'ligne valide', 'lignes valides')}
        </Badge>
        {report.errors.length > 0 && <Badge tone="danger">{plural(report.errors.length, 'erreur', 'erreurs')}</Badge>}
        {warnings.length > 0 && <Badge tone="amber">{plural(warnings.length, 'avertissement', 'avertissements')}</Badge>}
      </div>
      {(report.errors.length > 0 || warnings.length > 0) && (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
          {report.errors.map((e, i) => (
            <li key={`e${i}`} className="flex gap-3 px-3 py-2">
              <span className="w-16 shrink-0 font-mono text-xs text-fg-subtle">Ligne {e.row}</span>
              <span className="text-danger">{e.message}</span>
            </li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="flex gap-3 px-3 py-2">
              <span className="w-16 shrink-0 font-mono text-xs text-fg-subtle">Ligne {w.row}</span>
              <span className="text-fg-muted">{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Import de commerces

function RestaurantsImport() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Array<Partial<RestaurantImportRow>>>([]);
  const [report, setReport] = useState<RestaurantImportReport | null>(null);
  const [invite, setInvite] = useState(true);
  const run = useMutation(importRestaurants);

  async function load(list: File[]) {
    setFiles(list);
    setReport(null);
    const file = list[0];
    if (!file) return setRows([]);
    try {
      const parsed = await readTabularFile(file);
      setRows(parsed.map(toRestaurantRow));
      if (parsed.length === 0) toast.error('Fichier vide ou en-têtes non reconnus.');
    } catch {
      toast.error('Lecture du fichier impossible : utilisez le modèle CSV ou Excel.');
      setRows([]);
    }
  }

  async function execute(dryRun: boolean) {
    const result = await run.mutate({ rows, dryRun, inviteOwners: invite });
    if (!result) return;
    setReport(result);
    if (!dryRun) toast.success(`${plural(result.created, 'commerce créé', 'commerces créés')}`, { description: result.skipped ? `${result.skipped} déjà présent(s), ignoré(s).` : undefined });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Panel
        title="Importer des commerces"
        icon={<Store />}
        description="Une ligne par établissement. Chaque commerce démarre en « Documents manquants » ; le gérant reçoit un lien d’accès."
        actions={
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Download />}
            onClick={() => downloadCsv({ name: 'Commerces', columns: RESTAURANT_COLUMNS.map((c) => ({ header: c.key })), rows: [RESTAURANT_COLUMNS.map((c) => c.example)] }, 'modele-import-commerces')}
          >
            Modèle CSV
          </Button>
        }
        bodyClassName="space-y-4"
      >
        <FileUpload value={files} onChange={(f) => void load(f)} accept=".csv,.xlsx" maxFiles={1} maxSize={5 * 1024 * 1024} label="Déposez un fichier CSV ou Excel" hint="500 lignes au plus · colonnes du modèle" />
        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface-2 text-left">
                  <tr>
                    {['Nom', 'Ville', 'Adresse', 'Gérant', 'Formule'].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 6).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-fg">{r.name ?? '—'}</td>
                      <td className="px-3 py-2 text-fg-muted">{r.cityId ?? '—'}</td>
                      <td className="px-3 py-2 text-fg-muted">
                        {r.line1 ?? '—'} {r.postalCode ?? ''}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{r.ownerEmail ?? '—'}</td>
                      <td className="px-3 py-2 text-fg-muted">{r.planCode ?? 'basic'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="text-xs text-fg-subtle">{rows.length > 6 ? `Aperçu des 6 premières lignes sur ${rows.length}.` : plural(rows.length, 'ligne lue', 'lignes lues')}</p>
            <label className="flex items-center gap-2.5 text-sm text-fg">
              <Checkbox checked={invite} onCheckedChange={(v) => setInvite(v === true)} aria-label="Envoyer les accès" />
              Envoyer le lien d’accès à chaque gérant
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leftIcon={<ListChecks />} loading={run.loading && !report} onClick={() => void execute(true)}>
                Simuler l’import
              </Button>
              <Button variant="primary" leftIcon={<FileUp />} loading={run.loading && Boolean(report)} disabled={!report?.dryRun || report.errors.length === rows.length} onClick={() => void execute(false)}>
                Importer {report?.dryRun ? plural(rows.length - report.errors.length - report.skipped, 'commerce', 'commerces') : ''}
              </Button>
            </div>
            {report && <Report report={report} total={rows.length} />}
            {report && !report.dryRun && report.restaurantIds.length > 0 && (
              <p className="text-sm text-fg-muted">
                Commerces créés :{' '}
                {report.restaurantIds.slice(0, 5).map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <Link to={`/restaurants/${id}`} className="text-primary-soft-fg hover:underline">
                      ouvrir la fiche {i + 1}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </Panel>
      <RecentJobs />
    </div>
  );
}

function RecentJobs() {
  const { user } = useAuth();
  const jobs = useCollection<BulkJob>(
    useMemo(
      () => (user ? query(collectionAt(COLLECTIONS.bulkJobs), where('createdBy', '==', user.uid), where('type', '==', 'import_restaurants'), orderBy('createdAt', 'desc'), limit(8)) : null),
      [user],
    ),
  );
  return (
    <Panel title="Mes derniers imports" icon={<History />}>
      {jobs.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : jobs.data.length === 0 ? (
        <EmptyState compact icon={<FileSpreadsheet />} title="Aucun import pour le moment" description="Vos imports de commerces apparaîtront ici avec leur bilan." />
      ) : (
        <ul className="divide-y divide-border">
          {jobs.data.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-fg">{plural(job.succeeded, 'commerce créé', 'commerces créés')}</p>
                <p className="text-xs text-fg-subtle">{toDate(job.createdAt) ? formatRelative(toDate(job.createdAt)!) : ''}</p>
              </div>
              <Badge tone={job.status === 'completed' ? (job.failed ? 'amber' : 'success') : job.status === 'failed' ? 'danger' : 'info'}>
                {job.status === 'completed' ? (job.failed ? `${job.failed} échec(s)` : 'Terminé') : job.status === 'failed' ? 'Échec' : 'En cours'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ Import de carte

function MenuImport() {
  const restaurants = useScopedRestaurants();
  const [restaurantId, setRestaurantId] = useState<string | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [report, setReport] = useState<MenuImportReport | null>(null);
  const run = useMutation(importMenu);

  async function load(list: File[]) {
    setFiles(list);
    setReport(null);
    const file = list[0];
    if (!file) return setRows([]);
    try {
      setRows((await readTabularFile(file)).map(toMenuRow));
    } catch {
      toast.error('Lecture du fichier impossible.');
      setRows([]);
    }
  }
  async function execute(dryRun: boolean) {
    if (!restaurantId) return;
    const result = await run.mutate({ restaurantId, rows, dryRun });
    if (!result) return;
    setReport(result);
    if (!dryRun) toast.success('Carte importée', { description: `${result.created} créé(s), ${result.updated} mis à jour, ${result.sectionsCreated.length} section(s) créée(s).` });
  }

  return (
    <Panel
      title="Importer une carte complète"
      icon={<UtensilsCrossed />}
      description="Sections créées à la volée, produits rapprochés par référence puis par nom. Toute mention d’alcool est importée hors vente et signalée."
      actions={
        <Button size="sm" variant="ghost" leftIcon={<Download />} onClick={() => downloadCsv({ name: 'Carte', columns: MENU_COLUMNS.map((c) => ({ header: c.key })), rows: [MENU_COLUMNS.map((c) => c.example)] }, 'modele-import-carte')}>
          Modèle CSV
        </Button>
      }
      bodyClassName="space-y-4"
    >
      <FormField label="Commerce">
        <Combobox
          value={restaurantId}
          onChange={(v: string | undefined) => {
            setRestaurantId(v);
            setReport(null);
          }}
          placeholder="Choisir le commerce"
          searchPlaceholder="Rechercher un commerce…"
          options={restaurants.data.map((r) => ({ value: r.id, label: r.name, description: r.address.city }))}
        />
      </FormField>
      <FileUpload value={files} onChange={(f) => void load(f)} accept=".csv,.xlsx" maxFiles={1} maxSize={5 * 1024 * 1024} label="Déposez la carte (CSV ou Excel)" hint="Colonnes : section, nom, description, prix, allergènes, disponible, référence" />
      {rows.length > 0 && (
        <>
          <p className="text-xs text-fg-subtle">{plural(rows.length, 'produit lu', 'produits lus')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<ListChecks />} disabled={!restaurantId} loading={run.loading && !report} onClick={() => void execute(true)}>
              Simuler l’import
            </Button>
            <Button variant="primary" leftIcon={<FileUp />} disabled={!restaurantId || !report?.dryRun} loading={run.loading && Boolean(report)} onClick={() => void execute(false)}>
              Importer la carte
            </Button>
          </div>
          {report && (
            <>
              <p className="text-sm text-fg-muted">
                {report.dryRun ? 'Simulation : ' : ''}
                {report.created} à créer · {report.updated} à mettre à jour · {report.unchanged} inchangé(s)
                {report.sectionsCreated.length ? ` · sections nouvelles : ${report.sectionsCreated.join(', ')}` : ''}
              </p>
              <Report report={report} total={rows.length} />
            </>
          )}
        </>
      )}
    </Panel>
  );
}

export function ImportPage() {
  useDocumentTitle('Import · GoLink Admin');
  const can = useCan();
  const canRestaurants = can('restaurants.import');
  const canMenu = can('restaurants.edit');
  const [kind, setKind] = useState<'commerces' | 'carte'>(canRestaurants ? 'commerces' : 'carte');
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Acteurs" title="Import en masse" description="Arrivée d’une chaîne, reprise d’un fichier de prospects signés, mise en ligne d’une carte complète.">
        <RestaurantsNav />
      </PageHeader>
      {!canRestaurants && !canMenu ? (
        <Card>
          <EmptyState icon={<FileUp />} title="Accès réservé" description="L’import demande le droit « Importer des commerces » ou « Modifier les commerces »." />
        </Card>
      ) : (
        <div className="space-y-6">
          {canRestaurants && canMenu && (
            <SegmentedControl
              aria-label="Type d’import"
              value={kind}
              onValueChange={(v) => setKind(v as 'commerces' | 'carte')}
              options={[
                { value: 'commerces', label: 'Commerces', icon: <Store /> },
                { value: 'carte', label: 'Carte d’un commerce', icon: <UtensilsCrossed /> },
              ]}
            />
          )}
          {(kind === 'commerces' && canRestaurants) || !canMenu ? <RestaurantsImport /> : <MenuImport />}
        </div>
      )}
    </PageContainer>
  );
}
