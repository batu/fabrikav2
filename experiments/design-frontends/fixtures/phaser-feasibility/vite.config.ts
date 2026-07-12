import { defineConfig } from "vite";

// The editor project's public/ dir is the web root: the asset pack JSON and
// rasters it references are served/copied verbatim from there.
export default defineConfig({
  publicDir: "editor-project/public",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
});
