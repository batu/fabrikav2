import { test, expect } from "@playwright/test";

test("boots and exposes the Block Blast harness", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app .block-blast-screen")).toBeVisible();
  await expect(page.locator("canvas.block-blast-screen__canvas")).toBeVisible();

  const reached = await page.evaluate(async () => {
    const harness = (window as unknown as { __BLOCK_BLAST_HARNESS__?: { driveTo?: (state: string) => Promise<boolean> } })
      .__BLOCK_BLAST_HARNESS__;
    return harness?.driveTo?.("level");
  });
  expect(reached).toBe(true);
});
