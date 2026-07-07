import { test, expect } from "@playwright/test";
import type { TapTenHarness } from "../../src/shell/harness.ts";

declare global {
  interface Window {
    __TAP_TEN_HARNESS__?: TapTenHarness;
  }
}

test("boots and exposes a browser harness that drives every canonical state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app .tap-ten-screen")).toBeVisible();

  const result = await page.evaluate(async () => {
    const harness = window.__TAP_TEN_HARNESS__;
    if (!harness?.driveTo || !harness.capture) throw new Error("tap_ten harness is not ready");
    const states = ["menu", "level", "settings", "pause", "win", "fail"] as const;
    const reached: Record<string, boolean> = {};
    const scenes: Record<string, unknown> = {};
    for (const state of states) {
      reached[state] = await harness.driveTo(state);
      scenes[state] = harness.snapshot();
    }
    const capture = await harness.capture();
    return { reached, scenes, capture };
  });

  expect(result.reached).toEqual({
    menu: true,
    level: true,
    settings: true,
    pause: true,
    win: true,
    fail: true,
  });
  expect(result.scenes.win).toMatchObject({ scene: "complete", score: 10 });
  expect(result.scenes.fail).toMatchObject({ scene: "failed", misses: 3 });
  expect(result.capture.width).toBeGreaterThan(0);
  expect(result.capture.pngBase64.length).toBeGreaterThan(0);
});
