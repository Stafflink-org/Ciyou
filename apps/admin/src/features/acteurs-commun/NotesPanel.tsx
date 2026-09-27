// Notes internes (visibles uniquement par l'équipe Ciyou Eats) attachées à une entité :
// restaurant, groupe ou client. Écriture directe autorisée par les règles (auteur).
import { useMemo, useState } from 'react';
import { addDoc, deleteDoc, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { NotebookPen, Pin, PinOff, Trash2 } from 'lucide-react';
import { Avatar, Button, EmptyState, IconButton, Skeleton, Textarea, Tooltip, cn, formatRelative } from '@golink/ui';
import { COLLECTIONS, type EntityRef, type InternalNote, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useMutation } from '@/lib/firestore';

export function NotesPanel({ target, className }: { target: EntityRef; className?: string }) {
  const { user } = useAuth();
  const { admin } = useAdminAccess();
  const [body, setBody] = useState('');
  const notesQuery = useMemo(
    () =>
      query(
        collectionAt(COLLECTIONS.internalNotes),
        where('target.type', '==', target.type),
        where('target.id', '==', target.id),
        orderBy('createdAt', 'desc'),
        limit(100),
      ),
    [target.type, target.id],
  );
  const notes = useCollection<InternalNote>(notesQuery);
  const sorted = useMemo(() => [...notes.data].sort((a, b) => Number(b.pinned) - Number(a.pinned)), [notes.data]);

  const add = useMutation(
    async (text: string) =>
      addDoc(collectionAt(COLLECTIONS.internalNotes), {
        target: { type: target.type, id: target.id, label: target.label ?? null },
        body: text,
        pinned: false,
        authorId: user?.uid ?? '',
        authorName: admin.displayName || admin.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    { success: 'Note ajoutée' },
  );
  const togglePin = useMutation(
    async (note: WithId<InternalNote>) => updateDoc(docAt(`${COLLECTIONS.internalNotes}/${note.id}`), { pinned: !note.pinned, updatedAt: serverTimestamp() }),
  );
  const remove = useMutation(async (note: WithId<InternalNote>) => deleteDoc(docAt(`${COLLECTIONS.internalNotes}/${note.id}`)), { success: 'Note supprimée' });

  async function submit() {
    const text = body.trim();
    if (text.length < 2) return;
    const done = await add.mutate(text);
    if (done) setBody('');
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="rounded-xl border border-border bg-surface p-3 shadow-xs">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Ajouter une note pour l’équipe (jamais visible par le partenaire ni le client)…"
          rows={3}
          maxLength={5000}
          aria-label="Nouvelle note interne"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
          }}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="hidden text-xs text-fg-subtle sm:inline">Ctrl + Entrée pour enregistrer</span>
          <Button size="sm" variant="primary" loading={add.loading} disabled={body.trim().length < 2} onClick={() => void submit()} className="ml-auto">
            Ajouter la note
          </Button>
        </div>
      </div>

      {notes.error ? (
        <p className="text-sm text-danger">{errorMessage(notes.error)}</p>
      ) : notes.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState compact icon={<NotebookPen />} title="Aucune note interne" description="Consignez ici les échanges, engagements et points d’attention." />
      ) : (
        <ul className="space-y-3">
          {sorted.map((note) => {
            const mine = note.authorId === user?.uid;
            const at = toDate(note.createdAt);
            return (
              <li
                key={note.id}
                className={cn('rounded-xl border bg-surface p-4 shadow-xs', note.pinned ? 'tone-brand border-(--tone-border)' : 'border-border')}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={note.authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-fg">{note.authorName}</span>
                      <span className="text-xs text-fg-subtle">{at ? formatRelative(at) : 'à l’instant'}</span>
                      {note.pinned && <span className="text-2xs font-medium uppercase tracking-eyebrow text-(--tone-fg)">Épinglée</span>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-line break-words text-sm text-fg">{note.body}</p>
                  </div>
                  {mine && (
                    <div className="flex shrink-0 gap-1">
                      <Tooltip content={note.pinned ? 'Désépingler' : 'Épingler en haut'}>
                        <IconButton size="sm" variant="ghost" label={note.pinned ? 'Désépingler' : 'Épingler'} onClick={() => void togglePin.mutate(note)}>
                          {note.pinned ? <PinOff /> : <Pin />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip content="Supprimer">
                        <IconButton size="sm" variant="ghost" label="Supprimer la note" onClick={() => void remove.mutate(note)}>
                          <Trash2 />
                        </IconButton>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
