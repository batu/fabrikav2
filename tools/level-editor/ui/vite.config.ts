import { defineConfig } from 'vite';

const apiTarget = process.env.LEVEL_EDITOR_API ?? 'http://localhost:5192';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
        target: apiTarget,
        changeOrigin: true,
      },
      '/levels': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/public-levels': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
