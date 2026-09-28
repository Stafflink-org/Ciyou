// Saisies HACCP partagées : relevé de température, contrôle à réception, non-conformité.
import { useEffect, useState } from 'react';
import { addDoc, serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, ShieldAlert, Thermometer, Truck } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  RadioGroup,
  Select,
  Switch,
  Textarea,
  cn,
} from '@golink/ui';
import { HACCP_SEVERITIES, HACCP_SEVERITY_LABELS, paths, type HaccpEquipment, type HaccpNonConformity, type HaccpReception, type HaccpSeverity, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useMutation } from '@/lib/firestore';
import { formatTemp, inRange, rangeLabel } from './data';

export function ReadingDialog({
  open,
  onClose,
  equipments,
  equipmentId,
}: {
  open: boolean;
  onClose: () => void;
  equipments: WithId<HaccpEquipment>[];
  equipmentId?: string | null;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const active = equipments.filter((e) => e.active);
  const [selected, setSelected] = useState('');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [action, setAction] = useState('');
  useEffect(() => {
    if (!open) return;
    setSelected(equipmentId ?? active[0]?.id ?? '');
    setValue('');
    setComment('');
    setAction('');
  }, [open, equipmentId]);

  const equipment = active.find((e) => e.id === selected);
  const numeric = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(numeric) && numeric > -60 && numeric < 150;
  const ok = equipment && valid ? inRange(equipment, numeric) : true;

  const save = useMutation(
    async () => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpTemperatureLogs')), {
        equipmentId: selected,
        value: Math.round(numeric * 10) / 10,
        inRange: ok,
        comment: comment.trim() || null,
        correctiveAction: action.trim() || null,
        recordedBy: user!.uid,
        recordedAt: serverTimestamp(),
        verifiedBy: null,
        verifiedAt: null,
      });
      return ok;
    },
    { success: (conform) => (conform ? 'Relevé enregistré : conforme' : 'Relevé hors seuil enregistré, non-conformité ouverte') },
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Thermometer />} title="Relevé de température" description="Saisissez la valeur lue sur le thermomètre de l’enceinte." />
        <DialogBody className="space-y-4">
          <FormField label="Équipement" required>
            <Select value={selected} onValueChange={setSelected} options={active.map((e) => ({ value: e.id, label: e.name, description: `${e.area} · ${rangeLabel(e)}` }))} />
          </FormField>
          <FormField label="Température relevée" required hint={equipment ? `Plage attendue : ${rangeLabel(equipment)}` : undefined}>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} trailing="°C" placeholder="3,5" autoFocus className="text-lg" />
          </FormField>
          {valid && equipment && (
            <div
              className={cn(
                ok ? 'tone-success' : 'tone-danger',
                'flex items-center gap-2 rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm font-medium text-(--tone-fg)',
              )}
            >
              {ok ? <Thermometer className="size-4" /> : <AlertTriangle className="size-4" />}
              {ok ? `${formatTemp(numeric)} : conforme` : `${formatTemp(numeric)} : hors seuil, une action corrective est requise`}
            </div>
          )}
          {!ok && (
            <FormField label="Action corrective" required>
              <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} maxLength={300} placeholder="Ex. porte refermée, contrôle refait dans 30 min, produits déplacés" />
            </FormField>
          )}
          <FormField label="Commentaire">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={200} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={!valid || !selected || (!ok && action.trim().length < 3)}
            onClick={async () => {
              if ((await save.mutate()) !== undefined) onClose();
            }}
          >
            Enregistrer le relevé
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CHECKS: Array<[keyof HaccpReception['checks'], string]> = [
  ['supplierIdentified', 'Fournisseur identifié'],
  ['labelingConform', 'Étiquetage conforme'],
  ['packagingIntact', 'Emballage intact'],
  ['useByChecked', 'DLC / DDM vérifiée'],
  ['temperatureConform', 'Température conforme'],
  ['quantityChecked', 'Quantité contrôlée'],
];

export function ReceptionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [supplier, setSupplier] = useState('');
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState('Frais');
  const [lot, setLot] = useState('');
  const [useBy, setUseBy] = useState('');
  const [quantity, setQuantity] = useState('');
  const [temperature, setTemperature] = useState('');
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState<HaccpReception['checks']>({
    supplierIdentified: true,
    labelingConform: true,
    packagingIntact: true,
    useByChecked: true,
    temperatureConform: true,
    quantityChecked: true,
  });
  useEffect(() => {
    if (open) {
      setSupplier('');
      setProduct('');
      setLot('');
      setUseBy('');
      setQuantity('');
      setTemperature('');
      setNotes('');
      setChecks({ supplierIdentified: true, labelingConform: true, packagingIntact: true, useByChecked: true, temperatureConform: true, quantityChecked: true });
    }
  }, [open]);
  const failing = CHECKS.filter(([key]) => !checks[key]).length;
  const save = useMutation(
    async () => {
      const temp = temperature.trim() ? Number(temperature.replace(',', '.')) : null;
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpReceptions')), {
        supplierName: supplier.trim(),
        productName: product.trim(),
        category: category || null,
        lotNumber: lot.trim() || null,
        useByDate: useBy || null,
        quantityLabel: quantity.trim() || null,
        temperature: temp !== null && Number.isFinite(temp) ? temp : null,
        checks,
        labelPhoto: null,
        status: 'pending',
        notes: notes.trim() || null,
        receivedBy: user!.uid,
        receivedAt: serverTimestamp(),
        decidedBy: null,
        decidedAt: null,
      });
      return true;
    },
    { success: 'Réception enregistrée, en attente de décision' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Truck />} title="Contrôle à réception" description="Vérifiez chaque livraison avant de la ranger en chambre froide ou en réserve." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Fournisseur" required>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={80} />
            </FormField>
            <FormField label="Produit" required>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Catégorie">
              <Select value={category} onValueChange={setCategory} options={['Frais', 'Surgelé', 'Sec', 'Fruits et légumes', 'Boissons', 'Autre'].map((c) => ({ value: c, label: c }))} />
            </FormField>
            <FormField label="Numéro de lot">
              <Input value={lot} onChange={(e) => setLot(e.target.value)} maxLength={40} />
            </FormField>
            <FormField label="DLC / DDM">
              <Input type="date" value={useBy} onChange={(e) => setUseBy(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Quantité">
                <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} maxLength={30} placeholder="5 kg" />
              </FormField>
              <FormField label="Température">
                <Input inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} trailing="°C" />
              </FormField>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Points de contrôle</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHECKS.map(([key, label]) => (
                <Switch key={key} label={label} checked={checks[key]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [key]: v }))} className="rounded-lg border border-border px-3 py-2" />
              ))}
            </div>
          </div>
          {failing > 0 && (
            <p className="tone-danger flex items-center gap-2 rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              <AlertTriangle className="size-4" /> {failing} point{failing > 1 ? 's' : ''} non conforme{failing > 1 ? 's' : ''} : précisez et signalez au responsable.
            </p>
          )}
          <FormField label="Remarques">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={supplier.trim().length < 2 || product.trim().length < 2}
            onClick={async () => {
              if (await save.mutate()) onClose();
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NonConformityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<HaccpSeverity>('minor');
  const [source, setSource] = useState<NonNullable<HaccpNonConformity['source']>['type']>('other');
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setSeverity('minor');
      setSource('other');
    }
  }, [open]);
  const save = useMutation(
    async () => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpNonConformities')), {
        title: title.trim(),
        description: description.trim() || null,
        severity,
        status: 'open',
        source: { type: source, id: null },
        correctiveActions: [],
        declaredBy: user!.uid,
        declaredAt: serverTimestamp(),
        resolvedBy: null,
        resolvedAt: null,
      });
      return true;
    },
    { success: 'Non-conformité déclarée' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<ShieldAlert />} title="Déclarer une non-conformité" description="Tout écart d’hygiène ou de sécurité alimentaire, avec sa gravité." />
        <DialogBody className="space-y-4">
          <FormField label="Intitulé" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ex. produit sans étiquette en chambre froide" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </FormField>
          <FormField label="Origine">
            <Select
              value={source}
              onValueChange={(v) => setSource(v as typeof source)}
              options={[
                { value: 'temperature', label: 'Température' },
                { value: 'reception', label: 'Réception' },
                { value: 'cleaning', label: 'Nettoyage' },
                { value: 'pest', label: 'Nuisibles' },
                { value: 'audit', label: 'Audit ou contrôle' },
                { value: 'other', label: 'Autre' },
              ]}
            />
          </FormField>
          <FormField label="Gravité">
            <RadioGroup
              variant="cards"
              value={severity}
              onValueChange={(v) => setSeverity(v as HaccpSeverity)}
              className="sm:grid-cols-3"
              options={HACCP_SEVERITIES.map((s) => ({
                value: s,
                label: HACCP_SEVERITY_LABELS[s],
                description: s === 'minor' ? 'Sans risque immédiat' : s === 'major' ? 'Risque à traiter vite' : 'Risque pour la santé',
              }))}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={title.trim().length < 3}
            onClick={async () => {
              if (await save.mutate()) onClose();
            }}
          >
            Déclarer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
