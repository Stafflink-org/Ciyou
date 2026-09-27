import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type Ref } from 'react';
import { cn } from '../lib/cn';

/* Primitives de tableau stylées ; DataTable les assemble. */

/**
 * Tableau responsive : dès qu'il ne tient plus dans son conteneur (petit écran, colonnes
 * nombreuses, valeurs longues), il s'empile en cartes (une par ligne, l'en-tête de colonne
 * devient l'étiquette de chaque valeur, cf. `[data-stacked]` dans styles/index.css).
 * Jamais de défilement horizontal. `stackable={false}` pour laisser l'appelant décider (DataTable).
 */
export function Table({
  className,
  stackable = true,
  ref,
  ...props
}: ComponentPropsWithoutRef<'table'> & { ref?: Ref<HTMLTableElement>; stackable?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !stackable) return;
    const label = () => {
      const table = tableRef.current;
      if (!table) return;
      const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
      table.querySelectorAll('tbody tr').forEach((tr) => {
        let column = 0;
        Array.from(tr.children).forEach((cell) => {
          if (cell instanceof HTMLElement && !cell.dataset.label) cell.dataset.label = heads[column] ?? '';
          column += Number((cell as HTMLTableCellElement).colSpan) || 1;
        });
      });
    };
    const check = () => {
      const table = tableRef.current;
      if (!table) return;
      // Largeur naturelle mesurée hors flux (jamais en retirant l'attribut du tableau visible :
      // pas d'état intermédiaire observable pendant la mesure, pas de clignotement).
      let natural: number;
      if (wrap.hasAttribute('data-stacked')) {
        const clone = table.cloneNode(true) as HTMLTableElement;
        clone.removeAttribute('id');
        Object.assign(clone.style, { position: 'fixed', insetInlineStart: '0', top: '0', visibility: 'hidden', width: 'max-content', zIndex: '-1', pointerEvents: 'none' });
        document.body.appendChild(clone);
        natural = clone.scrollWidth;
        clone.remove();
      } else {
        natural = table.scrollWidth;
      }
      const overflowing = natural > wrap.clientWidth + 1;
      if (overflowing && !wrap.hasAttribute('data-stacked')) {
        label();
        wrap.setAttribute('data-stacked', '');
      } else if (!overflowing && wrap.hasAttribute('data-stacked')) {
        wrap.removeAttribute('data-stacked');
      }
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(wrap);
    // Lignes ajoutées ou remplacées (chargement, tri, pagination) : réévaluer.
    const mutation = new MutationObserver(check);
    mutation.observe(wrap, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [stackable]);

  return (
    <div ref={wrapRef} className={cn("relative w-full", stackable ? "overflow-x-auto" : "overflow-hidden")}>
      <table
        ref={(node) => {
          tableRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn('w-full caption-bottom border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentPropsWithoutRef<'thead'>) {
  return <thead className={cn('bg-surface-2 [&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentPropsWithoutRef<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors duration-100 hover:bg-surface-2/70 data-[state=selected]:bg-primary-soft/40',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      className={cn(
        'h-10 whitespace-nowrap px-4 text-start align-middle font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle first:ps-5 last:pe-5',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentPropsWithoutRef<'td'>) {
  return <td className={cn('h-14 px-4 align-middle text-fg first:ps-5 last:pe-5', className)} {...props} />;
}
