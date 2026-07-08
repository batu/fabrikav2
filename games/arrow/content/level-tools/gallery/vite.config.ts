// Dev-only gallery for arrow levels. Runs `npm run gallery` -> vite dev
// server on port 5190 with an inline API plugin that serves /api/* from
// the arrow workspace root. Never deployed.
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createApi } from "./server/api";

const __dirname = dirname(fileURLToPath(import.meta.url));

function apiPlugin(): Plugin {
  const api = createApi();
  return {
    name: "arrow-gallery-api",
    configureServer(server) {
      server.middlewares.use("/api", async (req, res) => {
        try {
          await api.handle(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: (err as Error).message, stack: (err as Error).stack }));
        }
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  server: { port: 5195, strictPort: true, host: true, allowedHosts: [".trycloudflare.com"] },
  plugins: [apiPlugin()],
});
