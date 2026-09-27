// Historique des modifications d'une entité (journal d'audit : qui, quoi, quand,
// pourquoi). Réservé aux administrateurs ayant le droit de consulter l'audit.
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { History, Lock } from 'lucide-react';
import { Button, EmptyState, Skeleton, Timeline, formatDateTime } from '@golink/ui';
import { COLLECTIONS, type AuditLog, type EntityRef } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, errorMessage, toDate, useCollection } from '@/lib/firestore';
import { auditActionLabel, auditFieldLabel, formatAuditField } from './audit-labels';

function Diff({ log }: { log: AuditLog }) {
  const keys = [...new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})])].slice(0, 6);
  if (keys.length === 0) return null;
  // Rendu en <span> : la description de la chronologie est un paragraphe.
  return (
    <span className="mt-2 block space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
      {keys.map((key) => (
        <span key={key} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2">
          <span className="truncate text-fg-subtle">{auditFieldLabel(key)}</span>
          <span className="min-w-0 break-words text-fg-muted">
            {log.before && key in log.before && (
              <>
                <span className="line-through decoration-fg-subtle/60">{formatAuditField(key, log.before[key])}</span>
                <span className="mx-1.5 text-fg-subtle">→</span>
              </>
            )}
            <span className="text-fg">{formatAuditField(key, log.after?.[key])}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

export function HistoryPanel({ target, extraTargets = [] }: { target: EntityRef; extraTargets?: EntityRef[] }) {
  const can = useCan();
  const allowed = can('audit.view');
  const [max, setMax] = useState(25);
  const logsQuery = useMemo(
    () =>
      allowed
        ? query(
            collectionAt(COLLECTIONS.auditLogs),
            where('target.type', '==', target.type),
            where('target.id', '==', target.id),
            orderBy('at', 'desc'),
            limit(max),
          )
        : null,
    [allowed, target.type, target.id, max],
  );
  const logs = useCollection<AuditLog>(logsQuery);
  const extra = extraTargets[0];
  const extraQuery = useMemo(
    () =>
      allowed && extra
        ? query(collectionAt(COLLECTIONS.auditLogs), where('target.type', '==', extra.type), where('target.id', '==', extra.id), orderBy('at', 'desc'), limit(10))
        : null,
    [allowed, extra],
  );
  const extraLogs = useCollection<AuditLog>(extraQuery);

  if (!allowed) {
    return (
      <EmptyState
        compact
        icon={<Lock />}
        title="Historique réservé"
        description="La consultation du journal d’audit demande le droit « Journal d’audit ». Les notes internes restent accessibles."
      />
    );
  }
  if (logs.error) return <p className="text-sm text-danger">{errorMessage(logs.error)}</p>;
  if (logs.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  const items = [...logs.data, ...extraLogs.data].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0));
  if (items.length === 0) {
    return <EmptyState compact icon={<History />} title="Aucune modification enregistrée" description="Chaque action de l’équipe sur cette fiche apparaîtra ici, avec son motif." />;
  }
  return (
    <div className="space-y-4">
      <Timeline
        items={items.map((log) => {
          const meta = auditActionLabel(log.action);
          const at = toDate(log.at);
          return {
            id: log.id,
            tone: meta.tone,
            title: meta.label,
            time: at ? formatDateTime(at) : '',
            description: (
              <>
                <span className="text-fg-muted">
                  {log.actor.type === 'system' ? 'Automatique' : log.actor.name}
                  {log.target.type !== target.type && log.target.label ? ` · ${log.target.label}` : ''}
                </span>
                {log.reason && <span className="mt-1 block text-fg">« {log.reason} »</span>}
                <Diff log={log} />
              </>
            ),
          };
        })}
      />
      {logs.data.length >= max && (
        <Button variant="ghost" size="sm" onClick={() => setMax((m) => m + 25)}>
          Afficher plus
        </Button>
      )}
    </div>
  );
}
