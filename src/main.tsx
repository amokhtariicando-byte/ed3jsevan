import './preload.ts';
import './fonts.ts';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { registerServiceWorker } from './utils/swRegister';
import './index.css';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>,
);
