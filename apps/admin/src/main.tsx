import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from '@golink/ui';
import './index.css';
import './i18n';
import { App } from './app/App';

applyTheme('admin');

const root = createRoot(document.getElementById('root')!);

// Vitrine du kit d'interface, servie uniquement en développement sur /_ui.
if (import.meta.env.DEV && window.location.pathname.startsWith('/_ui')) {
  void import('./dev/Showcase.tsx').then(({ Showcase }) => {
    root.render(
      <StrictMode>
        <Showcase />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
