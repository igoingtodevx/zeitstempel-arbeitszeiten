import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { convex } from './convex';
import './styles.css';

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Eine neue Version ist verfügbar. Jetzt aktualisieren?')) void updateSW(true);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
