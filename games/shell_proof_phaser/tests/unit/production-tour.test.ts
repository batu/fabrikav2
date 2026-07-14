import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameConfig } from "../../game.config.ts";
import { createTemplateHarness } from "../../src/shell/harness.ts";
import { maybeRunTemplateInsituTour } from "../../src/shell/insituTour.ts";

function setTourSearch(search: string): void {
  window.history.pushState({}, "", search ? `/${search}` : "/");
}

/**
 * Regression for the Pixel 6a `state=shop-FAILED scene=menu` defect: main.ts
 * passed the seven-state list to the tour but no snapshot predicate, so the
 * testkit default matcher (legacy six states only) failed every custom state
 * even after `driveTo` succeeded. This runs the EXACT production tour
 * configuration (`maybeRunTemplateInsituTour`, the same call main.ts makes)
 * against the real template harness and real controller, and proves every
 * declared surface reaches, retires, and never publishes `-FAILED`.
 */
describe("production seven-surface tour on the real template harness", () => {
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

  it("tours all seven declared surfaces sequentially with no -FAILED marker", async () => {
    expect(gameConfig.screens).toEqual(["menu", "level", "shop", "settings", "pause", "win", "fail"]);
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
    });

    const run = maybeRunTemplateInsituTour(harness);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory.filter((label) => label.includes("-FAILED"))).toEqual([]);
    expect(ariaHistory).toEqual([
      ...gameConfig.screens.flatMap((state) => [`tourstate:${state}`, `tourstate:${state}-DONE`]),
      "tourstate:done",
    ]);
  });
});
