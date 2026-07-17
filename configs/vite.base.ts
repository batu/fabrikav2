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
import { execSync } from "node:child_process";
import type { Plugin, UserConfig } from "vite";

export interface BuildInfo {
  /** Short git SHA of HEAD, or "unknown" outside a git checkout. */
  sha: string;
  /** True when the working tree had uncommitted changes at build time. */
  dirty: boolean;
  /** Consuming workspace's package version (npm_package_version). */
  version: string;
  builtAt: string;
}

function git(command: string): string | null {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Build provenance stamp. The shipped 1.0.2 FTD bundle contained code present
 * in NO commit (built from a drifted worktree) and was untraceable; every
 * bundle now carries its exact origin, both as the `__BUILD_INFO__` define
 * (analytics stamps it on every event) and as `build-info.json` in the output.
 */
export function resolveBuildInfo(): BuildInfo {
  const sha = git("git rev-parse --short=10 HEAD") ?? "unknown";
  const dirty = (git("git status --porcelain") ?? "") !== "";
  return {
    sha,
    dirty,
    version: process.env.npm_package_version ?? "0.0.0",
    builtAt: new Date().toISOString(),
  };
}

function buildInfoPlugin(info: BuildInfo): Plugin {
  return {
    name: "fabrika-build-info",
    generateBundle(): void {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: JSON.stringify(info, null, 2) + "\n",
      });
    },
  };
}

export function baseViteConfig(overrides: UserConfig = {}): UserConfig {
  const info = resolveBuildInfo();
  return {
    ...overrides,
    define: {
      __BUILD_INFO__: JSON.stringify(info),
      ...overrides.define,
    },
    plugins: [buildInfoPlugin(info), ...(overrides.plugins ?? [])],
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
