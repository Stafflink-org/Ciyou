import { useMemo, type ReactNode } from 'react';
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { BadgeEuro, Bell, FileText, LifeBuoy, Megaphone, ShoppingBag, Tag, UserRound } from 'lucide-react';
import { NotificationsButton, formatRelative, type NotificationItem, type Tone } from '@golink/ui';
import { paths, type UserNotification } from '@golink/shared';
import { toDate } from '../firestore/convert';
import { useCollection } from '../firestore/hooks';

const CATEGORY: Record<UserNotification['category'], { icon: ReactNode; tone: Tone }> = {
  order: { icon: <ShoppingBag />, tone: 'brand' },
  promotion: { icon: <Tag />, tone: 'plum' },
  account: { icon: <UserRound />, tone: 'info' },
  announcement: { icon: <Megaphone />, tone: 'teal' },
  support: { icon: <LifeBuoy />, tone: 'amber' },
  payout: { icon: <BadgeEuro />, tone: 'success' },
  document: { icon: <FileText />, tone: 'neutral' },
};

export interface NotificationsMenuProps {
  db: Firestore;
  uid: string;
  /** Adresse interne ouverte au clic (null : aucune navigation). */
  resolveLink?: (link: NonNullable<UserNotification['link']>) => string | null;
  onNavigate?: (href: string) => void;
  onViewAll?: () => void;
}

/** Cloche de la barre supérieure : 20 dernières notifications de l'utilisateur, en temps réel. */
export function NotificationsMenu({ db, uid, resolveLink, onNavigate, onViewAll }: NotificationsMenuProps) {
  const feed = useMemo(
    () => query(collection(db, paths.userSub(uid, 'notifications')), orderBy('createdAt', 'desc'), limit(20)),
    [db, uid],
  );
  const { data } = useCollection<UserNotification>(feed);

  const items = useMemo<NotificationItem[]>(() => {
    const now = Date.now();
    return data.map((notification) => {
      const meta = CATEGORY[notification.category] ?? { icon: <Bell />, tone: 'neutral' as const };
      const created = toDate(notification.createdAt);
      return {
        id: notification.id,
        title: notification.title,
        description: notification.body,
        time: created ? formatRelative(created, now) : '',
        unread: !notification.read,
        tone: meta.tone,
        icon: meta.icon,
        onClick: () => {
          if (!notification.read) {
            void updateDoc(doc(db, paths.userSub(uid, 'notifications'), notification.id), {
              read: true,
              readAt: serverTimestamp(),
            }).catch(() => undefined);
          }
          const href = notification.link && resolveLink ? resolveLink(notification.link) : null;
          if (href) onNavigate?.(href);
        },
      };
    });
  }, [data, db, uid, resolveLink, onNavigate]);

  const markAllRead = () => {
    const unread = data.filter((notification) => !notification.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const notification of unread) {
      batch.update(doc(db, paths.userSub(uid, 'notifications'), notification.id), { read: true, readAt: serverTimestamp() });
    }
    void batch.commit().catch(() => undefined);
  };

  return <NotificationsButton items={items} onMarkAllRead={markAllRead} onViewAll={onViewAll} />;
}
