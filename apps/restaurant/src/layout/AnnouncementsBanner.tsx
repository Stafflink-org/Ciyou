// Annonces de l'équipe Ciyou Eats affichées en haut du back-office (nouveauté,
// maintenance, changement de conditions), ciblées par pays, ville et formule.
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { collection, doc, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { Info, TriangleAlert, Wrench, X } from 'lucide-react';
import { Button, IconButton, cn } from '@golink/ui';
import { COLLECTIONS, SUBCOLLECTIONS, type Announcement, type AnnouncementRead } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { toMillis, useCollection, useMutation } from '@/lib/firestore';

const TONES: Record<Announcement['severity'], { tone: string; icon: ReactElement; label: string }> = {
  info: { tone: 'tone-info', icon: <Info />, label: 'Information' },
  important: { tone: 'tone-amber', icon: <TriangleAlert />, label: 'Important' },
  maintenance: { tone: 'tone-plum', icon: <Wrench />, label: 'Maintenance' },
};

export function AnnouncementsBanner() {
  const { user } = useAuth();
  const { restaurant, restaurantId } = useRestaurantAccess();
  const [expanded, setExpanded] = useState(false);
  const announcementsQuery = useMemo(
    () => query(collection(db, COLLECTIONS.announcements), where('active', '==', true), where('audience', '==', 'restaurants')),
    [],
  );
  const readsQuery = useMemo(
    () => (restaurantId ? collection(db, COLLECTIONS.restaurants, restaurantId, SUBCOLLECTIONS.restaurants.announcementReads) : null),
    [restaurantId],
  );
  const announcements = useCollection<Announcement>(announcementsQuery);
  const reads = useCollection<AnnouncementRead>(readsQuery);
  const dismiss = useMutation(async (announcementId: string) => {
    if (!user) return;
    await setDoc(doc(db, COLLECTIONS.restaurants, restaurantId, SUBCOLLECTIONS.restaurants.announcementReads, announcementId), {
      readBy: user.uid,
      readAt: serverTimestamp(),
    });
  });

  const visible = useMemo(() => {
    const now = Date.now();
    const read = new Set(reads.data.map((r) => r.id));
    return announcements.data
      .filter((a) => {
        if (read.has(a.id)) return false;
        const start = toMillis(a.publishedAt) ?? 0;
        const end = toMillis(a.expiresAt);
        if (start > now || (end !== null && end <= now)) return false;
        if (a.countryIds?.length && !a.countryIds.includes(restaurant.countryId)) return false;
        if (a.cityIds?.length && !a.cityIds.includes(restaurant.cityId)) return false;
        if (a.planCodes?.length && !a.planCodes.includes(restaurant.planCode)) return false;
        return true;
      })
      .sort((a, b) => {
        const weight = (x: Announcement) => (x.severity === 'maintenance' ? 0 : x.severity === 'important' ? 1 : 2);
        return weight(a) - weight(b) || (toMillis(b.publishedAt) ?? 0) - (toMillis(a.publishedAt) ?? 0);
      });
  }, [announcements.data, reads.data, restaurant.countryId, restaurant.cityId, restaurant.planCode]);

  if (reads.loading || visible.length === 0) return null;
  const shown = expanded ? visible : visible.slice(0, 1);

  return (
    <div className="mx-auto w-full max-w-(--container-page) space-y-2 px-4 pt-4 sm:px-6 lg:px-8" aria-label="Annonces Ciyou Eats" role="region">
      {shown.map((a) => {
        const meta = TONES[a.severity];
        const internal = a.link?.startsWith('/');
        return (
          <div key={a.id} className={cn(meta.tone, 'flex items-start gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-3.5 shadow-xs')}>
            <div className="mt-0.5 shrink-0 text-(--tone-fg) [&_svg]:size-4" aria-hidden>
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">
                <span className="sr-only">{meta.label} : </span>
                {a.title}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{a.body}</p>
              {(a.link || a.requiresAcknowledgement) && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {a.link &&
                    (internal ? (
                      <Link to={a.link} className="text-sm font-medium text-(--tone-fg) underline underline-offset-4">
                        En savoir plus
                      </Link>
                    ) : (
                      <a href={a.link} target="_blank" rel="noreferrer" className="text-sm font-medium text-(--tone-fg) underline underline-offset-4">
                        En savoir plus
                      </a>
                    ))}
                  {a.requiresAcknowledgement && (
                    <Button size="xs" variant="secondary" loading={dismiss.loading} onClick={() => void dismiss.mutate(a.id)}>
                      J’ai pris connaissance
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!a.requiresAcknowledgement && (
              <IconButton label="Masquer l’annonce" variant="ghost" size="sm" onClick={() => void dismiss.mutate(a.id)}>
                <X />
              </IconButton>
            )}
          </div>
        );
      })}
      {visible.length > 1 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="px-1 text-xs font-medium text-fg-muted hover:text-fg">
          {expanded ? 'Réduire' : `Voir ${visible.length - 1} autre${visible.length > 2 ? 's' : ''} annonce${visible.length > 2 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}
