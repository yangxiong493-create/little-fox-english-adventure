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
        // Bundle every fixed voice line so an installed iPad can play the
        // complete adventure after one online visit.
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest,mp3}'],
        navigateFallback: 'index.html',
        skipWaiting: true,
      },
    }),
  ],
  // Relative assets let the same build work on localhost and GitHub Pages.
  base: './',
});
