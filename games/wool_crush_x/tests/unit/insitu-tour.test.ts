import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRIVE_STATES, maybeRunInsituTour, type DriveState, type TourHarness } from "@fabrikav2/testkit/testing";

interface HarnessSaveProfile {
  unlockedLevel?: number;
  coins?: number;
  [gameSpecific: string]: unknown;
}

function snapshotFor(state: string): Record<string, unknown> {
  switch (state) {
    case "level":
      return { activeScene: "GameScene", status: "playing", levelDataReady: true, levelComplete: false };
    case "settings":
      return { activeScene: "HomeScene", status: undefined, settingsOpen: true };
    case "pause":
      return { activeScene: "GameScene", status: "paused", lifecycleSuspended: true };
    case "win":
      return { activeScene: "GameScene", status: "complete", levelComplete: true };
    case "fail":
      return { activeScene: "GameScene", status: "failed", lives: 0 };
    case "menu":
    default:
      return { activeScene: "HomeScene", status: undefined, settingsOpen: false };
  }
}

function setTourSearch(search: string): void {
  window.history.pushState({}, "", search ? `/${search}` : "/");
}

function makeHarness(
  driveTo: (state: string) => Promise<boolean>,
  overrides: Partial<TourHarness> = {},
): TourHarness {
  let currentState = "menu";
  return {
    driveTo: async (state: DriveState): Promise<boolean> => {
      const ok = await driveTo(state);
      if (ok) currentState = state;
      return ok;
    },
    snapshot: () => snapshotFor(currentState),
    ...overrides,
  };
}

function snapshotMatchesFindTheDogDriveState(state: DriveState, raw: unknown): boolean {
  const snapshot = (raw ?? {}) as Record<string, unknown>;
  const scene = String(snapshot.scene ?? snapshot.activeScene ?? "");
  const status = String(snapshot.status ?? "");
  const ready = snapshot.inputReady !== false && snapshot.levelDataReady !== false;
  if (state === "menu") return scene === "menu" || scene === "HomeScene";
  if (state === "level") {
    return ready
      && (scene === "playing" || scene === "GameScene")
      && snapshot.levelComplete !== true
      && status !== "complete"
      && status !== "failed";
  }
  if (state === "settings") return snapshot.settingsOpen === true;
  if (state === "pause") return scene === "paused" || status === "paused" || snapshot.lifecycleSuspended === true;
  if (state === "win") return scene === "complete" || status === "complete" || snapshot.levelComplete === true;
  return scene === "failed" || status === "failed" || snapshot.lives === 0;
}

function runFindTheDogTour(harness: TourHarness): Promise<void> {
  return maybeRunInsituTour(harness, {
    snapshotMatchesState: snapshotMatchesFindTheDogDriveState,
  });
}

describe("find_the_dog maybeRunInsituTour — allstates", () => {
  let ariaHistory: string[];
  let metricsHistory: string[];

  beforeEach(() => {
    document.body.innerHTML = "";
    setTourSearch("?insituTour=allstates");
    ariaHistory = [];
    metricsHistory = [];
    vi.stubEnv("VITE_INSITU_TOUR", "");
    const originalSetAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (this.id === "__tourstate__" && name === "aria-label") ariaHistory.push(value);
      if (this.id === "__viewportmetrics__" && name === "aria-label") metricsHistory.push(value);
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

    const run = runFindTheDogTour(harness);
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

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(calls.slice(0, 3)).toEqual(["reset", "seed:2:25", "drive:menu"]);
  });

  it("marks a failed state honestly when driveTo returns false", async () => {
    const harness = makeHarness(async (state) => state !== "pause");

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain("tourstate:pause-FAILED");
    expect(ariaHistory).not.toContain("tourstate:pause");
    expect(ariaHistory.at(-1)).toBe("tourstate:done");
  });

  it("times out a never-settling driveTo, marks FAILED, and continues the tour", async () => {
    const seen: string[] = [];
    const harness = makeHarness(async (state) => {
      seen.push(state);
      if (state === "settings") return new Promise<boolean>(() => {});
      return true;
    });

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(seen).toEqual(["menu", "level", "settings", "pause", "win", "fail"]);
    expect(ariaHistory).toContain("tourstate:settings-FAILED");
    expect(ariaHistory).not.toContain("tourstate:settings");
    expect(ariaHistory).toContain("tourstate:pause-DONE");
    expect(ariaHistory.at(-1)).toBe("tourstate:done");
  });

  it("retires each exact marker before driving the next state", async () => {
    let markerAtPauseStart: string | undefined;
    const harness = makeHarness(async (state) => {
      if (state === "pause") markerAtPauseStart = ariaHistory.at(-1);
      return true;
    });

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(markerAtPauseStart).toBe("tourstate:settings-DONE");
  });

  it("writes one off-screen #__tourstate__ marker with exact final label and text", async () => {
    const harness = makeHarness(async () => true);

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    const marker = document.getElementById("__tourstate__");
    expect(marker).not.toBeNull();
    expect(document.querySelectorAll("#__tourstate__")).toHaveLength(1);
    expect(marker!.style.cssText).toContain("left: -9999px");
    expect(marker!.style.cssText).not.toContain("opacity");
    expect(marker!.getAttribute("aria-label")).toBe("tourstate:done");
    expect(marker!.textContent).toBe("tourstate:done");
  });

  it("publishes viewport geometry on a separate off-screen accessibility marker for exact states", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 780;
    canvas.height = 1688;
    canvas.style.width = "390px";
    canvas.style.height = "844px";
    document.body.appendChild(canvas);
    const harness = makeHarness(async () => true);

    const run = runFindTheDogTour(harness);
    await vi.runAllTimersAsync();
    await run;

    const marker = document.getElementById("__viewportmetrics__");
    const label = marker?.getAttribute("aria-label") ?? "";
    expect(marker).not.toBeNull();
    expect(marker!.style.cssText).toContain("left: -9999px");
    expect(label).toContain("viewportmetrics:state=tourstate:fail");
    expect(label).toContain("inner=");
    expect(label).toContain("vv=");
    expect(label).toContain("screen=");
    expect(label).toContain("safe=");
    expect(label).toContain("canvas=");
    expect(label).toContain("dpr=");
    expect(marker!.textContent).toBe(label);
    for (const state of DRIVE_STATES) {
      expect(metricsHistory.some((value) => value.startsWith(`viewportmetrics:state=tourstate:${state};`))).toBe(true);
    }
    expect(metricsHistory.some((value) => value.includes("-DONE"))).toBe(false);
    expect(metricsHistory.some((value) => value.includes("-FAILED"))).toBe(false);
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
