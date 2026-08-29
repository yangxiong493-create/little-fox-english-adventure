import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './main.jsx';

const rootElement = document.getElementById('root');
const appRoot = rootElement.__littleFoxRoot || createRoot(rootElement);
rootElement.__littleFoxRoot = appRoot;
appRoot.render(
  <React.StrictMode><App /></React.StrictMode>,
);

async function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    if (registration.waiting) window.dispatchEvent(new Event('little-fox-update-ready'));
    const watchWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) window.dispatchEvent(new Event('little-fox-update-ready'));
      });
    };
    watchWorker(registration.installing);
    registration.addEventListener('updatefound', () => watchWorker(registration.installing));
    if (!hadController) {
      await navigator.serviceWorker.ready;
      window.dispatchEvent(new Event('little-fox-offline-ready'));
    }
    window.setInterval(() => registration.update(), 60 * 60 * 1000);
  } catch {
    // Online play remains available if installation is blocked.
  }
}

window.addEventListener('load', registerPwa);
