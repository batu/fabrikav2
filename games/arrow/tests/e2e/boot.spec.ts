import { test, expect } from "@playwright/test";

test("boots arrow and exposes the 40-node saga harness", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#scene")).toBeVisible();
  await expect(page.locator("#ui .fab-home-menu")).toBeVisible();

  const snapshot = await page.evaluate(() => {
    const harness = (window as unknown as { __ARROW_HARNESS__?: { snapshot(): Record<string, unknown> } })
      .__ARROW_HARNESS__;
    return harness?.snapshot();
  });

  expect(snapshot).toMatchObject({ scene: "menu" });
  expect(snapshot?.sagaNodeIds).toHaveLength(40);
});
