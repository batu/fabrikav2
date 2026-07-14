import { defineConfig } from "vite";
import { baseViteConfig } from "../../configs/vite.base.ts";

// Per-game dev/build config. The port is the one thing a game overrides; the
// rest (es2022 target, sourcemaps, strictPort) comes from the shared base.
export default defineConfig(baseViteConfig({ server: { port: 5302 } }));
