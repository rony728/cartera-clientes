import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'Cartera de Clientes', short_name: 'Cartera', description: 'Consulta y gestión de comercios y terminales POS',
      theme_color: '#a71930', background_color: '#f5f6f8', display: 'standalone', start_url: '/', scope: '/', lang: 'es-HN',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
    },
    workbox: {
      navigateFallback: '/index.html',
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      runtimeCaching: [{
        urlPattern: /^https:\/\/api-cartera\.rtdev\.uk\/api\//,
        handler: 'NetworkOnly'
      }]
    }
  })],
  server: { port: 5173 },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', globals: true }
});
