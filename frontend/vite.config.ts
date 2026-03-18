import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192.svg'],
      manifest: {
        name: 'BurdyGurdy',
        short_name: 'BurdyGurdy',
        description: 'Learn to identify birds by their songs, photos, and names',
        theme_color: '#2a2e2b',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'pwa-192.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache the app shell and static assets
        globPatterns: ['**/*.{js,css,html,ico,svg,png,gif,woff2}'],
        runtimeCaching: [
          {
            // Cache eBird taxonomy (changes rarely)
            urlPattern: /\/api\/birds\/.*$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'birds-api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
            },
          },
          {
            // Cache xeno-canto audio files
            urlPattern: /xeno-canto\.org/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 604800 },
            },
          },
          {
            // Cache Macaulay Library photos
            urlPattern: /macaulaylibrary\.org|cdn\.download\.ams\.birds\.cornell\.edu/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'photo-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
