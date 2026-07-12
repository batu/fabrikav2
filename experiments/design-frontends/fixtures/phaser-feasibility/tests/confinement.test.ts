import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { diffManifests, filterOutsideManifest } from "../scripts/confine-audit.mjs";

describe("worktree confinement comparison", () => {
  it("names created, modified, and deleted paths", () => {
    const before = { "kept.txt": "1:10", "changed.txt": "2:20", "deleted.txt": "3:30" };
    const after = { "kept.txt": "1:10", "changed.txt": "4:40", "created.txt": "5:50" };
    expect(diffManifests(before, after)).toEqual([
      "created: created.txt",
      "modified: changed.txt",
      "deleted: deleted.txt",
    ]);
  });

  it("excludes the fixture subtree but not a similar path prefix", () => {
    const manifest = {
      "outside.txt": "1:1",
      "experiments/probe/inside.txt": "2:2",
      "experiments/probe-sibling/file.txt": "3:3",
    };
    expect(filterOutsideManifest(manifest, "experiments/probe")).toEqual({
      "outside.txt": "1:1",
      "experiments/probe-sibling/file.txt": "3:3",
    });
  });
});
