import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      filename: 'sw.js',
      injectRegister: false,
      manifest: false,
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        skipWaiting: true,
      },
    }),
  ],
  // Relative assets let the same build work on localhost and GitHub Pages.
  base: './',
});
