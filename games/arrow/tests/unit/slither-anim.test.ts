import { describe, expect, it } from "vitest";

import type { AnimConfig } from "../../src/game/juice.js";
import { toAnimConfig, DEFAULT_JUICE } from "../../src/game/juice.js";
import {
  animDone,
  makeAnim,
  tickAnim,
  type SlitherAnim,
} from "../../src/game/slither-anim.js";

const MEDIUM: AnimConfig = toAnimConfig(DEFAULT_JUICE);

function cfgWith(overrides: Partial<AnimConfig>): AnimConfig {
  return { ...MEDIUM, ...overrides };
}

function exitAnim(
  body: ReadonlyArray<{ x: number; y: number }>,
  ahead: ReadonlyArray<{ x: number; y: number }>,
  cfg: AnimConfig = MEDIUM,
): SlitherAnim {
  return makeAnim(1, "exit", body, ahead, cfg);
}

function collideAnim(
  body: ReadonlyArray<{ x: number; y: number }>,
  ahead: ReadonlyArray<{ x: number; y: number }>,
  cfg: AnimConfig = MEDIUM,
): SlitherAnim {
  return makeAnim(1, "collide", body, ahead, cfg);
}

describe("tickAnim — wind-up beat", () => {
  it("at t=0 with wind-up enabled: tailStretch=0, head frac=0", () => {
    const a = exitAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 2, y: 0 }],
    );
    const f = tickAnim(a, 0);
    expect(f.tailStretch).toBe(0);
    expect(f.head.frac).toBe(0);
    expect(animDone(a)).toBe(false);
  });

  it("at t=windup/2: tailStretch is positive but less than full", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 100 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const f = tickAnim(a, 50);
    expect(f.tailStretch).toBeGreaterThan(0);
    expect(f.tailStretch).toBeLessThan(0.35);
  });

  it("wind-up disabled: tailStretch stays 0, head starts advancing immediately", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const f = tickAnim(a, 50);
    expect(f.tailStretch).toBe(0);
    // By 50ms, slither window has started (cfg.slitherCellsPerSec=12 →
    // 83ms per cell), so head has a non-zero frac.
    expect(f.head.frac).toBeGreaterThan(0);
  });

  it("after wind-up completes: tailStretch drops to 0 for slither", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 80 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    tickAnim(a, 81);
    const f = tickAnim(a, 0);
    expect(f.tailStretch).toBe(0);
  });
});

describe("tickAnim — slither beat", () => {
  it("at mid-slither: head has moved past the original head cell into pathAhead", () => {
    const cfg = cfgWith({ windupEnabled: false, slitherCellsPerSec: 10 });
    // exit walkDistance = body(2) + ahead(2) = 4. slitherMs = 400ms.
    const a = exitAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 2, y: 0 }, { x: 3, y: 0 }],
      cfg,
    );
    tickAnim(a, 200); // easeInOutCubic(0.5)=0.5 → advance=2
    const f = tickAnim(a, 0);
    // head index = (originalLen - 1) + advance = 1 + 2 = 3 → track[3] = pathAhead[1] = (3,0)
    expect(f.head.cell).toEqual({ x: 3, y: 0 });
  });

  it("at start of slither: head starts at original head cell with frac > 0", () => {
    const cfg = cfgWith({ windupEnabled: false, slitherCellsPerSec: 12 });
    const a = exitAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 2, y: 0 }],
      cfg,
    );
    tickAnim(a, 10);
    const f = tickAnim(a, 0);
    // Head starts at the original LAST cell (arrow's head), not [0].
    expect(f.head.cell).toEqual({ x: 1, y: 0 });
    expect(f.head.frac).toBeGreaterThan(0);
    expect(f.head.nextCell).toEqual({ x: 2, y: 0 });
  });

  it("exit slither: tail pops as head advances (body length stays roughly constant)", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = exitAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 3, y: 0 }, { x: 4, y: 0 }],
      cfg,
    );
    // Step roughly 2 cells in; exit body should include 2 cells behind head.
    const cellMs = 1000 / cfg.slitherCellsPerSec;
    tickAnim(a, cellMs * 2.2);
    const f = tickAnim(a, 0);
    // bodyCells should be at most originalCells.length - 1 = 2.
    expect(f.bodyCells.length).toBeLessThanOrEqual(2);
  });

  it("collide slither: body grows, tail never pops", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = collideAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 2, y: 0 }, { x: 3, y: 0 }],
      cfg,
    );
    const cellMs = 1000 / cfg.slitherCellsPerSec;
    tickAnim(a, cellMs * 1.5);
    const f = tickAnim(a, 0);
    // Body must include original tail (x=0).
    expect(f.bodyCells.some((c) => c.x === 0 && c.y === 0)).toBe(true);
  });
});

describe("tickAnim — exit streak-fade", () => {
  it("after slither completes: alpha tapers to 0 over fade window", () => {
    const cfg = cfgWith({ windupEnabled: false, exitStreakFade: true });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Advance past slither end.
    const cellMs = 1000 / cfg.slitherCellsPerSec;
    tickAnim(a, cellMs * 3 + 1);
    const f1 = tickAnim(a, 50); // mid fade
    expect(f1.alpha).toBeGreaterThan(0);
    expect(f1.alpha).toBeLessThan(1);
    tickAnim(a, 200); // past fade
    expect(animDone(a)).toBe(true);
  });

  it("streak-fade disabled: anim ends immediately at slither end", () => {
    const cfg = cfgWith({ windupEnabled: false, exitStreakFade: false });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const cellMs = 1000 / cfg.slitherCellsPerSec;
    tickAnim(a, cellMs * 3 + 1);
    expect(animDone(a)).toBe(true);
  });
});

describe("tickAnim — collide impact", () => {
  it("recoil + shake active during hold window, done after", () => {
    const cfg = cfgWith({
      windupEnabled: false,
      headRecoil: true,
      bodyShake: true,
      collisionHoldMs: 200,
    });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Collide slither duration = aheadLen(1) / cps(12) = ~83ms.
    // Advance just past slither end to land inside the hold window.
    tickAnim(a, 90);
    // Mid-hold — shake should be non-zero.
    const mid = tickAnim(a, 50);
    expect(mid.shake.dx !== 0 || mid.shake.dy !== 0).toBe(true);
    expect(animDone(a)).toBe(false);
    // Past hold — anim done.
    tickAnim(a, 300);
    expect(animDone(a)).toBe(true);
  });

  it("recoil disabled: frac stays 0 through hold", () => {
    const cfg = cfgWith({
      windupEnabled: false,
      headRecoil: false,
      bodyShake: false,
      collisionHoldMs: 200,
    });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    tickAnim(a, 90);
    const mid = tickAnim(a, 50);
    expect(mid.head.frac).toBe(0);
    expect(mid.shake.dx).toBe(0);
    expect(mid.shake.dy).toBe(0);
  });

  it("body is intact throughout collide hold (never pops tail)", () => {
    const cfg = cfgWith({ windupEnabled: false, collisionHoldMs: 200 });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], [{ x: 3, y: 0 }], cfg);
    // Collide slither duration ≈ 83ms; advance to mid-hold.
    tickAnim(a, 100);
    const f = tickAnim(a, 0);
    expect(f.bodyCells.some((c) => c.x === 0 && c.y === 0)).toBe(true);
  });
});

describe("collide return phase — head eases back after the hold", () => {
  it("after the hold, head slides back toward originalCells[last] over RETURN_MS", () => {
    const cfg = cfgWith({ windupEnabled: false, headRecoil: false, bodyShake: false, collisionHoldMs: 100 });
    // Simple body-then-ahead so advance=0 lands the head at originalCells[last]=(1,0).
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Advance past slither (~83ms) + past the 100ms hold.
    tickAnim(a, 90); // slither done, first hold frame
    tickAnim(a, 100); // just past hold end, entering return
    const midReturn = tickAnim(a, 0);
    // In the return phase, head.cell should have moved back from
    // the collision cell (2,0) toward originalCells[last] (1,0).
    // At rp≈0 it's still at collision; at rp≈1 it's at originalCells[last].
    // We're just after entry: head should still be near collision.
    expect(midReturn.head.cell.x).toBeGreaterThanOrEqual(1);
    expect(midReturn.head.cell.x).toBeLessThanOrEqual(2);

    // Advance past return → anim done.
    tickAnim(a, 200);
    expect(animDone(a)).toBe(true);
  });
});

describe("impactJustHappened — fires exactly once at head arrival (collide only)", () => {
  it("first hold frame has impactJustHappened=true; subsequent frames false", () => {
    const cfg = cfgWith({ windupEnabled: false, collisionHoldMs: 200 });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Advance past slither end (≈83ms) — first hold frame is the impact.
    const impactFrame = tickAnim(a, 90);
    expect(impactFrame.impactJustHappened).toBe(true);
    // Subsequent ticks: flag is false.
    const later = tickAnim(a, 30);
    expect(later.impactJustHappened).toBe(false);
  });

  it("exit anims never report impact", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    for (let i = 0; i < 10; i++) {
      const f = tickAnim(a, 40);
      expect(f.impactJustHappened).toBe(false);
    }
  });
});

describe("activationBlend — ink → blue fade during wind-up", () => {
  it("at t=0 with wind-up enabled: activationBlend=0 (full ink, no blue yet)", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 100 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const f = tickAnim(a, 0);
    expect(f.activationBlend).toBe(0);
  });

  it("mid wind-up: activationBlend is between 0 and 1", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 100 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const f = tickAnim(a, 50);
    expect(f.activationBlend).toBeGreaterThan(0);
    expect(f.activationBlend).toBeLessThan(1);
  });

  it("after wind-up: activationBlend = 1 (full blue)", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 80 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    tickAnim(a, 81);
    const f = tickAnim(a, 0);
    expect(f.activationBlend).toBe(1);
  });

  it("wind-up disabled: activationBlend = 1 immediately", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const f = tickAnim(a, 0);
    // wEnd = 0 → t < wEnd is false → slither branch → activationBlend = 1
    expect(f.activationBlend).toBe(1);
  });
});

describe("tailAnchor — anti-head direction at the tail-end segment", () => {
  it("straight east-pointing arrow: anchor is one cell west of tail", () => {
    // body [(0,0),(1,0),(2,0)] → head (3,0). head-dir = E.
    // tailAnchor = body[0] - body[1] applied to body[0] = (0,0) - ((1,0)-(0,0)) = (-1, 0).
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], [{ x: 3, y: 0 }]);
    expect(a.tailAnchor).toEqual({ x: -1, y: 0 });
  });

  it("straight south-pointing arrow: anchor is one cell north of tail", () => {
    const a = exitAnim([{ x: 2, y: 0 }, { x: 2, y: 1 }], [{ x: 2, y: 2 }]);
    expect(a.tailAnchor).toEqual({ x: 2, y: -1 });
  });

  it("L-shape pointing down (S head-dir): anchor follows tail arm, NOT opposite head-dir", () => {
    // body [(3,0),(2,0),(1,0),(0,0),(0,1)] → head (0,2). head-dir = S.
    // Tail-end segment: body[0]→body[1] is (3,0)→(2,0) = W. Anti = E.
    // tailAnchor = body[0] + (body[0] - body[1]) = (3,0) + (1,0) = (4,0).
    // If we used -headDir we'd get (0, -1) / N from (3,0) = (3, -1). Distinct.
    const a = exitAnim(
      [{ x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      [{ x: 0, y: 2 }],
    );
    expect(a.tailAnchor).toEqual({ x: 4, y: 0 });
    // Sanity: not the head-dir-reversed answer.
    expect(a.tailAnchor).not.toEqual({ x: 3, y: -1 });
  });

  it("AnimFrame carries tailAnchor from the anim through every frame", () => {
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }]);
    const f0 = tickAnim(a, 0);
    expect(f0.tailAnchor).toEqual(a.tailAnchor);
    // Advance into slither — still the same anchor.
    tickAnim(a, 200);
    const f1 = tickAnim(a, 0);
    expect(f1.tailAnchor).toEqual(a.tailAnchor);
  });
});

describe("wind-up — head stays fixed at its rest position", () => {
  it("during wind-up, frame.head.cell === originalCells[last]", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 100 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Sample across the wind-up window.
    for (const dt of [0, 20, 50, 99]) {
      const f = tickAnim(a, dt === 0 ? 0 : dt - a.t);
      expect(f.head.cell).toEqual({ x: 1, y: 0 });
      expect(f.head.frac).toBe(0);
    }
  });
});

describe("tickAnim — tailFrac matches head frac during exit slither", () => {
  it("exit: tailFrac tracks head frac (rigid-length snake — both ends advance together)", () => {
    const cfg = cfgWith({ windupEnabled: false, slitherCellsPerSec: 10 });
    const a = exitAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 3, y: 0 }, { x: 4, y: 0 }],
      cfg,
    );
    // Advance to a mid-slither point with non-zero frac.
    tickAnim(a, 200);
    const f = tickAnim(a, 0);
    expect(f.tailFrac).toBe(f.head.frac);
  });

  it("collide: tailFrac stays 0 (tail doesn't move, body grows into pathAhead)", () => {
    const cfg = cfgWith({ windupEnabled: false });
    const a = collideAnim(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 2, y: 0 }, { x: 3, y: 0 }],
      cfg,
    );
    tickAnim(a, 50);
    const mid = tickAnim(a, 0);
    expect(mid.tailFrac).toBe(0);
    expect(mid.head.frac).toBeGreaterThan(0);
  });
});

describe("tickAnim — headFacing stays fixed through every beat", () => {
  it("exit: headFacing = arrow's original head direction through slither + fade", () => {
    const cfg = cfgWith({ windupEnabled: false, exitStreakFade: true });
    // body walks east: (0,0) → (1,0) → (2,0), head-dir = E
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], [{ x: 3, y: 0 }], cfg);
    const f0 = tickAnim(a, 0);
    expect(f0.headFacing).toBe("E");
    tickAnim(a, 50);
    expect(tickAnim(a, 0).headFacing).toBe("E");
    // Advance deep into fade.
    tickAnim(a, 1000);
    expect(tickAnim(a, 0).headFacing).toBe("E");
  });

  it("collide: headFacing stays forward even during recoil (no triangle flip)", () => {
    const cfg = cfgWith({ windupEnabled: false, headRecoil: true, collisionHoldMs: 200 });
    // head-dir = S: (0,0) → (0,1) → (0,2)
    const a = collideAnim([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }], [{ x: 0, y: 3 }], cfg);
    tickAnim(a, 90);
    // Mid-recoil: head.nextCell points BACK (N), but headFacing stays S.
    const mid = tickAnim(a, 50);
    expect(mid.headFacing).toBe("S");
    // head.nextCell is set to the previous cell during recoil-out/in,
    // which would flip a naive triangle-dir inference.
    if (mid.head.nextCell) {
      const dy = mid.head.nextCell.y - mid.head.cell.y;
      expect(dy).toBe(-1); // pointing N, i.e., backward
    }
  });
});

describe("tickAnim — collide recoil is continuous and monotonic through the in-phase", () => {
  it("recoil frac decreases monotonically through in-phase (no teleport, no double-bounce)", () => {
    const cfg = cfgWith({
      windupEnabled: false,
      headRecoil: true,
      bodyShake: false,
      collisionHoldMs: 200,
    });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    // Advance past slither end (collide slither ≈ 83 ms at 12 cps).
    tickAnim(a, 90);
    // Sample at out-end, then at several points across in-phase.
    // outMs = 60, inMs = 90. So in-phase spans t ∈ [150, 240) measured
    // from the slither end (we're already ~7ms past slither end, so
    // feed ~60ms to reach out-end, then sample the in-phase.
    tickAnim(a, 53); // now t ≈ 90 + 53 = 143 → holdT ≈ 60 (out-end)
    const outEnd = tickAnim(a, 0);
    // At the out-end, frac should be ~RECOIL_DEPTH (0.35).
    expect(outEnd.head.frac).toBeGreaterThan(0.3);

    const samples: number[] = [outEnd.head.frac];
    // Walk 5 more steps into the in-phase.
    for (let i = 0; i < 5; i++) {
      tickAnim(a, 16); // ~16ms each
      samples.push(tickAnim(a, 0).head.frac);
    }
    // Assert monotonic non-increasing.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]! + 1e-9);
    }
    // And we moved meaningfully toward 0.
    expect(samples[samples.length - 1]!).toBeLessThan(samples[0]!);
  });
});

describe("tickAnim — empty frame after done", () => {
  it("exit with streak-fade off: done=true, next tick returns empty frame", () => {
    const cfg = cfgWith({ windupEnabled: false, exitStreakFade: false });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    const cellMs = 1000 / cfg.slitherCellsPerSec;
    tickAnim(a, cellMs * 10);
    expect(animDone(a)).toBe(true);
    const f = tickAnim(a, 0);
    expect(f.bodyCells.length).toBe(0);
  });
});

describe("makeAnim — animSkipMs pre-roll", () => {
  it("animSkipMs=0 starts anim.t at 0 (default behaviour)", () => {
    const cfg = cfgWith({ animSkipMs: 0 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    expect(a.t).toBe(0);
  });

  it("animSkipMs=80 seeds anim.t at 80 so next tick evaluates past wind-up (windup=80)", () => {
    const cfg = cfgWith({ windupEnabled: true, windupDurationMs: 80, animSkipMs: 80 });
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    expect(a.t).toBe(80);
    // First tick with any positive dt should land in the slither window
    // (t > windupDurationMs), not the wind-up window.
    const f = tickAnim(a, 1);
    expect(f.tailStretch).toBe(0);
  });

  // Reviewer P1 regression: short collide anims with a high animSkipMs
  // used to seed t past sEnd, making the first tick land in the RETURN
  // or done branch — impactJustHappened never fired, collision feedback
  // was lost. makeAnim now caps seedT at sEnd so the first tick always
  // enters HOLD.
  it("collide with short slither + high animSkipMs still fires impact on first tick", () => {
    const cfg = cfgWith({
      windupEnabled: false,
      slitherCellsPerSec: 24,
      collisionHoldMs: 100,
      animSkipMs: 200,
    });
    // aheadLen=1 → slitherMs ~41.67ms → sEnd ~41.67ms.
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    expect(a.t).toBeLessThanOrEqual(42); // capped at sEnd
    const f = tickAnim(a, 16);
    expect(f.impactJustHappened).toBe(true);
  });

  it("exit with short slither + high animSkipMs doesn't mark anim done on first tick", () => {
    const cfg = cfgWith({
      windupEnabled: false,
      slitherCellsPerSec: 24,
      exitStreakFade: true,
      animSkipMs: 200,
    });
    // originalLen=2, aheadLen=1 → targetAdvance=3 → slitherMs=125ms.
    const a = exitAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    expect(a.t).toBeLessThanOrEqual(125); // capped at sEnd
    tickAnim(a, 16);
    expect(animDone(a)).toBe(false);
  });

  it("windupEnabled=true with animSkipMs > sEnd also caps at sEnd (collide still fires impact)", () => {
    // windupDurationMs=100 + slitherCellsPerSec=24 + aheadLen=1 →
    // slitherMs=41.67 → sEnd=141.67ms. animSkipMs=200 should cap.
    const cfg = cfgWith({
      windupEnabled: true,
      windupDurationMs: 100,
      slitherCellsPerSec: 24,
      collisionHoldMs: 100,
      animSkipMs: 200,
    });
    const a = collideAnim([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 2, y: 0 }], cfg);
    expect(a.t).toBeLessThanOrEqual(142);
    const f = tickAnim(a, 16);
    expect(f.impactJustHappened).toBe(true);
  });
});
