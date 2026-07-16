import { describe, expect, it } from "vitest";
import { driveTo, isDriveState, type DriveToDeps } from "@fabrikav2/testkit/testing";

/**
 * Headless acceptance for the per-state navigator (fidelity-diff ledger C5),
 * templatized from `games/marble_run/tests/unit/drive-to.test.ts` (card
 * vFSI5FwY). Exercises the PURE `driveTo` against a fake deps object backed by
 * a tiny hand-rolled state machine (kernel `FlowStates` names) — this proves
 * `driveTo` actually REACHES and CONFIRMS each state a fake app can reach.
 */

const instantSleep = (): Promise<void> => Promise.resolve();
const opts = { pollMs: 0, sleep: instantSleep } as const;

type Scene = "menu" | "playing" | "complete" | "failed" | "paused";

interface FakeDeps {
  deps: DriveToDeps;
  scene(): Scene;
  actions: string[];
}

/** A minimal fake mirroring the kernel FlowMachine's canonical scene names —
 *  enough to prove driveTo's confirm-poll logic, without a real port's wiring. */
function makeFakeDeps(overrides: Partial<DriveToDeps> = {}): FakeDeps {
  let scene: Scene = "menu";
  let settingsOpen = false;
  const actions: string[] = [];

  const deps: DriveToDeps = {
    gotoMenu: () => {
      actions.push("gotoMenu");
      scene = "menu";
      settingsOpen = false;
    },
    startLevel: () => {
      actions.push("startLevel");
      scene = "playing";
    },
    openSettings: () => {
      actions.push("openSettings");
      settingsOpen = true;
    },
    pause: () => {
      actions.push("pause");
      if (scene === "playing") scene = "paused";
    },
    autoWin: async () => {
      actions.push("autoWin");
      if (scene === "playing") scene = "complete";
      return scene === "complete";
    },
    autoFail: async () => {
      actions.push("autoFail");
      if (scene === "playing") scene = "failed";
      return scene === "failed";
    },
    snapshot: () => ({ scene, inputReady: true, settingsOpen }),
    ...overrides,
  };

  return { deps, scene: () => scene, actions };
}

describe("_template driveTo — deterministic per-state navigation", () => {
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
    const { deps, scene, actions } = makeFakeDeps();
    expect(await driveTo(deps, "bogus", opts)).toBe(false);
    expect(scene()).toBe("menu");
    expect(actions).toEqual([]);
  });

  it("normalizes through a confirmed menu before opening settings", async () => {
    const { deps, actions } = makeFakeDeps();

    await expect(driveTo(deps, "settings", opts)).resolves.toBe(true);

    expect(actions).toEqual(["gotoMenu", "openSettings"]);
    expect(deps.snapshot()).toMatchObject({ scene: "menu", settingsOpen: true });
  });

  it("waits for an async settings opener before confirming settings", async () => {
    let scene: Scene = "menu";
    let settingsOpen = false;
    const actions: string[] = [];
    const deps: DriveToDeps = {
      gotoMenu: () => {
        actions.push("gotoMenu");
        scene = "menu";
        settingsOpen = false;
      },
      startLevel: () => {
        actions.push("startLevel");
        scene = "playing";
      },
      openSettings: async () => {
        actions.push("openSettings:start");
        await instantSleep();
        settingsOpen = true;
        actions.push("openSettings:done");
      },
      pause: () => {
        actions.push("pause");
        scene = "paused";
      },
      autoWin: async () => {
        actions.push("autoWin");
        scene = "complete";
        return true;
      },
      autoFail: async () => {
        actions.push("autoFail");
        scene = "failed";
        return true;
      },
      snapshot: () => ({ scene, inputReady: true, settingsOpen }),
    };

    await expect(driveTo(deps, "settings", opts)).resolves.toBe(true);

    expect(actions).toEqual(["gotoMenu", "openSettings:start", "openSettings:done"]);
    expect(deps.snapshot()).toMatchObject({ scene: "menu", settingsOpen: true });
  });

  it.each([
    ["level", ["gotoMenu", "startLevel"]] as const,
    ["pause", ["gotoMenu", "startLevel", "pause"]] as const,
    ["win", ["gotoMenu", "startLevel", "autoWin"]] as const,
    ["fail", ["gotoMenu", "startLevel", "autoFail"]] as const,
  ])("normalizes before driving %s", async (state, expectedActions) => {
    const { deps, actions } = makeFakeDeps();

    await expect(driveTo(deps, state, opts)).resolves.toBe(true);

    expect(actions).toEqual(expectedActions);
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

  it.each([
    ["win", "autoWin"] as const,
    ["fail", "autoFail"] as const,
  ])("returns false and never trusts %s driver while gameplay is lifecycle-paused", async (state, driver) => {
    const fake = makeFakeDeps();
    let terminalDriverCalled = false;
    const deps: DriveToDeps = {
      ...fake.deps,
      [driver]: async () => {
        terminalDriverCalled = true;
        return true;
      },
      snapshot: () => ({ ...fake.deps.snapshot(), status: "paused", lifecycleSuspended: true }),
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
