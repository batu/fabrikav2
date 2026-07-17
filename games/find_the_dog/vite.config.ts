import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { baseViteConfig } from "../../configs/vite.base.ts";

// Per-game dev/build config. The port is the one thing a game overrides; the
// rest (es2022 target, sourcemaps, strictPort) comes from the shared base.
const admobStub = fileURLToPath(new URL('./src/sdk/shims/capacitor-community-admob.ts', import.meta.url));

export default defineConfig(baseViteConfig({
  server: { port: 5199 },
  resolve: { alias: { '@capacitor-community/admob': admobStub } },
}));
