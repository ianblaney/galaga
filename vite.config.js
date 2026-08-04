import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works under any path (GitHub Pages
  // project sites serve from /<repo>/, not the domain root).
  base: './',
  server: { open: true, host: true },
  build: { target: 'es2020' },
});
