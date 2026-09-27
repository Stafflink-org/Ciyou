import { FileText } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'modeles',
  nav: { group: 'marketing', label: 'Modèles', icon: <FileText />, order: 60, keywords: ['réponses types', 'messages automatiques', 'gabarit'] },
  permission: 'marketing.manage',
  routes: [{ path: 'modeles', lazy: () => import('./TemplatesPage').then((m) => ({ Component: m.TemplatesPage })) }],
});
