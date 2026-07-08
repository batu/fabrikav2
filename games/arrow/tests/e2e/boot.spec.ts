import { test, expect, type Page } from "@playwright/test";

async function expectSagaNodesOnRail(page: Page): Promise<void> {
  const deltas = await page.locator(".fab-levelmap").evaluate((root) => {
    const path = root.querySelector<HTMLElement>(".fab-levelmap-path");
    if (!path) return [];
    const pathRect = path.getBoundingClientRect();
    const railX = pathRect.left + pathRect.width / 2;
    return Array.from(root.querySelectorAll<HTMLElement>(".fab-levelmap-node-dot")).map((dot) => {
      const rect = dot.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - railX);
    });
  });

  expect(deltas.length).toBeGreaterThan(0);
  for (const delta of deltas) expect(delta).toBeLessThanOrEqual(4);
}

test("boots arrow and exposes the 40-node saga harness", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#scene")).toBeVisible();
  await expect(page.locator("#ui .fab-home-menu")).toBeVisible();
  await expectSagaNodesOnRail(page);

  const snapshot = await page.evaluate(() => {
    const harness = (window as unknown as { __ARROW_HARNESS__?: { snapshot(): Record<string, unknown> } })
      .__ARROW_HARNESS__;
    return harness?.snapshot();
  });

  expect(snapshot).toMatchObject({ scene: "menu" });
  expect(snapshot?.sagaNodeIds).toHaveLength(40);
});
