import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './main.jsx';
import { registerPwa } from './pwaUpdates.js';

const rootElement = document.getElementById('root');
const appRoot = rootElement.__littleFoxRoot || createRoot(rootElement);
rootElement.__littleFoxRoot = appRoot;
appRoot.render(
  <React.StrictMode><App /></React.StrictMode>,
);

window.addEventListener('load', registerPwa);
