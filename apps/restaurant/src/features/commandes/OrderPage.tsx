// Fiche commande en pleine page (lien direct, notification, impression).
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, SearchX } from 'lucide-react';
import { Button, Card, EmptyState, PageContainer, Skeleton } from '@golink/ui';
import { useDocumentTitle } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { useOrder } from './hooks';
import { OrderActionsProvider } from './components/OrderActions';
import { OrderDetail } from './components/OrderDetail';

export function OrderPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { restaurantId } = useRestaurantAccess();
  const state = useOrder(orderId);
  const order = state.data && state.data.restaurantId === restaurantId ? state.data : null;
  useDocumentTitle(order ? `${order.number} · Commandes · Ciyou Eats Restaurant` : 'Commande · Ciyou Eats Restaurant');

  return (
    <OrderActionsProvider>
      <PageContainer>
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="-ml-2 mb-4" onClick={() => navigate('/commandes')}>
          Retour au service
        </Button>
        {state.loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
            <Skeleton className="h-80" />
          </div>
        ) : state.error ? (
          <Card className="p-6 text-sm text-danger">{errorMessage(state.error)}</Card>
        ) : order ? (
          <OrderDetail order={order} />
        ) : (
          <Card>
            <EmptyState
              icon={<SearchX />}
              title="Commande introuvable"
              description="Cette commande n’existe pas ou appartient à un autre établissement. Vérifiez l’établissement sélectionné."
              action={
                <Button variant="secondary" onClick={() => navigate('/commandes/historique')}>
                  Ouvrir l’historique
                </Button>
              }
            />
          </Card>
        )}
      </PageContainer>
    </OrderActionsProvider>
  );
}
