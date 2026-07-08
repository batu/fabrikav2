import { describe, expect, it } from "vitest";

import { buildSagaNodes, isSagaLevelOpen } from "../../src/shell/saga.js";
import type { Progress } from "../../src/game/persist.js";
import { DEFAULT_JUICE } from "../../src/game/juice.js";

function progress(done: number): Progress {
  return {
    schema: "arrow-progress",
    version: 2,
    packProgress: done > 0 ? { all: done } : {},
    mute: false,
    tutorialSeen: false,
    bestTimeSeconds: 0,
    completions: 0,
    juice: DEFAULT_JUICE,
  };
}

describe("arrow saga map", () => {
  it("renders the 40 authored nodes in indexInPack order", () => {
    const nodes = buildSagaNodes(progress(0));

    expect(nodes).toHaveLength(40);
    expect(nodes.map((node) => node.label)).toEqual(
      Array.from({ length: 40 }, (_, i) => String(i + 1)),
    );
  });

  it("derives locked/current/completed from packProgress", () => {
    const nodes = buildSagaNodes(progress(3));

    expect(nodes[0]?.state).toBe("completed");
    expect(nodes[1]?.state).toBe("completed");
    expect(nodes[2]?.state).toBe("completed");
    expect(nodes[3]?.state).toBe("current");
    expect(nodes[4]?.state).toBe("locked");
  });

  it("opens only completed nodes and the next current node", () => {
    const p = progress(3);

    expect(isSagaLevelOpen(p, 3)).toBe(true);
    expect(isSagaLevelOpen(p, 4)).toBe(true);
    expect(isSagaLevelOpen(p, 5)).toBe(false);
  });
});
