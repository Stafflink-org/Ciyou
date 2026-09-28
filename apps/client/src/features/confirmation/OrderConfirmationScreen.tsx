// Confirmation (`OrderConfirmationScreen`, §18.1, §10 client.md) — code de
// retrait, « Suivre ma commande » / « Revenir à l'accueil » : lot « checkout » à venir.
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

export function OrderConfirmationScreen() {
  return <PlaceholderScreen icon="✅" title="Commande confirmée" note="Récapitulatif et code de retrait arrivent dans le lot « checkout »." />;
}
