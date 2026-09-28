// Réordonnancement par glisser-déposer (souris, tactile) et au clavier (flèches),
// sans dépendance : l'élément suit le pointeur, ses voisins s'écartent en direct.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@golink/ui';

interface DragState {
  id: string;
  pointerId: number;
  startY: number;
  /** Position « naturelle » de l'élément au début du glissement. */
  startTop: number;
  offset: number;
}

export interface SortableApi {
  /** Identifiants dans l'ordre affiché (ordre local pendant et juste après un glissement). */
  order: string[];
  draggingId: string | null;
  itemProps: (id: string) => { 'data-sortable-id': string; style?: CSSProperties; className?: string };
  handleProps: (id: string, label: string) => {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    'aria-label': string;
    'aria-roledescription': string;
    'aria-describedby': string;
  };
}

export const SORTABLE_HINT_ID = 'golink-sortable-hint';

/** Consigne lue par les lecteurs d'écran sur chaque poignée (à rendre une fois par page). */
export function SortableHint() {
  return (
    <p id={SORTABLE_HINT_ID} className="sr-only">
      Faites glisser pour réordonner, ou utilisez les flèches haut et bas.
    </p>
  );
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function useSortable(ids: string[], onCommit: (ids: string[]) => Promise<unknown> | void, disabled = false): SortableApi {
  const [pending, setPending] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const orderRef = useRef<string[]>(ids);
  const container = useRef<HTMLElement | null>(null);
  const initial = useRef<string[]>(ids);

  // L'ordre local reste affiché jusqu'à ce que les données temps réel le rejoignent.
  const order = pending && pending.length === ids.length && pending.every((id) => ids.includes(id)) ? pending : ids;
  orderRef.current = order;

  useEffect(() => {
    if (pending && same(pending, ids)) setPending(null);
  }, [ids, pending]);

  const commit = useCallback(
    async (next: string[]) => {
      if (same(next, initial.current)) {
        setPending(null);
        return;
      }
      setPending(next);
      try {
        await onCommit(next);
      } catch {
        setPending(null);
      }
    },
    [onCommit],
  );

  // Après chaque réordonnancement, l'élément glissé est recalé sous le pointeur.
  useLayoutEffect(() => {
    const state = dragRef.current;
    if (!state || !container.current) return;
    const element = container.current.querySelector<HTMLElement>(`:scope > [data-sortable-id="${CSS.escape(state.id)}"]`);
    if (!element) return;
    element.style.transform = `translateY(${state.offset}px)`;
  });

  const onMove = useCallback((event: globalThis.PointerEvent) => {
    const state = dragRef.current;
    if (!state || event.pointerId !== state.pointerId || !container.current) return;
    event.preventDefault();
    const items = [...container.current.querySelectorAll<HTMLElement>(':scope > [data-sortable-id]')];
    const element = items.find((item) => item.dataset.sortableId === state.id);
    if (!element) return;
    const currentTransform = Number(element.style.transform.match(/-?[\d.]+/)?.[0] ?? 0);
    const naturalTop = element.getBoundingClientRect().top - currentTransform;
    const pointerDelta = event.clientY - state.startY;
    const centre = state.startTop + pointerDelta + element.offsetHeight / 2;

    const current = orderRef.current;
    // Nouvelle place = nombre d'autres éléments dont le milieu est au-dessus du centre glissé.
    const target = items.filter((item) => {
      if (item === element) return false;
      const rect = item.getBoundingClientRect();
      return rect.top + rect.height / 2 < centre;
    }).length;
    const from = current.indexOf(state.id);
    let next = current;
    if (target !== from) {
      next = [...current];
      next.splice(from, 1);
      next.splice(target, 0, state.id);
    }
    const offset = state.startTop + pointerDelta - naturalTop;
    dragRef.current = { ...state, offset };
    element.style.transform = `translateY(${offset}px)`;
    if (next !== current) setPending(next);
  }, []);

  const onUp = useCallback(
    (event: globalThis.PointerEvent) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const element = container.current?.querySelector<HTMLElement>(`:scope > [data-sortable-id="${CSS.escape(state.id)}"]`);
      if (element) element.style.transform = '';
      dragRef.current = null;
      setDrag(null);
      void commit(orderRef.current);
    },
    [commit, onMove],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    },
    [onMove, onUp],
  );

  const handleProps: SortableApi['handleProps'] = (id, label) => ({
    'aria-label': label,
    'aria-roledescription': 'poignée de déplacement',
    'aria-describedby': SORTABLE_HINT_ID,
    onPointerDown: (event) => {
      if (disabled || event.button !== 0) return;
      const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-sortable-id]');
      const parent = element?.parentElement;
      if (!element || !parent) return;
      event.preventDefault();
      container.current = parent;
      initial.current = orderRef.current;
      const state: DragState = {
        id,
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: element.getBoundingClientRect().top,
        offset: 0,
      };
      dragRef.current = state;
      setDrag(state);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    onKeyDown: (event) => {
      if (disabled || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      const current = orderRef.current;
      const from = current.indexOf(id);
      const to = event.key === 'ArrowUp' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= current.length) return;
      initial.current = current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, id);
      const target = event.currentTarget;
      void commit(next);
      requestAnimationFrame(() => target.focus());
    },
  });

  const itemProps: SortableApi['itemProps'] = (id) => ({
    'data-sortable-id': id,
    className: cn(
      'relative',
      drag?.id === id ? 'z-20 shadow-lg ring-1 ring-primary/40 transition-none' : drag ? 'transition-transform duration-150' : undefined,
    ),
  });

  return { order, draggingId: drag?.id ?? null, itemProps, handleProps };
}

/** Poignée de glissement standard (icône à six points). */
export function DragHandle({ className, disabled, ...props }: ReturnType<SortableApi['handleProps']> & { className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg active:cursor-grabbing',
        'focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}
