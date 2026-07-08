import { describe, expect, it } from "vitest";
import { driveTo, isDriveState, type DriveToDeps } from "@fabrikav2/testkit/testing";
import { createTapTenHarness } from "../../src/shell/harness.ts";

/**
 * Headless acceptance for the per-state navigator (fidelity-diff ledger C5),
 * templatized from `games/marble_run/tests/unit/drive-to.test.ts` (card
 * vFSI5FwY). Exercises the PURE `driveTo` against a fake deps object backed by
 * a tiny hand-rolled state machine (kernel `FlowStates` names) — this proves
 * `driveTo` actually REACHES and CONFIRMS each state a fake app can reach, and
 * honestly reports `false` for the ones the template's TODO(port) deps don't
 * wire up yet (settings/win/fail/pause never actually transition in a fresh
 * scaffold — see `../../src/shell/harness.ts`).
 */

const instantSleep = (): Promise<void> => Promise.resolve();
const opts = { pollMs: 0, sleep: instantSleep } as const;

type Scene = "menu" | "playing" | "complete" | "failed" | "paused";

interface FakeDeps {
  deps: DriveToDeps;
  scene(): Scene;
}

/** A minimal fake mirroring the kernel FlowMachine's canonical scene names —
 *  enough to prove driveTo's confirm-poll logic, without a real port's wiring. */
function makeFakeDeps(overrides: Partial<DriveToDeps> = {}): FakeDeps {
  let scene: Scene = "menu";
  let settingsOpen = false;

  const deps: DriveToDeps = {
    gotoMenu: () => {
      scene = "menu";
      settingsOpen = false;
    },
    startLevel: () => {
      scene = "playing";
    },
    openSettings: () => {
      settingsOpen = true;
    },
    pause: () => {
      if (scene === "playing") scene = "paused";
    },
    autoWin: async () => {
      if (scene === "playing") scene = "complete";
      return scene === "complete";
    },
    autoFail: async () => {
      if (scene === "playing") scene = "failed";
      return scene === "failed";
    },
    snapshot: () => ({ scene, inputReady: true, settingsOpen }),
    ...overrides,
  };

  return { deps, scene: () => scene };
}

describe("tap_ten driveTo — deterministic per-state navigation", () => {
  it.each([
    ["menu", "menu", undefined] as const,
    ["level", "playing", undefined] as const,
    ["win", "complete", undefined] as const,
    ["fail", "failed", undefined] as const,
    ["pause", "paused", undefined] as const,
    ["settings", "menu", true] as const,
  ])("driveTo(%s) reaches + confirms it against a fake deps object", async (state, scene, settingsOpen) => {
    const { deps } = makeFakeDeps();

    const reached = await driveTo(deps, state, opts);

    expect(reached).toBe(true);
    const snap = deps.snapshot();
    expect(snap.scene).toBe(scene);
    if (settingsOpen !== undefined) expect(snap.settingsOpen).toBe(settingsOpen);
  });

  it("returns false for an unknown state (honest \"did not reach\")", async () => {
    const { deps, scene } = makeFakeDeps();
    expect(await driveTo(deps, "bogus", opts)).toBe(false);
    // No transition attempted beyond the menu normalisation.
    expect(scene()).toBe("menu");
  });

  it("returns false when the terminal driver never reaches the state (confirm-before-resolve)", async () => {
    // A TODO(port) autoWin that never transitions (the template's actual
    // current wiring — `createTemplateHarness`'s `winLevel` always returns
    // `false`) must resolve `driveTo('win')` to an honest `false`, not a bare
    // `true` — the whole point of the confirm poll.
    const { deps } = makeFakeDeps({ autoWin: async () => false });
    const reached = await driveTo(deps, "win", { pollMs: 0, maxPolls: 3, sleep: instantSleep });
    expect(reached).toBe(false);
    expect(deps.snapshot().scene).toBe("playing");
  });

  it.each([
    ["win", "autoWin"] as const,
    ["fail", "autoFail"] as const,
  ])("returns false when %s driver claims success but snapshot stays playing", async (state, driver) => {
    const { deps } = makeFakeDeps({
      [driver]: async () => true,
    });

    const reached = await driveTo(deps, state, { pollMs: 0, maxPolls: 3, sleep: instantSleep });

    expect(reached).toBe(false);
    expect(deps.snapshot().scene).toBe("playing");
  });

  it.each([
    ["win", "autoWin"] as const,
    ["fail", "autoFail"] as const,
  ])("returns false and never trusts %s driver when inputReady never becomes true", async (state, driver) => {
    const fake = makeFakeDeps();
    let terminalDriverCalled = false;
    const deps: DriveToDeps = {
      ...fake.deps,
      [driver]: async () => {
        terminalDriverCalled = true;
        return true;
      },
      snapshot: () => ({ ...fake.deps.snapshot(), inputReady: false }),
    };

    const reached = await driveTo(deps, state, { pollMs: 0, maxPolls: 3, sleep: instantSleep });

    expect(reached).toBe(false);
    expect(terminalDriverCalled).toBe(false);
    expect(deps.snapshot().scene).toBe("playing");
  });
});

describe("isDriveState", () => {
  it("accepts the six canonical states and rejects others", () => {
    for (const s of ["menu", "level", "win", "fail", "settings", "pause"]) {
      expect(isDriveState(s)).toBe(true);
    }
    expect(isDriveState("boot")).toBe(false);
    expect(isDriveState("")).toBe(false);
  });
});

describe("createTapTenHarness driveTo", () => {
  it.each([
    ["menu", "menu", false] as const,
    ["level", "playing", false] as const,
    ["win", "complete", false] as const,
    ["fail", "failed", false] as const,
    ["pause", "paused", false] as const,
    ["settings", "menu", true] as const,
  ])("driveTo(%s) reaches + confirms it on the fresh placeholder harness", async (state, scene, settingsOpen) => {
    const harness = createTapTenHarness({ buildVersion: "test", packageId: "com.fabrikav2.tap_ten" });

    const reached = await harness.driveTo!(state);

    expect(reached).toBe(true);
    expect(harness.snapshot()).toMatchObject({ scene, settingsOpen });
  });
});
