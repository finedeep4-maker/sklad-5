import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'icons/app-icon-transparent-192.png', 'icons/app-icon-transparent-512.png', 'icons/maskable-512.png', 'qr.html'],
      manifest: {
        id: '/',
        scope: '/',
        start_url: '/',
        lang: 'ru',
        name: 'Склад',
        short_name: 'Склад',
        description: 'Управление складом жилого комплекса',
        theme_color: '#0e7c86',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: '/icons/app-icon-transparent-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/app-icon-transparent-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/qr(\/|$)/, /\/qr\.html$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        qr: fileURLToPath(new URL('./qr.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
