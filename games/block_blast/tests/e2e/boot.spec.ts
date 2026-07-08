import { test, expect, type Page } from "@playwright/test";
import type { BlockBlastHarness } from "../../src/shell/harness.ts";

declare global {
  interface Window {
    __BLOCK_BLAST_HARNESS__?: BlockBlastHarness;
  }
}

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

test("boots to menu and starts gameplay through the rendered Play action", async ({ page }) => {
  await page.goto("/");
  const screen = page.locator("#app .block-blast-screen");
  const canvas = page.locator("canvas.block-blast-screen__canvas");
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute("data-scene", "menu");
  await expect(screen).toHaveAttribute("data-surface", "menu");
  await expect(canvas).toBeHidden();
  await expect(page.locator(".block-blast-menu-header")).toHaveCount(0);
  await expectSagaNodesOnRail(page);

  const bootSnapshot = await page.evaluate(() => window.__BLOCK_BLAST_HARNESS__?.snapshot());
  expect(bootSnapshot).toMatchObject({ scene: "menu", status: "idle" });

  await page.locator("[data-fab-action='play']").click();
  await expect(screen).toHaveAttribute("data-scene", "playing");
  await expect(screen).toHaveAttribute("data-surface", "game");
  await expect(canvas).toBeVisible();

  const targetFits = await page
    .locator(".block-blast-screen__stat[data-stat='target'] .block-blast-screen__stat-value")
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(targetFits).toBe(true);

  const reached = await page.evaluate(async () => {
    return window.__BLOCK_BLAST_HARNESS__?.driveTo?.("level");
  });
  expect(reached).toBe(true);
});
