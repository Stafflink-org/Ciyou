// Notifications : messages automatiques (gabarits modifiables du super admin) remis par
// le centre de notifications, le push, l'e-mail Brevo et le SMS, en simulation ou en réel.
// Les fonctions de ce module sont exportées ici et ré-exportées par src/index.ts ;
// les outils d'envoi (messages.ts, order-messages.ts) sont importés directement par les modules métier.
export { updateNotificationDelivery } from './settings';
