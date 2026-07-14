import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Zeitstempel Arbeitszeiten',
        short_name: 'Zeitstempel',
        description: 'Einfache Arbeitszeiterfassung für Baustellen',
        lang: 'de',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#173f35',
        background_color: '#f4f1e9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
      devOptions: { enabled: true },
    }),
  ],
  test: { environment: 'jsdom', include: ['src/test/**/*.test.ts'], setupFiles: ['./src/test/setup.ts'], restoreMocks: true },
});
