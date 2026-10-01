// En-tête commun des vues Commandes : bandeau, onglets (en cours, historique),
// lien vers le suivi des livreurs en direct, alerte sonore, et tiroir de fiche
// commande.
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Archive, Clock3, Radio, Volume2, VolumeX } from 'lucide-react';
import { Button, IconButton, PageBanner, PageContainer, Sheet, SheetContent, Skeleton, cn } from '@golink/ui';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { useNewOrderAlert, useOrder } from '../hooks';
import { AutoPauseBanner } from './AutoPauseBanner';
import { OrderDetail } from './OrderDetail';

// 2 onglets, alignés sur la maquette de référence : le suivi en direct des
// livreurs reste accessible (fonctionnalité réelle conservée), mais via le
// bouton « Suivi des livreurs » du bandeau plutôt qu'un 3e onglet.
const TABS = [
  { to: '/commandes', label: 'En cours', icon: Clock3, end: true },
  { to: '/commandes/historique', label: 'Historique', icon: Archive, end: false },
] as const;

export function OrdersLayout({
  activeCount,
  pendingCount,
  children,
  actions,
  description = 'Retrouvez vos commandes et leur délai de préparation.',
  showLiveTrackingLink = true,
}: {
  activeCount?: number;
  pendingCount: number;
  children: ReactNode;
  actions?: ReactNode;
  description?: string;
  /** Masqué sur l'écran de suivi en direct lui-même. */
  showLiveTrackingLink?: boolean;
}) {
  const { restaurant } = useRestaurantAccess();
  const navigate = useNavigate();
  const alert = useNewOrderAlert(pendingCount);

  return (
    <PageContainer wide>
      <PageBanner
        eyebrow={`${restaurant.name} · Service`}
        title="Commandes"
        description={description}
        actions={
          <div className="flex items-center gap-2">
            {showLiveTrackingLink && (
              <Button
                variant="secondary"
                leftIcon={<Radio />}
                className="border-sidebar-fg/25 bg-sidebar-fg/10 text-sidebar-fg hover:border-sidebar-fg/40 hover:bg-sidebar-fg/15"
                onClick={() => navigate('/commandes/suivi')}
              >
                Suivi des livreurs
              </Button>
            )}
            {actions}
            <IconButton
              variant="secondary"
              className="border-sidebar-fg/25 bg-sidebar-fg/10 text-sidebar-fg hover:border-sidebar-fg/40 hover:bg-sidebar-fg/15"
              label={alert.enabled ? 'Couper l’alerte sonore des nouvelles commandes' : 'Activer l’alerte sonore des nouvelles commandes'}
              onClick={() => alert.setEnabled(!alert.enabled)}
            >
              {alert.enabled ? <Volume2 /> : <VolumeX />}
            </IconButton>
          </div>
        }
      />

      <AutoPauseBanner className="mb-4" />

      {alert.blocked && (
        <div className="tone-brand mb-4 flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg">
            <span className="font-semibold">{pendingCount} nouvelle{pendingCount > 1 ? 's' : ''} commande{pendingCount > 1 ? 's' : ''} en attente.</span>{' '}
            Votre navigateur bloque le son tant que vous n’avez pas cliqué sur la page.
          </p>
          <Button size="sm" variant="primary" leftIcon={<Volume2 />} onClick={alert.unlock}>
            Activer le son
          </Button>
        </div>
      )}

      <nav data-scroll-ok aria-label="Vues des commandes" className="mb-5 flex items-center gap-5 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'relative -mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 text-sm font-medium transition-colors [&_svg]:size-4',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )
            }
          >
            <tab.icon />
            {tab.label}
            {tab.to === '/commandes' && activeCount !== undefined && (
              <span className="num rounded-full bg-surface-3 px-1.5 py-px font-mono text-2xs text-fg-muted">{activeCount}</span>
            )}
          </NavLink>
        ))}
      </nav>
      {children}
    </PageContainer>
  );
}

/** Fiche commande dans un tiroir latéral (depuis la file, l'historique ou la carte). */
export function OrderSheet({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const state = useOrder(orderId);
  const order = state.data && state.data.restaurantId === restaurantId ? state.data : null;
  return (
    <Sheet open={Boolean(orderId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-3xl" aria-describedby={undefined}>
        <h2 className="sr-only">Fiche commande</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {state.loading ? (
            <div className="space-y-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-16" />
              <Skeleton className="h-64" />
            </div>
          ) : state.error ? (
            <p className="text-sm text-danger">{errorMessage(state.error)}</p>
          ) : order ? (
            <OrderDetail order={order} compactHeader />
          ) : (
            <p className="text-sm text-fg-muted">Cette commande est introuvable ou n’appartient pas à cet établissement.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
