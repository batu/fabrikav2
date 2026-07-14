import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { baseViteConfig } from "../../configs/vite.base.ts";
import { assertSelectedProjection } from "../../tools/grapes-shell/src/application/projector.ts";

// Per-game dev/build config. The port is the one thing a game overrides; the
// rest (es2022 target, sourcemaps, strictPort) comes from the shared base.
export default defineConfig(async () => {
  const gameRoot = fileURLToPath(new URL(".", import.meta.url));
  await assertSelectedProjection({
    authoringDir: path.join(gameRoot, "authoring", "grapesjs"),
    seedRoot: path.join(gameRoot, "design"),
  });
  return baseViteConfig({ server: { port: 5301 } });
});
