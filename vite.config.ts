import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './', // relative paths → works on GitHub Pages
  plugins: [svelte()],
  optimizeDeps: { exclude: ['sql.js'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
