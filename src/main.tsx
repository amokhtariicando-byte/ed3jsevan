import './preload.ts';
import './fonts.ts';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { initRemoteMenu } from './data/remoteMenu';
import './index.css';

// In real-API mode the published menu is fetched before the first render
// so every consumer sees the remote data from the start. initRemoteMenu
// never throws and never blocks on failure: without an API base it
// resolves immediately (mock mode / GitHub Pages: static menu), and any
// fetch/validation failure leaves the static menu in place.
async function start(): Promise<void> {
  try {
    await initRemoteMenu();
  } catch {
    // Static menu stays in place.
  }
  createRoot(document.getElementById('root')!).render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
}

void start();
