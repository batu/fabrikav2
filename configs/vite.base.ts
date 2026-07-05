// Shared Vite base config helper for fabrika v2 games and packages.
//
// Consume from a workspace's vite.config.ts:
//   import { defineConfig } from "vite";
//   import { baseViteConfig } from "../../configs/vite.base";
//   export default defineConfig(baseViteConfig({ server: { port: 5200 } }));
//
// One pinned Vite major at root (v1 drifted; see
// docs/research/06-shared-package-audit.md §3). Keep this thin — per-workspace
// specifics (ports, plugins) go in the workspace's own config via overrides.
import type { UserConfig } from "vite";

export function baseViteConfig(overrides: UserConfig = {}): UserConfig {
  return {
    ...overrides,
    build: {
      target: "es2022",
      sourcemap: true,
      ...overrides.build,
    },
    server: {
      strictPort: true,
      ...overrides.server,
    },
  };
}
