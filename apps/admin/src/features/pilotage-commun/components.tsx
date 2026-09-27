// Éléments d'interface communs aux écrans de pilotage : barre de filtres,
// états d'erreur, cartes de graphique, téléchargement de fichiers générés.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Layers, RefreshCw } from 'lucide-react';
import { Button, Card, CardHeader, DateRangePicker, EmptyState, IconButton, Select, Tooltip, cn, type DateRange } from '@golink/ui';
import { PILOTAGE_PLAN_CODES, type PlanCode } from '@golink/shared';
import { useTranslation } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import type { PilotageFilterState } from './hooks';
import { isoDay, parseDay, PERIOD_PRESETS, presetRange } from './period';

export const PILOTAGE_PLAN_NAMES: Record<PlanCode, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium' };

const ALL_PLANS = 'all';

/** Sélecteur de période (raccourcis + calendrier) et de formule d'abonnement. */
export function PilotageFilterBar({
  state,
  showPlan = true,
  onRefresh,
  refreshing,
  children,
  className,
}: {
  state: PilotageFilterState;
  showPlan?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation('accueil');
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const value: DateRange = draft ?? { from: parseDay(state.period.from), to: parseDay(state.period.to) };
  const presets = PERIOD_PRESETS.map((preset) => ({
    label: t(`period.${preset.value}`),
    range: () => {
      const range = presetRange(preset.value);
      return { from: parseDay(range.from), to: parseDay(range.to) };
    },
  }));

  function handleChange(range: DateRange | undefined) {
    if (!range?.from) return;
    if (!range.to) {
      setDraft(range);
      return;
    }
    setDraft(undefined);
    const from = isoDay(range.from);
    const to = isoDay(range.to);
    const match = PERIOD_PRESETS.find((preset) => {
      const candidate = presetRange(preset.value);
      return candidate.from === from && candidate.to === to;
    });
    if (match) state.setPreset(match.value);
    else state.setCustom(from <= to ? { from, to } : { from: to, to: from });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DateRangePicker value={value} onChange={handleChange} presets={presets} className="w-full min-w-0 basis-full sm:w-auto sm:min-w-60 sm:basis-auto" />
      {showPlan && (
        <Select
          aria-label={t('filter.plan')}
          value={state.planCode ?? ALL_PLANS}
          onValueChange={(next) => state.setPlanCode(next === ALL_PLANS ? null : (next as PlanCode))}
          options={[
            { value: ALL_PLANS, label: t('filter.allPlans'), icon: <Layers /> },
            ...PILOTAGE_PLAN_CODES.map((code) => ({ value: code, label: t('filter.planName', { name: PILOTAGE_PLAN_NAMES[code] }) })),
          ]}
          className="w-auto min-w-40 flex-1 sm:flex-none"
        />
      )}
      {children}
      {onRefresh && (
        <Tooltip content={t('filter.refresh')}>
          <IconButton label={t('filter.refresh')} variant="secondary" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}

/** Erreur de chargement d'un bloc, avec relance. */
export function LoadError({ error, onRetry, compact, className }: { error: unknown; onRetry?: () => void; compact?: boolean; className?: string }) {
  const { t } = useTranslation('accueil');
  return (
    <EmptyState
      compact={compact}
      className={className}
      icon={<AlertTriangle className="text-danger" />}
      title={t('filter.loadError')}
      description={errorMessage(error)}
      action={
        onRetry && (
          <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={onRetry}>
            {t('common:actions.retry')}
          </Button>
        )
      }
    />
  );
}

/** Carte de graphique avec en-tête, actions et zone de contenu. */
export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader title={title} description={description} actions={actions} />
      <div className={cn('min-w-0 flex-1 px-5 pb-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

/** Enregistre un fichier renvoyé en base64 par une Cloud Function. */
export function downloadBase64(fileName: string, mimeType: string, contentBase64: string): void {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** Petite légende « valeur · libellé » pour les pieds de carte. */
export function Metric({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cn(
          'num font-mono font-medium text-fg',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </span>
      <span className="text-fg-subtle">{label}</span>
    </span>
  );
}
