import { defineConfig } from "vite";

import { marbleAuthoringPlugin } from "./src/server.ts";

export default defineConfig({
  plugins: [marbleAuthoringPlugin()],
  server: { host: "127.0.0.1", port: 5203, strictPort: true },
  preview: { host: "127.0.0.1", port: 5203, strictPort: true },
});
