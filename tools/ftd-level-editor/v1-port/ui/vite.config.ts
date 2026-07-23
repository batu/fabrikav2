import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5193,
    host: true,
    allowedHosts: true,
    hmr: {
      // Don't block page load if HMR WebSocket fails (e.g., through Cloudflare tunnel)
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5192',
        changeOrigin: true,
      },
      '/levels': {
        target: 'http://localhost:5192',
        changeOrigin: true,
      },
      '/public-levels': {
        target: 'http://localhost:5192',
        changeOrigin: true,
      },
    },
  },
});
