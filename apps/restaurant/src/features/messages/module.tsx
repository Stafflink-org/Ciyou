import { MessageCircle } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useUnreadMessagesCount } from './lib';

export default defineModule({
  id: 'messages',
  nav: {
    group: 'messagerie',
    label: 'Messages',
    icon: <MessageCircle />,
    order: 10,
    href: '/messages',
    badge: useUnreadMessagesCount,
    keywords: ['conversation', 'chat', 'client', 'livreur', 'discussion'],
    feature: 'messaging',
  },
  permission: 'messages.use',
  routes: [{ path: 'messages/:conversationId?', lazy: () => import('./MessagesPage').then((m) => ({ Component: m.MessagesPage })) }],
});
