import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './', // relative paths → works on GitHub Pages
  plugins: [svelte()],
  // sql.js ships CJS; vite's pre-bundling provides the ESM default-export interop dev mode needs
  optimizeDeps: { include: ['sql.js'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
