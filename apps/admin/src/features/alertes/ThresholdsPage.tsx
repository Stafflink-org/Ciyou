import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Ban, Bike, Lock, MapPin, RotateCcw, Save, ShieldCheck, Store, Wallet } from 'lucide-react';
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, FormField, Input, PageContainer, PageHeader, Skeleton, formatDateTime } from '@golink/ui';
import { COLLECTIONS, DEFAULT_MONITORING_SETTINGS, SETTINGS_DOCS, type MonitoringSettings } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { callFunction, docAt, toMillis, useDoc, useMutation } from '@/lib/firestore';
import { LoadError } from '../pilotage-commun/components';

type Values = Omit<MonitoringSettings, 'updatedAt' | 'updatedBy'>;
type Key = keyof Values;

interface FieldDef {
  key: Key;
  label: string;
  hint: string;
  /** Affichage en pourcentage (valeur stockée de 0 à 1, ou plus pour une hausse). */
  percent?: boolean;
  integer?: boolean;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const GROUPS: Array<{
  title: string;
  description: string;
  icon: ReactNode;
  fields: FieldDef[];
}> = [
  {
    title: 'Commerces',
    description: 'Évalués chaque quart d’heure sur les 7 derniers jours.',
    icon: <Store />,
    fields: [
      {
        key: 'restaurantCancellationRate',
        label: 'Taux d’annulation maximal',
        hint: 'Au-delà, une alerte « Annulations anormales » est levée.',
        percent: true,
        unit: '%',
        min: 0,
        max: 100,
        step: 0.5,
      },
      {
        key: 'restaurantRejectionRate',
        label: 'Taux de refus maximal',
        hint: 'Commandes refusées, expirées ou articles indisponibles.',
        percent: true,
        unit: '%',
        min: 0,
        max: 100,
        step: 0.5,
      },
      {
        key: 'restaurantMinOrders',
        label: 'Commandes minimales pour évaluer',
        hint: 'En dessous, le commerce n’est pas évalué (échantillon trop faible).',
        integer: true,
        unit: 'cmd',
        min: 1,
        max: 10000,
        step: 1,
      },
    ],
  },
  {
    title: 'Villes',
    description: 'Comparaison au même jour des 4 semaines précédentes.',
    icon: <MapPin />,
    fields: [
      {
        key: 'cityOrderDrop',
        label: 'Chute des commandes',
        hint: 'Baisse par rapport à la moyenne attendue à la même heure.',
        percent: true,
        unit: '%',
        min: 5,
        max: 95,
        step: 1,
      },
      {
        key: 'cityMinOrders',
        label: 'Commandes attendues minimales',
        hint: 'Une ville peu active n’est pas évaluée.',
        integer: true,
        unit: 'cmd',
        min: 1,
        max: 100000,
        step: 1,
      },
    ],
  },
  {
    title: 'Argent',
    description: 'Remboursements des 7 derniers jours contre les 28 précédents.',
    icon: <Wallet />,
    fields: [
      {
        key: 'refundSpike',
        label: 'Hausse des remboursements',
        hint: '100 % = remboursements doublés par rapport à la normale.',
        percent: true,
        unit: '%',
        min: 10,
        max: 1000,
        step: 5,
      },
    ],
  },
  {
    title: 'Livreurs',
    description: 'Relevé en temps réel sur chaque zone de service active.',
    icon: <Bike />,
    fields: [
      {
        key: 'zoneDriverRatio',
        label: 'Livreurs disponibles par commande en attente',
        hint: 'En dessous de ce rapport, la zone est signalée en manque de livreurs.',
        unit: 'liv./cmd',
        min: 0.05,
        max: 10,
        step: 0.05,
      },
      {
        key: 'driverTensionRatio',
        label: 'Commandes par livreur en tension',
        hint: 'Au-delà, une ville est affichée « Tension forte » dans le comparatif des villes.',
        unit: 'cmd/liv.',
        min: 1,
        max: 20,
        step: 0.5,
      },
    ],
  },
  {
    title: 'Conformité',
    description: 'Délai légal d’un mois pour répondre aux demandes RGPD.',
    icon: <ShieldCheck />,
    fields: [
      {
        key: 'gdprDueWarningDays',
        label: 'Alerte avant échéance RGPD',
        hint: 'Nombre de jours restants à partir duquel la demande devient critique.',
        integer: true,
        unit: 'jours',
        min: 1,
        max: 30,
        step: 1,
      },
      {
        key: 'alertReopenAfterDays',
        label: 'Réouverture d’une alerte écartée',
        hint: 'Une alerte écartée par un humain n’est rouverte que si la situation persiste ce nombre de jours.',
        integer: true,
        unit: 'jours',
        min: 1,
        max: 30,
        step: 1,
      },
    ],
  },
];

const FIELDS = GROUPS.flatMap((g) => g.fields);

function toDisplay(field: FieldDef, value: number): string {
  const shown = field.percent ? Math.round(value * 1000) / 10 : value;
  return String(shown).replace('.', ',');
}

function fromDisplay(field: FieldDef, raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  if (!raw.trim() || Number.isNaN(n)) return null;
  if (n < field.min || n > field.max) return null;
  if (field.integer && !Number.isInteger(n)) return null;
  return field.percent ? Math.round(n * 10) / 1000 : n;
}

const updateSettings = callFunction<Values & { reason: string }, { ok: true }>('updateMonitoringSettings');

/** Seuils des alertes par exception (settings/monitoring), tous paramétrables. */
export function ThresholdsPage() {
  useDocumentTitle('Seuils des alertes · Ciyou Eats Admin');
  const { can } = useAdminAccess();
  const canView = can('settings.view');
  const canEdit = can('settings.edit');
  const { data, loading, error, missing } = useDoc<MonitoringSettings>(canView ? docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.monitoring}`) : null);
  const current = useMemo<Values>(() => ({ ...DEFAULT_MONITORING_SETTINGS, ...(data ?? {}) }), [data]);
  const [draft, setDraft] = useState<Record<Key, string> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutate, loading: saving } = useMutation(updateSettings, {
    success: 'Seuils enregistrés',
  });

  useEffect(() => {
    if (!loading) setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, toDisplay(f, current[f.key])])) as Record<Key, string>);
  }, [loading, current]);

  const parsed = useMemo(() => {
    if (!draft) return null;
    const out: Partial<Values> = {};
    const errors: Partial<Record<Key, string>> = {};
    for (const f of FIELDS) {
      const value = fromDisplay(f, draft[f.key]);
      if (value === null)
        errors[f.key] = `Entre ${String(f.min).replace('.', ',')} et ${String(f.max).replace('.', ',')}${f.integer ? ', nombre entier' : ''}.`;
      else out[f.key] = value;
    }
    return { values: out as Values, errors };
  }, [draft]);

  const changed = parsed ? FIELDS.filter((f) => parsed.values[f.key] !== undefined && parsed.values[f.key] !== current[f.key]) : [];
  const invalid = parsed ? Object.keys(parsed.errors).length > 0 : true;

  if (!canView) {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Accès réservé"
            description="La consultation des réglages de la plateforme n’est pas incluse dans votre rôle."
            action={
              <Button variant="secondary" asChild>
                <Link to="/alertes">Retour aux alertes</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const updatedAt = toMillis(data?.updatedAt);

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: 'Alertes', href: '/alertes' }, { label: 'Seuils' }]}
        eyebrow="Surveillance"
        title="Seuils des alertes"
        description="Réglez à partir de quand une situation devient une anomalie. Chaque modification est historisée avec son motif."
        actions={
          <Button variant="ghost" asChild>
            <Link to="/alertes">
              <ArrowLeft /> Retour aux alertes
            </Link>
          </Button>
        }
      />

      {error ? (
        <Card>
          <LoadError error={error} />
        </Card>
      ) : !draft || !parsed ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {GROUPS.map((group) => (
              <Card key={group.title}>
                <CardHeader title={group.title} description={group.description} icon={group.icon} divided />
                <div className="space-y-4 p-5">
                  {group.fields.map((f) => (
                    <FormField key={f.key} label={f.label} hint={f.hint} error={parsed.errors[f.key]}>
                      <Input
                        inputMode="decimal"
                        value={draft[f.key]}
                        disabled={!canEdit}
                        trailing={<span className="font-mono">{f.unit}</span>}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                    </FormField>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-fg-muted">
                {!canEdit ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Ban className="size-3.5" /> Lecture seule : la modification des réglages n’est pas incluse dans votre rôle.
                  </span>
                ) : changed.length ? (
                  `${changed.length} seuil${changed.length > 1 ? 's' : ''} modifié${changed.length > 1 ? 's' : ''}, appliqué${changed.length > 1 ? 's' : ''} dès la prochaine surveillance.`
                ) : missing ? (
                  'Valeurs par défaut de la plateforme.'
                ) : updatedAt ? (
                  `Dernière modification le ${formatDateTime(updatedAt)}.`
                ) : (
                  'Aucune modification en attente.'
                )}
              </p>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    leftIcon={<RotateCcw />}
                    disabled={!changed.length || saving}
                    onClick={() => setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, toDisplay(f, current[f.key])])) as Record<Key, string>)}
                  >
                    Annuler
                  </Button>
                  <Button variant="primary" leftIcon={<Save />} disabled={!changed.length || invalid} loading={saving} onClick={() => setConfirmOpen(true)}>
                    Enregistrer
                  </Button>
                </div>
              )}
            </div>
          </div>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Enregistrer les nouveaux seuils ?"
            description="Les alertes seront recalculées avec ces valeurs lors de la prochaine surveillance (15 minutes au plus)."
            confirmLabel="Enregistrer"
            requireReason
            onConfirm={async (reason) => {
              await mutate({ ...parsed.values, reason: reason ?? '' });
            }}
          >
            <ul className="space-y-1 rounded-lg border border-border bg-surface-2 p-3 text-xs">
              {changed.map((f) => (
                <li key={f.key} className="flex justify-between gap-3">
                  <span className="text-fg-muted">{f.label}</span>
                  <span className="num shrink-0 font-mono text-fg">
                    {toDisplay(f, current[f.key])} → {toDisplay(f, parsed.values[f.key])} {f.unit}
                  </span>
                </li>
              ))}
            </ul>
          </ConfirmDialog>
        </>
      )}
    </PageContainer>
  );
}
