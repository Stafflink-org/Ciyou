import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import { CornerDownLeft } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Résultats distants de la palette ⌘K (recherche globale). Chaque élément porte la
 * requête qui l'a produit en mot-clé : il passe le filtrage local et compte parmi les
 * résultats (sélection au clavier, message « Aucun résultat » masqué). Remonter les
 * éléments à chaque nouvelle réponse (clé incluant la requête) pour les réévaluer.
 */
export function CommandResultGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3"
    >
      {children}
    </Command.Group>
  );
}

export interface CommandResultItemProps {
  /** Identifiant unique (sélection clavier). */
  value: string;
  /** Requête ayant produit le résultat : mot-clé de filtrage de l'élément. */
  query: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Élément secondaire à droite (statut, date…). */
  meta?: ReactNode;
  onSelect: () => void;
}

export function CommandResultItem({ value, query, icon, title, description, meta, onSelect }: CommandResultItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={[query]}
      onSelect={onSelect}
      className={cn('group flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none', 'data-[selected=true]:bg-surface-3')}
    >
      {icon && (
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface text-fg-muted group-data-[selected=true]:text-primary [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {description && <span className="block truncate text-xs text-fg-subtle">{description}</span>}
      </span>
      {meta && <span className="shrink-0">{meta}</span>}
      <CornerDownLeft className="size-3.5 shrink-0 text-fg-subtle opacity-0 group-data-[selected=true]:opacity-100" />
    </Command.Item>
  );
}

/** Ligne d'état (chargement, erreur, aucun résultat) sous les résultats. */
export function CommandResultNote({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-fg-subtle">{children}</div>;
}
