// Notifications (`NotificationsScreen`, §18.1, §14 client.md) : lot notifications à venir
// (source `users/{uid}/notifications`, cf. packages/shared/src/models/users.ts).
import { PlaceholderScreen } from '../shared/PlaceholderScreen';

export function NotificationsScreen() {
  return <PlaceholderScreen icon="🔔" title="Notifications" note="Vos notifications de commande et de promotions arriveront dans un prochain lot." />;
}
