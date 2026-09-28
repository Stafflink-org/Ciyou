// « Voir comme le restaurant » : une session ouverte par la Cloud Function
// startImpersonation (lecture seule par défaut, tracée au journal d'audit) est
// signalée par un bandeau tant qu'elle est active.
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { ExternalLink, Eye } from 'lucide-react';
import { Button, formatTime } from '@golink/ui';
import { COLLECTIONS, paths, type ImpersonationSession, type Restaurant } from '@golink/shared';
import { toMillis, useAuth } from '@golink/web';
import { db } from '@/lib/firebase';
import { env } from '@/lib/env';
import { callFunction, docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';

const endImpersonation = callFunction<{ sessionId: string }, void>('endImpersonation');

/** Horloge à la minute, pour faire disparaître le bandeau à l'expiration. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Bandeau affiché sous la barre supérieure pendant une session « voir comme ». */
export function ImpersonationBanner() {
  const { user } = useAuth();
  const now = useMinuteClock();
  const sessionsQuery = useMemo(
    () =>
      user
        ? query(collection(db, COLLECTIONS.impersonationSessions), where('adminId', '==', user.uid), where('endedAt', '==', null))
        : null,
    [user],
  );
  const { data } = useCollection<ImpersonationSession>(sessionsQuery);
  const session = data
    .filter((item) => (toMillis(item.expiresAt) ?? 0) > now)
    .sort((a, b) => (toMillis(b.startedAt) ?? 0) - (toMillis(a.startedAt) ?? 0))[0];
  const restaurant = useDoc<Restaurant>(session ? docAt(paths.restaurant(session.restaurantId)) : null).data;
  const end = useMutation(endImpersonation, { success: 'Session « voir comme » terminée.' });

  if (!session) return null;
  const expiresAt = session.expiresAt.toDate();

  return (
    <div role="status" className="tone-brand border-b border-(--tone-border) bg-(--tone-bg)">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--tone-solid) text-white">
          <Eye className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-(--tone-fg)">
          Vous consultez l’espace de <strong className="font-semibold">{restaurant?.name ?? 'ce restaurant'}</strong>
          {session.mode === 'read_only' ? ' en lecture seule' : ' avec droits de modification'} · fin à {formatTime(expiresAt)}.
          <span className="hidden text-(--tone-fg)/80 md:inline"> Chaque action est enregistrée au journal d’audit.</span>
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <a href={`${env.restaurantAppUrl}/?voir-comme=${encodeURIComponent(session.restaurantId)}`} target="_blank" rel="noreferrer">
              Ouvrir l’espace
              <ExternalLink />
            </a>
          </Button>
          <Button size="sm" variant="primary" loading={end.loading} onClick={() => void end.mutate({ sessionId: session.id })}>
            Terminer
          </Button>
        </div>
      </div>
    </div>
  );
}
