// Actions groupées sur une sélection de commerces : commission, formule,
// fonctionnalité, message, suspension, réactivation. Motif obligatoire (audit).
import { useState, type ReactNode } from 'react';
import { BadgePercent, Ban, Mail, Play, Sparkles, ToggleRight } from 'lucide-react';
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
  toast,
} from '@golink/ui';
import { FEATURE_KEYS, FEATURE_LABELS, type BulkRestaurantActionType, type FeatureKey } from '@golink/shared';
import { useMutation } from '@/lib/firestore';
import { plural } from '../../acteurs-commun/ui';
import { PLAN_LABELS, bulkRestaurantAction, type RestaurantRow } from '../lib';

export type BulkDialogAction = Exclude<BulkRestaurantActionType, 'export'>;

const META: Record<BulkDialogAction, { title: string; icon: ReactNode; confirm: string; destructive?: boolean }> = {
  set_commission: { title: 'Changer la commission', icon: <BadgePercent />, confirm: 'Appliquer les taux' },
  set_plan: { title: 'Changer la formule', icon: <Sparkles />, confirm: 'Appliquer la formule' },
  set_feature: { title: 'Activer ou désactiver une fonctionnalité', icon: <ToggleRight />, confirm: 'Appliquer' },
  send_message: { title: 'Envoyer un message', icon: <Mail />, confirm: 'Envoyer' },
  suspend: { title: 'Suspendre les commerces', icon: <Ban />, confirm: 'Suspendre', destructive: true },
  reactivate: { title: 'Réactiver les commerces', icon: <Play />, confirm: 'Réactiver' },
};

function percentToBps(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : Number.NaN;
}

export function BulkActionDialog({
  action,
  rows,
  onOpenChange,
  onDone,
}: {
  action: BulkDialogAction | null;
  rows: RestaurantRow[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [platform, setPlatform] = useState('');
  const [own, setOwn] = useState('');
  const [pickup, setPickup] = useState('');
  const [plan, setPlan] = useState('pro');
  const [feature, setFeature] = useState<FeatureKey>('scheduled_orders');
  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState('7');
  const run = useMutation(bulkRestaurantAction);

  if (!action) return null;
  const meta = META[action];
  const bps = { platformDeliveryBps: percentToBps(platform), restaurantDeliveryBps: percentToBps(own), pickupBps: percentToBps(pickup) };
  const invalidRates = Object.values(bps).some((v) => Number.isNaN(v));
  const blocked =
    reason.trim().length < 3 ||
    (action === 'set_commission' && (invalidRates || Object.values(bps).every((v) => v === null))) ||
    (action === 'send_message' && (subject.trim().length < 3 || message.trim().length < 3));

  async function submit() {
    if (!action) return;
    const until = duration === 'none' ? null : new Date(Date.now() + Number(duration) * 86_400_000).toISOString();
    const result = await run.mutate({
      restaurantIds: rows.map((r) => r.id),
      action,
      reason: reason.trim(),
      params:
        action === 'set_commission'
          ? bps
          : action === 'set_plan'
            ? { planCode: plan as 'basic' | 'pro' | 'premium' }
            : action === 'set_feature'
              ? { feature, enabled }
              : action === 'send_message'
                ? { subject: subject.trim(), message: message.trim() }
                : action === 'suspend'
                  ? { until, message: message.trim() || undefined }
                  : {},
    });
    if (!result) return;
    if (result.failed === 0) toast.success(`${plural(result.succeeded, 'commerce mis à jour', 'commerces mis à jour')}.`);
    else
      toast.warning(`${plural(result.succeeded, 'commerce traité', 'commerces traités')}, ${plural(result.failed, 'échec', 'échecs')}.`, {
        description: result.errors.slice(0, 3).map((e) => `${rows.find((r) => r.id === e.id)?.name ?? e.id} : ${e.message}`).join(' · '),
      });
    setReason('');
    onDone();
    onOpenChange(false);
  }

  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !run.loading && onOpenChange(open)}>
      <DialogContent size="md">
        <DialogHeader
          icon={meta.icon}
          title={meta.title}
          description={`${plural(rows.length, 'commerce sélectionné', 'commerces sélectionnés')} : ${rows
            .slice(0, 3)
            .map((r) => r.name)
            .join(', ')}${rows.length > 3 ? '…' : ''}`}
        />
        <DialogBody className="space-y-4">
          {action === 'set_commission' && (
            <>
              <p className="text-sm text-fg-muted">Taux négociés en pourcentage des articles TTC (hors livraison et pourboires). Laissez vide pour reprendre le taux de la formule.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Livraison GoLink">
                  <Input inputMode="decimal" value={platform} onChange={(e) => setPlatform(e.target.value)} trailing="%" placeholder="30" />
                </FormField>
                <FormField label="Livreurs du commerce">
                  <Input inputMode="decimal" value={own} onChange={(e) => setOwn(e.target.value)} trailing="%" placeholder="15" />
                </FormField>
                <FormField label="Retrait">
                  <Input inputMode="decimal" value={pickup} onChange={(e) => setPickup(e.target.value)} trailing="%" placeholder="12" />
                </FormField>
              </div>
              {invalidRates && <p className="text-sm text-danger">Saisissez des taux entre 0 et 100 %.</p>}
            </>
          )}
          {action === 'set_plan' && (
            <FormField label="Nouvelle formule">
              <RadioGroup
                variant="cards"
                className="sm:grid-cols-3"
                value={plan}
                onValueChange={setPlan}
                options={Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </FormField>
          )}
          {action === 'set_feature' && (
            <>
              <FormField label="Fonctionnalité">
                <Select
                  value={feature}
                  onValueChange={(v) => setFeature(v as FeatureKey)}
                  options={FEATURE_KEYS.filter((k) => k !== 'alcohol_sales' && k !== 'meal_voucher').map((k) => ({ value: k, label: FEATURE_LABELS[k] }))}
                />
              </FormField>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium text-fg">{enabled ? 'Activer' : 'Désactiver'} pour la sélection</span>
                  <span className="block text-xs text-fg-subtle">Surcharge propre à chaque commerce, prioritaire sur la ville et la formule.</span>
                </span>
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="État de la fonctionnalité" />
              </label>
            </>
          )}
          {action === 'send_message' && (
            <>
              <FormField label="Objet" required>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Nouveaux horaires de support" />
              </FormField>
              <FormField label="Message" required hint="Envoyé par e-mail au propriétaire et affiché dans ses notifications.">
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={3000} />
              </FormField>
            </>
          )}
          {action === 'suspend' && (
            <>
              <FormField label="Durée">
                <Select
                  value={duration}
                  onValueChange={setDuration}
                  options={[
                    { value: '1', label: '24 heures' },
                    { value: '3', label: '3 jours' },
                    { value: '7', label: '7 jours' },
                    { value: '30', label: '30 jours' },
                    { value: 'none', label: 'Jusqu’à réactivation manuelle' },
                  ]}
                />
              </FormField>
              <FormField label="Message au restaurant" hint="Facultatif, ajouté à l’e-mail de suspension.">
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} />
              </FormField>
            </>
          )}
          {action === 'reactivate' && <p className="text-sm text-fg-muted">Les commerces suspendus redeviennent visibles et peuvent rouvrir. Les autres sont ignorés.</p>}
          <FormField label="Motif" required hint="Conservé dans le journal d’audit.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button variant={meta.destructive ? 'danger' : 'primary'} loading={run.loading} disabled={blocked} onClick={() => void submit()}>
            {meta.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
