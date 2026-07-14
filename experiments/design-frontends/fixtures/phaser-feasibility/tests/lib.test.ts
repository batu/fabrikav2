import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { listFiles } from "../scripts/lib.mjs";

describe("deterministic file discovery", () => {
  it("ignores Finder metadata at the canonical walker", () => {
    const root = mkdtempSync(join(tmpdir(), "phaser-feasibility-list-"));
    try {
      writeFileSync(join(root, ".DS_Store"), "noise");
      writeFileSync(join(root, "kept.txt"), "kept");
      expect(listFiles(root).map((path: string) => relative(root, path))).toEqual(["kept.txt"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
