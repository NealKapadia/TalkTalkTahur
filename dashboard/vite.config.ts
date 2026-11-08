import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@bindings': fileURLToPath(new URL('../bindings/index.ts', import.meta.url)) } },
  server: { port: 5173, fs: { allow: ['..'] } },
});
