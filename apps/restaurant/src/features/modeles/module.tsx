import { FileText } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'modeles',
  nav: {
    group: 'marketing',
    label: 'Modèles',
    icon: <FileText />,
    order: 60,
    keywords: ['réponses types', 'messages automatiques', 'gabarit'],
    hidden: true, // regroupé dans le hub Marketing (features/marketing)
  },
  permission: 'marketing.manage',
  routes: [{ path: 'modeles', lazy: () => import('./TemplatesPage').then((m) => ({ Component: m.TemplatesPage })) }],
});
