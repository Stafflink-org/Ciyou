// Notifications (§14 client.md) — lecture réelle de `users/{uid}/notifications`,
// marquer comme lu (règles : update onlyChanges(['read','readAt']), jamais de
// création côté app — les notifications sont émises par les Cloud Functions).
import { useCallback } from 'react';
import { collection, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { UserNotification } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

export function useNotifications() {
  const { user } = useAuth();
  const q = user ? query(collection(db, `users/${user.uid}/notifications`), orderBy('createdAt', 'desc')) : null;
  const { data, loading } = useCollection<UserNotification>(q);

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      await updateDoc(doc(db, `users/${user.uid}/notifications/${id}`), { read: true, readAt: serverTimestamp() });
    },
    [user],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return;
      await deleteDoc(doc(db, `users/${user.uid}/notifications/${id}`));
    },
    [user],
  );

  const unreadCount = data.filter((n) => !n.read).length;

  return { data, loading, unreadCount, markRead, remove };
}
