import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// This target serves source/assets only. There is deliberately no backend proxy
// and no dotenv directory: each browser smoke supplies its own API fixtures.
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  envDir: false,
  plugins: [react(), {
    name: 'editor-smoke-no-backend',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (/^\/(api|levels|public-levels)(\/|$)/.test(request.url || '')) {
          response.statusCode = 501;
          response.end('Unmocked API request: editor smoke has no backend');
        } else next();
      });
    },
  }],
  server: { host: '127.0.0.1', strictPort: true },
});
