import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { getDeviceId } from '@/sync/deviceId';
import { syncEngine } from '@/sync/engine';

// Inicializace device_id při prvním spuštění
getDeviceId();

// Start sync engine (no-op pokud nejsou nastavené env vars)
void syncEngine.start();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
