// Bandeau de contrôle qualité de la carte : score, anomalies cliquables (filtre).
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { MENU_ISSUE_LABELS, type MenuIssueType } from '@golink/shared';
import { cn, formatPercent, IconButton } from '@golink/ui';
import type { MenuProduct } from '../menu/data';
import { menuQualityScore, productIssues } from '../menu/helpers';

const ORDER: MenuIssueType[] = ['alcohol_suspected', 'missing_photo', 'allergens_missing', 'price_outlier', 'missing_description'];

const HINTS: Partial<Record<MenuIssueType, string>> = {
  missing_photo: 'Un plat avec photo se commande nettement plus.',
  allergens_missing: 'Information obligatoire pour vos clients (règlement UE 1169/2011).',
  price_outlier: 'Prix nul ou très éloigné des autres produits de la section.',
  missing_description: 'Quelques mots sur les ingrédients rassurent le client.',
  alcohol_suspected: 'La vente d’alcool est interdite sur Ciyou Eats : vérifiez le nom et la description.',
};

export function QualityBanner({
  products,
  active,
  onFilter,
  onDismiss,
}: {
  products: MenuProduct[];
  active: MenuIssueType | null;
  onFilter: (issue: MenuIssueType | null) => void;
  onDismiss: () => void;
}) {
  if (products.length === 0) return null;
  const counts = new Map<MenuIssueType, number>();
  for (const product of products) for (const issue of productIssues(product)) counts.set(issue, (counts.get(issue) ?? 0) + 1);
  const score = menuQualityScore(products);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="tone-success mb-5 flex items-center gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Carte complète.</span> Photos, descriptions, allergènes et prix sont renseignés pour tous vos produits.
        </p>
      </div>
    );
  }

  const tone = score >= 0.9 ? 'success' : score >= 0.7 ? 'amber' : 'danger';
  const circumference = 2 * Math.PI * 18;

  return (
    <section aria-label="Qualité de la carte" className="mb-5 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className={cn(`tone-${tone}`, 'relative grid size-12 shrink-0 place-items-center')}>
            <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" className="stroke-surface-3" />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                stroke="var(--tone-solid)"
                strokeDasharray={`${circumference * score} ${circumference}`}
              />
            </svg>
            <span className="num font-display text-xs font-semibold text-fg">{Math.round(score * 100)}</span>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <AlertTriangle className="tone-amber size-4 text-(--tone-solid)" aria-hidden="true" />
              Qualité de la carte : {formatPercent(score)}
            </p>
            <p className="text-xs text-fg-muted">
              {total} point{total > 1 ? 's' : ''} à compléter. Cliquez sur un point pour afficher les produits concernés.
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
          {ORDER.filter((issue) => counts.get(issue)).map((issue) => (
            <button
              key={issue}
              type="button"
              title={HINTS[issue]}
              aria-pressed={active === issue}
              onClick={() => onFilter(active === issue ? null : issue)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                active === issue ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-surface-2 text-fg hover:border-border-strong',
              )}
            >
              {MENU_ISSUE_LABELS[issue]}
              <span className="num rounded-md bg-surface-3 px-1.5 font-mono text-2xs text-fg-muted">{counts.get(issue)}</span>
            </button>
          ))}
          <IconButton label="Masquer le bandeau qualité" variant="ghost" size="sm" onClick={onDismiss}>
            <X />
          </IconButton>
        </div>
      </div>
    </section>
  );
}
