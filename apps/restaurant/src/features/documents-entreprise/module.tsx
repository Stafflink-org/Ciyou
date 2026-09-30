import { FolderOpen } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'documents-entreprise',
  nav: { group: 'equipe', label: 'Documents', icon: <FolderOpen />, order: 70, keywords: ['règlement intérieur', 'procédures', 'formation', 'fichiers'], feature: 'documents' },
  permission: 'documents.view',
  routes: [{ path: 'equipe/documents', lazy: () => import('./DocumentsPage').then((m) => ({ Component: m.DocumentsPage })) }],
});
