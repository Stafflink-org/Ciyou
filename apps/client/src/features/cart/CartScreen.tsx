// Panier (`CartScreen`, §18.1, §7 client.md) — modale plein écran depuis le sac
// / bouton flottant : lot « panier / checkout » à venir.
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

export function CartScreen() {
  return <PlaceholderScreen icon="🛒" title="Votre panier" note="Le panier mono-restaurant, les options et les offres automatiques arrivent dans le lot « panier »." />;
}
