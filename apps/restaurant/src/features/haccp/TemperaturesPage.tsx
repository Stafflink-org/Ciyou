import { useEffect, useMemo, useState } from 'react';
import { addDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { BadgeCheck, Pencil, Plus, Refrigerator, Thermometer } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageContainer,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  cn,
  createColumnHelper,
  formatDateTime,
} from '@golink/ui';
import { paths, type HaccpEquipment, type HaccpTemperatureLog, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { collectionAt, createdFields, toDate, updatedFields, useMutation } from '@/lib/firestore';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard } from '../_rh/ui';
import { EQUIPMENT_KIND_LABELS, formatTemp, rangeLabel, useEquipments, useTemperatureLogs } from './data';
import { ReadingDialog } from './dialogs';
import { HaccpHeader } from './layout';
import { TemperatureChart } from './TemperatureChart';

const column = createColumnHelper<WithId<HaccpTemperatureLog>>();
const dayHour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function EquipmentDialog({ open, onClose, equipment }: { open: boolean; onClose: () => void; equipment: WithId<HaccpEquipment> | null }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [area, setArea] = useState('Cuisine');
  const [kind, setKind] = useState<HaccpEquipment['kind']>('fridge');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('4');
  const [readings, setReadings] = useState('2');
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setName(equipment?.name ?? '');
    setCode(equipment?.code ?? '');
    setArea(equipment?.area ?? 'Cuisine');
    setKind(equipment?.kind ?? 'fridge');
    setMin(equipment?.minTemp !== null && equipment?.minTemp !== undefined ? String(equipment.minTemp) : '0');
    setMax(equipment?.maxTemp !== null && equipment?.maxTemp !== undefined ? String(equipment.maxTemp) : '4');
    setReadings(String(equipment?.readingsPerDay ?? 2));
    setActive(equipment?.active ?? true);
  }, [open, equipment]);
  const presets: Record<HaccpEquipment['kind'], [string, string]> = { fridge: ['0', '4'], cold_room: ['0', '4'], freezer: ['-25', '-18'], hot_holding: ['63', '90'], other: ['', ''] };
  const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = useMutation(
    async () => {
      const data = {
        name: name.trim(),
        code: code.trim() || null,
        area: area.trim() || 'Cuisine',
        kind,
        minTemp: parse(min),
        maxTemp: parse(max),
        readingsPerDay: Math.max(1, Math.min(6, Number(readings) || 1)),
        active,
      };
      const collection = collectionAt(paths.restaurantSub(restaurantId, 'haccpEquipments'));
      if (equipment) await updateDoc(doc(collection, equipment.id), { ...data, ...updatedFields(user!.uid) });
      else await addDoc(collection, { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: equipment ? 'Équipement mis à jour' : 'Équipement ajouté' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<Refrigerator />} title={equipment ? 'Modifier l’équipement' : 'Nouvel équipement'} description="Enceinte froide ou chaude suivie en température." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Réfrigérateur du passe" />
            </FormField>
            <FormField label="Type">
              <Select
                value={kind}
                onValueChange={(v) => {
                  const next = v as HaccpEquipment['kind'];
                  setKind(next);
                  if (!equipment) {
                    setMin(presets[next][0]);
                    setMax(presets[next][1]);
                  }
                }}
                options={Object.entries(EQUIPMENT_KIND_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </FormField>
            <FormField label="Zone">
              <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} />
            </FormField>
            <FormField label="Repère">
              <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="EQ-1" />
            </FormField>
            <FormField label="Température minimale">
              <Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} trailing="°C" />
            </FormField>
            <FormField label="Température maximale">
              <Input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} trailing="°C" />
            </FormField>
            <FormField label="Relevés par jour">
              <Select value={readings} onValueChange={setReadings} options={['1', '2', '3', '4'].map((v) => ({ value: v, label: `${v} relevé${v === '1' ? '' : 's'}` }))} />
            </FormField>
          </div>
          <Switch label="Suivi actif" description="Un équipement inactif n’est plus proposé aux relevés." checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={name.trim().length < 2}
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

export function TemperaturesPage() {
  useDocumentTitle('Températures · HACCP · Ciyou Eats Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const equipments = useEquipments();
  const logs = useTemperatureLogs(14);
  const [reading, setReading] = useState<string | null | false>(false);
  const [editing, setEditing] = useState<WithId<HaccpEquipment> | 'new' | null>(null);
  const [chartId, setChartId] = useState<string>('');
  const selectedChart = chartId || equipments.data[0]?.id || '';
  const byId = new Map(equipments.data.map((e) => [e.id, e]));

  const verify = useMutation(
    async (list: WithId<HaccpTemperatureLog>[]) => {
      const batch = writeBatch(db);
      const targets = list.filter((l) => !l.verifiedBy);
      for (const log of targets) {
        batch.update(doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpTemperatureLogs')), log.id), { verifiedBy: user!.uid, verifiedAt: serverTimestamp() });
      }
      await batch.commit();
      return targets.length;
    },
    { success: (n) => `${n} relevé${n > 1 ? 's' : ''} vérifié${n > 1 ? 's' : ''}` },
  );

  const chartData = useMemo(() => {
    return logs.data
      .filter((l) => l.equipmentId === selectedChart)
      .map((l) => ({ at: toDate(l.recordedAt), value: l.value }))
      .filter((p): p is { at: Date; value: number } => p.at !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((p) => ({ date: dayHour.format(p.at), valeur: p.value }));
  }, [logs.data, selectedChart]);

  const columns = useMemo(
    () => [
      column.accessor((l) => toDate(l.recordedAt)?.getTime() ?? 0, {
        id: 'at',
        header: 'Date',
        cell: (info) => <span className="whitespace-nowrap font-mono text-xs num">{info.getValue() ? formatDateTime(info.getValue()) : '—'}</span>,
      }),
      column.accessor((l) => byId.get(l.equipmentId)?.name ?? 'Équipement', { id: 'equipment', header: 'Équipement' }),
      column.accessor('value', {
        header: 'Valeur',
        meta: { align: 'right' },
        cell: (info) => <span className={cn('font-mono text-sm font-semibold num', info.row.original.inRange ? 'text-fg' : 'text-danger')}>{formatTemp(info.getValue())}</span>,
      }),
      column.accessor('inRange', {
        header: 'Conformité',
        cell: (info) => <StatusPill tone={info.getValue() ? 'success' : 'danger'}>{info.getValue() ? 'Conforme' : 'Hors seuil'}</StatusPill>,
      }),
      column.accessor((l) => directory.nameOfUid(l.recordedBy), { id: 'by', header: 'Relevé par' }),
      column.accessor((l) => l.correctiveAction ?? l.comment ?? '', {
        id: 'action',
        header: 'Action / commentaire',
        cell: (info) => <span className="line-clamp-2 max-w-72 text-xs text-fg-muted">{info.getValue() || '—'}</span>,
      }),
      column.accessor((l) => (l.verifiedBy ? 'yes' : 'no'), {
        id: 'verified',
        header: 'Vérifié',
        cell: (info) =>
          info.getValue() === 'yes' ? (
            <Badge tone="success" icon={<BadgeCheck />} size="sm">
              {directory.nameOfUid(info.row.original.verifiedBy).split(' ')[0]}
            </Badge>
          ) : (
            <span className="text-xs text-fg-subtle">À vérifier</span>
          ),
      }),
    ],
    [equipments.data, directory.byUid],
  );

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Températures"
        description="Relevés des enceintes froides et chaudes, actions correctives et vérification par le responsable."
        actions={
          <>
            {manage && (
              <Button leftIcon={<Plus />} onClick={() => setEditing('new')}>
                Équipement
              </Button>
            )}
            <Button variant="primary" leftIcon={<Thermometer />} onClick={() => setReading(null)} disabled={equipments.data.length === 0}>
              Nouveau relevé
            </Button>
          </>
        }
      />
      {(equipments.error || logs.error) && <ErrorCard error={equipments.error ?? logs.error} />}

      {equipments.loading ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : equipments.data.length === 0 ? (
        <Card className="mb-6">
          <EmptyState
            icon={<Refrigerator />}
            title="Aucun équipement suivi"
            description="Ajoutez vos réfrigérateurs, congélateurs et bains-marie avec leurs seuils réglementaires."
            action={
              manage ? (
                <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
                  Ajouter un équipement
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {equipments.data.map((equipment) => {
            const last = logs.data.find((l) => l.equipmentId === equipment.id);
            const lastAt = last ? toDate(last.recordedAt) : null;
            return (
              <Card key={equipment.id} className={cn('p-4', !equipment.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{equipment.name}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      {EQUIPMENT_KIND_LABELS[equipment.kind]} · {equipment.area}
                    </p>
                  </div>
                  {manage && (
                    <IconButton label={`Modifier ${equipment.name}`} size="xs" onClick={() => setEditing(equipment)}>
                      <Pencil />
                    </IconButton>
                  )}
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className={cn('font-display text-2xl font-semibold tracking-tight num', last && !last.inRange ? 'text-danger' : 'text-fg')}>{last ? formatTemp(last.value) : '—'}</p>
                    <p className="text-2xs text-fg-subtle">{lastAt ? `Relevé ${formatDateTime(lastAt)}` : 'Aucun relevé'}</p>
                  </div>
                  <Badge tone="neutral" variant="outline" size="sm">
                    {rangeLabel(equipment)}
                  </Badge>
                </div>
                {equipment.active && (
                  <Button size="xs" variant="soft" block className="mt-3" leftIcon={<Thermometer />} onClick={() => setReading(equipment.id)}>
                    Relever
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {equipments.data.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            icon={<Thermometer />}
            title="Courbe sur 14 jours"
            description="Chaque point est un relevé ; la bande verte figure la plage de conformité."
            actions={<Select size="sm" className="w-56" value={selectedChart} onValueChange={setChartId} options={equipments.data.map((e) => ({ value: e.id, label: e.name }))} aria-label="Équipement affiché" />}
            divided
          />
          <div className="p-4">
            {logs.loading ? (
              <Skeleton className="h-56" />
            ) : chartData.length === 0 ? (
              <EmptyState compact icon={<Thermometer />} title="Aucun relevé sur la période" />
            ) : (
              <TemperatureChart data={chartData} min={byId.get(selectedChart)?.minTemp ?? null} max={byId.get(selectedChart)?.maxTemp ?? null} />
            )}
          </div>
        </Card>
      )}

      <DataTable
        data={logs.data}
        columns={columns}
        getRowId={(l) => l.id}
        loading={logs.loading}
        itemLabel="relevés"
        pageSize={15}
        searchPlaceholder="Rechercher un équipement, une personne…"
        initialSorting={[{ id: 'at', desc: true }]}
        filters={[
          { id: 'equipment', label: 'Équipement', options: equipments.data.map((e) => ({ value: e.id, label: e.name })), getValue: (l) => l.equipmentId },
          {
            id: 'range',
            label: 'Conformité',
            options: [
              { value: 'ok', label: 'Conforme' },
              { value: 'ko', label: 'Hors seuil' },
            ],
            getValue: (l) => (l.inRange ? 'ok' : 'ko'),
          },
        ]}
        bulkActions={manage ? [{ label: 'Marquer vérifié', icon: <BadgeCheck />, onClick: (rows, clear) => void verify.mutate(rows).then((n) => n !== undefined && clear()) }] : undefined}
        emptyState={<EmptyState compact icon={<Thermometer />} title="Aucun relevé sur 14 jours" />}
      />

      <ReadingDialog open={reading !== false} onClose={() => setReading(false)} equipments={equipments.data} equipmentId={reading || null} />
      {manage && <EquipmentDialog open={editing !== null} equipment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
