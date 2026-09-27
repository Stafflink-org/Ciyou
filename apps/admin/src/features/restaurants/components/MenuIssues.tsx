// Anomalies de carte signalées automatiquement (photo, prix, allergènes,
// description, alcool) : correction directe d'un produit par l'équipe ou clôture.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, EyeOff, ImageOff, Pencil, ShieldAlert, Tag, Wine } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  FormField,
  Input,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Switch,
  Textarea,
  formatRelative,
} from '@golink/ui';
import { ALLERGENS, ALLERGEN_LABELS, MENU_ISSUE_LABELS, findAlcoholTerm, paths, type Allergen, type MenuIssue, type Product, type WithId } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { docAt, toDate, useDoc, useMutation } from '@/lib/firestore';
import { callFunctionWithReason } from '@/lib/reason';

const ICONS: Record<MenuIssue['type'], ReactNode> = {
  missing_photo: <ImageOff />,
  price_outlier: <Tag />,
  allergens_missing: <ShieldAlert />,
  missing_description: <Pencil />,
  empty_section: <AlertTriangle />,
  alcohol_suspected: <Wine />,
};

// Écritures par Cloud Functions (motif obligatoire, audit) : l'équipe n'écrit plus dans la carte.
const resolveIssueFn = callFunctionWithReason<{ issueId: string; status: 'fixed' | 'ignored' }, { status: string }>('resolveMenuIssue', { title: 'Traiter cette anomalie', description: 'Le motif est conservé dans le journal d’audit.' });
const fixProductFn = callFunctionWithReason<{ restaurantId: string; productId: string; name: string; description: string | null; allergens: Allergen[]; available: boolean }, { productId: string }>('fixRestaurantProduct', { title: 'Corriger ce produit', description: 'Modification tracée sur le produit ; le restaurant garde la main sur sa carte.' });

export function useResolveIssue() {
  return useMutation(
    async (input: { issue: WithId<MenuIssue>; status: 'fixed' | 'ignored' }) => resolveIssueFn({ issueId: input.issue.id, status: input.status }),
    { success: 'Anomalie mise à jour' },
  );
}

/** Correction rapide d'un produit : description, allergènes, disponibilité. */
function ProductFixSheet({ restaurantId, productId, onClose }: { restaurantId: string; productId: string; onClose: () => void }) {
  const product = useDoc<Product>(docAt(`${paths.restaurantSub(restaurantId, 'products')}/${productId}`));
  const [draft, setDraft] = useState<{ description: string; allergens: Allergen[]; available: boolean; name: string } | null>(null);
  const current = draft ?? (product.data ? { description: product.data.description ?? '', allergens: product.data.allergens ?? [], available: product.data.available, name: product.data.name } : null);
  const save = useMutation(
    async () => {
      if (!current) return;
      await fixProductFn({
        restaurantId,
        productId,
        name: current.name.trim(),
        description: current.description.trim() || null,
        allergens: current.allergens,
        available: current.available,
      });
    },
    { success: 'Produit corrigé' },
  );
  const alcohol = current ? findAlcoholTerm(current.name, current.description) : null;

  return (
    <Sheet open onOpenChange={(o) => !o && !save.loading && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader title="Corriger le produit" description="Modification tracée sur le produit ; le restaurant garde la main sur sa carte." />
        <SheetBody className="space-y-4">
          {product.loading || !current ? (
            <Skeleton className="h-60 w-full" />
          ) : product.missing ? (
            <p className="text-sm text-fg-muted">Ce produit n’existe plus.</p>
          ) : (
            <>
              {product.data?.image?.url && <img src={product.data.image.url} alt="" className="h-36 w-full rounded-xl object-cover" />}
              <FormField label="Nom">
                <Input value={current.name} onChange={(e) => setDraft({ ...current, name: e.target.value })} maxLength={100} />
              </FormField>
              <FormField label="Description">
                <Textarea value={current.description} onChange={(e) => setDraft({ ...current, description: e.target.value })} rows={3} maxLength={500} />
              </FormField>
              {alcohol && (
                <p className="tone-danger rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
                  Mention « {alcohol} » détectée : la vente d’alcool est interdite. Retirez la mention ou rendez le produit indisponible.
                </p>
              )}
              <FormField label="Allergènes (14 allergènes réglementaires)">
                <div className="grid grid-cols-2 gap-1.5">
                  {ALLERGENS.map((a) => (
                    <label key={a} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-surface-3">
                      <Checkbox
                        checked={current.allergens.includes(a)}
                        onCheckedChange={(v) => setDraft({ ...current, allergens: v === true ? [...current.allergens, a] : current.allergens.filter((x) => x !== a) })}
                        aria-label={ALLERGEN_LABELS[a]}
                      />
                      {ALLERGEN_LABELS[a]}
                    </label>
                  ))}
                </div>
              </FormField>
              <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <span className="text-sm font-medium text-fg">Disponible à la vente</span>
                <Switch checked={current.available} onCheckedChange={(v) => setDraft({ ...current, available: v })} aria-label="Disponible" />
              </label>
            </>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={!current || current.name.trim().length < 1 || product.missing} onClick={() => void save.mutate().then(() => onClose())}>
            Enregistrer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function MenuIssueList({ issues, showRestaurant, restaurantNames }: { issues: WithId<MenuIssue>[]; showRestaurant?: boolean; restaurantNames?: Map<string, string> }) {
  const can = useCan();
  const editable = can('restaurants.edit');
  const resolve = useResolveIssue();
  const [fixing, setFixing] = useState<WithId<MenuIssue> | null>(null);
  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {issues.map((issue) => {
          const at = toDate(issue.detectedAt);
          return (
            <li key={issue.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <span className={`${issue.type === 'alcohol_suspected' ? 'tone-danger' : issue.type === 'allergens_missing' ? 'tone-amber' : 'tone-neutral'} grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4`}>
                {ICONS[issue.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-fg">{MENU_ISSUE_LABELS[issue.type]}</p>
                  {showRestaurant && <Badge size="sm">{restaurantNames?.get(issue.restaurantId) ?? issue.restaurantId}</Badge>}
                  {issue.status !== 'open' && <Badge size="sm" tone={issue.status === 'fixed' ? 'success' : 'neutral'}>{issue.status === 'fixed' ? 'Corrigée' : 'Ignorée'}</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-fg-subtle">
                  {issue.details ?? 'Détail indisponible'}
                  {at ? ` · ${formatRelative(at)}` : ''}
                </p>
              </div>
              {editable && issue.status === 'open' && (
                <div className="flex shrink-0 gap-1.5">
                  {issue.productId && (
                    <Button size="xs" variant="secondary" leftIcon={<Pencil />} onClick={() => setFixing(issue)}>
                      Corriger
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" leftIcon={<Check />} onClick={() => void resolve.mutate({ issue, status: 'fixed' })}>
                    Résolue
                  </Button>
                  <Button size="xs" variant="ghost" leftIcon={<EyeOff />} onClick={() => void resolve.mutate({ issue, status: 'ignored' })}>
                    Ignorer
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {fixing?.productId && <ProductFixSheet restaurantId={fixing.restaurantId} productId={fixing.productId} onClose={() => setFixing(null)} />}
    </>
  );
}
