import { useEffect, useMemo, useState } from 'react';
import { Button, Card, ConfirmDialog, FormField, Skeleton, formatDateTime } from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, type CampaignSettings } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { docAt, toMillis, useDoc, useMutation } from '@/lib/firestore';
import { updateGrowthSettings } from '../_croissance/api';
import { LoadError, NumberInput, SettingsBlock } from '../_croissance/ui';
import { History, Save, Timer } from 'lucide-react';
import { CommunicationLayout } from './layout';

type Values = { maxSendsPer7Days: number; sendWindow: { fromHour: number; toHour: number } };

const DEFAULTS: Values = { maxSendsPer7Days: 3, sendWindow: { fromHour: 9, toHour: 21 } };

/** Garde-fous des campagnes des restaurants (settings/campaignRules), tous paramétrables. */
export function RulesPage() {
  useDocumentTitle('Règles des campagnes · GoLink Admin');
  const { can, admin } = useAdminAccess();
  const central = admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0);
  const canEdit = can('notifications.send') && central;
  const settings = useDoc<CampaignSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.campaignRules}`));
  const current = useMemo<Values>(() => ({ ...DEFAULTS, ...(settings.data ?? {}) }), [settings.data]);
  const [draft, setDraft] = useState<Values | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { mutate } = useMutation(updateGrowthSettings, { success: 'Règles enregistrées' });

  useEffect(() => {
    if (!settings.loading) setDraft(current);
  }, [settings.loading, current]);

  if (settings.error) {
    return (
      <CommunicationLayout>
        <Card>
          <LoadError error={settings.error} />
        </Card>
      </CommunicationLayout>
    );
  }
  if (!draft) {
    return (
      <CommunicationLayout>
        <Skeleton className="h-64" />
      </CommunicationLayout>
    );
  }

  const invalid = draft.maxSendsPer7Days < 1 || draft.maxSendsPer7Days > 50 || draft.sendWindow.fromHour >= draft.sendWindow.toHour;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const updatedAt = toMillis(settings.data?.updatedAt);

  return (
    <CommunicationLayout
      title="Règles des campagnes"
      description="Fréquence maximale et plage horaire des envois marketing des restaurants."
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
          <SettingsBlock icon={<Timer />} title="Fréquence et plage d’envoi" description="Appliquées à chaque campagne créée par un établissement.">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Envois maximum sur 7 jours" error={draft.maxSendsPer7Days < 1 || draft.maxSendsPer7Days > 50 ? 'Entre 1 et 50.' : undefined}>
                <NumberInput value={draft.maxSendsPer7Days} onChange={(v) => setDraft({ ...draft, maxSendsPer7Days: v ?? 0 })} unit="envois" disabled={!canEdit} />
              </FormField>
              <FormField label="Début de la plage" error={draft.sendWindow.fromHour >= draft.sendWindow.toHour ? 'Doit précéder la fin.' : undefined}>
                <NumberInput
                  value={draft.sendWindow.fromHour}
                  onChange={(v) => setDraft({ ...draft, sendWindow: { ...draft.sendWindow, fromHour: v ?? 0 } })}
                  unit="h"
                  disabled={!canEdit}
                />
              </FormField>
              <FormField label="Fin de la plage">
                <NumberInput
                  value={draft.sendWindow.toHour}
                  onChange={(v) => setDraft({ ...draft, sendWindow: { ...draft.sendWindow, toHour: v ?? 0 } })}
                  unit="h"
                  disabled={!canEdit}
                />
              </FormField>
            </div>
          </SettingsBlock>
        </div>
        <div className="space-y-4">
          {updatedAt && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-fg-subtle">
              <History className="size-3.5" />
              Modifié le {formatDateTime(updatedAt)}
            </p>
          )}
          {!canEdit && <p className="px-1 text-xs text-fg-subtle">Lecture seule : ces règles s’appliquent à toute la plateforme et sont modifiées par l’équipe centrale.</p>}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Enregistrer les règles des campagnes ?"
        description="Elles s’appliquent immédiatement aux nouveaux envois des restaurants de toute la plateforme."
        confirmLabel="Enregistrer"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ section: 'campaignRules', values: draft, reason: reason ?? '' });
        }}
      />
    </CommunicationLayout>
  );
}
