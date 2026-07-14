import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseViteConfig } from "../../configs/vite.base.ts";

interface SelectedProjection {
  readonly sourcePublicationId: string;
  readonly projectionId: string;
  readonly revisionPath: string;
}

const gameRoot = path.resolve(import.meta.dirname);
const selected = JSON.parse(readFileSync(path.join(gameRoot, "design/revision.json"), "utf8")) as SelectedProjection;
if (!/^sha256-[a-f0-9]{64}$/u.test(selected.projectionId)) throw new Error("Invalid selected Phaser projection ID.");
if (!/^sha256-[a-f0-9]{64}$/u.test(selected.sourcePublicationId)) throw new Error("Invalid selected Phaser publication ID.");
const revisionRoot = path.resolve(gameRoot, selected.revisionPath.replace(/^design\//u, "design/"));
if (!revisionRoot.startsWith(path.join(gameRoot, "design/revisions") + path.sep)) throw new Error("Selected Phaser revision escapes design/revisions.");

export default defineConfig(baseViteConfig({
  server: { port: 5302 },
  publicDir: revisionRoot,
  define: {
    __FABRIKAV2_SELECTED_PROJECTION__: JSON.stringify({
      publicationId: selected.sourcePublicationId,
      projectionId: selected.projectionId,
    }),
  },
}));
