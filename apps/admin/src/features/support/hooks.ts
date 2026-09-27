// Lectures du support : file des tickets, badge de navigation, agents.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, type SupportAgent, type SupportTicket, type TicketReason } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { callFunction, errorMessage, useCollection } from '@/lib/firestore';
import { useAdminPerimeter, useScopeFilter } from '../_experience/scope';

/** Badge : tickets ouverts sans agent attribué dans le périmètre. */
export function useSupportQueueCount(): number | null {
  const can = useCan();
  const scope = useAdminPerimeter();
  const allowed = can('support.view');
  const q = useMemo(
    () => (allowed ? query(collection(db, COLLECTIONS.supportTickets), where('status', '==', 'open'), where('assigneeId', '==', null), ...scope.constraints, limit(99)) : null),
    [allowed, scope.key],
  );
  const { data } = useCollection<SupportTicket>(q);
  return allowed ? data.length : null;
}

/** Tickets du périmètre, les plus récents d'abord (temps réel). */
export function useTickets(max = 400) {
  const scope = useScopeFilter();
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.supportTickets), ...scope.constraints, orderBy('lastMessageAt', 'desc'), limit(max)),
    [scope.key, max],
  );
  return useCollection<SupportTicket>(q);
}

export function useTicketReasons() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.ticketReasons), orderBy('order')), []);
  const state = useCollection<TicketReason>(q);
  const labels = useMemo(() => new Map(state.data.map((r) => [r.id, r.label.fr])), [state.data]);
  return { ...state, labels };
}

const getSupportAgents = callFunction<Record<string, never>, { agents: SupportAgent[]; unassigned: number }>('getSupportAgents');

/** Agents du support et leur charge (Cloud Function : les fiches admins ne sont pas lisibles par tous). */
export function useSupportAgents() {
  const [state, setState] = useState<{ agents: SupportAgent[]; unassigned: number; loading: boolean; error: string | null }>({ agents: [], unassigned: 0, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getSupportAgents({})
      .then((r) => alive && setState({ ...r, loading: false, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ ...s, loading: false, error: errorMessage(e) })));
    return () => {
      alive = false;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const names = useMemo(() => new Map(state.agents.map((a) => [a.uid, a.displayName])), [state.agents]);
  return { ...state, names, reload };
}
