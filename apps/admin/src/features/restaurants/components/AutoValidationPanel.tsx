// Validation automatique des commerces (décision client n° 14) : réglage de la règle par le
// super admin (mode, contrôles, plafond) et résultat des contrôles sur chaque dossier.
import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog, FormField, Select, Switch, toast } from '@golink/ui';
import {
  COLLECTIONS,
  DEFAULT_MERCHANT_VALIDATION,
  MERCHANT_VALIDATION_MODES,
  SETTINGS_DOCS,
  type MerchantAutoValidation,
  type MerchantValidationMode,
  type MerchantValidationSettings,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { callFunction, docAt, errorMessage, toDate, useDoc } from '@/lib/firestore';
import { UnitInput } from '../../_operations/inputs';
import { Panel } from '../../acteurs-commun/ui';

type Settings = Omit<MerchantValidationSettings, 'updatedAt' | 'updatedBy'>;

const updateMerchantValidation = callFunction<Settings & { reason: string }, { updatedFields: string[] }>('updateMerchantValidation');
const runMerchantValidationCheck = callFunction<{ restaurantId: string; apply?: boolean }, { outcome: 'approved' | 'suggested' | 'not_eligible' | 'skipped'; checks: MerchantAutoValidation['checks'] }>('runMerchantValidationCheck');

const MODE_LABELS: Record<MerchantValidationMode, { label: string; description: string }> = {
  off: { label: 'Désactivée', description: 'Tous les dossiers passent par la validation manuelle.' },
  suggest: { label: 'Suggestion', description: 'Les dossiers conformes sont signalés « validables » ; un agent valide en un clic.' },
  auto: { label: 'Automatique', description: 'Un dossier complet et conforme est validé et mis en ligne sans intervention.' },
};

/** Réglage de la règle (carte de la file de validation). Modifiable par l'équipe centrale seulement. */
export function AutoValidationSettingsCard() {
  const { admin, can } = useAdminAccess();
  const doc = useDoc<MerchantValidationSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.merchantValidation}`));
  const editable = can('restaurants.validate') && (admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0));
  const saved = useMemo<Settings>(() => ({ ...DEFAULT_MERCHANT_VALIDATION, ...(doc.data ?? {}) }), [doc.data]);
  const [draft, setDraft] = useState<Settings>(saved);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Panel
      title="Validation automatique"
      icon={<BadgeCheck />}
      description="Règle décidée par le client : un commerce dont le dossier est complet et valide est mis en ligne automatiquement, sinon il reste ici pour validation manuelle."
      actions={<Badge tone={saved.mode === 'auto' ? 'success' : saved.mode === 'suggest' ? 'info' : 'neutral'}>{MODE_LABELS[saved.mode].label}</Badge>}
    >
      <div className="space-y-5">
        <FormField label="Mode" hint={MODE_LABELS[draft.mode].description}>
          <Select
            value={draft.mode}
            onValueChange={(v) => set('mode', v as MerchantValidationMode)}
            disabled={!editable}
            options={MERCHANT_VALIDATION_MODES.map((m) => ({ value: m, label: MODE_LABELS[m].label }))}
            aria-label="Mode de validation"
          />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch checked={draft.requireContract} onCheckedChange={(v) => set('requireContract', v)} disabled={!editable} label="Contrat partenaire accepté" description="Obligatoire avant toute validation." />
          <Switch checked={draft.checkRegistrationNumber} onCheckedChange={(v) => set('checkRegistrationNumber', v)} disabled={!editable} label="Numéro d’immatriculation conforme" description="Format et clé de contrôle selon le pays (SIRET, BCE, RCS, ICE…)." />
          <Switch checked={draft.requireActiveCity} onCheckedChange={(v) => set('requireActiveCity', v)} disabled={!editable} label="Ville active avec zone de livraison" description="Lancement ville par ville." />
          <Switch checked={draft.goLive} onCheckedChange={(v) => set('goLive', v)} disabled={!editable} label="Mise en ligne immédiate" description="Sinon le commerce est validé mais reste à ouvrir." />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Validité minimale des pièces" hint="Une pièce qui expire plus tôt est refusée.">
            <UnitInput value={draft.minDocumentValidityDays} onChange={(v) => v !== null && set('minDocumentValidityDays', v)} unit="jours" min={0} max={365} disabled={!editable} />
          </FormField>
          <FormField label="Ancienneté maximale du Kbis" hint="0 = pas de contrôle.">
            <UnitInput value={draft.registrationDocumentMaxAgeDays} onChange={(v) => v !== null && set('registrationDocumentMaxAgeDays', v)} unit="jours" min={0} max={730} disabled={!editable} />
          </FormField>
          <FormField label="Plafond par jour" hint="Garde-fou ; 0 = illimité.">
            <UnitInput value={draft.maxPerDay} onChange={(v) => v !== null && set('maxPerDay', v)} unit="dossiers" min={0} max={1000} disabled={!editable} />
          </FormField>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" leftIcon={<Save />} disabled={!dirty || doc.loading} onClick={() => setConfirm(true)}>
              Enregistrer la règle
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(saved)}>
                Annuler
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">Consultation seule : le réglage relève de l’équipe centrale.</p>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer la validation automatique"
        description="La règle s’applique aux dossiers à venir, dès le prochain dépôt de pièce ou le prochain passage horaire."
        requireReason
        confirmLabel="Enregistrer"
        onConfirm={async (reason) => {
          try {
            await updateMerchantValidation({ ...draft, reason: reason ?? '' });
            toast.success('Règle de validation enregistrée');
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </Panel>
  );
}

/** Contrôles automatiques d'un dossier (fiche restaurant) et bouton « Vérifier maintenant ». */
export function AutoValidationChecks({ restaurantId, autoValidation, canRun, inQueue }: { restaurantId: string; autoValidation?: MerchantAutoValidation | null; canRun: boolean; inQueue: boolean }) {
  const [running, setRunning] = useState(false);
  const at = autoValidation ? toDate(autoValidation.at) : null;

  async function run(apply = false) {
    setRunning(true);
    try {
      const result = await runMerchantValidationCheck({ restaurantId, apply });
      toast.success(result.outcome === 'approved' ? 'Dossier validé automatiquement' : result.outcome === 'suggested' ? 'Dossier conforme : validable en un clic' : 'Contrôles rejoués');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel
      title="Contrôles automatiques"
      icon={<ShieldCheck />}
      description="Ce que la validation automatique a vérifié sur ce dossier."
      actions={
        canRun && inQueue ? (
          <div className="flex flex-wrap gap-2">
            {autoValidation?.eligible && autoValidation.mode === 'suggest' && !autoValidation.decided && (
              <Button size="sm" variant="primary" leftIcon={<BadgeCheck />} loading={running} onClick={() => void run(true)}>
                Valider en un clic
              </Button>
            )}
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} loading={running} onClick={() => void run()}>
              Vérifier maintenant
            </Button>
          </div>
        ) : undefined
      }
    >
      {!autoValidation ? (
        <p className="text-sm text-fg-muted">Aucun examen automatique pour l’instant : il a lieu au dépôt des pièces et à l’acceptation du contrat.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <Badge tone={autoValidation.eligible ? 'success' : 'amber'} size="sm">
              {autoValidation.decided ? 'Validé automatiquement' : autoValidation.eligible ? 'Conforme' : 'À traiter manuellement'}
            </Badge>
            {at && <span>Examiné le {at.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {autoValidation.checks.map((check) => (
              <li key={check.code} className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm">
                {check.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className={check.ok ? 'text-fg-muted' : 'text-fg'}>{check.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
