import { defineConfig } from "vite";

import { marbleAuthoringPlugin } from "./src/server.ts";

export default defineConfig({
  plugins: [marbleAuthoringPlugin()],
  server: { port: 5203, strictPort: true },
  preview: { port: 5203, strictPort: true },
});
