import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../../..");
const gamesRoot = path.join(repoRoot, "games");
const forbiddenTestkitCopies = new Set([
  "driveTo.ts",
  "insituTour.ts",
  "marker.ts",
  "metrics.ts",
  "tourMarker.ts",
  "viewportMetrics.ts",
]);

describe("template testkit duplication guard", () => {
  it("keeps shared testkit modules out of game src/testing folders", () => {
    const duplicated = fs.readdirSync(gamesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const testingDir = path.join(gamesRoot, entry.name, "src", "testing");
        if (!fs.existsSync(testingDir)) return [];
        return fs.readdirSync(testingDir)
          .filter((file) => forbiddenTestkitCopies.has(file))
          .map((file) => path.relative(repoRoot, path.join(testingDir, file)));
      });

    expect(duplicated).toEqual([]);
  });
});
