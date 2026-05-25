import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Pages serves the app under /study-tracker/ on github.io
export default defineConfig({
  base: '/study-tracker/',
  plugins: [preact()],
});
