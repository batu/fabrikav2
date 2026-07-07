import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameHarness } from "@fabrikav2/testkit/harness";
import { maybeRunInsituTour } from "../../src/testing/insituTour.ts";

function setTourSearch(search: string): void {
  window.history.pushState({}, "", search ? `/${search}` : "/");
}

function makeHarness(driveTo: (state: string) => Promise<boolean>): GameHarness {
  return {
    gotoState: () => {},
    startLevel: () => {},
    snapshot: () => ({ scene: "menu", status: "idle", inputReady: true }),
    sagaNodes: () => [],
    unlockAll: () => {},
    grantCoins: () => {},
    verbs: {},
    winLevel: async () => true,
    failLevel: async () => true,
    driveTo,
  } as GameHarness;
}

describe("_template maybeRunInsituTour — allstates", () => {
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
      "tourstate:level",
      "tourstate:settings",
      "tourstate:pause",
      "tourstate:win",
      "tourstate:fail",
      "tourstate:done",
    ]);
  });

  it("marks a failed state honestly when driveTo returns false", async () => {
    const harness = makeHarness(async (state) => state !== "pause");

    const run = maybeRunInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain("tourstate:pause-FAILED");
    expect(ariaHistory).not.toContain("tourstate:pause");
    expect(ariaHistory.at(-1)).toBe("tourstate:done");
  });

  it("writes one off-screen #__tourstate__ marker with exact final label and text", async () => {
    const harness = makeHarness(async () => true);

    const run = maybeRunInsituTour(harness);
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
});

describe("_template maybeRunInsituTour — no script", () => {
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
