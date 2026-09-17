// Manual diagnostic: run with VITE_ENABLE_TEST_HARNESS=true against a dev server on a free port (5199 is often taken by another session).
import { test, expect } from "@playwright/test";

type W = Window & { __FIND_DOG_GAME__?: { scene: { isActive: (k: string) => boolean } } };

test("debug auto play collects birds and advances", async ({ page }) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator("#home-play-now")).toBeVisible({ timeout: 30000 });
  await page.locator("#home-play-now").click({ force: true });
  await page.waitForFunction(() => (window as unknown as W).__FIND_DOG_GAME__?.scene.isActive("GameScene") === true, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const counter = () => page.locator("#dog-counter .count").textContent();
  const before = await counter();
  await page.locator("#settings-btn").click({ force: true });
  const toggle = page.locator("#debug-autoplay-toggle");
  await expect(toggle).toBeVisible({ timeout: 10000 });
  await page.locator("#debug-autoplay-speed").selectOption("0.1");
  await toggle.click({ force: true });
  await page.waitForTimeout(4000);
  const mid = await counter();
  await page.waitForTimeout(10000);
  const after = await counter();
  console.log(JSON.stringify({ before, mid, after, errors: errors.slice(0, 5) }));
  expect(mid).not.toBe(before);
});
