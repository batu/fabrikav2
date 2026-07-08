import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeRunInsituTour, type TourHarness } from "../../src/testing/insituTour.ts";
import type { DriveState } from "../../src/testing/driveTo.ts";

interface HarnessSaveProfile {
  unlockedLevel: number;
  coins: number;
}

function setTourSearch(search: string): void {
  window.history.pushState({}, "", search ? `/${search}` : "/");
}

function makeHarness(
  driveTo: (state: string) => Promise<boolean>,
  overrides: Partial<TourHarness> = {},
): TourHarness {
  return {
    driveTo: async (state: DriveState): Promise<boolean> => {
      const ok = await driveTo(state);
      return ok;
    },
    ...overrides,
  };
}

describe("find_the_dog maybeRunInsituTour — allstates", () => {
  let ariaHistory: string[];

  beforeEach(() => {
    document.body.innerHTML = "";
    setTourSearch("?insituTour=allstates");
    ariaHistory = [];
    vi.stubEnv("VITE_INSITU_TOUR", "");
    const originalSetAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (this.id === "__tourstate__" && name === "aria-label") ariaHistory.push(value);
      return originalSetAttribute.call(this, name, value);
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
    setTourSearch("");
  });

  it("drives every canonical state via driveTo and marks each confirmed state", async () => {
    const seen: string[] = [];
    const harness = makeHarness(async (state) => {
      seen.push(state);
      return true;
    });

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(seen).toEqual(["menu", "level", "settings", "pause", "win", "fail"]);
    expect(ariaHistory).toEqual([
      "tourstate:menu",
      "tourstate:menu-DONE",
      "tourstate:level",
      "tourstate:level-DONE",
      "tourstate:settings",
      "tourstate:settings-DONE",
      "tourstate:pause",
      "tourstate:pause-DONE",
      "tourstate:win",
      "tourstate:win-DONE",
      "tourstate:fail",
      "tourstate:fail-DONE",
      "tourstate:done",
    ]);
  });

  it("resets and seeds save state before the first canonical drive", async () => {
    const calls: string[] = [];
    const harness = makeHarness(
      async (state) => {
        calls.push(`drive:${state}`);
        return true;
      },
      {
        resetSave: () => {
          calls.push("reset");
        },
        seedSave: (profile: HarnessSaveProfile) => {
          calls.push(`seed:${profile.unlockedLevel}:${profile.coins}`);
        },
      },
    );

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(calls.slice(0, 3)).toEqual(["reset", "seed:2:25", "drive:menu"]);
  });

  it("marks a failed state honestly when driveTo returns false", async () => {
    const harness = makeHarness(async (state) => state !== "pause");

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain("tourstate:pause-FAILED");
    expect(ariaHistory).toContain("tourstate:pause");
    expect(ariaHistory.at(-1)).toBe("tourstate:done");
  });

  it("marks the exact state before asking the harness to drive it", async () => {
    let markerAtPauseStart: string | undefined;
    const harness = makeHarness(async (state) => {
      if (state === "pause") markerAtPauseStart = ariaHistory.at(-1);
      return true;
    });

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(markerAtPauseStart).toBe("tourstate:pause");
  });

  it("writes one off-screen #__tourstate__ marker with exact final label and text", async () => {
    const harness = makeHarness(async () => true);

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    const marker = document.getElementById("__tourstate__");
    expect(marker).not.toBeNull();
    expect(document.querySelectorAll("#__tourstate__")).toHaveLength(1);
    expect(marker!.style.cssText).toContain("left: -10000px");
    expect(marker!.style.cssText).not.toContain("opacity");
    expect(marker!.getAttribute("aria-label")).toBe("tourstate:done");
    expect(marker!.textContent).toBe("tourstate:done");
  });
});

describe("find_the_dog maybeRunInsituTour — no script", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
    setTourSearch("");
  });

  it("does nothing when neither env nor URL asks for a tour", async () => {
    document.body.innerHTML = "";
    setTourSearch("");
    vi.stubEnv("VITE_INSITU_TOUR", "");
    let driveToCalled = false;
    const harness = makeHarness(async () => {
      driveToCalled = true;
      return true;
    });

    await maybeRunInsituTour(harness);

    expect(driveToCalled).toBe(false);
    expect(document.getElementById("__tourstate__")).toBeNull();
  });
});
