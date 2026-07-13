import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './', // relative paths → works on GitHub Pages
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['sql-wasm.wasm', 'sql-wasm-browser.wasm', 'icon.svg'],
      manifest: {
        name: 'JWL Backup Manager',
        short_name: 'JWL Merge',
        theme_color: '#0b1120',
        background_color: '#0b1120',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 }, // wasm is ~650 kB, main bundle under limit
    }),
  ],
  // sql.js ships CJS; vite's pre-bundling provides the ESM default-export interop dev mode needs
  optimizeDeps: { include: ['sql.js'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
