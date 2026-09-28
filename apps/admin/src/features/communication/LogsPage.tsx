import { useMemo } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { History } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, createColumnHelper, formatDateTime, type Tone } from '@golink/ui';
import { COLLECTIONS, type MessageTemplate, type NotificationLog, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';
import { USER_TYPE_LABELS } from '../_croissance/labels';
import { LoadError } from '../_croissance/ui';
import { CommunicationLayout } from './layout';

type Row = WithId<NotificationLog>;
const col = createColumnHelper<Row>();

const STATUS: Record<NotificationLog['status'], { label: string; tone: Tone }> = {
  queued: { label: 'Préparé (test)', tone: 'neutral' },
  sent: { label: 'Envoyé', tone: 'info' },
  delivered: { label: 'Délivré', tone: 'success' },
  opened: { label: 'Ouvert', tone: 'success' },
  bounced: { label: 'Rejeté', tone: 'danger' },
  failed: { label: 'Échec', tone: 'danger' },
};
const CHANNEL: Record<NotificationLog['channel'], string> = { push: 'Push', email: 'E-mail', sms: 'SMS' };
const RECIPIENT: Record<NotificationLog['recipientType'], string> = { ...USER_TYPE_LABELS, admin: 'Équipe Ciyou Eats' };

/** Journal de chaque message envoyé (preuve d'envoi, support, consentement). */
export function LogsPage() {
  useDocumentTitle('Journal des envois · Ciyou Eats Admin');
  const q = useMemo(() => query(collection(db, COLLECTIONS.notificationLogs), orderBy('createdAt', 'desc'), limit(400)), []);
  const { data, loading, error } = useCollection<NotificationLog>(q);
  const templatesQuery = useMemo(() => query(collection(db, COLLECTIONS.messageTemplates)), []);
  const templates = useCollection<MessageTemplate>(templatesQuery);
  const events = useMemo(() => new Map(templates.data.map((t) => [t.id, t.event])), [templates.data]);

  const columns = useMemo(
    () => [
      col.accessor((l) => toMillis(l.createdAt) ?? 0, {
        id: 'date',
        header: 'Date',
        cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue() ? formatDateTime(getValue()) : '—'}</span>,
      }),
      col.accessor((l) => CHANNEL[l.channel], { id: 'canal', header: 'Canal', cell: ({ getValue }) => <Badge>{getValue()}</Badge> }),
      col.accessor((l) => `${l.destinationMasked} ${RECIPIENT[l.recipientType]}`, {
        id: 'destinataire',
        header: 'Destinataire',
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <p className="truncate font-mono text-xs text-fg">{row.original.destinationMasked}</p>
            <p className="text-xs text-fg-muted">{RECIPIENT[row.original.recipientType]}</p>
          </div>
        ),
      }),
      col.accessor((l) => (l.campaignId ? 'Envoi' : (events.get(l.templateKey ?? '') ?? l.templateKey ?? '—')), {
        id: 'origine',
        header: 'Origine',
        cell: ({ row, getValue }) =>
          row.original.campaignId ? (
            <Link to={`/communication/${row.original.campaignId}`} className="whitespace-nowrap text-sm text-primary-soft-fg hover:underline">
              Envoi groupé
            </Link>
          ) : (
            <span className="whitespace-nowrap text-sm text-fg">{getValue()}</span>
          ),
      }),
      col.accessor((l) => STATUS[l.status]?.label ?? l.status, {
        id: 'statut',
        header: 'Statut',
        cell: ({ row, getValue }) => (
          <div className="min-w-[8rem]">
            <Badge tone={STATUS[row.original.status]?.tone ?? 'neutral'}>{getValue()}</Badge>
            {row.original.error && row.original.status !== 'queued' && <p className="mt-1 max-w-[16rem] truncate text-2xs text-fg-subtle">{row.original.error}</p>}
          </div>
        ),
      }),
    ],
    [events],
  );

  return (
    <CommunicationLayout>
      {error ? (
        <Card>
          <LoadError error={error} />
        </Card>
      ) : (
        <DataTable
          data={data}
          columns={columns}
          getRowId={(l) => l.id}
          loading={loading}
          searchable
          searchPlaceholder="Rechercher une adresse masquée, un message…"
          itemLabel="messages"
          pageSize={25}
          filters={[
            { id: 'channel', label: 'Canal', options: Object.entries(CHANNEL).map(([value, label]) => ({ value, label })), getValue: (l) => l.channel },
            { id: 'status', label: 'Statut', options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })), getValue: (l) => l.status },
            { id: 'recipient', label: 'Destinataire', options: Object.entries(RECIPIENT).map(([value, label]) => ({ value, label })), getValue: (l) => l.recipientType },
          ]}
          emptyState={<EmptyState compact icon={<History />} title="Aucun message envoyé" description="Chaque e-mail, push ou SMS envoyé par Ciyou Eats est tracé ici, adresse masquée." />}
        />
      )}
      <p className="mt-4 text-xs text-fg-subtle">Les 400 derniers messages. Les adresses sont masquées ; le contenu n’est pas conservé.</p>
    </CommunicationLayout>
  );
}
