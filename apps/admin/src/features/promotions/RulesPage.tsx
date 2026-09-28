import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Gauge, History, Save, ShieldCheck } from 'lucide-react';
import { Button, Card, ConfirmDialog, FormField, Skeleton, Switch, formatDateTime } from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, formatPrice, type PromotionSettings } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { docAt, toMillis, useDoc, useMutation } from '@/lib/firestore';
import { updateGrowthSettings } from '../_croissance/api';
import { LoadError, MoneyInput, NumberInput, SettingsBlock } from '../_croissance/ui';
import { PromotionsLayout } from './PromotionsPage';

type Values = { capsEnabled: boolean; restaurantMaxPercentBps: number; restaurantMaxFixedCents: number; restaurantRequiresReview: boolean; maxActivePerRestaurant: number; loyalOrdersThreshold: number; inactiveDaysDefault: number };

const DEFAULTS: Values = { capsEnabled: false, restaurantMaxPercentBps: 5000, restaurantMaxFixedCents: 1500, restaurantRequiresReview: false, maxActivePerRestaurant: 3, loyalOrdersThreshold: 5, inactiveDaysDefault: 30 };

function ToggleRow({ title, description, checked, onChange, disabled }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-sm text-fg-muted">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </label>
  );
}

/** Règles encadrant les offres créées par les restaurants (settings/promotions). */
export function RulesPage() {
  useDocumentTitle('Règles des promotions · GoLink Admin');
  const { can, admin } = useAdminAccess();
  const central = admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0);
  const canEdit = can('promotions.edit') && central;
  const settings = useDoc<PromotionSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.promotions}`));
  const current = useMemo<Values>(() => ({ ...DEFAULTS, ...(settings.data ?? {}), capsEnabled: settings.data?.capsEnabled ?? DEFAULTS.capsEnabled }), [settings.data]);
  const [draft, setDraft] = useState<Values | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { mutate } = useMutation(updateGrowthSettings, { success: 'Règles enregistrées' });

  useEffect(() => {
    if (settings.loading) return;
    setDraft(current);
    setPercent(current.restaurantMaxPercentBps / 100);
  }, [settings.loading, current]);

  if (settings.error) {
    return (
      <PromotionsLayout>
        <Card>
          <LoadError error={settings.error} />
        </Card>
      </PromotionsLayout>
    );
  }
  if (!draft) {
    return (
      <PromotionsLayout>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </PromotionsLayout>
    );
  }

  const values: Values = { ...draft, restaurantMaxPercentBps: Math.round((percent ?? 0) * 100) };
  const invalid =
    percent === null || percent < 1 || percent > 100 || draft.restaurantMaxFixedCents < 50 || draft.maxActivePerRestaurant < 1 || draft.maxActivePerRestaurant > 50 || draft.loyalOrdersThreshold < 2 || draft.loyalOrdersThreshold > 500 || draft.inactiveDaysDefault < 7 || draft.inactiveDaysDefault > 365;
  const dirty = JSON.stringify(values) !== JSON.stringify(current);
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const updatedAt = toMillis(settings.data?.updatedAt);

  return (
    <PromotionsLayout
      actions={
        canEdit ? (
          <Button variant="primary" leftIcon={<Save />} disabled={!dirty || invalid} onClick={() => setConfirm(true)}>
            Enregistrer
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <SettingsBlock icon={<ClipboardCheck />} title="Validation" description="Les offres des restaurants peuvent être publiées directement ou passer par l’équipe GoLink.">
            <ToggleRow
              title="Valider chaque offre avant publication"
              description="Les nouvelles offres des restaurants arrivent dans la file « À valider » et restent invisibles jusqu’à votre décision."
              checked={draft.restaurantRequiresReview}
              onChange={(v) => set('restaurantRequiresReview', v)}
              disabled={!canEdit}
            />
          </SettingsBlock>
          <SettingsBlock icon={<ShieldCheck />} title="Ciblage des offres" description="Définit qui est un client « fidèle » ou « inactif » pour les offres qui les visent (toutes les offres, y compris celles sans code).">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Client fidèle à partir de" error={draft.loyalOrdersThreshold < 2 || draft.loyalOrdersThreshold > 500 ? 'Entre 2 et 500.' : undefined}>
                <NumberInput value={draft.loyalOrdersThreshold} onChange={(v) => set('loyalOrdersThreshold', v ?? 0)} unit="commandes" disabled={!canEdit} />
              </FormField>
              <FormField label="Client inactif après (par défaut)" error={draft.inactiveDaysDefault < 7 || draft.inactiveDaysDefault > 365 ? 'Entre 7 et 365.' : undefined}>
                <NumberInput value={draft.inactiveDaysDefault} onChange={(v) => set('inactiveDaysDefault', v ?? 0)} unit="jours" disabled={!canEdit} />
              </FormField>
            </div>
          </SettingsBlock>
          <SettingsBlock
            icon={<Gauge />}
            title="Plafonds"
            description="Limites appliquées aux offres financées par les restaurants."
            aside={<Switch checked={draft.capsEnabled} onCheckedChange={(v) => set('capsEnabled', v)} disabled={!canEdit} aria-label="Appliquer des plafonds" />}
          >
            {!draft.capsEnabled && (
              <p className="tone-info rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2.5 text-sm text-(--tone-fg)">
                Plafonds désactivés : les restaurants créent leurs offres sans limite (décision en vigueur). Les valeurs ci-dessous s’appliqueront dès leur activation.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Remise maximale en %" error={percent !== null && (percent < 1 || percent > 100) ? 'Entre 1 et 100 %.' : undefined}>
                <NumberInput value={percent} onChange={setPercent} unit="%" decimals={1} disabled={!canEdit} />
              </FormField>
              <FormField label="Remise fixe maximale" error={draft.restaurantMaxFixedCents < 50 ? 'Au moins 0,50 €.' : undefined}>
                <MoneyInput value={draft.restaurantMaxFixedCents} onChange={(v) => set('restaurantMaxFixedCents', v ?? 0)} disabled={!canEdit} />
              </FormField>
              <FormField label="Offres actives par restaurant" error={draft.maxActivePerRestaurant < 1 || draft.maxActivePerRestaurant > 50 ? 'Entre 1 et 50.' : undefined}>
                <NumberInput value={draft.maxActivePerRestaurant} onChange={(v) => set('maxActivePerRestaurant', v ?? 0)} unit="offres" disabled={!canEdit} />
              </FormField>
            </div>
          </SettingsBlock>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
              <ShieldCheck className="size-4 text-fg-muted" />
              En résumé
            </div>
            <ul className="space-y-2 text-sm text-fg-muted">
              <li>{draft.restaurantRequiresReview ? 'Chaque offre est validée par GoLink.' : 'Les offres sont publiées sans validation.'}</li>
              <li>
                {draft.capsEnabled
                  ? `Remise plafonnée à ${percent ?? 0} % ou ${formatPrice(draft.restaurantMaxFixedCents)}, ${draft.maxActivePerRestaurant} offres actives au plus.`
                  : 'Aucun plafond de remise ni de nombre d’offres.'}
              </li>
              <li>Le coût des offres des restaurants est déduit de leur reversement.</li>
            </ul>
          </Card>
          {updatedAt && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-fg-subtle">
              <History className="size-3.5" />
              Modifié le {formatDateTime(updatedAt)}
            </p>
          )}
          {!canEdit && (
            <p className="px-1 text-xs text-fg-subtle">Lecture seule : ces règles s’appliquent à toute la plateforme et sont modifiées par l’équipe centrale.</p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer les règles des promotions ?"
        description="Elles s’appliquent immédiatement aux nouvelles offres des restaurants de toute la plateforme."
        confirmLabel="Enregistrer"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ section: 'promotions', values, reason: reason ?? '' });
        }}
      />
    </PromotionsLayout>
  );
}
