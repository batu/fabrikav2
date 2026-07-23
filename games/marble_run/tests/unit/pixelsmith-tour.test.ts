import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeRunInsituTour, type TourHarness } from "@fabrikav2/testkit/testing";
import {
  PIXELSMITH_TOUR_STATES,
  snapshotMatchesPixelsmithState,
  type PixelsmithState,
} from "../../src/testing/pixelsmithStates";

// The exact per-state snapshot each drive lands on — mirrors the DOM signals the
// real harness surfaces (see pixelsmith-states.test.ts), so the marker only
// fires when the true pixelsmith predicate confirms the state.
const SNAPSHOTS: Record<PixelsmithState, Record<string, unknown>> = {
  "home-fresh": { homeShellVisible: true, settingsOpen: false, shopOpen: false, levelMapVisible: false },
  "level-map": { homeShellVisible: true, levelMapVisible: true, settingsOpen: false, shopOpen: false },
  "gameplay-opener": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-plugs": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-voids": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-teach": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  // UI-truth surfaces (MRV2-8 defects 3/4): win = visible level-complete overlay,
  // pause = in-game settings modal, settings = menu (Close) settings modal.
  win: { activeScene: "GameScene", homeShellVisible: false, levelCompleteOverlayVisible: true },
  pause: { activeScene: "GameScene", homeShellVisible: false, settingsVariant: "ingame" },
  settings: { homeShellVisible: true, settingsVariant: "menu" },
};

// The card's hard external contract: Pixelsmith gives up after 25s.
const MARKER_BUDGET_MS = 25_000;

type PixelsmithTourHarness = TourHarness<PixelsmithState>;

// A single-state build passes saveProfile:null only for home-fresh (its identity
// is an untouched save); every other state uses the default profile.
function runSingleStateTour(state: PixelsmithState, harness: PixelsmithTourHarness): Promise<void> {
  return maybeRunInsituTour(harness, {
    script: "allstates",
    states: [state],
    snapshotMatchesState: snapshotMatchesPixelsmithState,
    saveProfile: state === "home-fresh" ? null : undefined,
  });
}

function makeHarness(
  state: PixelsmithState,
  driveTo: (target: string) => Promise<boolean>,
  overrides: Partial<PixelsmithTourHarness> = {},
): PixelsmithTourHarness {
  let landed = false;
  return {
    driveTo: async (target: string): Promise<boolean> => {
      const ok = await driveTo(target);
      if (ok) landed = true;
      return ok;
    },
    snapshot: () => (landed ? SNAPSHOTS[state] : { homeShellVisible: true }),
    ...overrides,
  };
}

describe("marble_run maybeRunInsituTour — single pixelsmith state", () => {
  let ariaHistory: string[];
  let markerElapsed: Map<string, number>;
  let startTime: number;

  beforeEach(() => {
    document.body.innerHTML = "";
    ariaHistory = [];
    markerElapsed = new Map();
    vi.stubEnv("VITE_INSITU_TOUR", "");
    const originalSetAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (this.id === "__tourstate__" && name === "aria-label") {
        ariaHistory.push(value);
        if (!markerElapsed.has(value)) markerElapsed.set(value, Date.now() - startTime);
      }
      return originalSetAttribute.call(this, name, value);
    });
    vi.useFakeTimers();
    startTime = Date.now();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  for (const state of PIXELSMITH_TOUR_STATES) {
    it(`publishes tourstate:${state} well within the 25s budget`, async () => {
      const harness = makeHarness(state, async () => {
        // A realistic drive settles in a couple seconds; still far inside 25s.
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        return true;
      });

      const run = runSingleStateTour(state, harness);
      await vi.runAllTimersAsync();
      await run;

      expect(ariaHistory).toContain(`tourstate:${state}`);
      expect(ariaHistory).not.toContain(`tourstate:${state}-FAILED`);
      const elapsed = markerElapsed.get(`tourstate:${state}`);
      expect(elapsed).toBeDefined();
      expect(elapsed!).toBeLessThan(MARKER_BUDGET_MS);
    });
  }

  it("marks <state>-FAILED (never the bare state) when the drive never settles", async () => {
    const harness = makeHarness("settings", async () => new Promise<boolean>(() => {}));

    const run = runSingleStateTour("settings", harness);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain("tourstate:settings-FAILED");
    expect(ariaHistory).not.toContain("tourstate:settings");
  });

  it("does not seed the default save profile for home-fresh", async () => {
    const calls: string[] = [];
    const harness = makeHarness(
      "home-fresh",
      async () => true,
      {
        resetSave: () => {
          calls.push("reset");
        },
        seedSave: () => {
          calls.push("seed");
        },
      },
    );

    const run = runSingleStateTour("home-fresh", harness);
    await vi.runAllTimersAsync();
    await run;

    expect(calls).not.toContain("seed");
  });

  it("seeds the default save profile for a non-home-fresh state", async () => {
    const calls: string[] = [];
    const harness = makeHarness(
      "settings",
      async () => true,
      {
        resetSave: () => {
          calls.push("reset");
        },
        seedSave: () => {
          calls.push("seed");
        },
      },
    );

    const run = runSingleStateTour("settings", harness);
    await vi.runAllTimersAsync();
    await run;

    expect(calls).toContain("seed");
  });
});
